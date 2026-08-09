import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { readWebsite } from '@/lib/scraper';
import { supabaseAdmin } from '@/lib/supabase';

// Same brand-extraction prompt the Brand Scout agent uses.
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

// Models occasionally emit malformed JSON — retry and keep the first that parses.
async function extractBrand(content: string) {
  const MAX_ATTEMPTS = 3;
  let lastParseError: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ai = await callAI({
      model: MODELS.SONNET,
      system: SYSTEM_PROMPT,
      user: 'Analyze this website content:\n\n' + content,
      maxTokens: 2000,
    });
    try {
      return { ai, brand: parseJSON(ai.text) };
    } catch (e: any) {
      lastParseError = e;
      console.error(
        `[onboarding/analyze] JSON parse failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e?.message}`,
      );
    }
  }
  throw new Error(
    `Could not read that website's details reliably. Please try again. (${lastParseError?.message})`,
  );
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'Please provide your website URL.' },
        { status: 400 },
      );
    }

    // 1 — Create the client row.
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .insert({ name: 'New Business', url, status: 'onboarding' })
      .select('id')
      .single();

    if (clientError) {
      console.error('[onboarding/analyze] client insert failed:', clientError);
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }

    const client_id = client.id;

    // 2 — Read the website, then extract the Brand DNA.
    const content = await readWebsite(url, 6000);
    if (!content) {
      return NextResponse.json(
        { error: 'Could not read that website. Check the URL.' },
        { status: 400 },
      );
    }

    const { brand } = await extractBrand(content);

    // 3 — Upsert the brand profile for this client.
    await supabaseAdmin.from('brand_profiles').delete().eq('client_id', client_id);

    const { error: brandError } = await supabaseAdmin.from('brand_profiles').insert({
      client_id,
      company_name: brand.company_name,
      icp_summary: brand.icp_summary,
      tone_description: brand.tone_description,
      tone_type: brand.tone_type,
      products_json: brand.products_json,
      pain_points_json: brand.pain_points_json,
      competitors_json: brand.competitors_json,
      value_proposition: brand.value_proposition,
      brand_colors: brand.brand_colors,
      greeting_text: brand.greeting_text,
      faq_json: brand.faq_json,
      last_scraped_at: new Date().toISOString(),
    });

    if (brandError) {
      console.error('[onboarding/analyze] brand_profiles insert failed:', brandError);
      return NextResponse.json({ error: brandError.message }, { status: 500 });
    }

    // Replace the 'New Business' placeholder with the real company name.
    if (brand.company_name) {
      await supabaseAdmin
        .from('clients')
        .update({ name: brand.company_name })
        .eq('id', client_id);
    }

    // 4 — Hand the profile back to the chat.
    return NextResponse.json({ client_id, brand_profile: brand });
  } catch (err: any) {
    console.error('[onboarding/analyze] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
