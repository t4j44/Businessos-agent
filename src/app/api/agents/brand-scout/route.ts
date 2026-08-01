import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { readWebsite } from '@/lib/jina';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { createEmbedding } from '@/lib/voyage';

// Splits text into ~maxChars chunks, breaking on sentence boundaries so a
// chunk stays semantically whole. Sentences longer than maxChars are hard-split.
function chunkText(text: string, maxChars = 400): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current && current.length + sentence.length + 1 > maxChars) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();

  return chunks.filter((c) => c.length > 0);
}

const SYSTEM_PROMPT = `You are a brand analyst. Analyze the website content and extract brand intelligence. Return ONLY valid JSON, no markdown fences, no extra text, with exactly these keys:
{
  company_name: string,
  icp_summary: string (who they sell to, 2-3 sentences),
  tone_description: string (their communication style, 1-2 sentences),
  tone_type: 'formal' | 'casual' | 'technical',
  products_json: array of {name: string, description: string},
  pain_points_json: array of strings (problems they solve),
  competitors_json: array of strings (competitors mentioned, else empty array),
  value_proposition: string (main selling point, one sentence),
  brand_colors: string (colors mentioned, or empty string),
  greeting_text: string (a warm greeting their AI receptionist would use),
  faq_json: array of {question: string, answer: string} (3-5 likely FAQs)
}`;

export type BrandScoutResult = {
  brand_profile: any;
  saved_to_db: boolean;
  tokens_used: number;
  cost_usd: number;
  response_time_ms: number;
};

// Shared logic, reused by the test route.
export async function runBrandScout(
  url: string,
  client_id?: string,
): Promise<{ status: number; body: any }> {
  const startedAt = Date.now();

  // STEP 1 — Read the website
  const content = await readWebsite(url, 6000);
  if (!content) {
    return {
      status: 400,
      body: { error: 'Could not read that website. Check the URL.' },
    };
  }

  // STEP 2 — Extract Brand DNA.
  // Free models (gpt-oss-20b) are inconsistent and sometimes emit malformed
  // JSON, so retry a few times and keep the first response that parses.
  const MAX_ATTEMPTS = 3;
  let ai: Awaited<ReturnType<typeof callAI>> | undefined;
  let brandProfile: any;
  let lastParseError: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    ai = await callAI({
      model: MODELS.SONNET,
      system: SYSTEM_PROMPT,
      user: 'Analyze this website content:\n\n' + content,
      maxTokens: 2000,
    });
    try {
      brandProfile = parseJSON(ai.text);
      break;
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[brand-scout] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}\nRAW MODEL OUTPUT >>>\n${ai.text}\n<<< END RAW`,
      );
    }
  }

  if (!brandProfile || !ai) {
    throw new Error(
      `Model returned malformed JSON after ${MAX_ATTEMPTS} attempts (free gpt-oss-20b is unreliable — try again or switch ACTIVE_MODEL). Last parse error: ${lastParseError?.message}`,
    );
  }

  const tokensUsed = ai.inputTokens + ai.outputTokens;

  // STEP 3 — Save to Supabase (only when a client_id was provided)
  let savedToDb = false;
  let chunksCreated = 0;
  if (client_id) {
    await supabaseAdmin
      .from('brand_profiles')
      .delete()
      .eq('client_id', client_id);

    await supabaseAdmin.from('brand_profiles').insert({
      client_id,
      company_name: brandProfile.company_name,
      icp_summary: brandProfile.icp_summary,
      tone_description: brandProfile.tone_description,
      tone_type: brandProfile.tone_type,
      products_json: brandProfile.products_json,
      pain_points_json: brandProfile.pain_points_json,
      competitors_json: brandProfile.competitors_json,
      value_proposition: brandProfile.value_proposition,
      brand_colors: brandProfile.brand_colors,
      greeting_text: brandProfile.greeting_text,
      faq_json: brandProfile.faq_json,
      last_scraped_at: new Date().toISOString(),
    });

    await supabaseAdmin.from('clients').update({ url }).eq('id', client_id);

    savedToDb = true;

    // STEP 3b — Embed the website content so agents can retrieve brand memory
    // by meaning. Replaces this client's previous 'brand' chunks on a re-run.
    await supabaseAdmin
      .from('rag_chunks')
      .delete()
      .eq('client_id', client_id)
      .eq('chunk_type', 'brand');

    const chunks = chunkText(content, 400);
    const embeddings = await Promise.all(chunks.map((c) => createEmbedding(c)));

    const rows = chunks
      .map((chunk, i) => ({ chunk, embedding: embeddings[i] }))
      .filter((r) => r.embedding !== null)
      .map((r) => ({
        client_id,
        content: r.chunk,
        embedding: r.embedding,
        source_url: url,
        chunk_type: 'brand',
        is_active: true,
      }));

    if (rows.length > 0) {
      const { error: chunkError } = await supabaseAdmin.from('rag_chunks').insert(rows);
      if (chunkError) {
        console.error('[brand-scout] rag_chunks insert failed:', chunkError.message);
      }
    }

    chunksCreated = rows.length;
    console.log(
      `[brand-scout] embedded ${chunksCreated} of ${chunks.length} chunks for client ${client_id}`,
    );
  }

  // STEP 4 — Log the run
  await logAgentRun({
    client_id: client_id || '',
    agent_type: 'brand_scout',
    status: 'completed',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: brandProfile.company_name + ' brand profile created',
  });

  return {
    status: 200,
    body: {
      brand_profile: brandProfile,
      saved_to_db: savedToDb,
      chunks_created: chunksCreated,
      tokens_used: tokensUsed,
      cost_usd: ai.cost,
      response_time_ms: Date.now() - startedAt,
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
    const { url, client_id } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'Could not read that website. Check the URL.' },
        { status: 400 },
      );
    }

    const { status, body } = await runBrandScout(url, client_id);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[brand-scout] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err), stack: err?.stack },
      { status: 500 },
    );
  }
}
