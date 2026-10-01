import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { retrieveContext, storeRAGChunk } from '@/lib/embeddings';
import { findOrCreateContact, logInteraction, updateContactScore } from '@/lib/contacts';
import { requireCronOrSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError, serverErrorPayload } from '@/lib/server-error'

const NEUTRAL_TONE =
  'professional, courteous, and clear — like a well-run business responding respectfully.';

function buildSystemPrompt(
  companyName: string,
  toneDescription: string,
  voiceContext = '',
  productContext = '',
): string {
  return `You are the reputation manager for ${companyName}. Brand tone: ${toneDescription}.
${
  voiceContext
    ? `\nReal examples of how this brand writes — match this voice closely:\n"""\n${voiceContext}\n"""\n`
    : ''
}
${
  productContext
    ? `\nProducts and services information:\n"""\n${productContext}\n"""\n`
    : ''
}

For rating 4-5: warm, specific, 50-80 words.
For rating 1-3: empathetic, solution-focused, 50-80 words, includes contact method placeholder [CONTACT_METHOD].

Never use: "we apologize", "we're sorry to hear", "valued customer".
Always sound like the brand wrote it.

Return ONLY valid JSON:
{ "response_text": "string", "word_count": 0, "tone_match_score": 0, "complaint_theme": "string or null" }`;
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
      maxTokens: 2000,
    });
    try {
      const analysis = parseJSON(ai.text);
      return { ai, analysis };
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[reputation] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nRAW MODEL OUTPUT >>>\n${ai.text}\n<<< END RAW`,
      );
    }
  }
  throw new Error(
    `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts. Last parse error: ${lastParseError?.message}`,
  );
}

export async function runReputation(params: {
  client_id: string;
  review_text: string;
  rating: number;
  platform?: string;
  reviewer_name?: string;
  reviewer_email?: string;
  reviewer_phone?: string;
  review_id?: string;
}): Promise<{ status: number; body: any }> {
  const {
    client_id, review_text, rating, platform = 'unknown', reviewer_name,
    reviewer_email, reviewer_phone, review_id,
  } = params;

  // ── BEFORE ACTING ────────────────────────────────────────────────────────
  let contactId: string | null = null;
  if (reviewer_email) {
    const contact = await findOrCreateContact({
      client_id,
      email: reviewer_email,
    });
    if (contact) {
      contactId = contact.id;
    }
  }

  const voiceContext = await retrieveContext('brand voice tone and communication style', client_id, 'voice');
  const productContext = await retrieveContext('products and services and common customer questions', client_id, 'brand');

  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'our company';
  const toneDescription = brand?.tone_description || NEUTRAL_TONE;

  // ── CORE ACTION ────────────────────────────────────────────────────────
  const system = buildSystemPrompt(companyName, toneDescription, voiceContext, productContext);
  const user =
    `Platform: ${platform} Rating: ${rating} stars ` +
    `Reviewer: ${reviewer_name || 'Anonymous'} Review: ${review_text}`;

  let ai: any;
  let analysis: any;
  try {
    const result = await generateWithRetry(system, user);
    ai = result.ai;
    analysis = result.analysis;
  } catch (err: any) {
    await logAgentRun({
      client_id,
      agent_type: 'reputation_intelligence',
      status: 'error',
      output_summary: 'Failed to generate review response',
      metadata: { error: err?.message || String(err) },
    });
    return { status: 500, body: { success: false, ...serverErrorPayload(err, 'agents/reputation') } };
  }

  if (review_id) {
    await supabaseAdmin
      .from('reviews')
      .update({
        response_text: analysis.response_text,
        complaint_theme: analysis.complaint_theme,
        response_method: 'ai_draft',
      })
      .eq('id', review_id)
      .eq('client_id', client_id);
  } else {
    await supabaseAdmin.from('reviews').insert({
      client_id,
      platform,
      star_rating: rating,
      review_text,
      reviewer_name,
      response_text: analysis.response_text,
      responded: true,
      complaint_theme: analysis.complaint_theme,
      response_method: 'ai_draft',
    });
  }

  // ── AFTER ACTING ────────────────────────────────────────────────────────
  if (contactId) {
    await logInteraction({
      contact_id: contactId,
      client_id,
      agent_name: 'reputation_intelligence',
      interaction_type: 'review',
      summary: (reviewer_name || 'Anonymous') + ' left ' + rating + ' star review',
      sentiment_score: rating * 20,
      metadata: { rating, review_text, response_drafted: true },
    });

    if (rating <= 3) {
      await updateContactScore({ client_id, contact_id: contactId, score_delta: -15 });
    } else if (rating >= 4) {
      await updateContactScore({ client_id, contact_id: contactId, score_delta: 10 });
    }
  }

  await storeRAGChunk({
    client_id,
    content: 'Review response example: ' + analysis.response_text,
    chunk_type: 'voice',
    source_agent: 'reputation_intelligence',
  });

  await logAgentRun({
    client_id,
    agent_type: 'reputation_intelligence',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: `${rating}-star review responded`,
    metadata: { rating, contact_id: contactId, platform },
  });

  return {
    status: 200,
    body: {
      success: true,
      response: analysis.response_text,
      contact_id: contactId,
      sentiment_score: rating * 20,
      brand_context_used: !!voiceContext,
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
    const review_text = body.review_text;
    const rating = body.rating ?? body.star_rating;
    const platform = body.platform || 'unknown';
    const reviewer_name = body.reviewer_name;
    const review_id = body.review_id;
    const reviewer_email = body.reviewer_email;
    const reviewer_phone = body.reviewer_phone;

    if (!client_id || !review_text || rating == null) {
      return NextResponse.json(
        {
          success: false,
          error: 'client_id, review_text, and rating are required.',
        },
        { status: 400 },
      );
    }

    const { status, body: resultBody } = await runReputation({
      client_id,
      review_text,
      rating,
      platform,
      reviewer_name,
      review_id,
      reviewer_email,
      reviewer_phone,
    });
    return NextResponse.json(resultBody, { status });
  } catch (err: any) {
    console.error('[reputation] POST failed:', err);
    return serverError(err, 'agents/reputation', { success: false });
  }
}
