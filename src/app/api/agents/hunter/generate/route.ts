import { NextResponse } from 'next/server'
import { callAI, MODELS, parseJSON } from '@/lib/ai'
import { getClientContext, supabaseAdmin } from '@/lib/supabase'
import { createEmbedding } from '@/lib/embeddings'
import { readWebsite } from '@/lib/scraper'
import { logAgentRun } from '@/lib/log'
import { requireSession, authErrorResponse } from '@/lib/auth-guard'

// Hunter — personalised cold outbound.
//
// The whole point is that the copy sounds like this client and speaks to this
// lead, so the run pulls three things together before writing: the brand voice
// (brand_profiles), the ICP's own phrasing (RAG chunks, ideally the ones
// Audience Intelligence stored), and whatever the lead's own site says.
//
// The two enrichment steps are best-effort. No embedding, no chunks or an
// unreadable lead site narrows the personalisation; it does not fail the run.
// A missing brand profile does fail it — generic outbound is worse than none.

const SITE_CHARS = 1500
const SITE_EXCERPT = 200
const MAX_ICP_QUOTES = 3
const RAG_MATCH_COUNT = 5

export type Lead = {
  name: string
  company: string
  role: string
  pain_point?: string
  website?: string
}

export type Email = { subject: string; body: string }

export type HunterEmails = {
  initial: Email
  follow_up_1: Email
  follow_up_2: Email
}

type RagChunk = { content: string; chunk_type: string; similarity: number }

function buildSystemPrompt(
  brand: any,
  icpQuotes: string[],
): string {
  const quoteBlock = icpQuotes.length
    ? icpQuotes.map((q) => '- ' + q).join('\n')
    : '(none available — write from the brand voice alone)'

  return `You are writing cold outbound emails for ${brand.company_name || 'this business'}.
Brand voice: ${brand.tone_description || 'clear and direct'}
What we offer: ${brand.value_proposition || 'not specified'}
Who we help: ${brand.icp_summary || 'small business owners'}

RULES FOR COLD EMAIL:
- Subject line: 5-7 words, specific, no hype. Never 'Quick question' or 'Following up'.
- Opening: reference something specific about their company or role — not generic.
- Core pitch: one sentence, the most relevant benefit for their exact role.
- Social proof or proof point: one real claim (be specific, not vague).
- CTA: one clear ask. Not 'would love to chat' — something specific.
  ('Worth a 15-minute call Thursday?' or 'Can I send you a 2-minute video?')
- Length: 80-120 words for initial. 50-70 words for follow-ups.
- Tone: match the brand voice above. If casual — be casual. If formal — be formal.
- FORBIDDEN: 'I hope this email finds you well', 'Reaching out to connect',
  'My name is X and I work at Y', 'synergy', 'paradigm shift', 'game-changing'.
- If the recipient's name is "there", open with a greeting that does not use a name
  ("Hi there —" or a direct opening line). NEVER address a company name as if it
  were a person's name.

ICP LANGUAGE (use these phrases naturally if relevant — these came from real conversations
with people like this lead):
${quoteBlock}

Return ONLY valid JSON (no markdown):
{
  subject: string,
  body: string,
  follow_up_1: { subject: string, body: string },
  follow_up_2: { subject: string, body: string },
  personalization_notes: string (what specific details you used about this lead),
  icp_phrases_used: string[] (which ICP phrases from above you included, if any)
}`
}

function buildUserMessage(lead: Lead, leadSiteContent: string, sequence: string): string {
  return `Write a cold email sequence for this lead:
Name: ${lead.name}
Role: ${lead.role}
Company: ${lead.company}
Their business: ${leadSiteContent || 'Not provided'}
Likely pain point: ${lead.pain_point || 'Infer from their role'}
Email sequence requested: ${sequence}

Generate all 3 emails (initial + 2 follow-ups) even if sequence is 'initial'.`
}

// The model is told to return this shape but nothing enforces it, and these
// strings go straight into an email a real person receives.
function coerceEmail(raw: any, fallbackSubject: string): Email {
  return {
    subject: String(raw?.subject ?? '').trim() || fallbackSubject,
    body: String(raw?.body ?? '').trim(),
  }
}

export async function runHunterGenerate(params: {
  client_id?: string
  lead?: Partial<Lead>
  sequence?: string
}): Promise<{ status: number; body: any }> {
  const startedAt = Date.now()

  if (!process.env.OPENROUTER_API_KEY) {
    return { status: 503, body: { error: 'OPENROUTER_API_KEY missing' } }
  }

  const client_id = params.client_id
  const leadIn = params.lead || {}

  const lead: Lead = {
    name: String(leadIn.name || '').trim(),
    company: String(leadIn.company || '').trim(),
    role: String(leadIn.role || '').trim(),
    pain_point: leadIn.pain_point ? String(leadIn.pain_point).trim() : undefined,
    website: leadIn.website ? String(leadIn.website).trim() : undefined,
  }

  if (!client_id) {
    return { status: 400, body: { error: 'client_id is required.' } }
  }
  if (!lead.name || !lead.company || !lead.role) {
    return {
      status: 400,
      body: { error: 'lead.name, lead.company, and lead.role are required.' },
    }
  }

  const sequence =
    params.sequence === 'follow_up_1' || params.sequence === 'follow_up_2'
      ? params.sequence
      : 'initial'

  try {
    // ── STEP 1 — brand voice ────────────────────────────────────────────
    const { brand } = await getClientContext(client_id)

    if (!brand) {
      return { status: 400, body: { error: 'Run Brand Scout first' } }
    }

    // ── STEP 2 — the ICP's own words ────────────────────────────────────
    const searchQuery =
      `${lead.role} at ${lead.company} pain points objections buying triggers`

    let icpQuotes: string[] = []
    let ragChunksUsed = 0

    const queryEmbedding = await createEmbedding(searchQuery)

    if (queryEmbedding) {
      // Audience chunks hold the ICP's own phrasing, which is what this prompt
      // needs. Searching unfiltered makes them compete with brand copy and
      // performance data, so they are asked for first.
      let { data: ragChunks, error: ragError } = await supabaseAdmin.rpc(
        'search_rag_chunks',
        {
          query_embedding: queryEmbedding,
          match_client_id: client_id,
          match_count: RAG_MATCH_COUNT,
          filter_chunk_type: 'audience',
        },
      )

      // Too little audience material to work from — widen rather than send
      // outbound with almost no ICP context.
      if (!ragError && (ragChunks?.length ?? 0) < 2) {
        const wide = await supabaseAdmin.rpc('search_rag_chunks', {
          query_embedding: queryEmbedding,
          match_client_id: client_id,
          match_count: RAG_MATCH_COUNT,
        })
        if (!wide.error && wide.data) {
          ragChunks = wide.data
          ragError = wide.error
        }
      }

      if (ragError) {
        console.warn('[hunter] rag search failed:', ragError.message)
      } else {
        const chunks = (ragChunks || []) as RagChunk[]
        ragChunksUsed = chunks.length

        // 'audience' chunks are the ones Audience Intelligence stored, which
        // hold real quoted phrasing rather than marketing copy — those first.
        const ranked = [...chunks].sort((a, b) => {
          const aAudience = a.chunk_type === 'audience' ? 0 : 1
          const bAudience = b.chunk_type === 'audience' ? 0 : 1
          return aAudience - bAudience || (b.similarity ?? 0) - (a.similarity ?? 0)
        })

        icpQuotes = ranked
          .map((c) => String(c.content || '').trim())
          .filter(Boolean)
          .slice(0, MAX_ICP_QUOTES)
      }
    } else {
      console.warn('[hunter] no embedding available — writing without ICP quotes')
    }

    // ── STEP 3 — the lead's own site ────────────────────────────────────
    let leadSiteContent = ''
    if (lead.website) {
      try {
        const content = await readWebsite(lead.website, SITE_CHARS)
        leadSiteContent = (content || '').trim().slice(0, SITE_EXCERPT)
      } catch (err) {
        console.warn('[hunter] could not read lead site', lead.website, err)
      }
    }

    // ── STEP 4 — write it ───────────────────────────────────────────────
    const ai = await callAI({
      model: MODELS.SONNET,
      system: buildSystemPrompt(brand, icpQuotes),
      user: buildUserMessage(lead, leadSiteContent, sequence),
      maxTokens: 2000,
    })

    let result: any
    try {
      result = parseJSON(ai.text)
    } catch (err) {
      console.error('[hunter] could not parse model output:', err)
      return { status: 500, body: { error: 'AI returned invalid format' } }
    }

    const emails: HunterEmails = {
      initial: coerceEmail(result, `${lead.company} — quick idea`),
      follow_up_1: coerceEmail(result?.follow_up_1, `Following on — ${lead.company}`),
      follow_up_2: coerceEmail(result?.follow_up_2, `Last note — ${lead.company}`),
    }

    const tokensUsed = ai.inputTokens + ai.outputTokens

    // ── STEP 6 — log ────────────────────────────────────────────────────
    await logAgentRun({
      client_id,
      agent_type: 'hunter',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.cost,
      output_summary: `Hunter email generated for ${lead.name} at ${lead.company}`,
      metadata: {
        lead,
        sequence,
        rag_chunks_used: ragChunksUsed,
        icp_quotes_available: icpQuotes.length,
        lead_site_read: !!leadSiteContent,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        lead: { name: lead.name, company: lead.company, role: lead.role },
        emails,
        personalization_notes: String(result?.personalization_notes ?? '').trim(),
        icp_phrases_used: Array.isArray(result?.icp_phrases_used)
          ? result.icp_phrases_used.map((p: any) => String(p))
          : [],
        rag_chunks_used: ragChunksUsed,
        sequence,
        tokens_used: tokensUsed,
        cost_usd: ai.cost,
        response_time_ms: Date.now() - startedAt,
      },
    }
  } catch (err: any) {
    console.error('[hunter] generate failed:', err)

    await logAgentRun({
      client_id,
      agent_type: 'hunter',
      status: 'failed',
      output_summary: err?.message || String(err),
      metadata: { lead, sequence },
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
    const body = await req.json().catch(() => ({}))
    const { status, body: result } = await runHunterGenerate({
      client_id: clientId,
      lead: body?.lead,
      sequence: body?.sequence,
    })
    return NextResponse.json(result, { status })
  } catch (err: any) {
    console.error('[hunter] POST failed:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
