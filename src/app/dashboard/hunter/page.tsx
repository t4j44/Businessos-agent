'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Search, Loader2, ArrowRight, Star, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { ErrorMessage } from '@/components/dashboard/AgentState';
import { Attribution } from '@/components/Attribution';

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
  new: 'border-[#2A2A30] bg-[#52525B]/10 text-[#A1A1AA]',
  enriched: 'border-[#3B82F6]/25 bg-[#3B82F6]/10 text-[#60A5FA]',
  emailed: 'border-[#10B981]/25 bg-[#10B981]/10 text-[#10B981]',
};

function icpColor(score: number) {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function StatCard({ label, value, loading }: { label: string; value: string | number; loading: boolean }) {
  return (
    <div className="rounded-lg border border-[#1F1F23] bg-[#111113] p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[#71717A]">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-[#17171A]" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight text-[#FAFAFA]">{value}</p>
      )}
    </div>
  );
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
    <div className="min-h-screen space-y-6 bg-[#0A0A0B] p-6">
      <PageHeader
        title="Hunter"
        subtitle="Find local businesses, enrich them, and write the outbound."
      />

      {/* ── Section A — prospect search ─────────────────────────────────── */}
      <form onSubmit={prospect} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#52525B]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. dentists in Chicago IL"
            aria-label="Industry and location"
            className="w-full rounded-lg border border-[#1F1F23] bg-[#111113] py-2.5 pl-9 pr-3 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:border-[#7C3AED]/50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={prospecting || !searchQuery.trim()}
          className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {prospecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {prospecting ? 'Searching…' : 'Find Leads'}
        </button>
      </form>

      <ErrorMessage message={error} />
      {toast && (
        <div className="flex items-center gap-2 rounded-lg border border-[#10B981]/20 bg-[#10B981]/10 px-3 py-2 text-sm text-[#10B981]">
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[#F59E0B]/25 bg-[#F59E0B]/10 px-3 py-2 text-sm text-[#F59E0B]">
          {notice}
        </div>
      )}
      {query && !prospecting && (
        <p className="text-xs text-[#71717A]">Showing results for &ldquo;{query}&rdquo;</p>
      )}

      {/* ── Section B — stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Total Leads" value={stats?.total ?? 0} loading={loading} />
        <StatCard label="New" value={stats?.new ?? 0} loading={loading} />
        <StatCard label="Enriched" value={stats?.enriched ?? 0} loading={loading} />
        <StatCard label="Avg ICP Score" value={stats?.avg_icp_score ?? 0} loading={loading} />
      </div>

      {/* ── Section C — lead table ──────────────────────────────────────── */}
      <div className="rounded-lg border border-[#1F1F23] bg-[#111113]">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-[#17171A]" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <EmptyState message="No leads yet. Enter a search above to find local businesses in your target market." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#1F1F23] text-xs uppercase tracking-wider text-[#71717A]">
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
                    <tr key={lead.id} className="border-b border-[#1F1F23] last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-[#FAFAFA]">{lead.name ?? 'Unknown'}</span>
                        {lead.email_found && (
                          <span className="mt-0.5 block text-xs text-[#71717A]">{lead.email_found}</span>
                        )}
                        {lead.phone_consent !== true && (
                          <span
                            title="No phone consent on record — calls and SMS are disabled for this lead (TCPA)."
                            className="mt-1 inline-block rounded-full border border-[#2A2A30] bg-[#52525B]/10 px-1.5 py-px text-[10px] font-medium text-[#71717A]"
                          >
                            no consent
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[#A1A1AA]">{lead.category ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[#A1A1AA]">{lead.city ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[#A1A1AA]">
                        {lead.rating != null ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-[#F59E0B] text-[#F59E0B]" />
                            {lead.rating}
                            <span className="text-xs text-[#52525B]">({lead.review_count ?? 0})</span>
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
                          <span className="text-[#52525B]">—</span>
                        ) : (
                          <span className={'font-semibold tabular-nums ' + icpColor(score!)}>{score}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {status === 'new' && (
                          <button
                            onClick={() => enrich(lead.id)}
                            disabled={enrichingId === lead.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/40 px-2.5 py-1.5 text-xs font-medium text-[#A78BFA] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {enrichingId === lead.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <ArrowRight className="h-3 w-3" />}
                            {enrichingId === lead.id ? 'Enriching…' : 'Enrich'}
                          </button>
                        )}

                        {status === 'enriched' && (
                          <button
                            onClick={() => writeEmails(lead)}
                            disabled={generatingId === lead.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {generatingId === lead.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <ArrowRight className="h-3 w-3" />}
                            {generatingId === lead.id ? 'Writing…' : 'Write Emails'}
                          </button>
                        )}

                        {status === 'emailed' && (
                          <button
                            disabled
                            className="rounded-lg border border-[#1F1F23] px-2.5 py-1.5 text-xs font-medium text-[#52525B]"
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
