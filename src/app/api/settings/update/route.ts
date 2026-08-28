import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionClient } from '@/lib/session';

// PATCH /api/settings/update
//
// Writes across two tables: identity fields live on `clients`, brand voice
// fields live on `brand_profiles`.
//
// The client id comes from the session only — never the request body. Taking
// it from the body would let any signed-in user rewrite another tenant's
// settings by changing one field.
const CLIENT_FIELDS = ['name', 'url', 'contact_email'] as const;
const BRAND_FIELDS = ['icp_summary', 'tone_description'] as const;

export async function PATCH(req: Request) {
  try {
    const session = await getSessionClient();

    if (!session) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }
    if (!session.clientId) {
      return NextResponse.json(
        { error: 'No client for this user.', needs_onboarding: true },
        { status: 404 },
      );
    }

    const client_id = session.clientId;
    const body = await req.json().catch(() => ({}));

    // Only fields actually present in the payload are written, so a form that
    // submits one field cannot blank the others.
    const clientPatch: Record<string, any> = {};
    for (const field of CLIENT_FIELDS) {
      if (field in body) clientPatch[field] = body[field] ?? null;
    }

    const brandPatch: Record<string, any> = {};
    for (const field of BRAND_FIELDS) {
      if (field in body) brandPatch[field] = body[field] ?? null;
    }

    if (Object.keys(clientPatch).length === 0 && Object.keys(brandPatch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    if (Object.keys(clientPatch).length > 0) {
      const { error } = await supabaseAdmin
        .from('clients')
        .update(clientPatch)
        .eq('id', client_id);

      if (error) {
        console.error('[settings/update] clients update failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (Object.keys(brandPatch).length > 0) {
      // A client that has never been analysed has no brand_profiles row yet,
      // so an update would silently affect zero rows.
      const { data: existing } = await supabaseAdmin
        .from('brand_profiles')
        .select('id')
        .eq('client_id', client_id)
        .maybeSingle();

      const { error } = existing
        ? await supabaseAdmin.from('brand_profiles').update(brandPatch).eq('id', existing.id)
        : await supabaseAdmin.from('brand_profiles').insert({ client_id, ...brandPatch });

      if (error) {
        console.error('[settings/update] brand_profiles write failed:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[settings/update] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
