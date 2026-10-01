import { NextResponse } from 'next/server';
import { callAI, MODELS, parseJSON } from '@/lib/ai';
import { readWebsite, normalizeUrl } from '@/lib/scraper';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser, authErrorResponse } from '@/lib/auth-guard';
import { ensureClientForUser, ClientWriteError } from '@/lib/onboarding-client';
import { serverErrorMessage } from '@/lib/server-error';

// Reads the caller's website and writes the first brand profile.
//
// TWO THINGS CHANGED HERE, BOTH OF THEM BUGS THAT COST DATA:
//
// 1. CLIENT IDENTITY. This route used to INSERT a fresh `clients` row on every
//    run with no user_id. getClientId() resolves the dashboard's client by
//    user_id, so onboarding filled in a row nobody could ever read, and
//    /dashboard/my-business went on reporting "No website on file". It now
//    operates on the caller's own client row (see src/lib/onboarding-client.ts).
//
// 2. ERROR VISIBILITY. Failures are surfaced to the caller instead of being
//    swallowed. The response is a stream, so a failure arrives as a final
//    `{ error }` line rather than a non-200 — the client treats that line as
//    fatal. Auth and payload failures still return real status codes, because
//    they happen before the stream opens.
//
// The response is newline-delimited JSON so the 20-30s wait can show what the
// server is actually doing. Each line is one of:
//    { stage: string }                              progress, in real time
//    { done: true, client_id, brand_profile }        success, always last
//    { error: string }                               failure, always last

export const runtime = 'nodejs';
export const maxDuration = 60;

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
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const raw = typeof body?.url === 'string' ? body.url.trim() : '';

  if (!raw) {
    return NextResponse.json({ error: 'Please provide your website URL.' }, { status: 400 });
  }

  // THE single place a website URL enters the system. Nobody types
  // "https://" — they type "zqtion.com" — and every downstream consumer
  // (readWebsite, clients.url, brand-scout's re-scrape) needs a scheme.
  // normalizeUrl also trims the trailing slash, so the same site does not
  // produce two different stored values.
  const url = normalizeUrl(raw);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every stage line below is emitted at the point the work actually
      // happens. Nothing here is on a timer.
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
      };

      const fail = (message: string) => {
        send({ error: message });
        controller.close();
      };

      try {
        // 1 — the caller's own client row.
        send({ stage: 'Setting up your workspace…' });

        let client_id: string;
        try {
          ({ clientId: client_id } = await ensureClientForUser(userId, { url }));
        } catch (e) {
          const code = e instanceof ClientWriteError ? e.code : null;
          console.error('[onboarding/analyze] could not resolve client', code ?? '');
          return fail(
            e instanceof Error ? e.message : 'Could not create your account record.',
          );
        }

        // 2 — read the site. readWebsite fetches the single page it is given
        // (Crawl4AI when configured, Jina Reader otherwise); it does not crawl,
        // so the message says homepage rather than a page count.
        send({ stage: 'Fetching your homepage…' });
        const content = await readWebsite(url, 6000);

        if (!content) {
          return fail('Could not read that website. Check the URL.');
        }

        send({
          stage: `Read ${content.length.toLocaleString()} characters — working out what you do…`,
        });

        // 3 — extract the Brand DNA.
        const { brand } = await extractBrand(content);

        const productCount = Array.isArray(brand?.products_json)
          ? brand.products_json.length
          : 0;
        send({
          stage: productCount
            ? `Found ${productCount} service${productCount === 1 ? '' : 's'} — now capturing your tone of voice…`
            : 'Capturing your tone of voice…',
        });

        // 4 — persist. brand_profiles has a unique index on client_id
        // (migration 007), so the delete-then-insert keeps a re-run from
        // colliding with the row it wrote last time.
        send({ stage: 'Saving to your brand memory…' });

        const { error: clearError } = await supabaseAdmin
          .from('brand_profiles')
          .delete()
          .eq('client_id', client_id);

        if (clearError) {
          console.error(
            `[onboarding/analyze] brand_profiles clear failed (${clearError.code}):`,
            clearError.message,
          );
          return fail(clearError.message);
        }

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
          console.error(
            `[onboarding/analyze] brand_profiles insert failed (${brandError.code}):`,
            brandError.message,
          );
          return fail(brandError.message);
        }

        // Replace the 'New Business' placeholder with the real company name.
        if (brand.company_name) {
          const { error: nameError } = await supabaseAdmin
            .from('clients')
            .update({ name: brand.company_name })
            .eq('id', client_id);

          // Not fatal — the profile is already saved and the dashboard reads
          // the name from brand_profiles too.
          if (nameError) {
            console.error(
              `[onboarding/analyze] client name update failed (${nameError.code}):`,
              nameError.message,
            );
          }
        }

        send({ done: true, client_id, brand_profile: brand });
        controller.close();
      } catch (err: any) {
        console.error('[onboarding/analyze] POST failed:', err);
        // A streamed error event, not a 500, but it must not carry a raw
        // database or provider message to the browser either.
        fail(serverErrorMessage(err, 'onboarding/analyze'));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // Stops any intermediary from buffering the whole stream and defeating
      // the point of sending stages at all.
      'X-Accel-Buffering': 'no',
    },
  });
}
