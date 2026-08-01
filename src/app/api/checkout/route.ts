import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';
import { stripe, getOrCreateStripeCustomer, PLAN_TIERS } from '@/lib/stripe';

export async function POST(req: Request) {
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

    const priceId = pilot ? tierObj.pilot : (billing_period === 'annual' ? tierObj.annual : tierObj.monthly);

    // Provide mock implementations when running locally with missing Env checks gracefully
    let customerId = 'mock_customer';
    if (process.env.STRIPE_SECRET_KEY) {
      customerId = await getOrCreateStripeCustomer(user.email!, client.id);
    }

    // Creating Checkout Session
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ checkout_url: '/dashboard/billing?mock=success' });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.get('origin')}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}/pricing`,
      metadata: {
        client_id: client.id,
        plan_tier,
      }
    });

    return NextResponse.json({ checkout_url: checkoutSession.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
