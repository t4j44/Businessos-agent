import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { getClientContext, supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { retrieveContext } from '@/lib/voyage';

const NEUTRAL_TONE =
  'professional, courteous, and clear — like a well-run business responding respectfully.';

function buildSystemPrompt(
  companyName: string,
  toneDescription: string,
  voiceContext = '',
): string {
  return `You are the reputation manager for ${companyName}. Brand tone: ${toneDescription}.
${
  voiceContext
    ? `\nReal examples of how this brand writes — match this voice closely:\n"""\n${voiceContext}\n"""\n`
    : ''
}

For POSITIVE reviews (4-5 stars): at least 50 words, reference SPECIFIC details from the review, sound like the owner wrote it personally, warm and genuine, thank them for what they mentioned.

For NEGATIVE reviews (1-3 stars): never defensive, acknowledge the SPECIFIC complaint, take responsibility, offer a path to resolution, 50-80 words, end with a direct contact method.

FORBIDDEN phrases, never use: 'sorry you feel that way', 'as per our policy', 'not reflective of our standards', 'we take these matters seriously'.

Return ONLY valid JSON:
{ response_text: string, word_count: number,
  tone_match_score: number 0-100,
  complaint_theme: string or null (main complaint category if negative) }`;
}

// Free models (gpt-oss-20b) are inconsistent and sometimes emit malformed JSON,
// so retry a few times and keep the first response that parses.
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
    `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts (free gpt-oss-20b is unreliable — try again or switch ACTIVE_MODEL). Last parse error: ${lastParseError?.message}`,
  );
}

// Shared logic, reused by the test route.
export async function runReputation(params: {
  client_id: string;
  review_text: string;
  star_rating: number;
  platform: string;
  reviewer_name?: string;
  /** When set, refresh this review's draft instead of inserting a new row. */
  review_id?: string;
}): Promise<{ status: number; body: any }> {
  const { client_id, review_text, star_rating, platform, reviewer_name, review_id } = params;

  // STEP 1 — Load brand context for voice (fall back to a neutral tone).
  const { brand } = await getClientContext(client_id);
  const companyName = brand?.company_name || 'our company';
  const toneDescription = brand?.tone_description || NEUTRAL_TONE;

  // STEP 2 — Generate the response, grounded in retrieved brand-voice examples.
  const voiceContext = await retrieveContext(
    'brand voice tone and communication style examples',
    client_id,
    'voice',
    3,
  );

  const system = buildSystemPrompt(companyName, toneDescription, voiceContext);
  const user =
    `Platform: ${platform} Rating: ${star_rating} stars ` +
    `Reviewer: ${reviewer_name || 'Anonymous'} Review: ${review_text}`;

  const { ai, analysis } = await generateWithRetry(system, user);
  const tokensUsed = ai.inputTokens + ai.outputTokens;

  // STEP 3 — Save to reviews table. Regenerating an existing review updates
  // that row rather than creating a duplicate.
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
      star_rating,
      review_text,
      reviewer_name,
      response_text: analysis.response_text,
      responded: true,
      complaint_theme: analysis.complaint_theme,
      response_method: 'ai_draft',
    });
  }

  // STEP 4 — Log the run.
  await logAgentRun({
    client_id,
    agent_type: 'reputation',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary:
      `${star_rating}-star ${platform} review responded` +
      (analysis.complaint_theme ? ` (theme: ${analysis.complaint_theme})` : ''),
  });

  return {
    status: 200,
    body: {
      response_text: analysis.response_text,
      word_count: analysis.word_count,
      tone_match_score: analysis.tone_match_score,
      complaint_theme: analysis.complaint_theme,
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
    const { client_id, review_text, star_rating, platform, reviewer_name, review_id } =
      await req.json();

    if (!client_id || !review_text || star_rating == null || !platform) {
      return NextResponse.json(
        {
          error:
            'client_id, review_text, star_rating, and platform are required.',
        },
        { status: 400 },
      );
    }

    const { status, body } = await runReputation({
      client_id,
      review_text,
      star_rating,
      platform,
      reviewer_name,
      review_id,
    });
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[reputation] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
