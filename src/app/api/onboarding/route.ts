import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBrandScout } from '@/app/api/agents/brand-scout/route';
import { requireUser, authErrorResponse } from '@/lib/auth-guard';

// Finalises onboarding: makes sure the client exists, then runs Brand Scout
// in-process to enrich the brand profile.
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
  try {
    await requireUser();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id, name, url, industry, contact_email, contact_phone } = body;

    let resolvedClientId: string | null = client_id || null;
    let websiteUrl: string | null = url || null;

    if (resolvedClientId) {
      // Finishing an onboarding run that /analyze already started.
      const { data: client, error } = await supabaseAdmin
        .from('clients')
        .select('id, url')
        .eq('id', resolvedClientId)
        .maybeSingle();

      if (error || !client) {
        return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
      }
      websiteUrl = websiteUrl || client.url;
    } else {
      // Direct creation path.
      if (!name || !url) {
        return NextResponse.json(
          { error: 'Business name and website URL are required.' },
          { status: 400 },
        );
      }

      const { data, error } = await supabaseAdmin
        .from('clients')
        .insert({ name, url, industry, contact_email, contact_phone })
        .select('id')
        .single();

      if (error) {
        console.error('[onboarding] insert failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      resolvedClientId = data.id;
    }

    // Brand Scout is an enrichment step. A failure here must not undo an
    // account that was created successfully.
    let brandScoutComplete = false;

    if (websiteUrl) {
      try {
        const { status } = await runBrandScout(websiteUrl, resolvedClientId as string);
        brandScoutComplete = status === 200;
        if (!brandScoutComplete) {
          console.warn('[onboarding] brand scout returned', status, 'for', resolvedClientId);
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
