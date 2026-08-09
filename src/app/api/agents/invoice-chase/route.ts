import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { findOrCreateContact, logInteraction, updateContactScore, getContactHistory } from '@/lib/contacts';
import { retrieveContext, storeRAGChunk } from '@/lib/embeddings';

const NEUTRAL_TONE =
  'professional, courteous, and clear — like a well-run business communicating respectfully.';

type ChaseStep = 1 | 2 | 3 | 4 | 5;
type Channel = 'email' | 'sms' | 'voice' | 'none';

const STEP_CHANNEL: Record<ChaseStep, Channel> = {
  1: 'email',
  2: 'sms',
  3: 'email',
  4: 'voice',
  5: 'none',
};

const FDCPA_DISCLOSURE = "This is an attempt to collect a debt. Any information obtained will be used for that purpose.";

function buildSystemPrompt(
  step: ChaseStep,
  companyName: string,
  toneDescription: string,
  voiceContext: string,
  softerTone: boolean,
): string {
  const voice = `You are drafting overdue-invoice chase messages for ${companyName}. Brand tone: ${toneDescription}.
${voiceContext ? `\nReal examples of how this brand writes — match this voice closely:\n"""\n${voiceContext}\n"""\n` : ''}`;

  switch (step) {
    case 1:
      return `${voice}

This is STEP 1 (days 1-3) of a 5-step chase sequence.
Write a friendly reminder email. No pressure, no urgency.
${softerTone ? 'IMPORTANT: The customer has a history of negative interactions. Use an exceptionally soft, empathetic, and understanding tone.' : ''}

Return ONLY valid JSON: { "channel": "email", "message": "string", "step": 1 }`;
    case 2:
      return `${voice}

This is STEP 2 (days 4-7) of a 5-step chase sequence.
Write a follow-up email or SMS with urgency.
${softerTone ? 'IMPORTANT: The customer has a history of negative interactions. Use an exceptionally soft, empathetic, and understanding tone.' : ''}

Return ONLY valid JSON: { "channel": "sms", "message": "string", "step": 2 }`;
    case 3:
      return `${voice}

This is STEP 3 (days 8-14) of a 5-step chase sequence.
Write a firm notice stating the invoice is now overdue.

Return ONLY valid JSON: { "channel": "email", "message": "string", "step": 3 }`;
    case 4:
      return `${voice}

This is STEP 4 (days 15-21) of a 5-step chase sequence.
Write a final warning message. A mandatory legal disclosure will be appended to your text separately. Do NOT write any legal disclosures yourself.

Return ONLY valid JSON: { "channel": "voice", "message": "string", "step": 4 }`;
    case 5:
      return '';
  }
}

function buildUserMessage(
  companyName: string,
  customerName: string,
  invoiceId: string,
  amountDue: string,
): string {
  return `Company: ${companyName}\nCustomer: ${customerName}\nInvoice: ${invoiceId}\nAmount due: ${amountDue}`;
}

async function generateWithRetry(
  system: string,
  user: string,
): Promise<{ ai: Awaited<ReturnType<typeof callAI>>; analysis: any }> {
  const MAX_ATTEMPTS = 3;
  let lastParseError: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ai = await callAI({
      model: MODELS.SONNET,
      system,
      user,
      maxTokens: 800,
    });
    try {
      const analysis = parseJSON(ai.text);
      return { ai, analysis };
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[invoice-chase] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nRAW MODEL OUTPUT >>>\n${ai.text}\n<<< END RAW`,
      );
    }
  }
  throw new Error(
    `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts. Last parse error: ${lastParseError?.message}`,
  );
}

export async function runInvoiceChase(params: {
  client_id: string;
  customer_email?: string;
  customer_name: string;
  invoice_id: string;
  amount_due: number;
  days_overdue: number;
  chase_step: ChaseStep;
}): Promise<{ status: number; body: any }> {
  const {
    client_id, customer_email, customer_name, invoice_id, amount_due, days_overdue, chase_step
  } = params;

  if (![1, 2, 3, 4, 5].includes(chase_step)) {
    return {
      status: 400,
      body: { success: false, error: 'chase_step must be an integer from 1 to 5.' },
    };
  }

  // ── BEFORE ACTING ────────────────────────────────────────────────────────
  let contactId: string | null = null;
  let hasNegativeHistory = false;

  if (customer_email) {
    const contact = await findOrCreateContact({
      client_id,
      email: customer_email,
    });
    if (contact) {
      contactId = contact.id;
      const history = await getContactHistory({ contact_id: contactId });
      
      hasNegativeHistory = history.some(
        (h) => h.sentiment_score !== null && h.sentiment_score < 50
      );
    }
  }

  const voiceContext = await retrieveContext('brand voice tone and communication style', client_id);

  // ── CORE ACTION ────────────────────────────────────────────────────────
  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'our company';
  const toneDescription = brand?.tone_description || NEUTRAL_TONE;
  const formattedAmount = '$' + amount_due.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let message: string | null = null;
  let ai: any = null;
  const channel: Channel = STEP_CHANNEL[chase_step];

  if (chase_step === 5) {
    message = null;
  } else {
    const system = buildSystemPrompt(chase_step, companyName, toneDescription, voiceContext, hasNegativeHistory);
    const user = buildUserMessage(companyName, customer_name, invoice_id, formattedAmount);

    try {
      const result = await generateWithRetry(system, user);
      ai = result.ai;
      message = result.analysis.message || '';
      
      if (chase_step === 4) {
        message = (message || '').trim() + ' ' + FDCPA_DISCLOSURE;
      }
      
      if (chase_step === 2 && message && message.length > 160) {
        message = message.slice(0, 157) + '...';
      }
    } catch (err: any) {
      await logAgentRun({
        client_id,
        agent_type: 'invoice_chase',
        status: 'error',
        output_summary: 'Failed to generate chase message',
        metadata: { error: err?.message || String(err) },
      });
      return {
        status: 500,
        body: { success: false, error: err?.message || String(err) },
      };
    }
  }

  // ── AFTER ACTING ────────────────────────────────────────────────────────
  if (contactId) {
    await logInteraction({
      contact_id: contactId,
      client_id,
      agent_name: 'invoice_chase',
      interaction_type: 'invoice_chase_step_' + chase_step,
      summary: 'Invoice chase step ' + chase_step + ' sent to ' + customer_name + ' for $' + amount_due,
      sentiment_score: undefined,
      metadata: { invoice_id, amount_due, days_overdue, chase_step, message_sent: chase_step !== 5 },
    });

    const scoreDelta = -5 * chase_step;
    await updateContactScore({ contact_id: contactId, score_delta: scoreDelta });
  }

  await storeRAGChunk({
    client_id,
    content: 'Invoice chase: ' + customer_name + ' owes $' + amount_due + ', on step ' + chase_step + ', ' + days_overdue + ' days overdue',
    chunk_type: 'contact',
    source_agent: 'invoice_chase',
  });

  await logAgentRun({
    client_id,
    agent_type: 'invoice_chase',
    status: 'completed',
    input_tokens: ai?.inputTokens || 0,
    output_tokens: ai?.outputTokens || 0,
    cost_usd: ai?.cost || 0,
    output_summary: `Chase step ${chase_step} processed for invoice ${invoice_id}`,
    metadata: { invoice_id, chase_step, contact_id: contactId },
  });

  return {
    status: 200,
    body: {
      success: true,
      chase_step,
      message,
      contact_id: contactId,
      fdcpa_compliant: chase_step === 4,
      escalated: chase_step === 5,
    },
  };
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const client_id = body.client_id;
    const customer_email = body.customer_email;
    const customer_name = body.customer_name;
    const invoice_id = body.invoice_id ?? body.invoice_number;
    const amount_due = body.amount_due ?? (body.amount_cents != null ? body.amount_cents / 100 : null);
    const days_overdue = body.days_overdue || 0;
    const chase_step = body.chase_step;

    if (!client_id || !customer_name || amount_due == null || !invoice_id || !chase_step) {
      return NextResponse.json(
        {
          success: false,
          error: 'client_id, customer_name, amount_due, invoice_id, and chase_step are required.',
        },
        { status: 400 },
      );
    }

    const { status, body: resultBody } = await runInvoiceChase({
      client_id,
      customer_email,
      customer_name,
      invoice_id,
      amount_due,
      days_overdue,
      chase_step,
    });
    return NextResponse.json(resultBody, { status });
  } catch (err: any) {
    console.error('[invoice-chase] POST failed:', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
