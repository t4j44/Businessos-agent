'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Cell,
} from 'recharts';
import {
  Star, CheckCircle2, ArrowRight, RefreshCw, Check, X, Rocket, AlertTriangle,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AgentCard } from '@/components/dashboard/AgentCard';
import { AGENTS, normalizeStatus } from '@/lib/agent-catalog';
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { ActivityFeed } from '@/components/ActivityFeed';

const TARGETS = {
  callResolution: 65,
  reviewResponse: 80,
  invoiceCollection: 90,
  agentUptime: 99,
  leadResponse: 90,
};

function pct(numerator: number, denominator: number) {
  if (!denominator) return { value: 0, hasData: false };
  return { value: Math.round((numerator / denominator) * 100), hasData: true };
}

// Strips tags from the brief HTML and returns its opening sentences.
function firstSentences(html: string, count = 2) {
  const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.slice(0, 240);
  return parts.slice(0, count).join(' ').trim();
}

// ─── WARE score ring ─────────────────────────────────────────────────────────
function WareRing({ score }: { score: number }) {
  const size = 88;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, score / 1000));

  const color = score > 700 ? '#10B981' : score >= 400 ? '#F59E0B' : '#EF4444';

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1F1F23" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tracking-tight" style={{ color }}>{score}</span>
        <span className="text-[10px] font-medium text-[#71717A]">/ 1000</span>
      </div>
    </div>
  );
}

// ─── Clickable card shell ────────────────────────────────────────────────────
function ActionCard({
  label, href, children,
}: { label: string; href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group w-full rounded-xl border border-[#1F1F23] bg-[#111113] p-5 text-left transition-colors duration-200 hover:border-[#3F3F46] hover:bg-[#17171A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0B]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className={tokens.type.metricLabel}>{label}</p>
        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[#71717A] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[#A1A1AA]" />
      </div>
      {children}
    </button>
  );
}

// ─── Per-row bar + its own target tick ───────────────────────────────────────
// Each metric has a different target, so a single ReferenceLine cannot work —
// the bar and its target marker are drawn together in one custom shape.
function BarWithTarget(props: any) {
  const { x, y, width, height, payload, background } = props;
  const trackX = background?.x ?? x;
  const trackWidth = background?.width ?? width;
  const targetX = trackX + (trackWidth * payload.target) / 100;
  const radius = 4;

  return (
    <g>
      {payload.hasData && width > 0 && (
        <rect x={x} y={y} width={width} height={height} rx={radius} fill={payload.fill} />
      )}
      <line
        x1={targetX} x2={targetX}
        y1={y - 3} y2={y + height + 3}
        stroke="#F4F4F5" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.55}
      />
    </g>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  // Fallback for clients who skipped the website step during onboarding.
  const [needsBrand, setNeedsBrand] = useState(false);
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/dashboard/metrics');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setApprovals(json.approvals?.items || []);
      setError(null);
    } catch (err: any) {
      // Never substitute stand-in numbers — say the data could not be reached.
      setData(null);
      setApprovals([]);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Identity comes from the signed-in session — /api/dashboard/client resolves
  // it server-side rather than the browser choosing its own client_id.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/client');

        if (res.status === 401) {
          router.push('/login');
          return;
        }

        const json = await res.json().catch(() => ({}));

        // Signed in, but no client row exists yet.
        if (res.status === 404 && json?.needs_onboarding) {
          router.push('/onboarding');
          return;
        }

        if (res.ok && json?.id) {
          setClientId(json.id);
          setClientUrl(json.url ?? null);
          setNeedsBrand(json.has_brand_profile === false);
        }
      } catch {
        // Cards still render; Run Now stays disabled without an id.
      }
    })();
  }, [router]);

  const analyseBrand = async () => {
    if (!clientId || !clientUrl) return;
    setAnalysing(true);
    setAnalyseError(null);
    try {
      const res = await fetch('/api/agents/brand-scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clientUrl, client_id: clientId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setNeedsBrand(false);
      load(true);
    } catch (err: any) {
      setAnalyseError(err?.message || String(err));
    } finally {
      setAnalysing(false);
    }
  };

  const handleApproval = async (id: string, action: 'approved' | 'rejected') => {
    setApprovingId(id);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setApprovalError(err?.message || String(err));
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 h-80 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
          <div className="lg:col-span-2 h-80 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <div className="rounded-xl border border-[#1F1F23] bg-[#111113]">
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#EF4444]/10">
              <AlertTriangle className="h-7 w-7 text-[#EF4444]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F4F4F5]">
                Couldn&apos;t load your dashboard
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                {error ?? 'No data was returned.'}
              </p>
            </div>
            <button
              onClick={() => load(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9]"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const calls = data.calls;
  const reviews = data.reviews;
  const invoices = data.invoices;
  const runs = data.agent_runs;
  const leads = data.leads;
  const brief = data.latest_brief;

  // Computed live from this week's activity, not the last stored brief.
  const wareScore = data.ware_score ?? brief?.ware_score ?? 0;
  const revenue = Math.round((invoices.amount_collected_cents ?? invoices.paid_amount_cents ?? 0) / 100);
  const briefHref = brief?.id ? `/dashboard/brief/${brief.id}` : '/dashboard/brief';

  // agent_runs.by_type carries each agent's most recent status and time.
  const runsByAgent = (() => {
    const map: Record<string, { status: ReturnType<typeof normalizeStatus>; lastRunAt: string | null }> = {};
    for (const row of runs.by_type ?? []) {
      map[row.type] = {
        status: normalizeStatus(row.last_status),
        lastRunAt: row.last_run_at ?? null,
      };
    }
    const ranCount = AGENTS.filter((a) => map[a.agentType]).length;
    return { map, ranCount };
  })();

  const rates = [
    { name: 'Call resolution', ...pct(calls.resolved, calls.total), target: TARGETS.callResolution },
    { name: 'Review responses', ...pct(reviews.responded, reviews.total), target: TARGETS.reviewResponse },
    { name: 'Invoice collection', ...pct(invoices.paid, invoices.total_sent), target: TARGETS.invoiceCollection },
    { name: 'Agent uptime', ...pct(runs.completed, runs.total), target: TARGETS.agentUptime },
    { name: 'Lead response', ...pct(leads.contacted, leads.total), target: TARGETS.leadResponse },
  ].map((r) => ({
    ...r,
    fill: !r.hasData ? '#3F3F46' : r.value >= r.target ? '#10B981' : '#EF4444',
  }));

  const behind = rates.filter((r) => r.hasData && r.value < r.target);
  const noData = rates.filter((r) => !r.hasData);

  // ── Nothing has happened yet: invite onboarding instead of showing zeros ──
  if (data.is_empty) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <div className="rounded-xl border border-[#1F1F23] bg-[#111113]">
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#7C3AED]/15">
              <Rocket className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F4F4F5]">
                Your AI team is set up and ready. Onboard your first client to see results.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                Every call answered, review replied to, invoice chased, and brief written
                will show up here automatically.
              </p>
            </div>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9]"
            >
              Onboard your first client <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] p-6 space-y-6">

      {/* ── Brand not analysed yet ──────────────────────────────────────── */}
      {needsBrand && (
        <div className="flex flex-col gap-3 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#F59E0B]">
              Your brand hasn&apos;t been analyzed yet.
            </p>
            <p className="mt-0.5 text-sm text-[#A1A1AA]">
              {clientUrl
                ? 'Your agents write in a generic voice until Brand Scout reads your website.'
                : 'Add your website in My Business first — Brand Scout needs a URL to read.'}
            </p>
            {analyseError && (
              <p className="mt-1.5 text-xs text-[#EF4444]">{analyseError}</p>
            )}
          </div>

          {clientUrl ? (
            <button
              onClick={analyseBrand}
              disabled={analysing}
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {analysing ? 'Analyzing…' : 'Analyze Brand'}
            </button>
          ) : (
            <Link
              href="/dashboard/my-business"
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-[#F59E0B]/40 px-4 py-2 text-sm font-medium text-[#F59E0B] transition-colors hover:bg-[#F59E0B]/10"
            >
              Add website <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <PageHeader
        title="Dashboard"
        subtitle="What your AI team handled over the last 7 days."
        action={
          <>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-[#1F1F23] bg-transparent px-4 py-2 text-sm font-medium text-[#A1A1AA] transition-colors hover:border-[#2A2A30] hover:text-[#F4F4F5] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href={briefHref}
              className="btn-accent-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              View brief <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      {/* ── This week at a glance (agent_runs + call_transcripts, 7 days) ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: 'Agent actions',
            value: runs.total.toLocaleString(),
            note: 'Runs in the last 7 days',
          },
          {
            label: 'Cost this week',
            value: '$' + (Number(runs.total_cost_usd) || 0).toFixed(3),
            note: 'Across every agent',
          },
          {
            label: 'Agents active',
            value: String((runs.by_type ?? []).length),
            note: 'Distinct agents that ran',
          },
          {
            label: 'Calls handled',
            value: calls.total.toLocaleString(),
            note: 'Inbound calls logged',
          },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-[#1F1F23] bg-[#111113] p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-[#71717A]">{m.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-[#F4F4F5]">{m.value}</p>
            <p className="mt-1 text-xs text-[#71717A]">{m.note}</p>
          </div>
        ))}
      </div>

      {/* ── Your AI team ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-semibold leading-8 tracking-tight text-[#F4F4F5]">
            Your AI team
          </h2>
          <span className="text-xs text-[#71717A]">
            {runsByAgent.ranCount} of {AGENTS.length} active this week
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((agent) => (
            <AgentCard
              key={agent.agentType}
              agent={agent}
              run={runsByAgent.map[agent.agentType] ?? { status: 'never', lastRunAt: null }}
              clientId={clientId}
              onRan={() => load(true)}
            />
          ))}
        </div>
      </section>

      {/* ── Live activity feed ──────────────────────────────────────────── */}
      {clientId && <ActivityFeed clientId={clientId} />}

      {/* ── Top row: 4 clickable metric cards ───────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

        <ActionCard label="WARE Score" href={briefHref}>
          <div className="mt-3 flex items-center gap-4">
            <WareRing score={wareScore} />
            <p className="text-xs leading-relaxed text-[#71717A]">
              {wareScore > 700 ? 'Strong week' : wareScore >= 400 ? 'Needs attention' : 'Falling behind'}
            </p>
          </div>
        </ActionCard>

        <ActionCard label="Calls Handled" href="/dashboard/calls">
          <p className={`mt-3 ${tokens.type.metric} text-[#F4F4F5]`}>{calls.total}</p>
          <p className="mt-2 text-xs text-[#71717A]">
            <span className="font-medium text-[#10B981]">{calls.resolved}</span> resolved without human
          </p>
        </ActionCard>

        <ActionCard label="Reviews Managed" href="/dashboard/reviews">
          <p className={`mt-3 ${tokens.type.metric} text-[#F4F4F5]`}>{reviews.total}</p>
          {reviews.total > 0 ? (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-3.5 w-3.5 ${
                      i < Math.round(reviews.avg_rating)
                        ? 'fill-[#F59E0B] text-[#F59E0B]'
                        : 'text-[#3F3F46]'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-[#71717A]">{reviews.avg_rating} avg</span>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#71717A]">No reviews yet</p>
          )}
        </ActionCard>

        <ActionCard label="Revenue Collected" href="/dashboard/invoices">
          <p className={`mt-3 ${tokens.type.metric} text-[#10B981]`}>
            ${revenue.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {invoices.paid} of {invoices.total_sent} invoices paid
          </p>
        </ActionCard>
      </div>

      {/* ── Middle row: chart (60%) + approvals (40%) ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        <div className="lg:col-span-3 rounded-xl border border-[#1F1F23] bg-[#111113]">
          <div className="flex items-center justify-between border-b border-[#1F1F23] px-5 py-4">
            <div>
              <h2 className={tokens.type.cardTitle}>This week at a glance</h2>
              <p className="mt-0.5 text-xs text-[#71717A]">
                Dashed line marks the target
              </p>
            </div>
          </div>

          <div className="p-5">
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer>
                <ComposedChart
                  data={rates}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                  barCategoryGap="28%"
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={116}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#A1A1AA', fontSize: 12 }}
                  />
                  <Bar dataKey="value" shape={<BarWithTarget />} background={{ fill: '#17171A', radius: 4 }} isAnimationActive={false}>
                    {rates.map((r, i) => <Cell key={i} fill={r.fill} />)}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#1F1F23] pt-4">
              <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
                <span className="h-2 w-2 rounded-full bg-[#10B981]" /> On target
              </span>
              <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
                <span className="h-2 w-2 rounded-full bg-[#EF4444]" /> Below target
              </span>
              {noData.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
                  <span className="h-2 w-2 rounded-full bg-[#3F3F46]" /> No data yet
                </span>
              )}
            </div>

            <p className="mt-3 text-sm text-[#A1A1AA]">
              {behind.length === 0
                ? 'Everything with data is hitting target.'
                : `${behind.length === 1 ? 'One metric is' : `${behind.length} metrics are`} below target: ${behind.map((b) => b.name.toLowerCase()).join(', ')}.`}
            </p>
          </div>
        </div>

        {/* ── Needs your attention ───────────────────────────────────────── */}
        <div className="lg:col-span-2 rounded-xl border border-[#1F1F23] bg-[#111113]">
          <div className="flex items-center justify-between border-b border-[#1F1F23] px-5 py-4">
            <h2 className={tokens.type.cardTitle}>Needs your attention</h2>
            {approvals.length > 0 && (
              <span className="rounded-full border border-[#7C3AED]/20 bg-[#7C3AED]/10 px-2 py-0.5 text-xs font-medium text-[#7C3AED]">
                {approvals.length}
              </span>
            )}
          </div>

          <div className="p-5">
            {approvalError && (
              <p className="mb-3 text-xs text-[#EF4444]">{approvalError}</p>
            )}

            {approvals.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10B981]/10">
                  <CheckCircle2 className="h-6 w-6 text-[#10B981]" />
                </div>
                <p className="text-sm font-medium text-[#F4F4F5]">You&apos;re all caught up!</p>
                <p className="text-xs text-[#71717A]">Nothing needs your approval right now.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {approvals.map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-[#1F1F23] bg-[#17171A] p-4">
                    <p className="text-sm font-medium text-[#F4F4F5]">
                      {(item.action_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </p>
                    {item.payload_json?.description && (
                      <p className="mt-1 line-clamp-1 text-xs text-[#71717A]">
                        {item.payload_json.description}
                      </p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleApproval(item.id, 'approved')}
                        disabled={approvingId === item.id}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#7C3AED] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => handleApproval(item.id, 'rejected')}
                        disabled={approvingId === item.id}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1F1F23] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#1F1F23] disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom: Monday Brief preview ─────────────────────────────────── */}
      <div className="rounded-xl border border-[#1F1F23] bg-[#111113] p-5">
        {!brief ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7C3AED]/10">
              <Rocket className="h-5 w-5 text-[#7C3AED]" />
            </div>
            <p className="text-sm text-[#A1A1AA]">No Monday Brief yet — it appears once your agents have a week of activity.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className={tokens.type.cardTitle}>Monday Brief</h2>
              <p className={`mt-1.5 ${tokens.type.body}`}>{firstSentences(brief.brief_html, 2)}</p>
            </div>
            <Link
              href={briefHref}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#7C3AED] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9]"
            >
              Read full brief <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
