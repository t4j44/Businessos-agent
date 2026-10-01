import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionClient } from '@/lib/session';
import { serverError } from '@/lib/server-error'

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
        return serverError(error, 'settings/update');
      }
    }

    if (Object.keys(brandPatch).length > 0) {
      for (const [field, value] of Object.entries(brandPatch)) {
        if (typeof value !== 'string') return NextResponse.json({ error: 'Brand corrections must be text.' }, { status: 400 });
        const { data, error } = await supabaseAdmin.rpc('edit_brand_field', { p_client_id: client_id, p_field: field, p_value: value });
        if (error) return NextResponse.json({ error: 'Brand correction could not be saved.' }, { status: 503 });
        if (!data) return NextResponse.json({ error: 'Create your brand profile first.' }, { status: 404 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[settings/update] PATCH failed:', err);
    return serverError(err, 'settings/update');
  }
}
