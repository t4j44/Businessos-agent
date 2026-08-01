import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';

const NEUTRAL_TONE =
  'professional, courteous, and clear — like a well-run business communicating respectfully.';

type ChaseStep = 1 | 2 | 3 | 4 | 5;
type Channel = 'email' | 'sms' | 'voice';

const STEP_CHANNEL: Record<ChaseStep, Channel> = {
  1: 'email',
  2: 'sms',
  3: 'email',
  4: 'voice',
  5: 'email',
};

// The FDCPA disclosure must appear verbatim, so it is built in code — never
// left to the model — and prepended to the step-4 message.
function buildDisclosure(companyName: string, invoiceNumber: string, formattedAmount: string): string {
  return (
    `This is an automated message from ${companyName} regarding invoice ${invoiceNumber} ` +
    `for ${formattedAmount}. This is an attempt to collect a debt. You have the right to dispute this invoice.`
  );
}

function formatAmount(amountCents: number): string {
  return '$' + (amountCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildSystemPrompt(step: ChaseStep, companyName: string, toneDescription: string): string {
  const voice = `You are drafting overdue-invoice chase messages for ${companyName}. Brand tone: ${toneDescription}.`;

  switch (step) {
    case 1:
      return `${voice}

This is STEP 1 (Day+1) of a 5-step chase sequence — a friendly email.
Write a short, warm email just checking that the customer received the invoice. No pressure, no urgency.

Return ONLY valid JSON: { channel: "email", message: string, step: 1 }`;
    case 2:
      return `${voice}

This is STEP 2 (Day+3) of a 5-step chase sequence — an SMS reminder.
Write a short SMS, STRICTLY under 160 characters total, that mentions payment is due.

Return ONLY valid JSON: { channel: "sms", message: string, step: 2 }`;
    case 3:
      return `${voice}

This is STEP 3 (Day+7) of a 5-step chase sequence — a firm email.
Write a firmer email stating the invoice is now overdue and asking the customer to arrange payment. Still professional, not aggressive.

Return ONLY valid JSON: { channel: "email", message: string, step: 3 }`;
    case 4:
      return `${voice}

This is STEP 4 (Day+7) of a 5-step chase sequence — a voice call script.
A mandatory legal disclosure will be prepended to your text separately — do NOT write any disclosure, legal language, or debt-collection notice yourself.
Write ONLY the polite spoken request to pay: 1-2 short sentences, referencing the invoice and asking the customer to make payment.

Return ONLY valid JSON: { channel: "voice", message: string, step: 4 }`;
    case 5:
      return `${voice}

This is STEP 5 (Day+14) of a 5-step chase sequence — a final notice email, sent before further action is taken.
Write a serious, final-notice email: state this is the last reminder before the matter is escalated, while remaining professional and not threatening.

Return ONLY valid JSON: { channel: "email", message: string, step: 5 }`;
  }
}

function buildUserMessage(
  companyName: string,
  customerName: string,
  invoiceNumber: string,
  formattedAmount: string,
): string {
  return `Company: ${companyName}\nCustomer: ${customerName}\nInvoice: ${invoiceNumber}\nAmount due: ${formattedAmount}`;
}

// Free/paid models occasionally emit malformed JSON, so retry a few times
// and keep the first response that parses.
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
    `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts (try again or switch ACTIVE_MODEL). Last parse error: ${lastParseError?.message}`,
  );
}

// Shared logic, reused by the test route.
export async function runInvoiceChase(params: {
  client_id: string;
  customer_name: string;
  amount_cents: number;
  invoice_number: string;
  chase_step: ChaseStep;
}): Promise<{ status: number; body: any }> {
  const { client_id, customer_name, amount_cents, invoice_number, chase_step } = params;

  if (![1, 2, 3, 4, 5].includes(chase_step)) {
    return {
      status: 400,
      body: { error: 'chase_step must be an integer from 1 to 5.' },
    };
  }

  // STEP 1 — Load brand context for voice (fall back to a neutral tone).
  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'our company';
  const toneDescription = brand?.tone_description || NEUTRAL_TONE;
  const formattedAmount = formatAmount(amount_cents);

  // STEP 2 — Generate the message for the requested chase step.
  const system = buildSystemPrompt(chase_step, companyName, toneDescription);
  const user = buildUserMessage(companyName, customer_name, invoice_number, formattedAmount);

  const { ai, analysis } = await generateWithRetry(system, user);
  const tokensUsed = ai.inputTokens + ai.outputTokens;

  let message: string = analysis.message;
  const channel: Channel = STEP_CHANNEL[chase_step];

  if (chase_step === 4) {
    const disclosure = buildDisclosure(companyName, invoice_number, formattedAmount);
    // Guarantee the disclosure is exact and first, regardless of what the model wrote.
    message = disclosure + ' ' + (message || '').trim();
  }

  if (chase_step === 2 && message.length > 160) {
    message = message.slice(0, 157) + '...';
  }

  // STEP 3 — Log the run.
  await logAgentRun({
    client_id,
    agent_type: 'invoice_chase',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: `Chase step ${chase_step} (${channel}) generated for invoice ${invoice_number}`,
  });

  return {
    status: 200,
    body: {
      channel,
      message,
      step: chase_step,
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
    const { client_id, customer_name, amount_cents, invoice_number, chase_step } =
      await req.json();

    if (!client_id || !customer_name || amount_cents == null || !invoice_number || !chase_step) {
      return NextResponse.json(
        {
          error:
            'client_id, customer_name, amount_cents, invoice_number, and chase_step are required.',
        },
        { status: 400 },
      );
    }

    const { status, body } = await runInvoiceChase({
      client_id,
      customer_name,
      amount_cents,
      invoice_number,
      chase_step,
    });
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[invoice-chase] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
