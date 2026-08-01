import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { retrieveContext } from '@/lib/voyage';

const ANALYSIS_SYSTEM_PROMPT = `Analyze this phone call transcript. Return ONLY valid JSON:
{ summary: string (2 sentences), sentiment_score: number 0-100,
  resolved: boolean, escalated: boolean, escalation_reason: string or null }`;

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

// Shared logic, reused by the test route.
export async function runCallCenter(
  client_id: string,
  transcript?: string,
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
      'faq',
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
  const ai = await callAI({
    model: MODELS.SONNET,
    system: ANALYSIS_SYSTEM_PROMPT,
    user: transcript,
    maxTokens: 1000,
  });

  const analysis = parseJSON(ai.text);
  const tokensUsed = ai.inputTokens + ai.outputTokens;

  await supabaseAdmin.from('call_transcripts').insert({
    client_id,
    transcript,
    summary: analysis.summary,
    sentiment_score: analysis.sentiment_score,
    resolved: analysis.resolved,
    escalated: analysis.escalated,
    escalation_reason: analysis.escalation_reason,
    direction: 'inbound',
  });

  await logAgentRun({
    client_id,
    agent_type: 'call_center',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: 'Call analyzed: ' + (analysis.summary || '').slice(0, 120),
  });

  return {
    status: 200,
    body: {
      mode: 'analysis',
      ...analysis,
      cost_usd: ai.cost,
      tokens_used: tokensUsed,
    },
  };
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const { client_id, transcript } = await req.json();

    if (!client_id) {
      return NextResponse.json(
        { error: 'client_id is required.' },
        { status: 400 },
      );
    }

    const { status, body } = await runCallCenter(client_id, transcript);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[call-center] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
