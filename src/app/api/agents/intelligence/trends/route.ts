import { NextResponse } from 'next/server'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase'
import { braveSearch } from '@/lib/brave'
import { logAgentRun } from '@/lib/log'
import { isUuid } from '@/lib/validation'
import { industrySubreddits } from '@/lib/subreddits'
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// Trend Radar — reads what is actually hot in the client's communities right
// now, cross-references it with trending industry news, and decides what is
// worth posting about. Anything urgent enough to post today is drafted and
// dropped into the approvals queue rather than published.
//
// Runs daily, so the synthesis is deliberately on the cheap model and every
// external source is best-effort: a throttled Reddit or a missing Brave key
// narrows the input instead of failing the run.

const MAX_SUBREDDITS = 3
const MAX_KEYWORDS = 3
const HOT_LIMIT = 10
const RECENCY_SECONDS = 172_800 // 48 hours
const FETCH_TIMEOUT_MS = 10_000
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

const UA = 'BusinessOS/1.0'

export type Trend = {
  topic: string
  relevance_score: number
  urgency: string
  content_angle: string
  suggested_hook: string
  platform: string
}

export type TrendAnalysis = {
  trends: Trend[]
  top_opportunity: string
}

type HotPost = {
  subreddit: string
  title: string
  score: number
  num_comments: number
  age_hours: number
}

type SearchHit = { label: string; title: string; description: string }

const SYSTEM_PROMPT = `You are a content trend analyst. Identify trending topics relevant to a specific business's audience.

Return ONLY valid JSON:
{
  trends: array of {
    topic: string,
    relevance_score: number (1-10, how relevant to this business's ICP),
    urgency: 'post today' | 'this week' | 'monitor',
    content_angle: string (how this business should approach this topic),
    suggested_hook: string (a specific opening line for a social post),
    platform: 'linkedin' | 'twitter' | 'both'
  },
  top_opportunity: string (the single best content opportunity right now, 1 sentence)
}`

// ── Reddit hot feed ────────────────────────────────────────────────────────
async function fetchHot(subreddit: string): Promise<HotPost[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${HOT_LIMIT}`,
      {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    )

    if (res.status === 429) {
      console.warn('[trends] reddit rate limited (429) on r/' + subreddit)
      return []
    }
    if (!res.ok) {
      console.warn('[trends] reddit HTTP', res.status, 'on r/' + subreddit)
      return []
    }

    const json = await res.json()
    const children = json?.data?.children
    if (!Array.isArray(children)) return []

    const nowSec = Date.now() / 1000
    const cutoff = nowSec - RECENCY_SECONDS

    return children
      .map((c: any) => c?.data)
      .filter(Boolean)
      .filter((d: any) => Number(d.created_utc) > cutoff)
      .map((d: any) => ({
        subreddit,
        title: String(d.title || ''),
        score: Number(d.score) || 0,
        num_comments: Number(d.num_comments) || 0,
        age_hours: Math.max(0, Math.round((nowSec - Number(d.created_utc)) / 3600)),
      }))
      .filter((p: HotPost) => p.title)
  } catch (e) {
    console.warn('[trends] hot feed failed for r/' + subreddit + ':', e)
    return []
  }
}

// ── Brand context ──────────────────────────────────────────────────────────
type BrandContext = {
  company_name: string
  icp_summary: string
  tone_description: string
}

const GENERIC_BRAND: BrandContext = {
  company_name: 'this business',
  icp_summary: 'small business owners',
  tone_description: 'clear, practical, no jargon',
}

async function loadBrandContext(client_id: string): Promise<BrandContext> {
  try {
    const { data } = await supabaseAdmin
      .from('brand_profiles')
      .select('company_name, icp_summary, tone_description')
      .eq('client_id', client_id)
      .maybeSingle()

    if (!data) return GENERIC_BRAND

    // A profile can exist with individual fields still blank, so each one
    // falls back independently rather than all-or-nothing.
    return {
      company_name: data.company_name || GENERIC_BRAND.company_name,
      icp_summary: data.icp_summary || GENERIC_BRAND.icp_summary,
      tone_description: data.tone_description || GENERIC_BRAND.tone_description,
    }
  } catch (e) {
    console.warn('[trends] brand profile lookup failed:', e)
    return GENERIC_BRAND
  }
}

// ── Prompt ─────────────────────────────────────────────────────────────────
function buildUserMessage(
  industry: string,
  brand: BrandContext,
  posts: HotPost[],
  hits: SearchHit[],
): string {
  const parts: string[] = []

  parts.push(`Business: ${brand.company_name}`)
  parts.push(`Industry: ${industry}`)
  parts.push(`Their ICP: ${brand.icp_summary}`)
  parts.push(`Their tone: ${brand.tone_description}`)
  parts.push('')
  parts.push(
    'Score relevance_score by how closely each trend affects THIS ICP specifically, not the industry in general.',
  )
  parts.push('')

  parts.push('REDDIT — HOT IN THE LAST 48 HOURS')
  if (posts.length === 0) {
    parts.push('(no recent hot posts retrieved)')
  } else {
    for (const p of posts) {
      parts.push(
        `* r/${p.subreddit} [${p.score} upvotes, ${p.num_comments} comments, ${p.age_hours}h ago] ${p.title}`,
      )
    }
  }
  parts.push('')

  parts.push('TRENDING SEARCH RESULTS')
  if (hits.length === 0) {
    parts.push('(no search results available)')
  } else {
    for (const h of hits) {
      parts.push(`* [${h.label}] ${h.title} — ${h.description}`)
    }
  }

  return parts.join('\n')
}

const VALID_URGENCY = ['post today', 'this week', 'monitor']
const VALID_PLATFORM = ['linkedin', 'twitter', 'both']

// Urgency drives a real side effect (a queued draft), so an unrecognised value
// must not be allowed to trigger one — anything unexpected degrades to
// 'monitor' rather than 'post today'.
function coerceAnalysis(raw: any): TrendAnalysis {
  const rows = Array.isArray(raw?.trends) ? raw.trends : []

  return {
    trends: rows.map((t: any) => {
      const score = Number(t?.relevance_score)
      const urgency = String(t?.urgency ?? '').toLowerCase().trim()
      const platform = String(t?.platform ?? '').toLowerCase().trim()

      return {
        topic: String(t?.topic ?? ''),
        relevance_score: Number.isFinite(score)
          ? Math.min(10, Math.max(1, Math.round(score)))
          : 1,
        urgency: VALID_URGENCY.includes(urgency) ? urgency : 'monitor',
        content_angle: String(t?.content_angle ?? ''),
        suggested_hook: String(t?.suggested_hook ?? ''),
        platform: VALID_PLATFORM.includes(platform) ? platform : 'both',
      }
    }),
    top_opportunity: String(raw?.top_opportunity ?? '').trim(),
  }
}

// ── Approvals ──────────────────────────────────────────────────────────────
async function queueDrafts(client_id: string, trends: Trend[]): Promise<number> {
  const urgent = trends.filter((t) => t.urgency === 'post today' && t.topic)
  if (urgent.length === 0) return 0

  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()

  const rows = urgent.map((trend) => ({
    client_id,
    action_type: 'content_draft',
    payload_json: {
      topic: trend.topic,
      suggested_hook: trend.suggested_hook,
      platform: trend.platform,
      content_angle: trend.content_angle,
      source: 'trend_radar',
      urgency: 'post today',
      // The dashboard's approvals card renders payload_json.description as its
      // subtitle. Without it the reviewer sees "Content Draft" and nothing
      // else, and would be approving blind.
      description: trend.suggested_hook || trend.content_angle || trend.topic,
    },
    status: 'pending',
    expires_at,
  }))

  const { error } = await supabaseAdmin.from('approvals_queue').insert(rows)

  if (error) {
    // The trends themselves are still worth returning, so a queue failure is
    // reported rather than thrown.
    console.error('[trends] approvals_queue insert failed:', error.message)
    return 0
  }

  return rows.length
}

// ── Run ────────────────────────────────────────────────────────────────────
export async function runTrendRadar(params: {
  client_id?: string
  industry?: string
  keywords?: string[]
}): Promise<{ status: number; body: any }> {
  const startedAt = Date.now()

  if (!process.env.OPENROUTER_API_KEY) {
    return { status: 503, body: { error: 'OPENROUTER_API_KEY missing' } }
  }

  if (!isUuid(params.client_id)) return { status: 400, body: { error: 'A valid client_id is required.' } }
  const client_id = params.client_id
  const industry = String(params.industry || '').trim()

  const keywords = (Array.isArray(params.keywords) ? params.keywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)

  if (!industry) {
    return { status: 400, body: { error: 'industry is required' } }
  }
  if (keywords.length === 0) {
    return { status: 400, body: { error: 'At least one keyword required' } }
  }

  const subreddits = industrySubreddits(industry).slice(0, MAX_SUBREDDITS)

  if (!process.env.BRAVE_API_KEY) {
    console.warn('[trends] BRAVE_API_KEY not set — continuing with Reddit only')
  }

  try {
    // Reddit, search and the brand lookup are independent of each other.
    const hotPromise = Promise.all(subreddits.map(fetchHot))

    const searchPromise = Promise.all([
      ...keywords.slice(0, MAX_KEYWORDS).map(async (keyword): Promise<SearchHit[]> =>
        (await braveSearch(`${industry} ${keyword} 2026 trending OR viral OR news`, 4)).map(
          (r) => ({ label: keyword, title: r.title, description: r.description }),
        ),
      ),
      (async (): Promise<SearchHit[]> =>
        (await braveSearch(`${industry} news this week`, 3)).map((r) => ({
          label: 'this week',
          title: r.title,
          description: r.description,
        })))(),
    ])

    const [hotGroups, hitGroups, brand] = await Promise.all([
      hotPromise,
      searchPromise,
      loadBrandContext(client_id),
    ])

    // Loudest first, so the excerpt the model sees leads with real signal.
    const posts = hotGroups.flat().sort((a, b) => b.score - a.score)
    const hits = hitGroups.flat()

    const ai = await callAI({
      model: MODELS.HAIKU,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(industry, brand, posts, hits),
      maxTokens: 2000,
    })

    const analysis = coerceAnalysis(parseJSON(ai.text))
    const postTodayCount = await queueDrafts(client_id, analysis.trends)
    const tokensUsed = ai.inputTokens + ai.outputTokens

    const summary =
      analysis.top_opportunity ||
      (analysis.trends[0]?.topic
        ? `Top trend: ${analysis.trends[0].topic}`
        : 'No actionable trends found.')

    await logAgentRun({
      client_id,
      agent_type: 'trend_radar',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.cost,
      output_summary: summary,
      metadata: {
        trends_found: analysis.trends.length,
        post_today_count: postTodayCount,
        reddit_posts_scanned: posts.length,
        search_results: hits.length,
        subreddits,
        industry,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        trends: analysis.trends,
        top_opportunity: analysis.top_opportunity,
        post_today_count: postTodayCount,
        reddit_posts_scanned: posts.length,
        search_results_found: hits.length,
        subreddits_scanned: subreddits,
        tokens_used: tokensUsed,
        cost_usd: ai.cost,
        response_time_ms: Date.now() - startedAt,
      },
    }
  } catch (err: any) {
    console.error('[trends] run failed:', err)

    await logAgentRun({
      client_id,
      agent_type: 'trend_radar',
      status: 'failed',
      output_summary: err?.message || String(err),
      metadata: { industry, keywords: keywords.length },
    })

    return { status: 500, body: { error: err?.message || String(err) } }
  }
}

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json()
    const { status, body: result } = await runTrendRadar({
      client_id: clientId,
      industry: body?.industry,
      keywords: body?.keywords,
    })
    return NextResponse.json(result, { status })
  } catch (err: any) {
    console.error('[trends] POST failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
