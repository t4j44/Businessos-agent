import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireSession, authErrorResponse } from '@/lib/auth-guard'
import { serverError } from '@/lib/server-error'

// Defaults applied when a client has never saved preferences.
const NOTIFICATION_DEFAULTS: Record<string, boolean> = {
  hotLead: true,
  demoBooked: true,
  reviewAlert: true,
  weeklyBrief: true,
  agentFailure: true,
  approvalNeeded: true,
};

// `wired` is whether any code actually calls the provider. A key on its own
// does nothing, and this list used to show a green "Verified connection" for
// four services no line of code has ever contacted — an owner reasonably read
// that as "my CRM is syncing". Key presence is reported separately, and an
// unwired integration can never claim a connection however many keys are set.
const INTEGRATIONS = [
  { name: 'Stripe',    desc: 'Billing and subscription management',    env: 'STRIPE_SECRET_KEY',   wired: true  },
  { name: 'Resend',    desc: 'Transactional and outbound email',       env: 'RESEND_API_KEY',      wired: true  },
  { name: 'Bland',     desc: 'Voice calls for the AI receptionist',    env: 'BLAND_API_KEY',       wired: true  },
  { name: 'Twilio',    desc: 'SMS — inbound receipts only, sending is disabled', env: 'TWILIO_ACCOUNT_SID', wired: true },
  { name: 'HubSpot CRM', desc: 'CRM sync — not built yet',            env: 'HUBSPOT_API_KEY',     wired: false },
  { name: 'Instantly', desc: 'Outbound sending for Hunter — not built yet', env: 'INSTANTLY_API_KEY', wired: false },
  { name: 'Nylas',     desc: 'Calendar sync — not built yet',          env: 'NYLAS_API_KEY',       wired: false },
  { name: 'Buffer',    desc: 'Social publishing — not built yet',      env: 'BUFFER_ACCESS_TOKEN', wired: false },
];

export async function GET(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const client_id = clientId;

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, url, contact_name, contact_email, timezone, settings_json, plan_tier')
      .eq('id', client_id)
      .maybeSingle();

    if (error) {
      console.error('[dashboard/settings] query failed:', error.message);
      return serverError(error, 'dashboard/settings');
    }

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Brand voice lives on brand_profiles, not clients, so the settings screen
    // has to read both.
    const { data: brand } = await supabaseAdmin
      .from('brand_profiles')
      .select('icp_summary, tone_description')
      .eq('client_id', client_id)
      .maybeSingle();

    return NextResponse.json({
      client_id,
      // Sent to the browser so Settings can build a pre-filled mailto link.
      // SUPPORT_EMAIL stays a server variable rather than becoming
      // NEXT_PUBLIC_: it is only needed by a signed-in owner, so it does not
      // belong in the public bundle where a scraper would read it.
      support_email: process.env.SUPPORT_EMAIL?.trim() || null,
      plan_tier: client.plan_tier || 'starter',
      brand: {
        icp_summary: brand?.icp_summary || '',
        tone_description: brand?.tone_description || '',
        has_profile: !!brand,
      },
      profile: {
        name: client.contact_name || '',
        email: client.contact_email || '',
        company: client.name || '',
        website: client.url || '',
        timezone: client.timezone || 'UTC',
      },
      notifications: {
        ...NOTIFICATION_DEFAULTS,
        ...(client.settings_json?.notifications || {}),
      },
      integrations: INTEGRATIONS.map((i) => ({
        name: i.name,
        desc: i.desc,
        connected: false,
        // An unwired provider reports no key, because having one changes
        // nothing — "configured" would invite someone to go looking for the
        // verification step that would make it work.
        configured: i.wired ? Boolean(process.env[i.env]) : false,
        wired: i.wired,
        verification: 'not_checked',
      })),
    });
  } catch (err: any) {
    console.error('[dashboard/settings] GET failed:', err);
    return serverError(err, 'dashboard/settings');
  }
}

export async function PATCH(req: Request) {
  let clientId: string;
  try {
    ({ clientId } = await requireSession());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const client_id = clientId;
    const body = await req.json();

    const patch: Record<string, any> = {};
    if (body.profile) {
      const p = body.profile;
      if (p.name !== undefined) patch.contact_name = p.name || null;
      if (p.email !== undefined) patch.contact_email = p.email || null;
      if (p.company !== undefined) patch.name = p.company || null;
      if (p.website !== undefined) patch.url = p.website || null;
      if (p.timezone !== undefined) patch.timezone = p.timezone || 'UTC';
    }

    if (body.notifications) {
      // Merge rather than replace, so a partial save never drops other keys.
      const { data: existing } = await supabaseAdmin
        .from('clients')
        .select('settings_json')
        .eq('id', client_id)
        .maybeSingle();

      patch.settings_json = {
        ...(existing?.settings_json || {}),
        notifications: {
          ...(existing?.settings_json?.notifications || {}),
          ...body.notifications,
        },
      };
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('clients')
      .update(patch)
      .eq('id', client_id);

    if (error) {
      console.error('[dashboard/settings] update failed:', error.message);
      return serverError(error, 'dashboard/settings');
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[dashboard/settings] PATCH failed:', err);
    return serverError(err, 'dashboard/settings');
  }
}
