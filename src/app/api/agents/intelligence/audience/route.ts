import { NextResponse } from 'next/server'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase'
import { createEmbedding } from '@/lib/embeddings'
import { braveSearch } from '@/lib/brave'
import { logAgentRun } from '@/lib/log'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { industrySubreddits } from '@/lib/subreddits'
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// Audience Intelligence — finds real conversations from the client's ICP on
// Reddit and the open web, then extracts the psychology behind them: the exact
// words they use, what actually triggers a purchase, and what stops them.
//
// The output feeds Hunter (cold email copy), Creative (content angles) and the
// Receptionist (openers), so the synthesis runs on Sonnet rather than a cheap
// model — this is the one place where phrasing fidelity is the product.
//
// Every external source is best-effort. Reddit rate-limits unauthenticated
// clients aggressively, so a 429 narrows the evidence instead of failing.

const MAX_KEYWORDS_REDDIT = 4
const MAX_KEYWORDS_BRAVE = 3
const REDDIT_LIMIT = 8
const SELFTEXT_CHARS = 400
const COMMENT_CHARS = 200
const COMMENTS_PER_POST = 2
const MAX_RAG_CHUNKS = 10
const FETCH_TIMEOUT_MS = 10_000

// Reddit's public JSON endpoints throttle hard without an OAuth token, and a
// comment fetch is one request per post. Only the highest-scoring handful get
// their comments pulled, which is where the quotable language sits anyway.
const MAX_POSTS_WITH_COMMENTS = 6

const UA = 'BusinessOS/1.0 (research bot)'

export type PainPoint = {
  pain: string
  frequency: string
  exact_quote: string
  emotion: string
}

export type Objection = { objection: string; underlying_fear: string }

export type AudienceAnalysis = {
  top_pain_points: PainPoint[]
  buying_triggers: string[]
  objections: Objection[]
  language_they_use: string[]
  content_angles: string[]
  recommended_actions: {
    for_hunter: string
    for_creative: string
    for_receptionist: string
  }
}

type RedditPost = {
  title: string
  body: string
  score: number
  permalink: string
  top_comments: string[]
}

type SearchHit = { label: string; title: string; description: string }

const SYSTEM_PROMPT = `You are an ICP psychology analyst. You have Reddit posts and web search results from real conversations
about a specific type of business owner's pain points. Extract deep psychology.

Return ONLY valid JSON with exactly these keys:
{
  top_pain_points: array of {
    pain: string,
    frequency: 'very common' | 'common' | 'occasional',
    exact_quote: string (copy a real phrase from the data — do not paraphrase),
    emotion: string (what feeling drives this pain: fear, frustration, embarrassment, etc.)
  },
  buying_triggers: array of strings (what makes them finally take action and buy a solution),
  objections: array of { objection: string, underlying_fear: string },
  language_they_use: array of strings (exact phrases they use — for copywriting),
  content_angles: array of strings (post ideas that would resonate with this audience),
  recommended_actions: {
    for_hunter: string (one specific copywriting tip for cold emails based on this),
    for_creative: string (one content angle tip based on this),
    for_receptionist: string (one conversation opener based on this)
  }
}`

// ── Reddit ─────────────────────────────────────────────────────────────────
async function redditJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status === 429) {
      console.warn('[audience] reddit rate limited (429) —', url)
      return null
    }
    if (!res.ok) {
      console.warn('[audience] reddit HTTP', res.status, url)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn('[audience] reddit request failed:', url, e)
    return null
  }
}

function parsePosts(json: any): RedditPost[] {
  const children = json?.data?.children
  if (!Array.isArray(children)) return []

  return children
    .map((c: any) => c?.data)
    .filter(Boolean)
    .map((d: any) => ({
      title: String(d.title || ''),
      body: String(d.selftext || '').slice(0, SELFTEXT_CHARS),
      score: Number(d.score) || 0,
      permalink: String(d.permalink || ''),
      top_comments: [] as string[],
    }))
    .filter((p: RedditPost) => p.title)
}

async function fetchTopComments(permalink: string): Promise<string[]> {
  if (!permalink) return []

  const json = await redditJson(
    `https://www.reddit.com${permalink}.json?limit=${COMMENTS_PER_POST}`,
  )
  // The comments endpoint returns [postListing, commentListing].
  const children = json?.[1]?.data?.children
  if (!Array.isArray(children)) return []

  return children
    .map((c: any) => c?.data?.body)
    .filter((b: any) => typeof b === 'string' && b.trim() && b !== '[deleted]' && b !== '[removed]')
    .slice(0, COMMENTS_PER_POST)
    .map((b: string) => b.slice(0, COMMENT_CHARS))
}

async function searchReddit(
  keywords: string[],
  industry: string,
  subreddits: string[],
): Promise<RedditPost[]> {
  const perKeyword = await Promise.all(
    keywords.map(async (keyword) => {
      const q = encodeURIComponent(`${keyword} ${industry}`)
      const json = await redditJson(
        `https://www.reddit.com/search.json?q=${q}&sort=relevance&t=year&limit=${REDDIT_LIMIT}`,
      )
      const posts = parsePosts(json)
      if (posts.length > 0) return posts

      // Nothing found industry-wide: retry inside the communities this ICP is
      // known to gather in. This is the only place the subreddit map costs a
      // request, and only when the broad search came back empty.
      const scoped = encodeURIComponent(
        `${keyword} (${subreddits.map((s) => `subreddit:${s}`).join(' OR ')})`,
      )
      const fallback = await redditJson(
        `https://www.reddit.com/search.json?q=${scoped}&sort=relevance&t=year&limit=${REDDIT_LIMIT}`,
      )
      return parsePosts(fallback)
    }),
  )

  // De-duplicate across keywords — the same thread surfaces for related terms.
  const seen = new Set<string>()
  const posts: RedditPost[] = []
  for (const post of perKeyword.flat()) {
    const key = post.permalink || post.title
    if (seen.has(key)) continue
    seen.add(key)
    posts.push(post)
  }

  // Comments only for the loudest threads, to stay under Reddit's throttle.
  const ranked = [...posts].sort((a, b) => b.score - a.score)
  const withComments = ranked.slice(0, MAX_POSTS_WITH_COMMENTS)

  await Promise.all(
    withComments.map(async (post) => {
      post.top_comments = await fetchTopComments(post.permalink)
    }),
  )

  return posts
}

// ── Prompt ─────────────────────────────────────────────────────────────────
function buildUserMessage(
  icp: string,
  industry: string,
  subreddits: string[],
  posts: RedditPost[],
  hits: SearchHit[],
): string {
  const parts: string[] = []

  parts.push(`ICP: ${icp}`)
  parts.push(`Industry: ${industry}`)
  parts.push(`Communities searched: ${subreddits.join(', ')}`)
  parts.push('')

  parts.push('REDDIT POSTS')
  if (posts.length === 0) {
    parts.push('(no posts retrieved)')
  } else {
    for (const p of posts) {
      parts.push(`--- [${p.score} upvotes] ${p.title}`)
      if (p.body) parts.push(p.body)
      for (const c of p.top_comments) parts.push(`  > ${c}`)
      parts.push('')
    }
  }

  parts.push('WEB SEARCH RESULTS')
  if (hits.length === 0) {
    parts.push('(no search results available)')
  } else {
    for (const h of hits) {
      parts.push(`* [${h.label}] ${h.title} — ${h.description}`)
    }
  }

  return parts.join('\n')
}

// The model is instructed to return this shape, but nothing enforces it —
// downstream agents read these arrays directly, so they are normalised here.
function coerceAnalysis(raw: any): AudienceAnalysis {
  const strArray = (v: any): string[] =>
    Array.isArray(v) ? v.map((s: any) => String(s)).filter(Boolean) : []

  const pains = Array.isArray(raw?.top_pain_points) ? raw.top_pain_points : []
  const objections = Array.isArray(raw?.objections) ? raw.objections : []

  return {
    top_pain_points: pains.map((p: any) => ({
      pain: String(p?.pain ?? ''),
      frequency: String(p?.frequency ?? 'occasional'),
      exact_quote: String(p?.exact_quote ?? ''),
      emotion: String(p?.emotion ?? ''),
    })),
    buying_triggers: strArray(raw?.buying_triggers),
    objections: objections.map((o: any) => ({
      objection: String(o?.objection ?? ''),
      underlying_fear: String(o?.underlying_fear ?? ''),
    })),
    language_they_use: strArray(raw?.language_they_use),
    content_angles: strArray(raw?.content_angles),
    recommended_actions: {
      for_hunter: String(raw?.recommended_actions?.for_hunter ?? ''),
      for_creative: String(raw?.recommended_actions?.for_creative ?? ''),
      for_receptionist: String(raw?.recommended_actions?.for_receptionist ?? ''),
    },
  }
}

// ── RAG ────────────────────────────────────────────────────────────────────
// search_rag_chunks filters on `embedding IS NOT NULL`, so a chunk stored
// without one can never be retrieved, and nothing in this codebase backfills
// them. The embedding is therefore generated here; if that fails the row is
// still written so the finding is not lost, but it will stay invisible to RAG
// until an embedding exists.
async function storeAudienceChunks(
  client_id: string,
  pains: PainPoint[],
): Promise<number> {
  const quotable = pains
    .filter((p) => p.pain && p.exact_quote)
    .slice(0, MAX_RAG_CHUNKS)

  let stored = 0

  for (const p of quotable) {
    const content = `ICP pain point: ${p.pain}. Real quote: "${p.exact_quote}"`

    try {
      const embedding = await createEmbedding(content)
      if (!embedding) {
        console.warn('[audience] embedding unavailable — chunk stored unretrievable')
      }

      const { error } = await supabaseAdmin.from('rag_chunks').insert({
        client_id,
        content,
        embedding,
        source_url: 'audience_intelligence',
        chunk_type: 'audience',
        is_active: true,
      })

      if (error) {
        console.error('[audience] rag_chunks insert failed:', error.message)
        continue
      }
      stored++
    } catch (e) {
      console.error('[audience] chunk store failed:', e)
    }
  }

  return stored
}

// ── Run ────────────────────────────────────────────────────────────────────
export async function runAudienceIntelligence(params: {
  client_id?: string
  icp_description?: string
  industry?: string
  keywords?: string[]
}): Promise<{ status: number; body: any }> {
  const startedAt = Date.now()

  if (!process.env.OPENROUTER_API_KEY) {
    return { status: 503, body: { error: 'OPENROUTER_API_KEY missing' } }
  }

  const client_id = params.client_id || TEST_CLIENT_ID
  const icp = String(params.icp_description || '').trim()
  const industry = String(params.industry || '').trim() || 'general'

  const keywords = (Array.isArray(params.keywords) ? params.keywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)

  if (!icp) {
    return { status: 400, body: { error: 'icp_description is required' } }
  }
  if (keywords.length === 0) {
    return { status: 400, body: { error: 'At least one keyword required' } }
  }

  const subreddits = industrySubreddits(industry)

  if (!process.env.BRAVE_API_KEY) {
    console.warn('[audience] BRAVE_API_KEY not set — continuing with Reddit only')
  }

  try {
    // Reddit and Brave are independent; this is the slow half of the run.
    const redditPromise = searchReddit(
      keywords.slice(0, MAX_KEYWORDS_REDDIT),
      industry,
      subreddits,
    )

    const bravePromise = Promise.all(
      keywords.slice(0, MAX_KEYWORDS_BRAVE).flatMap((keyword) => [
        (async (): Promise<SearchHit[]> =>
          (await braveSearch(`site:reddit.com ${icp} ${keyword}`, 4)).map((r) => ({
            label: `reddit: ${keyword}`,
            title: r.title,
            description: r.description,
          })))(),
        (async (): Promise<SearchHit[]> =>
          (await braveSearch(`${icp} "${keyword}" problem OR challenge OR struggle`, 3)).map(
            (r) => ({ label: `web: ${keyword}`, title: r.title, description: r.description }),
          ))(),
      ]),
    )

    const [posts, hitGroups] = await Promise.all([redditPromise, bravePromise])
    const hits = hitGroups.flat()

    // Quality matters here — this output is copy that other agents reuse.
    const ai = await callAI({
      model: MODELS.SONNET,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(icp, industry, subreddits, posts, hits),
      maxTokens: 3000,
    })

    const analysis = coerceAnalysis(parseJSON(ai.text))
    const ragChunksStored = await storeAudienceChunks(client_id, analysis.top_pain_points)
    const tokensUsed = ai.inputTokens + ai.outputTokens

    const summary =
      analysis.top_pain_points[0]?.pain
        ? `Top ICP pain: ${analysis.top_pain_points[0].pain}`
        : 'Audience analysis completed with no dominant pain point.'

    await logAgentRun({
      client_id,
      agent_type: 'audience_intelligence',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.cost,
      output_summary: summary,
      metadata: {
        reddit_posts_found: posts.length,
        search_results: hits.length,
        rag_chunks_stored: ragChunksStored,
        pain_points: analysis.top_pain_points.length,
        subreddits,
        industry,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        top_pain_points: analysis.top_pain_points,
        buying_triggers: analysis.buying_triggers,
        objections: analysis.objections,
        language_they_use: analysis.language_they_use,
        content_angles: analysis.content_angles,
        recommended_actions: analysis.recommended_actions,
        rag_chunks_stored: ragChunksStored,
        reddit_posts_found: posts.length,
        search_results_found: hits.length,
        subreddits_searched: subreddits,
        tokens_used: tokensUsed,
        cost_usd: ai.cost,
        response_time_ms: Date.now() - startedAt,
      },
    }
  } catch (err: any) {
    console.error('[audience] run failed:', err)

    await logAgentRun({
      client_id,
      agent_type: 'audience_intelligence',
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
    const { status, body: result } = await runAudienceIntelligence({
      client_id: clientId,
      icp_description: body?.icp_description,
      industry: body?.industry,
      keywords: body?.keywords,
    })
    return NextResponse.json(result, { status })
  } catch (err: any) {
    console.error('[audience] POST failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
