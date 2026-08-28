import { NextResponse } from 'next/server'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { readWebsite, normalizeUrl } from '@/lib/scraper'
import { braveSearch, type BraveResult } from '@/lib/brave'
import { logAgentRun } from '@/lib/log'
import { TEST_CLIENT_ID } from '@/lib/client-config'
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// Market Intelligence — reads competitor sites (Jina, via lib/scraper) and
// searches for their recent news (Brave), then has the model turn both into a
// threat read and a short action list.
//
// Runs daily, so every external step is best-effort: a competitor whose site
// will not load, or a missing Brave key, narrows the evidence rather than
// failing the run. Only a missing model key or an empty competitor list is
// fatal.

const QUICK_MAX = 3
const DEEP_MAX = 8
const SITE_CHARS = 2000      // per competitor, passed to readWebsite
const EXCERPT_CHARS = 500    // per competitor, passed to the model

export type CompetitorMove = {
  competitor: string
  move: string
  implication: string
}

export type MarketAnalysis = {
  threat_level: number
  key_competitor_moves: CompetitorMove[]
  market_opportunities: string[]
  recommended_responses: string[]
  summary: string
}

const SYSTEM_PROMPT = `You are a competitive intelligence analyst. Analyse competitor websites and news.
Return ONLY valid JSON with exactly these keys:
{
  threat_level: number (1-10, 10 = immediate threat to this business),
  key_competitor_moves: array of { competitor: string, move: string, implication: string },
  market_opportunities: array of strings (gaps competitors are NOT addressing),
  recommended_responses: array of strings (specific actions this business should take),
  summary: string (2-3 sentences, plain English)
}`

type SiteRead = { domain: string; content: string }
type SearchBundle = { label: string; results: BraveResult[] }

// Keeps the model's numbers inside the documented contract even when it
// free-styles the shape, so downstream consumers can trust the payload.
function coerceAnalysis(raw: any): MarketAnalysis {
  const level = Number(raw?.threat_level)
  const moves = Array.isArray(raw?.key_competitor_moves) ? raw.key_competitor_moves : []

  return {
    threat_level: Number.isFinite(level) ? Math.min(10, Math.max(1, Math.round(level))) : 1,
    key_competitor_moves: moves.map((m: any) => ({
      competitor: String(m?.competitor ?? ''),
      move: String(m?.move ?? ''),
      implication: String(m?.implication ?? ''),
    })),
    market_opportunities: Array.isArray(raw?.market_opportunities)
      ? raw.market_opportunities.map((s: any) => String(s))
      : [],
    recommended_responses: Array.isArray(raw?.recommended_responses)
      ? raw.recommended_responses.map((s: any) => String(s))
      : [],
    summary: String(raw?.summary ?? '').trim(),
  }
}

function buildUserMessage(
  industry: string,
  sites: SiteRead[],
  searches: SearchBundle[],
): string {
  const parts: string[] = []

  parts.push(`Industry: ${industry}`)
  parts.push('')

  parts.push('COMPETITOR WEBSITES')
  if (sites.length === 0) {
    parts.push('(none could be read)')
  } else {
    for (const site of sites) {
      parts.push(`--- ${site.domain} ---`)
      parts.push(site.content.slice(0, EXCERPT_CHARS))
      parts.push('')
    }
  }

  parts.push('SEARCH RESULTS')
  const withHits = searches.filter((s) => s.results.length > 0)
  if (withHits.length === 0) {
    parts.push('(no search results available)')
  } else {
    for (const bundle of withHits) {
      parts.push(`--- ${bundle.label} ---`)
      for (const r of bundle.results) {
        parts.push(`* ${r.title} — ${r.description} (${r.url})`)
      }
      parts.push('')
    }
  }

  return parts.join('\n')
}

export async function runMarketIntelligence(params: {
  client_id?: string
  competitors?: string[]
  industry?: string
  run_type?: 'quick' | 'deep'
}): Promise<{ status: number; body: any }> {
  const startedAt = Date.now()

  if (!process.env.OPENROUTER_API_KEY) {
    return { status: 503, body: { error: 'OPENROUTER_API_KEY missing' } }
  }

  const client_id = params.client_id || TEST_CLIENT_ID
  const industry = (params.industry || '').trim() || 'general'
  const runType = params.run_type === 'deep' ? 'deep' : 'quick'

  const requested = Array.isArray(params.competitors) ? params.competitors : []
  const cleaned = requested
    .map((c) => String(c || '').trim())
    .filter(Boolean)

  if (cleaned.length === 0) {
    return { status: 400, body: { error: 'At least one competitor required' } }
  }

  const competitors = cleaned.slice(0, runType === 'deep' ? DEEP_MAX : QUICK_MAX)

  if (!process.env.BRAVE_API_KEY) {
    console.warn(
      '[market-intelligence] BRAVE_API_KEY not set — continuing with website reads only',
    )
  }

  try {
    // ── Sites and searches together: they do not depend on each other, and
    //    this is the slow half of the run. ────────────────────────────────
    const sitePromises = competitors.map(async (domain): Promise<SiteRead | null> => {
      try {
        const content = await readWebsite(normalizeUrl(domain), SITE_CHARS)
        if (!content || !content.trim()) return null
        return { domain, content }
      } catch (err) {
        // A competitor that blocks scraping should narrow the analysis, not
        // end it.
        console.warn('[market-intelligence] could not read', domain, err)
        return null
      }
    })

    const competitorSearches = competitors.map(async (domain): Promise<SearchBundle> => ({
      label: `News: ${domain}`,
      results: await braveSearch(`"${domain}" news OR announcement OR update 2026`, 3),
    }))

    const industrySearches: Promise<SearchBundle>[] = [
      (async () => ({
        label: `${industry} trends`,
        results: await braveSearch(`${industry} trends 2026`, 3),
      }))(),
      (async () => ({
        label: `${industry} customer complaints`,
        results: await braveSearch(`${industry} problems customers complain about`, 3),
      }))(),
    ]

    const [siteResults, searchResults] = await Promise.all([
      Promise.all(sitePromises),
      Promise.all([...competitorSearches, ...industrySearches]),
    ])

    const sites = siteResults.filter((s): s is SiteRead => s !== null)

    // ── Synthesis ─────────────────────────────────────────────────────────
    const ai = await callAI({
      model: MODELS.HAIKU,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(industry, sites, searchResults),
      maxTokens: 2000,
    })

    const analysis = coerceAnalysis(parseJSON(ai.text))
    const tokensUsed = ai.inputTokens + ai.outputTokens

    await logAgentRun({
      client_id,
      agent_type: 'market_intelligence',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.cost,
      output_summary: analysis.summary,
      metadata: {
        threat_level: analysis.threat_level,
        competitors_analysed: competitors.length,
        // Which evidence the read actually rested on — a threat level derived
        // from zero readable sites means something different from one built
        // on all of them.
        sites_read: sites.length,
        search_results: searchResults.reduce((n, s) => n + s.results.length, 0),
        run_type: runType,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        threat_level: analysis.threat_level,
        key_competitor_moves: analysis.key_competitor_moves,
        market_opportunities: analysis.market_opportunities,
        recommended_responses: analysis.recommended_responses,
        summary: analysis.summary,
        competitors_analysed: competitors.length,
        sites_read: sites.length,
        tokens_used: tokensUsed,
        cost_usd: ai.cost,
        response_time_ms: Date.now() - startedAt,
      },
    }
  } catch (err: any) {
    console.error('[market-intelligence] run failed:', err)

    // Recorded as a failed run so the activity feed and cost reporting show
    // the attempt rather than silently skipping the day.
    await logAgentRun({
      client_id,
      agent_type: 'market_intelligence',
      status: 'failed',
      output_summary: err?.message || String(err),
      metadata: { competitors_analysed: competitors.length, run_type: runType },
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
    const { status, body: result } = await runMarketIntelligence({
      client_id: clientId,
      competitors: body?.competitors,
      industry: body?.industry,
      run_type: body?.run_type,
    })
    return NextResponse.json(result, { status })
  } catch (err: any) {
    console.error('[market-intelligence] POST failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
