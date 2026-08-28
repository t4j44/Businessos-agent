import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';

export async function POST(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = await createRouteClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!client || !client.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing record found' }, { status: 404 });
    }

    // Mock bypass for dev without keys
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ url: '/dashboard/billing?portal=mock' });
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: client.stripe_customer_id,
      return_url: `${req.headers.get('origin')}/dashboard/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
