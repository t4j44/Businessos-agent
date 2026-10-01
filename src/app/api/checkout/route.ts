import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';
import { getStripe, getOrCreateStripeCustomer, PLAN_TIERS, billingOrigin } from '@/lib/stripe';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

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
      .select('id, user_id')
      .eq('user_id', user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const body = await req.json();
    const { plan_tier, billing_period, pilot } = body;

    const tierObj = PLAN_TIERS[plan_tier as keyof typeof PLAN_TIERS];
    if (!tierObj) {
      return NextResponse.json({ error: 'Invalid plan tier' }, { status: 400 });
    }

    if (typeof pilot !== 'boolean' && pilot !== undefined) return NextResponse.json({ error: 'Invalid pilot option.' }, { status: 400 });
    if (billing_period !== undefined && !['monthly', 'annual'].includes(billing_period)) return NextResponse.json({ error: 'Invalid billing period.' }, { status: 400 });
    const priceId = pilot ? tierObj.pilot : (billing_period === 'annual' ? tierObj.annual : tierObj.monthly);

    if (!process.env.STRIPE_SECRET_KEY || !priceId || !process.env.STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'This plan is not configured for checkout yet.' }, { status: 503 });
    }
    const customerId = await getOrCreateStripeCustomer(user.email!, client.id);
    const origin = billingOrigin();
    const checkoutSession = await getStripe().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${origin}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
      subscription_data: { metadata: { client_id: client.id, plan_tier } },
      metadata: {
        client_id: client.id,
        plan_tier,
      }
    });

    return NextResponse.json({ checkout_url: checkoutSession.url });
  } catch (err: any) {
    return serverError(err, 'checkout');
  }
}
