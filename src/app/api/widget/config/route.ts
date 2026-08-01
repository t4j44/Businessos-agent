import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../../lib/supabase';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');

  if (!clientId) {
    return NextResponse.json(
      { error: 'client_id is required' },
      { status: 400, headers: CORS },
    );
  }

  try {
    // Fetch in parallel — service role bypasses RLS on both tables
    const [profileRes, clientRes] = await Promise.all([
      supabaseServer
        .from('brand_profiles')
        .select('company_name, brand_color_primary, greeting_text, booking_url')
        .eq('client_id', clientId)
        .maybeSingle(),
      supabaseServer
        .from('clients')
        .select('name, plan_tier')
        .eq('id', clientId)
        .maybeSingle(),
    ]);

    const profile = profileRes.data;
    const client  = clientRes.data;

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404, headers: CORS },
      );
    }

    const payload = {
      company_name:        profile?.company_name        ?? client.name   ?? 'Assistant',
      brand_color_primary: profile?.brand_color_primary ?? '#2563EB',
      greeting_text:       profile?.greeting_text       ?? null,
      booking_url:         (profile as Record<string, unknown>)?.booking_url ?? null,
      plan_tier:           client.plan_tier              ?? 'starter',
    };

    return NextResponse.json(payload, {
      headers: {
        ...CORS,
        // Edge / CDN caches for 60 s; stale-while-revalidate for another 60 s
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500, headers: CORS });
  }
}
