import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { retrieveContext } from '@/lib/embeddings';
import { logAgentRun } from '@/lib/log';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type Classification = 'qualified_prospect' | 'support' | 'browser';

const CLASSIFICATIONS: Classification[] = ['qualified_prospect', 'support', 'browser'];

// Appointment businesses (dental, salon) phrase intent as booking and treatment
// language, not SaaS trial language, so both vocabularies are represented.
const BUY_SIGNALS = [
  'price', 'pricing', 'cost', 'how much', 'quote', 'plan', 'package',
  'book', 'booking', 'appointment', 'schedule', 'availability', 'available',
  'opening', 'slot', 'consultation', 'consult', 'sign up', 'get started',
  'trial', 'demo', 'purchase', 'buy', 'new patient', 'new client',
  'insurance', 'financing', 'payment plan', 'walk in', 'walk-in',
];

const SUPPORT_SIGNALS = [
  'problem', 'issue', 'error', 'broken', 'not working', 'bug', 'support',
  'complaint', 'refund', 'cancel', 'reschedule', 'late', 'wrong',
  'hurt', 'pain', 'sore', 'reaction', 'unhappy', 'disappointed',
];

// Deterministic fallback. Only ever sees the visitor's own words — the earlier
// version fed the assistant's reply in too, and since the assistant is told to
// invite bookings, almost every conversation scored as a qualified prospect.
function classifyByKeyword(visitorMessage: string): Classification {
  const lower = visitorMessage.toLowerCase();
  const hasSupport = SUPPORT_SIGNALS.some((s) => lower.includes(s));
  const hasBuy = BUY_SIGNALS.some((s) => lower.includes(s));

  if (hasSupport) return 'support';
  if (hasBuy) return 'qualified_prospect';
  return 'browser';
}

async function checkBudget(clientId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('api_usage')
    .select('tokens_used, token_limit')
    .eq('client_id', clientId)
    .maybeSingle();

  if (!data) return true; // no record = no limit enforced yet
  return data.tokens_used < data.token_limit;
}

// Turns whatever the brand profile holds into the system prompt's business
// briefing. Only the fields that are actually populated make it in, so a
// half-filled profile does not produce a prompt full of "unknown".
function buildBrandBriefing(brand: any, client: any): string {
  const lines: string[] = [];

  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (text) lines.push(`${label}: ${text}`);
  };

  push('Business', brand?.company_name || client?.name);
  push('Tagline', brand?.tagline);
  push('About', brand?.description);
  push('What they offer', brand?.value_proposition);
  push('Who they serve', brand?.icp_summary);
  push('Location', brand?.location);
  push('Industry', client?.industry);

  const products = Array.isArray(brand?.products_json) ? brand.products_json : [];
  if (products.length) {
    const listed = products
      .map((p: any) => (p?.name ? `- ${p.name}${p.description ? `: ${p.description}` : ''}` : null))
      .filter(Boolean)
      .join('\n');
    if (listed) lines.push(`Services offered:\n${listed}`);
  }

  return lines.join('\n');
}

// Phone can live in either place depending on whether the profile came from
// onboarding (clients.contact_phone) or brand-scout (contact_info JSONB).
function resolvePhone(brand: any, client: any): string | null {
  const info = brand?.contact_info;
  const fromBrand =
    info && typeof info === 'object' ? info.phone || info.telephone || info.tel : null;
  const phone = fromBrand || client?.contact_phone;
  const text = phone ? String(phone).trim() : '';
  return text || null;
}

function buildSystemPrompt(
  companyName: string,
  briefing: string,
  tone: string,
  ragContext: string,
): string {
  return [
    `You are the AI receptionist for ${companyName}. You answer visitors on the business's website.`,
    '',
    'BUSINESS DETAILS — this is the only business you represent:',
    briefing || `${companyName} (no further detail on file).`,
    '',
    `VOICE: ${tone}`,
    '',
    ragContext
      ? `REFERENCE MATERIAL from ${companyName}'s own content — prefer this over anything you assume:\n"""\n${ragContext}\n"""\n`
      : '',
    'RULES:',
    '- Keep replies to 3 sentences or fewer. You are a chat widget, not a brochure.',
    '- Never invent prices, availability, opening hours, or clinical/treatment advice. If it is not in the details above, say you will have the team confirm.',
    '- Never diagnose a medical or dental problem. Point those visitors to booking a proper appointment.',
    '- Only discuss this business. Decline unrelated topics politely.',
    '- If the visitor shows interest in an appointment, invite them to book warmly and without pressure.',
    '',
    'Classify the visitor from THEIR message only, ignoring your own reply:',
    '- "qualified_prospect": asking about booking, availability, prices, services, or becoming a new patient/client.',
    '- "support": an existing customer with a problem, complaint, or a change to an existing appointment.',
    '- "browser": general curiosity, research, or small talk.',
    '',
    'Return ONLY valid JSON: { "reply": "string", "classification": "qualified_prospect" | "support" | "browser" }',
  ]
    .filter(Boolean)
    .join('\n');
}

// callAI takes a single system + user pair, so prior turns are folded into the
// user block rather than sent as a native message array.
function buildUserBlock(history: Message[], message: string): string {
  const transcript = history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'Visitor' : 'Receptionist'}: ${m.content}`)
    .join('\n');

  return [
    transcript ? `Conversation so far:\n${transcript}\n` : '',
    `The visitor just said: "${message}"`,
  ]
    .filter(Boolean)
    .join('\n');
}


// ── Rate limiting ──────────────────────────────────────────────────────────
// These endpoints are anonymous by design (they run on customers' own sites),
// so throttling replaces authentication as the spend control.
//
// NOTE: this Map lives in the serverless instance's memory. It resets on every
// cold start and is not shared between concurrent instances, so the real ceiling
// is higher than the numbers below. A durable store (Upstash/Redis) is the
// eventual fix; this stops the trivial abuse case today.
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_SESSION = 20;
const MAX_PER_CLIENT = 200;
const MAX_MESSAGE_CHARS = 2000;

const hits = new Map<string, number[]>();

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const window = (hits.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (window.length >= limit) {
    hits.set(key, window);
    return true;
  }
  window.push(now);
  hits.set(key, window);
  return false;
}

export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY missing from .env.local' },
      { status: 503, headers: CORS },
    );
  }

  try {
    const body = await req.json();
    const { client_id, session_id, message, conversation_history = [] } = body as {
      client_id: string;
      session_id: string;
      message: string;
      conversation_history: Message[];
    };

    // Cap the inbound message before it reaches the model.
    if (typeof message === 'string' && message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: 'Message too long.' },
        { status: 400, headers: CORS },
      );
    }

    if (!client_id || !session_id || !message) {
      return NextResponse.json(
        { error: 'client_id, session_id, and message are required' },
        { status: 400, headers: CORS },
      );
    }

    // Per-session then per-client, cheapest check first.
    if (rateLimited('s:' + session_id, MAX_PER_SESSION)) {
      return NextResponse.json(
        { error: 'Too many messages. Try again later.' },
        { status: 429, headers: { ...CORS, 'Retry-After': '3600' } },
      );
    }
    if (rateLimited('c:' + client_id, MAX_PER_CLIENT)) {
      return NextResponse.json(
        { error: 'This assistant is temporarily unavailable.' },
        { status: 429, headers: { ...CORS, 'Retry-After': '3600' } },
      );
    }

    // Never spend tokens for a client that does not exist or is not active.
    const { data: widgetClient } = await supabaseServer
      .from('clients')
      .select('id, status')
      .eq('id', client_id)
      .maybeSingle();

    if (!widgetClient || widgetClient.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Unknown client.' },
        { status: 404, headers: CORS },
      );
    }

    // 1 — Brand DNA and client record.
    const [profileRes, clientRes] = await Promise.all([
      supabaseServer
        .from('brand_profiles')
        .select(
          'company_name, tone_description, icp_summary, products_json, value_proposition, tagline, description, contact_info, location, greeting_text, booking_url',
        )
        .eq('client_id', client_id)
        .maybeSingle(),
      supabaseServer
        .from('clients')
        .select('name, plan_tier, industry, contact_phone')
        .eq('id', client_id)
        .maybeSingle(),
    ]);

    if (!clientRes.data) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: CORS });
    }

    const brand = profileRes.data;
    const client = clientRes.data;
    const companyName = brand?.company_name || client.name || 'us';
    const tone =
      brand?.tone_description ||
      'warm, professional, and welcoming — like a friendly front-desk receptionist.';

    // 2 — Budget.
    if (!(await checkBudget(client_id))) {
      return NextResponse.json(
        {
          response: `I'm sorry, I can't take more questions right now. Please contact ${companyName} directly.`,
          classification: 'browser',
          session_id,
        },
        { headers: CORS },
      );
    }

    // 3 — RAG. Best-effort: a client with no indexed content still gets a reply
    //     built from the brand profile alone.
    const ragContext = await retrieveContext(message, client_id);

    // 4 — Generate. The model returns reply + classification together so the
    //     label reflects intent rather than keyword presence.
    const systemPrompt = buildSystemPrompt(companyName, buildBrandBriefing(brand, client), tone, ragContext);
    const userBlock = buildUserBlock(conversation_history, message);

    const ai = await callAI({
      model: MODELS.SONNET,
      system: systemPrompt,
      user: userBlock,
      maxTokens: 500,
    });

    let responseText: string;
    let classification: Classification;

    try {
      const parsed = parseJSON(ai.text);
      responseText = String(parsed.reply || '').trim();
      classification = CLASSIFICATIONS.includes(parsed.classification)
        ? parsed.classification
        : classifyByKeyword(message);
      if (!responseText) throw new Error('empty reply field');
    } catch {
      // Malformed JSON must not cost the visitor their answer — use the raw
      // text and fall back to keyword classification.
      responseText = ai.text.trim();
      classification = classifyByKeyword(message);
    }

    // 5 — Booking card for qualified prospects. Offered as soon as intent is
    //     clear: an appointment business loses the visitor if it waits.
    const phone = resolvePhone(brand, client);
    const bookingUrl = brand?.booking_url || null;

    const payload: Record<string, unknown> = {
      response: responseText,
      classification,
      session_id,
    };

    if (classification === 'qualified_prospect' && (phone || bookingUrl)) {
      payload.booking_card = {
        headline: `Ready to book with ${companyName}?`,
        cta_label: 'Book an appointment',
        booking_url: bookingUrl,
        phone,
      };
    }

    // 6 — Session tracking + run log. Neither should be able to fail the reply
    //     that has already been generated.
    const sessionPromise = supabaseServer
      .rpc('upsert_widget_session', {
        p_client_id: client_id,
        p_session_token: session_id,
        p_classification: classification,
      })
      .then(({ error }: { error: unknown }) => {
        if (error) console.error('[widget/chat] upsert_widget_session failed:', error);
      });

    const logPromise = logAgentRun({
      client_id,
      agent_type: 'receptionist',
      status: 'completed',
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.cost,
      output_summary: `Receptionist replied to a ${classification} visitor`,
      metadata: {
        session_id,
        classification,
        visitor_message: message,
        reply: responseText,
        rag_used: Boolean(ragContext),
        booking_card_shown: Boolean(payload.booking_card),
      },
    });

    // Awaited rather than fire-and-forget: serverless can freeze the function
    // the moment the response is returned, dropping both writes.
    await Promise.allSettled([sessionPromise, logPromise]);

    return NextResponse.json(payload, { headers: CORS });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('[widget/chat] POST failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS });
  }
}
