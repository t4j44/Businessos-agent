import { NextResponse } from 'next/server'
import { requireCron, authErrorResponse } from './auth-guard'
import { logAgentRun } from './log'

// The one entry point every scheduled job runs through.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// A cron that processed nothing and a cron that crashed used to look the same:
// `{ ok: true }`, HTTP 200, and no row anywhere. The appointment reminder job
// dropped every SMS for missing consent for weeks and reported success every
// night. Three of the four fan-out jobs have been fetching `undefined/api/...`
// since deploy — every client "errored", the response said `processed: 5`,
// and Vercel logged it as fired.
//
// WHAT EVERY CRON NOW GUARANTEES
//  * requireCron() — fails CLOSED. With CRON_SECRET unset, nothing gets in.
//    The old inline check (`auth !== 'Bearer ' + process.env.CRON_SECRET`)
//    accepted the literal string "Bearer undefined".
//  * A counted body: scanned / acted / skipped-by-reason / errors / ms.
//    `skipped` is keyed by reason because an unexplained skip is exactly how
//    the reminder bug hid.
//  * One agent_runs row per invocation — including the zero-work path — so
//    "ran and found nothing" and "never ran" are different rows.
//  * An unhandled throw becomes a 500 with { agent, error } and an
//    agent_runs row with status 'error'. Vercel surfaces non-200 cron runs in
//    the dashboard; a swallowed error surfaces nowhere.

export type CronCounts = {
  /** Rows the query returned. */
  scanned: number
  /** Rows the job actually did something to. */
  acted: number
  /** Everything scanned but not acted on, keyed by why. */
  skipped: Record<string, number>
  errors: number
  /** Anything else worth seeing in the Vercel log. */
  detail?: Record<string, unknown>
}

export type CronResult = CronCounts & {
  agent: string
  ms: number
}

export type CronJob = {
  /** Short name in the response body and log, e.g. 'invoice-chase'. */
  name: string
  /** agent_runs.agent_type — one of the catalog ids, e.g. 'invoice_chase'. */
  agentType: string
  run: () => Promise<CronCounts>
}

/** A skipped-by-reason tally that can be built up in a loop. */
export class SkipCounter {
  private counts: Record<string, number> = {}

  add(reason: string, n = 1) {
    this.counts[reason] = (this.counts[reason] ?? 0) + n
  }

  get total() {
    return Object.values(this.counts).reduce((a, b) => a + b, 0)
  }

  toJSON(): Record<string, number> {
    return { ...this.counts }
  }
}

/**
 * The base URL for a cron that fans out to agent routes over HTTP.
 *
 * NEXT_PUBLIC_APP_URL first; VERCEL_URL — the deployment's own hostname, which
 * Vercel always sets — as the fallback. Returns null rather than a bare
 * `undefined/...` string, so the caller can fail loudly instead of erroring
 * once per client and reporting success.
 */
export function selfBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return 'https://' + vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')

  return null
}

/**
 * Headers for a cron → agent route call. The agent routes accept either a
 * session or this bearer, via requireCronOrSession().
 */
export function cronAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (process.env.CRON_SECRET ?? ''),
  }
}

export function cronHandler(job: CronJob) {
  return async function GET(req: Request): Promise<Response> {
    try {
      await requireCron(req)
    } catch (err) {
      return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const startedAt = Date.now()

    try {
      const counts = await job.run()
      const result: CronResult = { agent: job.name, ...counts, ms: Date.now() - startedAt }

      // client_id is null on purpose: this row is the proof that the schedule
      // fired, not a fact about any one tenant. Per-client rows are written by
      // the agents themselves.
      await logAgentRun({
        client_id: null,
        agent_type: job.agentType,
        status: 'completed',
        output_summary:
          `cron ${job.name}: scanned ${counts.scanned}, acted ${counts.acted}, ` +
          `errors ${counts.errors}`,
        metadata: { source: 'cron', ...result },
      })

      return NextResponse.json(result)
    } catch (err: any) {
      const message = err?.message || String(err)
      console.error(`[cron/${job.name}] failed:`, err)

      await logAgentRun({
        client_id: null,
        agent_type: job.agentType,
        status: 'error',
        output_summary: `cron ${job.name} failed: ${message}`,
        metadata: { source: 'cron', agent: job.name, error: message, ms: Date.now() - startedAt },
      })

      return NextResponse.json({ agent: job.name, error: message }, { status: 500 })
    }
  }
}

/**
 * Runs `fn` once per client, never letting one client's failure abort the
 * rest. Returns how many succeeded and how many threw, and the per-client
 * detail for the log.
 */
export async function forEachClient<T extends { id: string; name?: string | null }>(
  clients: T[],
  fn: (client: T) => Promise<Record<string, unknown> | void>,
): Promise<{ ok: number; errors: number; results: Array<Record<string, unknown>> }> {
  let ok = 0
  let errors = 0
  const results: Array<Record<string, unknown>> = []

  for (const client of clients) {
    try {
      const detail = await fn(client)
      ok++
      results.push({ client_id: client.id, client: client.name ?? null, status: 'ok', ...(detail || {}) })
    } catch (err: any) {
      errors++
      const message = err?.message || String(err)
      console.error(`[cron] client ${client.id} failed:`, message)
      results.push({ client_id: client.id, client: client.name ?? null, status: 'error', error: message })
    }
  }

  return { ok, errors, results }
}

/**
 * POSTs to one of our own agent routes and returns its JSON. Throws on a
 * non-2xx so the caller's per-client catch counts it as an error rather than
 * a silent "failed" string.
 */
export async function callAgent(
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: cronAuthHeaders(),
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.error || `${path} returned HTTP ${res.status}`)
  }
  return json
}
