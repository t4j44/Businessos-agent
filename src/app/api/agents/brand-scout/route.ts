import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { readWebsite, normalizeUrl } from '@/lib/scraper';
import { supabaseAdmin } from '@/lib/supabase';
import { logAgentRun } from '@/lib/log';
import { createEmbedding, retrieveContext, storeRAGChunk } from '@/lib/embeddings';

// ACTIVE_MODEL in src/lib/ai.ts is a module constant, not an environment
// variable. Honour an env override here for parity with the spec, falling back
// to MODELS.SONNET (which already resolves to 'anthropic/claude-sonnet-5').
const MODEL = process.env.ACTIVE_MODEL || MODELS.SONNET;

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
  tagline: string (their one-line slogan, or empty string),
  description: string (what the business does, 2-3 sentences),
  icp_summary: string (who they sell to, 2-3 sentences),
  tone_description: string (their communication style, 1-2 sentences),
  tone_type: 'formal' | 'casual' | 'technical',
  products_json: array of {name: string, description: string},
  pain_points_json: array of strings (problems they solve),
  competitors_json: array of strings (competitors mentioned, else empty array),
  value_proposition: string (main selling point, one sentence),
  brand_colors: string (colors mentioned, or empty string),
  greeting_text: string (a warm greeting their AI receptionist would use),
  faq_json: array of {question: string, answer: string} (3-5 likely FAQs),
  contact_info: object with optional keys {email, phone, address} (omit what is absent),
  location: string (city/region they operate from, or empty string)
}`;

const MAX_ATTEMPTS = 3;

export type BrandScoutResult = {
  brand_profile: any;
  saved_to_db: boolean;
  tokens_used: number;
  cost_usd: number;
  response_time_ms: number;
};

// Joins the parts of a RAG chunk, dropping whatever the model left empty so a
// chunk never reads "undefined" or embeds a lone label.
function joinChunk(parts: Array<string | undefined | null>): string {
  return parts.filter((p) => p && String(p).trim()).join('\n\n').trim();
}

function describeProducts(products: any): string {
  if (!Array.isArray(products) || products.length === 0) return '';
  const lines = products
    .map((p: any) => {
      if (p && typeof p === 'object') {
        const name = p.name || '';
        const desc = p.description || '';
        return name && desc ? `${name}: ${desc}` : name || desc;
      }
      return String(p);
    })
    .filter(Boolean);
  return lines.length ? 'Products and services:\n' + lines.join('\n') : '';
}

// Shared logic, reused by the test route.
export async function runBrandScout(
  url: string,
  client_id?: string,
): Promise<{ status: number; body: any }> {
  url = normalizeUrl(url);
  const startedAt = Date.now();

  // ── BEFORE ACTING ────────────────────────────────────────────────────────
  // Existing profile decides update-vs-insert; a re-run always re-scrapes.
  let refreshed = false;
  let existingProfileId: string | null = null;
  let existingContext = '';

  if (client_id) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('brand_profiles')
      .select('id')
      .eq('client_id', client_id)
      .maybeSingle();

    if (existingError) {
      console.error('[brand-scout] existing profile lookup failed:', existingError.message);
    } else if (existing) {
      refreshed = true;
      existingProfileId = existing.id;
      console.log(`[brand-scout] refreshing existing brand profile for client ${client_id}`);
    }

    existingContext = await retrieveContext(
      'brand identity and business description',
      client_id,
    );
  }

  // ── CORE ACTION — scrape (Crawl4AI first, Jina fallback via readWebsite) ──
  const content = await readWebsite(url, 6000);
  if (!content) {
    await logAgentRun({
      client_id: client_id || '',
      agent_type: 'brand_scout',
      status: 'error',
      cost_usd: 0,
      output_summary: 'Could not read website',
      metadata: { input_data: { url }, output_data: null, error: 'Could not read website' },
    });
    return {
      status: 400,
      body: { success: false, error: 'Could not read website' },
    };
  }

  // ── CORE ACTION — extract Brand DNA ──────────────────────────────────────
  // Models sometimes emit malformed JSON, so retry and keep the first parse.
  let ai: Awaited<ReturnType<typeof callAI>> | undefined;
  let brandProfile: any;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      ai = await callAI({
        model: MODEL,
        system: SYSTEM_PROMPT,
        user: 'Analyze this website content:\n\n' + content,
        maxTokens: 2000,
      });
      brandProfile = parseJSON(ai.text);
      break;
    } catch (e: any) {
      lastError = e;
      console.error(
        `[brand-scout] extraction failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}`,
      );
    }
  }

  if (!brandProfile || !ai) {
    // Never throws — the agentic contract is a logged failure, not an exception.
    await logAgentRun({
      client_id: client_id || '',
      agent_type: 'brand_scout',
      status: 'error',
      cost_usd: ai?.cost || 0,
      output_summary: 'Brand DNA extraction failed',
      metadata: {
        input_data: { url },
        output_data: null,
        error: lastError?.message || 'AI call failed',
      },
    });
    return {
      status: 502,
      body: {
        success: false,
        error: 'Could not extract brand profile',
        detail: lastError?.message || 'AI call failed',
      },
    };
  }

  const tokensUsed = ai.inputTokens + ai.outputTokens;

  // ── AFTER ACTING ─────────────────────────────────────────────────────────
  let savedToDb = false;
  let chunksStored = 0;
  let rawChunksCreated = 0;

  if (client_id) {
    const profileRow = {
      client_id,
      company_name: brandProfile.company_name,
      tagline: brandProfile.tagline,
      description: brandProfile.description,
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
      contact_info: brandProfile.contact_info || {},
      location: brandProfile.location,
      last_scraped_at: new Date().toISOString(),
    };

    // Upsert by hand rather than .upsert({ onConflict: 'client_id' }) — that
    // needs a unique constraint, which brand_profiles only gains in migration
    // 007. Updating in place also preserves the row id across refreshes.
    const { error: writeError } = existingProfileId
      ? await supabaseAdmin
          .from('brand_profiles')
          .update(profileRow)
          .eq('id', existingProfileId)
      : await supabaseAdmin.from('brand_profiles').insert(profileRow);

    if (writeError) {
      console.error('[brand-scout] brand_profiles write failed:', writeError.message);
    } else {
      savedToDb = true;
    }

    await supabaseAdmin.from('clients').update({ url }).eq('id', client_id);

    // Replace every chunk type this route writes, so a re-run refreshes brand
    // memory instead of stacking a second copy on top.
    await supabaseAdmin
      .from('rag_chunks')
      .delete()
      .eq('client_id', client_id)
      .in('chunk_type', ['brand', 'icp', 'voice']);

    // Raw page text, chunked on sentence boundaries. Retained from the previous
    // implementation — it captures what the site actually says.
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
      } else {
        rawChunksCreated = rows.length;
      }
    }

    // The three structured Brand DNA chunks. These capture what the model
    // concluded, phrased so a similarity search on "who do we sell to" or
    // "how do we sound" lands on them.
    const structured: Array<{ content: string; chunk_type: string }> = [
      {
        content: joinChunk([brandProfile.description, describeProducts(brandProfile.products_json)]),
        chunk_type: 'brand',
      },
      {
        content: joinChunk([
          brandProfile.icp_summary && 'Our ideal customer: ' + brandProfile.icp_summary,
          brandProfile.value_proposition && 'Our value proposition: ' + brandProfile.value_proposition,
        ]),
        chunk_type: 'icp',
      },
      {
        content: joinChunk([
          brandProfile.tone_description && 'Our communication tone: ' + brandProfile.tone_description,
          brandProfile.tagline && 'Our tagline: ' + brandProfile.tagline,
        ]),
        chunk_type: 'voice',
      },
    ];

    for (const chunk of structured) {
      if (!chunk.content) continue;
      await storeRAGChunk({
        client_id,
        content: chunk.content,
        chunk_type: chunk.chunk_type,
        source_agent: 'brand_scout',
        metadata: { source_url: url, refreshed },
      });
      chunksStored++;
    }

    console.log(
      `[brand-scout] stored ${chunksStored} structured chunks and ${rawChunksCreated} page chunks for client ${client_id}`,
    );
  }

  await logAgentRun({
    client_id: client_id || '',
    agent_type: 'brand_scout',
    status: 'success',
    input_tokens: ai.inputTokens,
    output_tokens: ai.outputTokens,
    cost_usd: ai.cost,
    output_summary: (brandProfile.company_name || 'Brand') + ' profile ' + (refreshed ? 'refreshed' : 'created'),
    metadata: {
      input_data: { url },
      output_data: brandProfile,
      refreshed,
      chunks_stored: chunksStored,
    },
  });

  return {
    status: 200,
    body: {
      success: true,
      brand_profile: brandProfile,
      chunks_stored: chunksStored,
      refreshed,
      existing_context: existingContext,
      // Retained for existing callers (agent-lab reads saved_to_db).
      saved_to_db: savedToDb,
      chunks_created: chunksStored + rawChunksCreated,
      tokens_used: tokensUsed,
      cost_usd: ai.cost,
      response_time_ms: Date.now() - startedAt,
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
    let { url, client_id } = await req.json();
    if (url) {
      url = normalizeUrl(url);
    }

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'Could not read website' },
        { status: 400 },
      );
    }

    const { status, body } = await runBrandScout(url, client_id);
    return NextResponse.json(body, { status });
  } catch (err: any) {
    console.error('[brand-scout] POST failed:', err);
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
