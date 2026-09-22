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
      timeout: 15000, maxNetworkRetries: 1,
    });
  }
  return _stripe;
}

// supabaseAdmin is already a lazy Proxy — see src/lib/supabase.ts.
const supabase = supabaseAdmin;

export const PLAN_TIERS = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
    pilot: process.env.STRIPE_PRICE_STARTER_PILOT || ''
  },
  core: {
    monthly: process.env.STRIPE_PRICE_CORE_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_CORE_ANNUAL || '',
    pilot: process.env.STRIPE_PRICE_CORE_PILOT || ''
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL || '',
    pilot: process.env.STRIPE_PRICE_GROWTH_PILOT || ''
  },
  scale: {
    monthly: process.env.STRIPE_PRICE_SCALE_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_SCALE_ANNUAL || '',
    pilot: process.env.STRIPE_PRICE_SCALE_PILOT || ''
  },
  agency: {
    monthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_AGENCY_ANNUAL || '',
    pilot: process.env.STRIPE_PRICE_AGENCY_PILOT || ''
  }
};

export async function getOrCreateStripeCustomer(email: string, client_id: string): Promise<string> {
  const { data: client, error: lookupError } = await supabase
    .from('clients')
    .select('stripe_customer_id')
    .eq('id', client_id)
    .single();

  if (lookupError || !client) throw new Error('Billing record is unavailable.');
  if (client?.stripe_customer_id) {
    return client.stripe_customer_id;
  }

  const customer = await getStripe().customers.create({
    email,
    metadata: {
      client_id,
    },
  }, { idempotencyKey: `businessos-customer-${client_id}` });

  const { error: saveError } = await supabase
    .from('clients')
    .update({ stripe_customer_id: customer.id })
    .eq('id', client_id);

  if (saveError) throw new Error('Billing customer could not be linked.');
  return customer.id;
}

export function billingOrigin(): string {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL || '');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && url.hostname === 'localhost' && url.protocol === 'http:')) throw new Error('Configure a secure application URL.');
  if (url.username || url.password) throw new Error('Invalid application URL.');
  return url.origin;
}
