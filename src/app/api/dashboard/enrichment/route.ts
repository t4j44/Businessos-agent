import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { serverError } from '@/lib/server-error'

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
      return serverError(error, 'dashboard/enrichment');
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

    // What actually enriches a lead, and what does not.
    //
    // This list used to be Firecrawl, Apollo, HubSpot and Instantly, each shown
    // green whenever its key was present — and not one of them is called by any
    // line of code. The real pipeline is hunter/enrich: it reads the lead's
    // website through readWebsite() and checks the domain with a DNS MX lookup.
    // Those two need no credential, so they are always on; the rest are named
    // honestly as unbuilt so a key cannot imply a working integration.
    const sources = [
      { name: 'Website reader', desc: 'Reads each lead\'s site for contact and context (Jina Reader, no key needed)', always: true },
      { name: 'MX verification', desc: 'Confirms the email domain can receive mail (DNS lookup)', always: true },
      { name: 'Crawl4AI', desc: 'Browser-based scraping for JavaScript sites', env: 'CRAWL4AI_URL' },
      { name: 'Brave Search', desc: 'Market and competitor context', env: 'BRAVE_API_KEY' },
      { name: 'Apollo.io', desc: 'Email & phone lookup — not built yet', wired: false },
      { name: 'HubSpot', desc: 'CRM sync — not built yet', wired: false },
      { name: 'Instantly', desc: 'Outbound sending — not built yet', wired: false },
    ].map((s: any) => ({
      name: s.name,
      desc: s.desc,
      connected: s.always === true ? true : s.wired === false ? false : !!process.env[s.env],
      wired: s.wired !== false,
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
    return serverError(err, 'dashboard/enrichment');
  }
}
