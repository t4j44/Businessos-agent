import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// Defaults applied when a client has never saved preferences.
const NOTIFICATION_DEFAULTS: Record<string, boolean> = {
  hotLead: true,
  demoBooked: true,
  reviewAlert: true,
  weeklyBrief: true,
  agentFailure: true,
  approvalNeeded: true,
};

// "Connected" reflects whether the credential is actually present, not a
// hardcoded status.
const INTEGRATIONS = [
  { name: 'HubSpot CRM',     desc: 'Sync leads and deals bidirectionally',     env: 'HUBSPOT_API_KEY'      },
  { name: 'Stripe',          desc: 'Billing and subscription management',      env: 'STRIPE_SECRET_KEY'    },
  { name: 'Resend',          desc: 'Transactional and outbound email',         env: 'RESEND_API_KEY'       },
  { name: 'Instantly',       desc: 'Outbound sequences for the Hunter agent',  env: 'INSTANTLY_API_KEY'    },
  { name: 'Bland',           desc: 'Voice calls for the AI receptionist',      env: 'BLAND_API_KEY'        },
  { name: 'Nylas',           desc: 'Calendar sync for booked demos',           env: 'NYLAS_API_KEY'        },
  { name: 'Buffer',          desc: 'Publishing for the creative agent',        env: 'BUFFER_ACCESS_TOKEN'  },
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;

    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, url, contact_name, contact_email, timezone, settings_json, plan_tier')
      .eq('id', client_id)
      .maybeSingle();

    if (error) {
      console.error('[dashboard/settings] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    return NextResponse.json({
      client_id,
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
        connected: !!process.env[i.env],
      })),
    });
  } catch (err: any) {
    console.error('[dashboard/settings] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = searchParams.get('client_id') || TEST_CLIENT_ID;
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[dashboard/settings] PATCH failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
