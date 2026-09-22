'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Search, ArrowRight, Star, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { ErrorMessage } from '@/components/dashboard/AgentState';
import { Attribution } from '@/components/Attribution';
import { MetricCard } from '@/components/ui/MetricCard';
import { Pending, SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';

// Hunter — the lead pipeline. Search discovers local businesses, enrichment
// finds a contact and scores ICP fit, then Hunter Generate writes the outbound.

type Lead = {
  id: string;
  name: string | null;
  category: string | null;
  city: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  outreach_status: string | null;
  icp_match_score: number | null;
  email_found: string | null;
  phone_consent: boolean | null;
  contact_name: string | null;
  contact_role: string | null;
};

type Stats = {
  total: number;
  new: number;
  enriched: number;
  emailed: number;
  avg_icp_score: number;
};

const STATUS_PILL: Record<string, string> = {
  new: 'border-line-strong bg-faint/10 text-muted',
  enriched: 'border-accent/25 bg-accent/10 text-accent-bright',
  emailed: 'border-good/25 bg-good/10 text-good',
};

function icpColor(score: number) {
  if (score >= 70) return 'text-good';
  if (score >= 40) return 'text-warn';
  return 'text-crit';
}

export default function HunterPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [prospecting, setProspecting] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Typing is kept separate from the query that was actually run, so the
  // input never re-triggers a search on its own.
  const [searchQuery, setSearchQuery] = useState('');
  const [query, setQuery] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/hunter');
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads ?? []);
        setStats(data.stats ?? null);
      }
    } catch {
      // The table keeps whatever it already had.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const prospect = async (e: FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || prospecting) return;

    setProspecting(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/hunter/prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setQuery(q);
      // A slice with no Overture data loaded is a 200 with a message, not an
      // error — surface it so the operator knows to run the ETL.
      if (json?.message) setNotice(json.message);
      else setNotice(null);
      await fetchLeads();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setProspecting(false);
    }
  };

  const enrich = async (leadId: string) => {
    setEnrichingId(leadId);
    setError(null);
    try {
      const res = await fetch('/api/agents/hunter/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await fetchLeads();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setEnrichingId(null);
    }
  };

  const writeEmails = async (lead: Lead) => {
    setGeneratingId(lead.id);
    setError(null);
    try {
      const res = await fetch('/api/agents/hunter/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // contact_name is captured by Hunter Enrich from the company's about
          // or team page. It is null when no named person was identifiable —
          // 'there' then produces a nameless greeting rather than addressing
          // the business as if it were a person.
          lead: {
            name: lead.contact_name ?? 'there',
            company: lead.name ?? 'their company',
            role: lead.contact_role ?? lead.category ?? 'Owner',
            website: lead.website ?? undefined,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setToast('Emails generated ✓');
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="min-h-screen space-y-6 bg-canvas p-6">
      <PageHeader
        title="Hunter"
        subtitle="Find local businesses, enrich them, and write the outbound."
      />

      {/* ── Section A — prospect search ─────────────────────────────────── */}
      <form onSubmit={prospect} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. dentists in Chicago IL"
            aria-label="Industry and location"
            className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={prospecting || !searchQuery.trim()}
          className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {prospecting ? <Pending /> : <Search className="h-4 w-4" />}
          {prospecting ? 'Searching…' : 'Find Leads'}
        </button>
      </form>

      <ErrorMessage message={error} />
      {toast && (
        <div className="flex items-center gap-2 rounded-lg border border-good/20 bg-good/10 px-3 py-2 text-sm text-good">
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn">
          {notice}
        </div>
      )}
      {query && !prospecting && (
        <p className="text-xs text-dim">Showing results for &ldquo;{query}&rdquo;</p>
      )}

      {/* ── Section B — stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {loading ? (
          <>
            <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          </>
        ) : (
          <>
            <MetricCard label="Total Leads" value={stats?.total ?? 0} />
            <MetricCard label="New" value={stats?.new ?? 0} />
            <MetricCard label="Enriched" value={stats?.enriched ?? 0} />
            <MetricCard label="Avg ICP Score" value={stats?.avg_icp_score ?? 0} />
          </>
        )}
      </div>

      {/* ── Section C — lead table ──────────────────────────────────────── */}
      <div className="rounded-lg bg-surface/60">
        {loading ? (
          <SkeletonTable rows={5} cols={7} className="border-0 bg-transparent" />
        ) : leads.length === 0 ? (
          <EmptyState message="No leads yet. Enter a search above to find local businesses in your target market." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-dim">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">City</th>
                  <th className="px-4 py-2.5 font-medium">Rating</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">ICP</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const status = lead.outreach_status ?? 'new';
                  const score = lead.icp_match_score;
                  const showDash = status === 'new' || score == null;

                  return (
                    <tr key={lead.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-text">{lead.name ?? 'Unknown'}</span>
                        {lead.email_found && (
                          <span className="mt-0.5 block text-xs text-dim">{lead.email_found}</span>
                        )}
                        {lead.phone_consent !== true && (
                          <span
                            title="No phone consent on record — calls and SMS are disabled for this lead (TCPA)."
                            className="mt-1 inline-block rounded-full border border-line-strong bg-faint/10 px-1.5 py-px text-[10px] font-medium text-dim"
                          >
                            no consent
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{lead.category ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted">{lead.city ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted">
                        {lead.rating != null ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-warn text-warn" />
                            {lead.rating}
                            <span className="text-xs text-faint">({lead.review_count ?? 0})</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={
                          'rounded-full border px-2 py-0.5 text-xs font-medium ' +
                          (STATUS_PILL[status] ?? STATUS_PILL.new)
                        }>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {showDash ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={'font-semibold tabular-nums ' + icpColor(score!)}>{score}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {status === 'new' && (
                          <button
                            onClick={() => enrich(lead.id)}
                            disabled={enrichingId === lead.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs font-medium text-accent-bright transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {enrichingId === lead.id
                              ? <Pending />
                              : <ArrowRight className="h-3 w-3" />}
                            {enrichingId === lead.id ? 'Enriching…' : 'Enrich'}
                          </button>
                        )}

                        {status === 'enriched' && (
                          <button
                            onClick={() => writeEmails(lead)}
                            disabled={generatingId === lead.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {generatingId === lead.id
                              ? <Pending />
                              : <ArrowRight className="h-3 w-3" />}
                            {generatingId === lead.id ? 'Writing…' : 'Write Emails'}
                          </button>
                        )}

                        {status === 'emailed' && (
                          <button
                            disabled
                            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-faint"
                          >
                            View
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Attribution />
    </div>
  );
}
