import Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase';

// Built on first use, never at import time.
//
// `new Stripe('')` throws "Neither apiKey nor config.authenticator provided",
// and module scope runs during `next build` — where STRIPE_SECRET_KEY is not
// present — so constructing here failed the Vercel build for every route that
// transitively imported this file.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY missing');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-04-22.dahlia',
    });
  }
  return _stripe;
}

// supabaseAdmin is already a lazy Proxy — see src/lib/supabase.ts.
const supabase = supabaseAdmin;

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

  const customer = await getStripe().customers.create({
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
