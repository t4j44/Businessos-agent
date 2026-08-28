import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { retrieveContext, storeRAGChunk } from '@/lib/embeddings';
import {
  findOrCreateContact,
  getContactHistory,
  logInteraction,
  updateContactScore,
} from '@/lib/contacts';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

const ESCALATION_TRIGGERS = [
  'billing dispute',
  'legal mention',
  'angry caller',
  '"speak to a manager"',
  'service outage',
];

// Build the phone-handling script from a client's Brand DNA, enriched with
// any semantically-retrieved brand knowledge.
function buildScript(brand: any, faqContext = ''): string {
  const company = brand.company_name || 'our company';

  const products = Array.isArray(brand.products_json) ? brand.products_json : [];
  const productLines = products.length
    ? products
        .map((p: any) => `  - ${p.name}: ${p.description}`)
        .join('\n')
    : '  - (no products on file)';

  const faqs = Array.isArray(brand.faq_json) ? brand.faq_json : [];
  const faqLines = faqs.length
    ? faqs
        .map((f: any, i: number) => `  ${i + 1}. Q: ${f.question}\n     A: ${f.answer}`)
        .join('\n')
    : '  (no FAQs on file)';

  const escalationLines = ESCALATION_TRIGGERS.map((t) => `  - ${t}`).join('\n');

  return `CALL-HANDLING SCRIPT — ${company}

OPENING (recording disclosure):
"Thank you for calling ${company}. This call may be recorded for quality purposes. How can I help you today?"

VALUE PROPOSITION (use to frame the conversation):
${brand.value_proposition || '(no value proposition on file)'}

PRODUCTS / SERVICES:
${productLines}

FREQUENTLY ASKED QUESTIONS (answer directly when asked):
${faqLines}
${
  faqContext
    ? `\nADDITIONAL KNOWLEDGE BASE CONTEXT (use to answer off-script questions):\n${faqContext}\n`
    : ''
}
ESCALATION TRIGGERS — transfer to a human immediately if any of these occur:
${escalationLines}

CLOSING:
"Is there anything else I can help you with today? Thank you for calling ${company}."`;
}

export async function runCallCenter(
  client_id: string,
  transcript?: string,
  caller_phone?: string,
  caller_name?: string,
  call_duration_seconds?: number,
): Promise<{ status: number; body: any }> {
  // MODE A — no transcript: generate the call script from Brand DNA.
  if (!transcript) {
    const { brand } = await getClientContext(client_id);
    if (!brand) {
      return {
        status: 400,
        body: { error: 'Run Brand Scout first to build Brand DNA.' },
      };
    }

    // Pull in semantically relevant brand memory for off-script questions.
    const faqContext = await retrieveContext(
      'frequently asked questions and common customer inquiries',
      client_id,
      // FAQ content lives in Brand Scout's 'brand' chunks; 'contact' holds
      // interaction history, which is not what a caller is asking about.
      'brand',
      3,
    );

    return {
      status: 200,
      body: {
        mode: 'script',
        company_name: brand.company_name,
        script: buildScript(brand, faqContext),
        ready: true,
      },
    };
  }

  // MODE B — transcript provided: analyze the call.
  // ── BEFORE ACTING ────────────────────────────────────────────────────────
  let contact_id: string | null = null;
  let at_risk = false;

  if (caller_phone) {
    const contact = await findOrCreateContact({
      client_id,
      phone: caller_phone,
      name: caller_name,
      source: 'call_center',
    });
    
    if (contact) {
      contact_id = contact.id;
      const history = await getContactHistory({ contact_id: contact.id });
      at_risk = history.some(h => h.sentiment_score !== null && h.sentiment_score < 40);
    }
  }

  const faqContext = await retrieveContext(
    'frequently asked questions and common customer inquiries',
    client_id,
    'brand'
  );
  const brandContext = await retrieveContext(
    'brand voice tone and communication style',
    client_id,
    'contact'
  );

  // ── CORE ACTION ────────────────────────────────────────────────────────
  const ANALYSIS_SYSTEM_PROMPT = `Analyze this phone call transcript.
Brand voice: ${brandContext}
FAQ knowledge: ${faqContext}

Return ONLY valid JSON:
{ 
  "summary": "string (2 sentences)", 
  "sentiment_score": 50,
  "outcome": "resolved | escalated | missed",
  "follow_up_required": true,
  "topics_discussed": ["topic 1", "topic 2"]
}`;

  let aiResult;
  let analysis;
  let tokensUsed = 0;

  try {
    const ai = await callAI({
      model: MODELS.SONNET,
      system: ANALYSIS_SYSTEM_PROMPT,
      user: transcript,
      maxTokens: 1000,
    });
    aiResult = ai;
    analysis = parseJSON(ai.text);
    tokensUsed = ai.inputTokens + ai.outputTokens;
  } catch (err: any) {
    await logAgentRun({
      client_id,
      agent_type: 'call_center',
      status: 'error',
      output_summary: 'Failed to process call analysis',
      metadata: { error: err?.message || String(err) },
    });
    return { status: 500, body: { success: false, error: err?.message || String(err) } };
  }

  const outcome = analysis.outcome || 'missed';
  const escalated = outcome === 'escalated';
  const summaryText = analysis.summary || '';
  const sentimentScore = analysis.sentiment_score ?? null;
  const topicsDiscussed = Array.isArray(analysis.topics_discussed) ? analysis.topics_discussed : [];
  const followUpRequired = Boolean(analysis.follow_up_required);

  // ── AFTER ACTING ────────────────────────────────────────────────────────
  // Check actual column names: duration_sec instead of duration. escalated but no resolved.
  const { error: dbError } = await supabaseAdmin.from('call_transcripts').insert({
    client_id,
    contact_id,
    duration_sec: call_duration_seconds,
    transcript,
    summary: summaryText,
    sentiment_score: sentimentScore,
    escalated: escalated,
    direction: 'inbound',
  });

  if (contact_id) {
    await logInteraction({
      contact_id,
      client_id,
      agent_name: 'call_center',
      interaction_type: 'inbound_call',
      summary: `${outcome} — ${summaryText}`,
      sentiment_score: sentimentScore,
      metadata: { 
        call_duration_seconds, 
        topics_discussed: topicsDiscussed,
        follow_up_required: followUpRequired, 
        at_risk 
      },
    });

    const score_delta = outcome === 'resolved' ? 5 : (escalated ? -10 : 0);
    if (score_delta !== 0) {
      await updateContactScore({ contact_id, score_delta });
    }
  }

  await storeRAGChunk({
    client_id,
    content: `Call summary: ${summaryText}. Topics: ${topicsDiscussed.join(', ')}`,
    chunk_type: 'contact',
    source_agent: 'call_center',
  });

  await logAgentRun({
    client_id,
    agent_type: 'call_center',
    status: 'completed',
    input_tokens: aiResult.inputTokens,
    output_tokens: aiResult.outputTokens,
    cost_usd: aiResult.cost,
    output_summary: `Call analyzed (outcome: ${outcome}): ${summaryText.slice(0, 120)}`,
  });

  return {
    status: 200,
    body: {
      success: true,
      sentiment_score: sentimentScore,
      outcome,
      summary: summaryText,
      follow_up_required: followUpRequired,
      contact_id,
      at_risk,
      saved_to_db: !dbError,
    },
  };
}

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { transcript, caller_phone, caller_name, call_duration_seconds } = await req.json();
    const client_id = clientId;

    if (!client_id) { // always set from session

      return NextResponse.json(
        { success: false, error: 'client_id is required.' },
        { status: 400 },
      );
    }

    const { status, body } = await runCallCenter(
      client_id, 
      transcript, 
      caller_phone, 
      caller_name, 
      call_duration_seconds
    );
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[call-center] POST failed:', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
