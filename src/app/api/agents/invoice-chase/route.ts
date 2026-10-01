import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { isUuid, readJsonBody } from '@/lib/validation';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { findOrCreateContact, getContactHistory } from '@/lib/contacts';
import { retrieveContext } from '@/lib/embeddings';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError, serverErrorPayload } from '@/lib/server-error'

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

This is a debt collection communication. The message MUST include, verbatim:
"${FDCPA_DISCLOSURE}"
Do not threaten legal action, credit reporting, or any consequence that will not
actually occur. Do not imply urgency that is not real. State the amount owed and
the original due date factually.
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
        `[invoice-chase] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nprovider output omitted`,
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
      const history = await getContactHistory({ client_id, contact_id: contactId });
      
      hasNegativeHistory = history.some(
        (h) => h.sentiment_score !== null && h.sentiment_score < 50
      );
    }
  }

  const voiceContext = await retrieveContext('brand voice tone and communication style', client_id, 'voice');

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
      
      // FDCPA: assert the disclosure rather than trusting the model to have
      // included it. Applies to every step of the sequence, not just step 4.
      message = (message || '').trim();
      if (!message.includes(FDCPA_DISCLOSURE)) {
        message = (message + ' ' + FDCPA_DISCLOSURE).trim();
      }
      
      // Step 2 goes out as SMS. Truncate the drafted body, never the
      // disclosure — cutting it would undo the assertion above.
      if (chase_step === 2 && message && message.length > 160) {
        const room = 160 - FDCPA_DISCLOSURE.length - 4;
        const draft = message.replace(FDCPA_DISCLOSURE, '').trim();
        message = (draft.slice(0, Math.max(0, room)).trimEnd() + '... ' + FDCPA_DISCLOSURE).trim();
      }
    } catch (err: any) {
      await logAgentRun({
        client_id,
        agent_type: 'invoice_chase',
        status: 'error',
        output_summary: 'Failed to generate chase message',
        metadata: { error: err?.message || String(err) },
      });
      return { status: 500, body: { success: false, ...serverErrorPayload(err, 'agents/invoice-chase') } };
    }
  }

  // This function generates a draft only. Sending, score changes, and customer
  // interactions require a confirmed provider action in a separate workflow.
  await logAgentRun({
    client_id,
    agent_type: 'invoice_chase',
    status: 'completed',
    input_tokens: ai?.inputTokens || 0,
    output_tokens: ai?.outputTokens || 0,
    cost_usd: ai?.cost || 0,
    output_summary: `Chase step ${chase_step} drafted for invoice ${invoice_id}`,
    metadata: { invoice_id, chase_step, contact_id: contactId },
  });

  return {
    status: 200,
    body: {
      success: true,
      chase_step,
      message,
      contact_id: contactId,
      channel,
      delivery_status: 'draft',
      sent: false,
      requires_review: true,
      escalation_recommended: chase_step === 5,
    },
  };
}

export async function POST(req: Request) {
  let clientId: string;
  let reqBody: any = {};
  try {
    reqBody = await req.json().catch(() => ({}));
    ({ clientId } = await requireCronOrSession(req, reqBody?.client_id));
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
    const body = reqBody;
    const client_id = clientId;
    if (!isUuid(body.invoice_id)) return NextResponse.json({ error: 'Choose a stored invoice.' }, { status: 400 });
    const { data: invoice, error } = await supabaseAdmin.from('invoices').select('*').eq('client_id', client_id).eq('id', body.invoice_id).maybeSingle();
    if (error) return NextResponse.json({ error: 'Invoice could not be loaded.' }, { status: 503 });
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['sent','overdue'].includes(invoice.status) || !invoice.due_date) return NextResponse.json({ error: 'This invoice is not eligible for a reminder.' }, { status: 409 });
    const days_overdue = Math.floor((Date.now() - Date.parse(invoice.due_date + 'T00:00:00Z')) / 86400000);
    const chase_step = Number(invoice.chase_step || 0) + 1;
    if (chase_step > 5 || days_overdue < [1,4,8,15,22][chase_step-1]) return NextResponse.json({ error: 'The next reminder is not due yet.' }, { status: 409 });
    const customer_email = invoice.customer_email;
    const customer_name = invoice.customer_name || 'Customer';
    const invoice_id = invoice.stripe_invoice_id || invoice.id.slice(0,8);
    const amount_due = invoice.amount_cents / 100;
    const { status, body: resultBody } = await runInvoiceChase({
      client_id,
      customer_email,
      customer_name,
      invoice_id,
      amount_due,
      days_overdue,
      chase_step: chase_step as ChaseStep,
    });
    return NextResponse.json(resultBody, { status });
  } catch (err: any) {
    console.error('[invoice-chase] POST failed:', err);
    return serverError(err, 'agents/invoice-chase', { success: false });
  }
}
