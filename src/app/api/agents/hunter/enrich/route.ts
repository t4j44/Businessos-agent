import { NextRequest, NextResponse } from 'next/server'
import { promises as dns } from 'dns'
import { supabaseAdmin } from '@/lib/supabase'
import { readWebsite } from '@/lib/scraper'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// Hunter Enrich — the second pipeline step. Takes a prospected lead, reads its
// website for a contact address, verifies the domain can actually receive mail,
// and scores how well the business matches the client's ICP.
//
// Uses the Node runtime because dns.resolveMx is unavailable on edge.
export const runtime = 'nodejs'

const EMAIL_REGEX = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g

// Addresses nobody answers. info@, hello@ and contact@ are deliberately NOT
// here — for a small business those are the real inbox.
const NOISE = ['noreply', 'no-reply', 'donotreply', 'unsubscribe', 'privacy', 'support']

const CONFIDENCE = {
  websiteVerified: 90,   // found on the page and the domain has MX
  website: 80,           // found on the page
  directoryVerified: 85, // published in Overture and the domain has MX
  directory: 70,         // published in Overture
  pattern: 35,           // guessed from the domain, unverified
  none: 0,
}

const SYSTEM_PROMPT =
  'You are an ICP (ideal customer profile) scoring assistant. Score how well this business matches the provided ICP. Return JSON only, no markdown.'

export type EnrichResult = {
  lead_id: string
  name: string
  email_found: string | null
  email_confidence: number
  email_source: string | null
  icp_match_score: number
  icp_match_reason: string
  pain_points: string[]
  mx_verified: boolean
  outreach_status: string
  [key: string]: any
}

class EnrichError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Enrich failed'))
    this.status = status
    this.payload = payload
  }
}

function domainOf(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    return new URL(website).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function extractEmails(pageText: string): string[] {
  const raw = pageText.match(EMAIL_REGEX) ?? []
  const cleaned = raw
    .map((e) => e.toLowerCase())
    .filter((e) => !NOISE.some((n) => e.includes(n)))
  return [...new Set(cleaned)]
}

// Where a named human is most likely to appear. Tried in order, stopping at
// the first that returns content. Capped at MAX_ABOUT_ATTEMPTS because this is
// enrichment, not the point of the run — every failure is non-fatal.
const ABOUT_PATHS = ['/about', '/team', '/contact', '/our-team', '/staff']
const MAX_ABOUT_ATTEMPTS = 3
const ABOUT_CHARS = 1500

async function readAboutPage(website: string): Promise<string> {
  let origin: string
  try {
    origin = new URL(website).origin
  } catch {
    return ''
  }

  let attempts = 0
  for (const path of ABOUT_PATHS) {
    if (attempts >= MAX_ABOUT_ATTEMPTS) break
    attempts++
    try {
      const text = await readWebsite(origin + path, ABOUT_CHARS)
      if (text && text.trim().length > 100) return text.trim()
    } catch {
      // A 404 or a blocked path is expected; try the next one.
    }
  }
  return ''
}

// Only used when the page yielded nothing. These are guesses, which is why the
// confidence they carry is low.
function patternCandidates(name: string, domain: string): string[] {
  const parts = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const first = parts[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1] : ''

  return [
    `info@${domain}`,
    first ? `${first}@${domain}` : null,
    first && last && first !== last ? `${first}.${last}@${domain}` : null,
    first && last && first !== last ? `${first}${last}@${domain}` : null,
  ].filter((c): c is string => c !== null)
}

export async function runHunterEnrich(params: {
  clientId: string
  leadId: string
}): Promise<EnrichResult> {
  const { clientId } = params
  const leadId = String(params.leadId ?? '').trim()

  if (!leadId) {
    throw new EnrichError(400, { error: 'lead_id is required' })
  }

  // ── Step 1 — the lead, scoped to this client ──────────────────────────
  // The client_id filter is the IDOR guard: a lead id belonging to another
  // tenant returns 404 rather than their data.
  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .eq('client_id', clientId)
    .single()

  if (leadError || !lead) {
    throw new EnrichError(404, { error: 'Lead not found' })
  }

  // ── Step 2 — the client's ICP ─────────────────────────────────────────
  const { data: brand } = await supabaseAdmin
    .from('brand_profiles')
    .select('icp_summary, tone_description')
    .eq('client_id', clientId)
    .maybeSingle()

  const icpSummary: string | null = brand?.icp_summary ?? null

  // ── Step 2b — the directory may already have an address ───────────────
  // Overture supplies an email for a share of records. A published directory
  // address is better evidence than a guessed pattern, but weaker than one
  // found on the company's own site today.
  const directoryEmail = String(lead.email || '').trim().toLowerCase()

  // ── Step 3 — read the site ────────────────────────────────────────────
  // Still read it even when a directory email exists: the ICP scoring step
  // below needs the page text.
  let pageText = ''
  let aboutText = ''
  if (lead.website) {
    try {
      pageText = (await readWebsite(lead.website)) || ''
    } catch (err) {
      console.warn('[hunter/enrich] could not read', lead.website, err)
    }
    // Best-effort hunt for a named human to address the outbound to.
    aboutText = await readAboutPage(lead.website)
  }

  // ── Step 4 — emails on the page ───────────────────────────────────────
  // Order of preference: the live site, then the directory, then a guess.
  const emails = extractEmails(pageText)
  let foundEmail: string | null = emails[0] ?? directoryEmail ?? null
  let emailSource: string | null = null
  let emailConfidence = CONFIDENCE.none

  if (emails[0]) {
    foundEmail = emails[0]
    emailSource = 'website'
    emailConfidence = CONFIDENCE.website
  } else if (directoryEmail) {
    foundEmail = directoryEmail
    emailSource = 'directory'
    emailConfidence = CONFIDENCE.directory
  }

  const domain = domainOf(lead.website)

  // ── Step 5 — pattern guess when the page gave nothing ─────────────────
  if (!foundEmail && domain) {
    const candidates = patternCandidates(lead.name ?? '', domain)
    if (candidates.length > 0) {
      foundEmail = candidates[0]
      emailSource = 'pattern'
      emailConfidence = CONFIDENCE.pattern
    }
  }

  // ── Step 6 — can the domain receive mail at all? ──────────────────────
  let mxVerified = false
  if (domain) {
    try {
      const mx = await dns.resolveMx(domain)
      mxVerified = Array.isArray(mx) && mx.length > 0
    } catch {
      // ENOTFOUND / ENODATA — no mail exchanger for this domain.
      mxVerified = false
    }

    if (!mxVerified) {
      // Nothing can be delivered here, so an address would be a false lead.
      foundEmail = null
      emailSource = null
      emailConfidence = CONFIDENCE.none
    } else if (emailSource === 'website') {
      emailConfidence = CONFIDENCE.websiteVerified
    } else if (emailSource === 'directory') {
      emailConfidence = CONFIDENCE.directoryVerified
    }
  }

  // ── Step 7 — ICP score ────────────────────────────────────────────────
  let icpScore = 50
  let icpReason = icpSummary ? 'No ICP data available' : 'No ICP configured'
  let painPoints: string[] = []
  let contactName: string | null = null
  let contactRole: string | null = null
  let tokensUsed = 0
  let costUsd = 0

  if (icpSummary) {
    try {
      const ai = await callAI({
        model: MODELS.HAIKU,
        system: SYSTEM_PROMPT,
        user: `ICP: ${icpSummary}

Business to score:
Name: ${lead.name}
Category: ${lead.category ?? 'Unknown'}
Address: ${lead.address ?? 'Unknown'}
Location: ${[lead.city, lead.state].filter(Boolean).join(', ') || 'Unknown'}
Website preview: ${pageText.slice(0, 500)}

About/team page excerpt: ${aboutText.slice(0, 800) || '(none found)'}

From the about/team excerpt only, identify the owner or primary decision-maker.
Return null for contact_name and contact_role if no specific named person is
identifiable. NEVER invent a name, and never return the company name as a
person's name.

Return JSON: { "score": <0-100>, "reason": "<one sentence why>", "pain_points": ["<point1>", "<point2>", "<point3>"], "contact_name": "<full name or null>", "contact_role": "<their role or null>" }`,
        maxTokens: 500,
      })

      tokensUsed = ai.inputTokens + ai.outputTokens
      costUsd = ai.cost

      try {
        // parseJSON rather than JSON.parse: it strips markdown fences and
        // smart quotes, which models emit even when told not to. A genuine
        // parse failure still falls through to the defaults below.
        const parsed = parseJSON(ai.text)
        icpScore = typeof parsed.score === 'number'
          ? Math.min(100, Math.max(0, parsed.score))
          : 50
        icpReason = typeof parsed.reason === 'string' ? parsed.reason : icpReason
        painPoints = Array.isArray(parsed.pain_points)
          ? parsed.pain_points.slice(0, 3).map((p: any) => String(p))
          : []

        // A model that ignores the "null" instruction tends to echo the company
        // name back. Anything matching the business is rejected — an email
        // opening "Hi there" is better than one addressing a company as a person.
        const rawName = typeof parsed.contact_name === 'string' ? parsed.contact_name.trim() : ''
        const businessName = String(lead.name || '').trim().toLowerCase()
        const looksLikeCompany =
          !rawName ||
          rawName.toLowerCase() === 'null' ||
          rawName.toLowerCase() === businessName ||
          (businessName.length > 3 && rawName.toLowerCase().includes(businessName))

        contactName = looksLikeCompany ? null : rawName
        const rawRole = typeof parsed.contact_role === 'string' ? parsed.contact_role.trim() : ''
        contactRole = contactName && rawRole && rawRole.toLowerCase() !== 'null' ? rawRole : null
      } catch {
        // keep defaults
      }
    } catch (err) {
      console.warn('[hunter/enrich] ICP scoring failed:', err)
    }
  }

  // ── Step 8 — write it back ────────────────────────────────────────────
  const { error: updateError } = await supabaseAdmin
    .from('leads')
    .update({
      email_found: foundEmail,
      email_confidence: emailConfidence,
      email_source: emailSource,
      icp_match_score: icpScore,
      icp_match_reason: icpReason,
      pain_points: painPoints,
      contact_name: contactName,
      contact_role: contactRole,
      outreach_status: 'enriched',
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('client_id', clientId)

  if (updateError) {
    console.error('[hunter/enrich] lead update failed:', updateError.message)
    throw new Error(updateError.message)
  }

  // ── Step 9 — log ──────────────────────────────────────────────────────
  const { logAgentRun } = await import('@/lib/log')
  await logAgentRun({
    client_id: clientId,
    agent_type: 'hunter',
    status: 'completed',
    input_tokens: 0,
    output_tokens: tokensUsed,
    cost_usd: costUsd,
    output_summary: `Enriched lead: ${lead.name} — email ${foundEmail ?? 'not found'}, ICP score ${icpScore}/100`,
    metadata: {
      step: 'enrich',
      lead_id: leadId,
      email_source: emailSource,
      mx_verified: mxVerified,
    },
  })

  // ── Step 10 ───────────────────────────────────────────────────────────
  return {
    lead_id: leadId,
    name: lead.name,
    email_found: foundEmail,
    email_confidence: emailConfidence,
    email_source: emailSource,
    icp_match_score: icpScore,
    icp_match_reason: icpReason,
    pain_points: painPoints,
    contact_name: contactName,
    contact_role: contactRole,
    mx_verified: mxVerified,
    outreach_status: 'enriched',
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

    const result = await runHunterEnrich({ clientId, leadId: body?.lead_id })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof EnrichError) {
      return NextResponse.json(err.payload, { status: err.status })
    }

    console.error('[hunter/enrich] POST failed:', err)
    return NextResponse.json(
      {
        error: 'Enrich failed',
        details: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    )
  }
}
