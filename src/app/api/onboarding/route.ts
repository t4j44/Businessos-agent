import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBrandScout } from '@/app/api/agents/brand-scout/route';
import { requireUser, authErrorResponse } from '@/lib/auth-guard';
import { ensureClientForUser, ClientWriteError } from '@/lib/onboarding-client';

// Finalises onboarding: makes sure the caller's client row exists, then runs
// Brand Scout in-process to enrich the brand profile.
//
// CLIENT ID COMES FROM THE SESSION, NOT THE BODY. It used to be taken from
// `body.client_id` and looked up with no ownership check, so any signed-in user
// could point this at another tenant's client id and have Brand Scout overwrite
// their brand profile and RAG chunks. The body value is now only compared
// against the session's and logged when it disagrees.
//
// WHY BRAND SCOUT ON TOP OF /api/onboarding/analyze: analyze already reads the
// site and writes brand_profiles, so the profile is not empty by this point.
// Brand Scout adds the two things analyze does not produce — the visual brand
// (colours, fonts, imagery, used by the chat widget) and the RAG chunks that
// make every other agent answer in this client's own words. It writes a
// superset of analyze's columns and updates the row in place, so running it
// second enriches rather than clobbers.
//
// Called in-process, never over HTTP: a self-fetch would burn a second
// serverless invocation with its own timeout and depend on NEXT_PUBLIC_APP_URL
// being correct in every environment.
export async function POST(req: Request) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id: bodyClientId, name, url, industry, contact_email, contact_phone } = body;

    let resolvedClientId: string;
    try {
      ({ clientId: resolvedClientId } = await ensureClientForUser(userId, {
        name,
        url,
        industry,
        contact_email,
        contact_phone,
      }));
    } catch (err) {
      const code = err instanceof ClientWriteError ? err.code : null;
      console.error('[onboarding] could not resolve client', code ?? '');
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not save your business details.' },
        { status: 500 },
      );
    }

    if (bodyClientId && bodyClientId !== resolvedClientId) {
      // Not an error for the caller — the browser is simply echoing back the id
      // /analyze handed it, and that id is now always the session's own. Worth
      // a line in the log if it ever diverges.
      console.warn('[onboarding] ignoring client_id from body; it is not the session client');
    }

    // The website URL: whatever onboarding just supplied, else whatever is
    // already on the record from the /analyze step.
    let websiteUrl: string | null = url || null;
    if (!websiteUrl) {
      const { data: client, error } = await supabaseAdmin
        .from('clients')
        .select('url')
        .eq('id', resolvedClientId)
        .maybeSingle();

      if (error) {
        console.error(`[onboarding] client read failed (${error.code}):`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      websiteUrl = client?.url ?? null;
    }

    // Brand Scout is an enrichment step. A failure here must not undo an
    // account that was created successfully.
    let brandScoutComplete = false;

    if (websiteUrl) {
      try {
        const { status, body: scoutBody } = await runBrandScout(websiteUrl, resolvedClientId);

        // status 200 alone is not enough. runBrandScout logs a failed
        // brand_profiles write and carries on returning 200 — which is how a
        // success screen ended up sitting on top of a save that never
        // happened. saved_to_db is the fact that matters.
        // A profile row with no retrievable chunks is not a finished Brand
        // Scout run: every agent would then answer without this client's own
        // words, and the dashboard would read "Brand Memory: 0 pieces".
        brandScoutComplete =
          status === 200 &&
          scoutBody?.saved_to_db === true &&
          Number(scoutBody?.chunks_saved ?? 0) > 0;

        if (!brandScoutComplete) {
          console.warn(
            '[onboarding] brand scout incomplete for', resolvedClientId,
            '- status', status,
            'saved_to_db', scoutBody?.saved_to_db,
            'chunks_saved', scoutBody?.chunks_saved,
            'warning', scoutBody?.warning ?? null,
          );
        }
      } catch (err) {
        console.error('[onboarding] brand scout failed (not fatal):', err);
      }
    } else {
      console.warn('[onboarding] no website URL — skipping brand scout for', resolvedClientId);
    }

    return NextResponse.json({
      success: true,
      client_id: resolvedClientId,
      brand_scout_complete: brandScoutComplete,
      redirect: '/dashboard',
    });
  } catch (err: any) {
    console.error('[onboarding] POST failed:', err);
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
