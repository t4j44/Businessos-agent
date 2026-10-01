import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionClient } from '@/lib/session';
import { serverError } from '@/lib/server-error'

// Client identity for the dashboard. This is the endpoint the pages call to
// learn which client they are operating on, so it resolves from the signed-in
// session rather than trusting a query parameter.
//
// The unauthenticated fall-through to the test client is kept deliberately: it
// is what lets the app still be driven locally and by the /test routes before
// anyone has signed in. Once a session exists, the session always wins.
export async function GET(req: Request) {
  try {
    const session = await getSessionClient();

    if (session && !session.clientId) {
      // Signed in with no client row yet — the caller should route to
      // onboarding instead of rendering an empty dashboard.
      return NextResponse.json(
        { error: 'No client for this user', needs_onboarding: true },
        { status: 404 },
      );
    }

    if (!session?.clientId) {
      // No session, no client. The query-param fallback that used to sit here
      // let an anonymous caller read any tenant by id.
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const client_id = session.clientId;

    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, plan_tier, status, url')
      .eq('id', client_id)
      .single();

    if (error) {
      console.error('[dashboard/client] query failed:', error.message);
      return serverError(error, 'dashboard/client');
    }

    // Whether Brand Scout has ever produced a profile for this client. The
    // dashboard uses it to offer an analyse-now banner to anyone who skipped
    // the website step during onboarding.
    const { count } = await supabaseAdmin
      .from('brand_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id);

    return NextResponse.json({
      id: data.id,
      name: data.name || 'Your Business',
      plan_tier: data.plan_tier || 'starter',
      status: data.status,
      url: data.url || null,
      has_brand_profile: (count ?? 0) > 0,
      authenticated: !!session,
    });
  } catch (err: any) {
    console.error('[dashboard/client] GET failed:', err);
    return serverError(err, 'dashboard/client');
  }
}
