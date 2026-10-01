import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireSession, authErrorResponse } from '@/lib/auth-guard';

// A lead's enrichment state is derived from what the enrichment agent actually
// wrote back onto the row — there is no separate queue table.
function enrichmentStatus(lead: any): 'completed' | 'running' | 'failed' | 'queued' {
  const e = lead.enrichment_json || {};
  if (e.error) return 'failed';
  if (e.status === 'running') return 'running';
  if (lead.email || e.company_context || e.summary || lead.linkedin_url) return 'completed';
  return 'queued';
}

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

    const { data: rows, error } = await supabaseAdmin
      .from('leads')
      .select('id, name, company, email, linkedin_url, enrichment_json, source, created_at')
      .eq('client_id', client_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[dashboard/enrichment] query failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leads = rows || [];
    const queue = leads.map((l: any) => ({
      id: l.id,
      name: l.name || 'Unnamed lead',
      company: l.company || '',
      email: l.email || null,
      linkedin: l.linkedin_url || null,
      status: enrichmentStatus(l),
      created_at: l.created_at,
    }));

    const completed = queue.filter((q) => q.status === 'completed').length;
    const withEmail = queue.filter((q) => q.email).length;
    const companies = new Set(leads.map((l: any) => l.company).filter(Boolean)).size;

    // "Connected" means the credential is actually present in the environment,
    // not a hardcoded status.
    const sources = [
      { name: 'Firecrawl', desc: 'Website scraping & company context', env: 'FIRECRAWL_API_KEY' },
      { name: 'Apollo.io', desc: 'Email & phone number lookup',        env: 'APOLLO_API_KEY'    },
      { name: 'HubSpot',   desc: 'CRM sync for enriched contacts',     env: 'HUBSPOT_API_KEY'   },
      { name: 'Instantly', desc: 'Outbound sending & deliverability',  env: 'INSTANTLY_API_KEY' },
    ].map((s) => ({
      name: s.name,
      desc: s.desc,
      connected: !!process.env[s.env],
    }));

    return NextResponse.json({
      client_id,
      is_empty: queue.length === 0,
      queue,
      sources,
      stats: {
        leads_enriched: completed,
        emails_found: withEmail,
        companies_scraped: companies,
        // A percentage over zero rows is meaningless, so return null instead.
        enrichment_rate: queue.length > 0
          ? Math.round((completed / queue.length) * 100)
          : null,
      },
    });
  } catch (err: any) {
    console.error('[dashboard/enrichment] GET failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
