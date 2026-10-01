import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logAgentRun } from '@/lib/log'
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

// Hunter Prospect — the first step of the lead pipeline. Discovers local
// businesses from the locally-held Overture Maps Places dataset.
//
// WHY NOT GOOGLE PLACES: Google's API terms allow storing only place_id
// indefinitely; everything else is under caching restrictions. Business OS
// stores lead data permanently and embeds it into RAG, which those terms do not
// permit. Overture Places is CDLA Permissive 2.0 — storage, modification and
// commercial use are allowed with attribution (rendered by
// src/components/Attribution.tsx on the Hunter page).
//
// Rows are loaded in bulk by scripts/overture-etl.sh. This route only reads.
//
// Results without a website are excluded: every later pipeline step (enrichment,
// personalised outbound) needs a site to read.

const MAX_RESULTS = 50
const DEFAULT_RESULTS = 20

// Searches per client per calendar day, by plan. Nightwatch already caps its
// nightly spend per tier; prospecting had no ceiling at all, so one client
// could search indefinitely.
const DAILY_CAP: Record<string, number> = {
  starter: 10,
  growth: 50,
  scale: 200,
}
const DEFAULT_DAILY_CAP = 10

export type ProspectLead = {
  client_id: string
  place_id: string
  name: string
  phone: string | null
  website: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  category: string | null
  rating: number | null
  review_count: number | null
  prospect_query: string
  outreach_status: string
  source: string
  phone_consent: boolean
}

export type ProspectResult = {
  leads: ProspectLead[]
  total_found: number
  total_with_website: number
  query: string
  message?: string
}

class ProspectError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Prospect failed'))
    this.status = status
    this.payload = payload
  }
}

type ParsedQuery = {
  category: string
  city: string | null
  state: string | null
}

/**
 * "dentists in Austin TX" → { category: 'dentists', city: 'Austin', state: 'TX' }
 *
 * Splits on the last standalone " in " so a category containing the word
 * (e.g. "walk in clinic in Austin TX") still parses sensibly.
 */
export function parseProspectQuery(raw: string): ParsedQuery | null {
  const query = String(raw || '').trim().replace(/\s+/g, ' ')
  if (!query) return null

  const parts = query.split(/\s+in\s+/i)
  if (parts.length < 2) {
    // No location at all — the caller has to say where.
    return { category: query, city: null, state: null }
  }

  const location = parts[parts.length - 1].trim()
  const category = parts.slice(0, -1).join(' in ').trim()

  // A trailing two-letter token is the state; whatever precedes it is the city.
  const tokens = location.split(/[\s,]+/).filter(Boolean)
  let state: string | null = null
  if (tokens.length > 0 && /^[A-Za-z]{2}$/.test(tokens[tokens.length - 1])) {
    state = tokens.pop()!.toUpperCase()
  }

  const city = tokens.join(' ').trim() || null
  return { category, city, state }
}

export async function runHunterProspect(params: {
  clientId: string
  query: string
  maxResults?: number
}): Promise<ProspectResult> {
  const { clientId } = params
  const query = String(params.query ?? '').trim()

  if (!query) {
    throw new ProspectError(400, { error: 'query is required' })
  }

  const parsed = parseProspectQuery(query)
  if (!parsed) {
    throw new ProspectError(400, { error: 'query is required' })
  }

  if (!parsed.state && !parsed.city) {
    throw new ProspectError(400, {
      error:
        'Add a location to the search, e.g. "dentists in Austin TX". ' +
        'Overture data is loaded per state.',
    })
  }

  // ── Daily cap, before any work is done ──────────────────────────────
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('plan_tier')
    .eq('id', clientId)
    .maybeSingle()

  const tier = String(clientRow?.plan_tier || 'starter').toLowerCase()
  const cap = DAILY_CAP[tier] ?? DEFAULT_DAILY_CAP

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count: usedToday } = await supabaseAdmin
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('agent_type', 'hunter')
    .eq('metadata->>step', 'prospect')
    .gte('created_at', startOfDay.toISOString())

  if ((usedToday ?? 0) >= cap) {
    throw new ProspectError(429, {
      error:
        `Daily prospecting limit reached: ${cap} searches per day on the ` +
        `${tier} plan. Resets at midnight.`,
      limit: cap,
      used: usedToday ?? 0,
      plan_tier: tier,
    })
  }

  const requested = Number(params.maxResults)
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_RESULTS)
    : DEFAULT_RESULTS

  let q = supabaseAdmin
    .from('overture_places')
    .select('overture_id, name, category, website, phone, email, address, city, state, confidence')
    .not('website', 'is', null)

  if (parsed.state) q = q.eq('state', parsed.state)
  if (parsed.city) q = q.ilike('city', parsed.city)

  // Match the category hint against either the category or the business name —
  // Overture's categories are snake_case slugs and a user typing "dentists"
  // should still find "dentist".
  if (parsed.category) {
    const hint = parsed.category.replace(/[%,]/g, ' ').trim()
    if (hint) {
      q = q.or(`category.ilike.%${hint}%,name.ilike.%${hint}%`)
    }
  }

  const { data, error } = await q.order('confidence', { ascending: false }).limit(limit)

  if (error) {
    console.error('[hunter/prospect] overture query failed:', error.message)
    throw new Error(error.message)
  }

  const rows = data ?? []

  // Nothing loaded for this slice is a normal state, not a failure — the ETL
  // is run per state and per category set.
  if (rows.length === 0) {
    const where = [parsed.city, parsed.state].filter(Boolean).join(', ')
    return {
      leads: [],
      total_found: 0,
      total_with_website: 0,
      query,
      message:
        `No Overture places loaded for "${parsed.category}" in ${where || 'that location'}. ` +
        `Load them with: ./scripts/overture-etl.sh ${parsed.state ?? '<STATE>'} "<categories>", ` +
        'then import the CSV into the overture_places table.',
    }
  }

  const leads: ProspectLead[] = rows.map((row: any) => ({
    client_id: clientId,
    place_id: row.overture_id,
    name: row.name ?? 'Unknown',
    phone: row.phone ?? null,
    website: row.website ?? null,
    // Overture supplies an email for a share of records; Google did not.
    email: row.email ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    category: row.category ?? null,
    // Overture carries no ratings.
    rating: null,
    review_count: null,
    prospect_query: query,
    outreach_status: 'new',
    source: 'overture',
    // TCPA: a number from a public directory carries no consent.
    phone_consent: false,
  }))

  // ignoreDuplicates leaves an already-discovered place untouched, so a repeat
  // search never overwrites enrichment gathered since.
  const { error: upsertError } = await supabaseAdmin
    .from('leads')
    .upsert(leads, { onConflict: 'client_id,place_id', ignoreDuplicates: true })

  if (upsertError) {
    console.error('[hunter/prospect] lead upsert failed:', upsertError.message)
    throw new Error(upsertError.message)
  }

  await logAgentRun({
    client_id: clientId,
    agent_type: 'hunter',
    status: 'completed',
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    output_summary: `Prospected ${leads.length} leads for: ${query}`,
    metadata: {
      step: 'prospect',
      source: 'overture',
      query,
      category: parsed.category,
      city: parsed.city,
      state: parsed.state,
      total_found: rows.length,
      total_with_website: leads.length,
    },
  })

  return {
    leads,
    total_found: rows.length,
    total_with_website: leads.length,
    query,
  }
}

export async function POST(req: NextRequest) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
        const body = await req.json().catch(() => ({}))

    const result = await runHunterProspect({
      clientId,
      query: body?.query,
      maxResults: body?.max_results,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ProspectError) {
      return NextResponse.json(err.payload, { status: err.status })
    }

    return serverError(err, 'agents/hunter/prospect')
  }
}
