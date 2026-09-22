import { NextResponse } from 'next/server'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase'
import { logAgentRun } from '@/lib/log'
import { isUuid } from '@/lib/validation'
import { getMondayDateString } from '@/lib/week'
import { runMarketIntelligence } from '../intelligence/market/route'
import { runTrendRadar } from '../intelligence/trends/route'
import { runAudienceIntelligence } from '../intelligence/audience/route'
import { requireCron, authErrorResponse } from '@/lib/auth-guard';
import { cronHandler, SkipCounter } from '@/lib/cron';

// Nightwatch — the 2am orchestrator. Runs the three intelligence agents,
// synthesises what they found, attaches it to this week's brief, and raises an
// alert immediately if something cannot wait until Monday.
//
// NOTE ON HOW THE AGENTS ARE INVOKED: they are called as functions, not over
// HTTP. Each intelligence route exports its run function, so an in-process call
// avoids a second serverless invocation per agent (with its own cold start,
// timeout and bill), removes the dependency on NEXT_PUBLIC_APP_URL being
// correct in every environment, and keeps the results typed. A function that
// calls its own deployment over HTTP can also deadlock against Vercel's
// concurrency limit.

const APPROVAL_TTL_MS = 48 * 60 * 60 * 1000

// Hard ceiling per client per night.
const BUDGET_CAPS: Record<string, number> = {
  starter: 0.10,
  growth: 0.30,
}
const DEFAULT_BUDGET_CAP = 0.75

// Audience Intelligence is the expensive one (Sonnet, plus embeddings), so it
// only runs if the two cheap agents left most of the budget intact.
const AUDIENCE_BUDGET_THRESHOLD = 0.6

export type NightwatchSynthesis = {
  executive_summary: string
  priority_alert: string | null
  competitor_moves: string[]
  audience_insights: string[]
  trend_opportunities: string[]
  weekly_strategy_suggestion: string
  intelligence_score: number
}

const SYSTEM_PROMPT = `You are Nightwatch — the nightly intelligence synthesiser for Business OS.
You have received the output from 2-3 intelligence agents.
Produce a concise intelligence briefing.

Return ONLY valid JSON:
{
  executive_summary: string (3 sentences maximum — what matters most tonight),
  priority_alert: string | null (null unless something requires IMMEDIATE attention from the founder),
  competitor_moves: array of strings (top 3 most important competitor findings),
  audience_insights: array of strings (top 3 ICP psychology findings),
  trend_opportunities: array of strings (top 3 content opportunities),
  weekly_strategy_suggestion: string (one specific action this business should take this week),
  intelligence_score: number (1-100, overall intelligence quality of tonight's run)
}`

function budgetCapFor(planTier: string): number {
  return BUDGET_CAPS[String(planTier || '').toLowerCase()] ?? DEFAULT_BUDGET_CAP
}

// ── Brand context ──────────────────────────────────────────────────────────
type BrandRow = {
  company_name: string | null
  icp_summary: string | null
  tone_description: string | null
  products_json: any
  competitors_json: any
}

// brand_profiles has no `industry` column, so it is derived. icp_summary is
// free text ("dental clinic owners in the US"), which is exactly the phrasing
// the intelligence agents want for their searches.
function deriveIndustry(brand: BrandRow): string {
  const icp = String(brand.icp_summary || '').trim()
  if (icp) return icp.slice(0, 120)
  const name = String(brand.company_name || '').trim()
  return name ? `${name}'s industry` : 'small business'
}

// Trend Radar needs keywords. The client's own products are the most specific
// signal available; the rest fall back to the concerns every business shares.
const FALLBACK_KEYWORDS = ['customer experience', 'pricing', 'reviews']

function deriveKeywords(brand: BrandRow): string[] {
  const products = Array.isArray(brand.products_json) ? brand.products_json : []
  const names = products
    .map((p: any) => (typeof p === 'string' ? p : p?.name))
    .map((n: any) => String(n || '').trim())
    .filter(Boolean)
    .slice(0, 3)

  return names.length > 0 ? names : FALLBACK_KEYWORDS
}

function deriveCompetitors(brand: BrandRow): string[] {
  const raw = Array.isArray(brand.competitors_json) ? brand.competitors_json : []
  return raw
    .map((c: any) => (typeof c === 'string' ? c : c?.domain || c?.name))
    .map((c: any) => String(c || '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

// ── Synthesis ──────────────────────────────────────────────────────────────
function coerceSynthesis(raw: any): NightwatchSynthesis {
  const strArray = (v: any): string[] =>
    Array.isArray(v) ? v.map((s: any) => String(s)).filter(Boolean).slice(0, 3) : []

  // priority_alert drives a queued alert, so only a real non-empty string
  // counts. 'null', '', 'none' from a chatty model must not raise one.
  const alertRaw = raw?.priority_alert
  const alertText = typeof alertRaw === 'string' ? alertRaw.trim() : ''
  const alert =
    alertText && !['null', 'none', 'n/a'].includes(alertText.toLowerCase())
      ? alertText
      : null

  const score = Number(raw?.intelligence_score)

  return {
    executive_summary: String(raw?.executive_summary ?? '').trim(),
    priority_alert: alert,
    competitor_moves: strArray(raw?.competitor_moves),
    audience_insights: strArray(raw?.audience_insights),
    trend_opportunities: strArray(raw?.trend_opportunities),
    weekly_strategy_suggestion: String(raw?.weekly_strategy_suggestion ?? '').trim(),
    intelligence_score: Number.isFinite(score)
      ? Math.min(100, Math.max(1, Math.round(score)))
      : 1,
  }
}

function buildUserMessage(
  companyName: string,
  industry: string,
  results: { market: any; trends: any; audience: any },
): string {
  const parts: string[] = []

  parts.push(`Business: ${companyName}`)
  parts.push(`Industry / ICP: ${industry}`)
  parts.push('')

  parts.push('MARKET INTELLIGENCE')
  parts.push(results.market ? JSON.stringify(results.market) : '(did not run)')
  parts.push('')

  parts.push('TREND RADAR')
  parts.push(results.trends ? JSON.stringify(results.trends) : '(did not run)')
  parts.push('')

  parts.push('AUDIENCE INTELLIGENCE')
  parts.push(results.audience ? JSON.stringify(results.audience) : '(did not run)')

  return parts.join('\n')
}

// ── Persistence ────────────────────────────────────────────────────────────
// Deliberately not an upsert. weekly_briefs has no unique (client_id,
// week_start) constraint — and must not get one, because the BI Reporter does
// a plain INSERT and can write more than one brief per week. So: find the
// newest row for the week and update it, otherwise create one.
async function storeIntelligence(
  client_id: string,
  weekStart: string,
  synthesis: NightwatchSynthesis,
): Promise<boolean> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('weekly_briefs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_start', weekStart)
      .order('created_at', { ascending: false })
      .limit(1)

    const row = existing?.[0]

    const { error } = row
      ? await supabaseAdmin
          .from('weekly_briefs')
          .update({ intelligence_report_json: synthesis })
          .eq('id', row.id)
      : await supabaseAdmin
          .from('weekly_briefs')
          .insert({
            client_id,
            week_start: weekStart,
            intelligence_report_json: synthesis,
          })

    if (error) {
      // Most likely cause: migration 015 has not been applied, so the column
      // does not exist yet. The synthesis is still returned to the caller.
      console.error('[nightwatch] could not store intelligence:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[nightwatch] intelligence store failed:', e)
    return false
  }
}

async function raiseAlert(client_id: string, alert: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('approvals_queue').insert({
    client_id,
    action_type: 'priority_alert',
    payload_json: {
      alert,
      source: 'nightwatch',
      // The dashboard's approvals card reads payload_json.description for its
      // subtitle; without it the founder sees a bare "Priority Alert".
      description: alert,
    },
    status: 'pending',
    expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
  })

  if (error) {
    console.error('[nightwatch] alert insert failed:', error.message)
    return false
  }
  return true
}

// ── One client ─────────────────────────────────────────────────────────────
export async function runForClient(
  client_id: string,
  plan_tier = 'starter',
): Promise<{ status: number; body: any }> {
  const startedAt = Date.now()
  const budgetCap = budgetCapFor(plan_tier)
  let costAccumulator = 0

  const { data: brandRow } = await supabaseAdmin
    .from('brand_profiles')
    .select('company_name, icp_summary, tone_description, products_json, competitors_json')
    .eq('client_id', client_id)
    .maybeSingle()

  if (!brandRow) {
    // Without a brand profile there is nothing to target the searches at, and
    // the synthesis would be generic noise.
    console.warn('[nightwatch] no brand profile for', client_id, '— skipping')
    return {
      status: 200,
      body: { client_id, success: false, skipped: 'no brand profile', agents_run: 0, total_cost_usd: 0 },
    }
  }

  const brand = brandRow as BrandRow
  const companyName = brand.company_name || 'this business'
  const industry = deriveIndustry(brand)
  const keywords = deriveKeywords(brand)
  const competitors = deriveCompetitors(brand)

  try {
    // ── Cheap agents first, in parallel ─────────────────────────────────
    // Market Intelligence rejects an empty competitor list, so it only runs
    // when the brand profile actually names competitors.
    const marketPromise = competitors.length
      ? runMarketIntelligence({ client_id, competitors, industry, run_type: 'quick' })
      : Promise.resolve(null)

    if (!competitors.length) {
      console.warn(
        '[nightwatch] no competitors_json for', client_id,
        '— skipping market intelligence (it requires at least one)',
      )
    }

    const [marketRun, trendRun] = await Promise.all([
      marketPromise.catch(() => null),
      runTrendRadar({ client_id, industry, keywords }).catch(() => null),
    ])

    // Only a 200 counts as a result; a 400/500 body is an error, not findings.
    const market = marketRun?.status === 200 ? marketRun.body : null
    const trends = trendRun?.status === 200 ? trendRun.body : null

    costAccumulator += Number(market?.cost_usd) || 0
    costAccumulator += Number(trends?.cost_usd) || 0

    // ── Expensive agent, budget permitting ──────────────────────────────
    let audience: any = null
    if (costAccumulator < budgetCap * AUDIENCE_BUDGET_THRESHOLD) {
      const audienceRun = await runAudienceIntelligence({
        client_id,
        icp_description: brand.icp_summary || industry,
        industry,
        keywords,
      }).catch(() => null)

      audience = audienceRun?.status === 200 ? audienceRun.body : null
      costAccumulator += Number(audience?.cost_usd) || 0
    } else {
      console.log('[nightwatch] budget conserved — skipping audience intelligence for', client_id)
    }

    const agentsRun = [market, trends, audience].filter(Boolean).length

    if (agentsRun === 0) {
      console.error('[nightwatch] all intelligence agents failed for', client_id)
      await logAgentRun({
        client_id,
        agent_type: 'nightwatch',
        status: 'failed',
        cost_usd: costAccumulator,
        output_summary: 'All intelligence agents failed — no synthesis produced.',
        metadata: { agents_run: 0, plan_tier },
      })
      return {
        status: 502,
        body: {
          client_id,
          success: false,
          error: 'All intelligence agents failed',
          agents_run: 0,
          total_cost_usd: costAccumulator,
        },
      }
    }

    // ── Synthesis ────────────────────────────────────────────────────────
    const ai = await callAI({
      model: MODELS.HAIKU,
      system: SYSTEM_PROMPT,
      user: buildUserMessage(companyName, industry, { market, trends, audience }),
      maxTokens: 2000,
    })

    costAccumulator += ai.cost
    const synthesis = coerceSynthesis(parseJSON(ai.text))

    const weekStart = getMondayDateString()
    const stored = await storeIntelligence(client_id, weekStart, synthesis)

    const alertRaised = synthesis.priority_alert
      ? await raiseAlert(client_id, synthesis.priority_alert)
      : false

    await logAgentRun({
      client_id,
      agent_type: 'nightwatch',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: costAccumulator,
      output_summary: synthesis.executive_summary,
      metadata: {
        agents_run: agentsRun,
        intelligence_score: synthesis.intelligence_score,
        has_priority_alert: synthesis.priority_alert !== null,
        alert_raised: alertRaised,
        intelligence_stored: stored,
        budget_cap: budgetCap,
        plan_tier,
        week_start: weekStart,
      },
    })

    return {
      status: 200,
      body: {
        client_id,
        success: true,
        executive_summary: synthesis.executive_summary,
        priority_alert: synthesis.priority_alert,
        competitor_moves: synthesis.competitor_moves,
        audience_insights: synthesis.audience_insights,
        trend_opportunities: synthesis.trend_opportunities,
        weekly_strategy_suggestion: synthesis.weekly_strategy_suggestion,
        intelligence_score: synthesis.intelligence_score,
        total_cost_usd: Number(costAccumulator.toFixed(6)),
        budget_cap: budgetCap,
        agents_run: agentsRun,
        intelligence_stored: stored,
        week_start: weekStart,
        response_time_ms: Date.now() - startedAt,
      },
    }
  } catch (err: any) {
    console.error('[nightwatch] run failed for', client_id, err)

    await logAgentRun({
      client_id,
      agent_type: 'nightwatch',
      status: 'failed',
      cost_usd: costAccumulator,
      output_summary: err?.message || String(err),
      metadata: { plan_tier },
    })

    return {
      status: 500,
      body: {
        client_id,
        success: false,
        error: err?.message || String(err),
        total_cost_usd: Number(costAccumulator.toFixed(6)),
      },
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function runNightwatch(params: {
  client_id?: string
  run_all_clients?: boolean
}): Promise<{ status: number; body: any }> {
  if (!process.env.OPENROUTER_API_KEY) {
    return { status: 503, body: { error: 'OPENROUTER_API_KEY missing' } }
  }

  try {
    if (!params.run_all_clients) {
      if (!isUuid(params.client_id)) return { status: 400, body: { error: 'A valid client_id is required.' } }
      return await runForClient(params.client_id)
    }

    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, plan_tier')
      .eq('status', 'active')

    if (error) {
      return { status: 500, body: { error: error.message } }
    }

    const list = clients || []
    const results: any[] = []

    // Sequential on purpose: three agents fan out per client, and running the
    // whole book at once would hit Reddit, Brave and OpenRouter rate limits.
    for (const client of list) {
      const { body } = await runForClient(client.id, client.plan_tier || 'starter')
      results.push(body)
    }

    return {
      status: 200,
      body: {
        clients_processed: results.length,
        total_cost_usd: Number(
          results.reduce((sum, r) => sum + (Number(r?.total_cost_usd) || 0), 0).toFixed(6),
        ),
        priority_alerts: results.filter((r) => r?.priority_alert).length,
        results,
      },
    }
  } catch (err: any) {
    console.error('[nightwatch] orchestration failed:', err)
    return { status: 500, body: { error: err?.message || String(err) } }
  }
}

export async function POST(req: Request) {
  try {
    await requireCron(req);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { status, body: result } = await runNightwatch({
      client_id: body?.client_id,
      run_all_clients: body?.run_all_clients,
    })
    return NextResponse.json(result, { status })
  } catch (err: any) {
    console.error('[nightwatch] POST failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}

// GET /api/agents/nightwatch — the scheduled entry point.
//
// vercel.json has pointed a cron at this path since Nightwatch shipped, but
// the route only exported POST. Vercel invokes cron paths with GET, so every
// scheduled fire came back 405 and was logged as "fired". Nightwatch has
// never run from the schedule until this handler.
//
// POST stays for manual and test invocations (it accepts a single client_id);
// the schedule always runs the whole active book.
export const GET = cronHandler({
  name: 'nightwatch',
  agentType: 'nightwatch',
  async run() {
    const { status, body } = await runNightwatch({ run_all_clients: true })

    // A non-200 here is a whole-run failure — no API key, clients query
    // failed — not a per-client one. Throw so the harness returns 500 and
    // Vercel marks the run as failed.
    if (status !== 200) {
      throw new Error(body?.error || `runNightwatch returned ${status}`)
    }

    const results: any[] = Array.isArray(body?.results) ? body.results : []
    const skipped = new SkipCounter()
    let acted = 0
    let errors = 0

    for (const r of results) {
      if (r?.success) {
        acted++
      } else if (r?.error) {
        errors++
      } else if (r?.skipped) {
        // runForClient's own reason string, e.g. 'no brand profile'.
        skipped.add(String(r.skipped).replace(/\s+/g, '_'))
      } else {
        skipped.add('unknown')
      }
    }

    return {
      scanned: results.length,
      acted,
      skipped: skipped.toJSON(),
      errors,
      detail: {
        total_cost_usd: body?.total_cost_usd ?? 0,
        priority_alerts: body?.priority_alerts ?? 0,
        clients: results.map((r) => ({
          client_id: r?.client_id ?? null,
          success: !!r?.success,
          agents_run: r?.agents_run ?? 0,
          cost_usd: r?.total_cost_usd ?? 0,
          error: r?.error ?? null,
          skipped: r?.skipped ?? null,
        })),
      },
    }
  },
})
