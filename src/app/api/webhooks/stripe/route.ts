import { NextResponse } from 'next/server';
import { getStripe, PLAN_TIERS } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase';

const SUPPORTED = new Set(['customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.payment_succeeded', 'invoice.payment_failed']);

export async function POST(req: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY)
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  // Bound the actual stream, regardless of a client-supplied Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  let size = 0; const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 512000) { await reader.cancel(); return NextResponse.json({ error: 'Payload too large' }, { status: 413 }); }
    parts.push(value);
  }
  let event;
  try { event = getStripe().webhooks.constructEvent(Buffer.concat(parts), signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error: 'Invalid signature' }, { status: 400 }); }
  if (!SUPPORTED.has(event.type)) return NextResponse.json({ received: true, ignored: true });
  try {
    const object = event.data.object as any;
    const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    if (!customerId) return NextResponse.json({ received: true, ignored: true });
    const { data: account, error } = await supabaseAdmin.from('clients').select('id')
      .eq('stripe_customer_id', customerId).maybeSingle();
    if (error) throw new Error('Account lookup failed');
    if (!account) return NextResponse.json({ received: true, ignored: true });
    // Reconcile against Stripe's current subscriptions: webhook delivery is
    // neither ordered nor exactly once. Never infer entitlement from an invoice.
    const subscriptions = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (subscriptions.has_more) throw new Error('Subscription reconciliation requires pagination');
    const current = subscriptions.data.filter(s => !['canceled','incomplete_expired'].includes(s.status))
      .sort((a,b) => b.created-a.created);
    if (current.filter(s => ['active','trialing'].includes(s.status)).length > 1) throw new Error('Multiple active subscriptions require reconciliation');
    const subscription = current.find(s => ['active','trialing'].includes(s.status)) || current[0];
    let tier: string | null = null;
    if (subscription) {
      const prices = subscription.items.data.map(item => item.price.id);
      tier = Object.entries(PLAN_TIERS).find(([, periods]) => Object.values(periods).some(price => price && prices.includes(price)))?.[0] || null;
      if (!tier) throw new Error('Subscription price is not configured');
    }
    const status = subscription?.status === 'active' ? 'active' : subscription?.status === 'trialing' ? 'trial'
      : subscription && ['past_due','unpaid'].includes(subscription.status) ? 'past_due' : subscription ? 'inactive' : 'cancelled';
    const { data: outcome, error: saveError } = await supabaseAdmin.rpc('apply_billing_event', {
      p_event_id: event.id, p_customer_id: customerId, p_event_created: event.created, p_event_type: event.type,
      p_status: status, p_tier: tier, p_summary: { subscription_id: subscription?.id || null,
        provider_status: subscription?.status || 'none', invoice_id: event.type.startsWith('invoice.') ? object.id : null,
        amount_paid: typeof object.amount_paid === 'number' ? object.amount_paid : null, currency: object.currency || null },
    });
    if (saveError) throw new Error('Billing state could not be saved');
    return NextResponse.json({ received: true, outcome });
  } catch {
    // Non-2xx asks Stripe to retry. Do not acknowledge an uncommitted update.
    return NextResponse.json({ error: 'Billing reconciliation failed; retry required.' }, { status: 503 });
  }
}
