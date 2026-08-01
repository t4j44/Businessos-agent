import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2026-04-22.dahlia',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export const PLAN_TIERS = {
  starter: {
    monthly: 'price_starter_mo',
    annual: 'price_starter_yr',
    pilot: 'price_starter_pilot'
  },
  core: {
    monthly: 'price_core_mo',
    annual: 'price_core_yr',
    pilot: 'price_core_pilot'
  },
  growth: {
    monthly: 'price_growth_mo',
    annual: 'price_growth_yr',
    pilot: 'price_growth_pilot'
  },
  scale: {
    monthly: 'price_scale_mo',
    annual: 'price_scale_yr',
    pilot: 'price_scale_pilot'
  },
  agency: {
    monthly: 'price_agency_mo',
    annual: 'price_agency_yr',
    pilot: 'price_agency_pilot'
  }
};

export async function getOrCreateStripeCustomer(email: string, client_id: string): Promise<string> {
  const { data: client } = await supabase
    .from('clients')
    .select('stripe_customer_id')
    .eq('id', client_id)
    .single();

  if (client?.stripe_customer_id) {
    return client.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email,
    metadata: {
      client_id,
    },
  });

  await supabase
    .from('clients')
    .update({ stripe_customer_id: customer.id })
    .eq('id', client_id);

  return customer.id;
}
