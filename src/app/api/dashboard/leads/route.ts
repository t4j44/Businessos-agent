import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { TEST_CLIENT_ID } from '@/lib/client-config';
import { resolveClientId } from '@/lib/session';
const MS_DAY = 24 * 60 * 60 * 1000;

// Statuses that mean the lead has been emailed at least once.
const CONTACTED = new Set(['emailed', 'replied', 'hot']);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const client_id = (await resolveClientId(req)).clientId;

    const { data: rows, error } = await supabaseAdmin
      .from('leads')
      .select(
        'id, name, contact_name, email, company, bos_lead_score, status, source, enrichment_json, last_contacted_at, created_at',
      )
      .eq('client_id', client_id)
      // Apollo/CSV rows only — prospected rows have their own screen at
      // /dashboard/hunter and their own status column (outreach_status).
      .is('place_id', null)
      .order('bos_lead_score', { ascending: false });

    if (error) {
      console.error('[dashboard/leads] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leads = (rows || []).map((l: any) => ({
      id: l.id,
      // contact_name is the person; name is a person on Apollo rows but a
      // business on prospected ones. Preferring contact_name keeps the Contact
      // column correct whichever pipeline the row came from.
      name: l.contact_name || l.name || 'Unnamed lead',
      email: l.email || '',
      company: l.company || l.name || '',
      bos_lead_score: Number(l.bos_lead_score) || 0,
      status: l.status || 'pending',
      // The Firecrawl/Apollo enrichment payload is free-form; surface whichever
      // narrative field the enrichment agent wrote, and nothing if it wrote none.
      company_context:
        l.enrichment_json?.company_context ??
        l.enrichment_json?.summary ??
        null,
      last_contacted_at: l.last_contacted_at,
      created_at: l.created_at,
    }));

    // ── ICP config lives on the hunter campaign ──────────────────────────────
    const { data: campaign } = await supabaseAdmin
      .from('campaigns')
      .select('id, settings_json, daily_volume_limit')
      .eq('client_id', client_id)
      .eq('agent_type', 'hunter')
      .maybeSingle();

    // ── Outreach stats, real rows only ───────────────────────────────────────
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const emailedThisMonth = leads.filter(
      (l) => l.last_contacted_at && new Date(l.last_contacted_at).getTime() >= monthStart.getTime(),
    ).length;

    const dayStart = Date.now() - MS_DAY;
    const sentToday = leads.filter(
      (l) => l.last_contacted_at && new Date(l.last_contacted_at).getTime() >= dayStart,
    ).length;

    const contacted = leads.filter((l) => CONTACTED.has(l.status)).length;
    const replied = leads.filter((l) => l.status === 'replied' || l.status === 'hot').length;

    return NextResponse.json({
      client_id,
      is_empty: leads.length === 0,
      leads,
      icp: {
        titles: campaign?.settings_json?.titles ?? [],
        companySizeMin: campaign?.settings_json?.company_size_min ?? null,
        companySizeMax: campaign?.settings_json?.company_size_max ?? null,
        industries: campaign?.settings_json?.industries ?? '',
        seniority: campaign?.settings_json?.seniority ?? [],
        dailyEmailLimit:
          campaign?.settings_json?.daily_email_limit ?? campaign?.daily_volume_limit ?? 50,
        configured: !!campaign,
      },
      stats: {
        total_leads: leads.length,
        emails_sent_this_month: emailedThisMonth,
        contacted,
        replied,
        // Rates are only meaningful once something has actually been sent.
        reply_rate: contacted > 0 ? Number(((replied / contacted) * 100).toFixed(1)) : null,
        hot_leads: leads.filter((l) => l.status === 'hot').length,
        daily_sent: sentToday,
        daily_limit: campaign?.daily_volume_limit ?? 50,
      },
    });
  } catch (err: any) {
    console.error('[dashboard/leads] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
