'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip,
} from 'recharts';
import {
  PhoneCall,
  Pause, Play, Check, FileText,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';
import { InvoicePanel } from '@/components/dashboard/InvoicePanel';
import { MetricCard } from '@/components/ui/MetricCard';
import { Pending, SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';

const STAGE_COLOR: Record<string, string> = {
  sent: '#615D75',
  step1: '#D9A441',
  step2: '#D9A441',
  step3: '#D9A441',
  step4: '#D96A6A',
  paid: '#4FBF8B',
};

function Card({ children, className = '', elevated = true }: { children: React.ReactNode; className?: string; elevated?: boolean }) {
  return (
    <div className={`${elevated ? 'rounded-lg border border-line bg-surface shadow-lightcatch' : 'rounded-lg bg-surface/60'} ${className}`}>
      {children}
    </div>
  );
}

function money(cents: number) {
  return `$${Math.round((cents || 0) / 100).toLocaleString()}`;
}

function timeAgo(iso: string | null) {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? '' : 's'} ago`;
}

// ●●●○○ — how far through the 5-step chase sequence this invoice is.
function ChaseDots({ step }: { step: number }) {
  return (
    <span className="flex items-center gap-1" title={`Step ${step} of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < step ? (step >= 4 ? 'bg-crit' : 'bg-warn') : 'bg-line-strong'
          }`}
        />
      ))}
    </span>
  );
}

function FunnelTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <p className="text-xs font-medium text-text">{row.label}</p>
      <p className="mt-0.5 text-[11px] text-muted">
        {row.count} invoice{row.count === 1 ? '' : 's'} · {money(row.amount_cents)}
      </p>
    </div>
  );
}

export default function InvoicesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/invoices');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invoices: any[] = data?.invoices || [];

  const visible = useMemo(
    () => (stageFilter ? invoices.filter((i) => i.stage === stageFilter) : invoices),
    [invoices, stageFilter],
  );

  const act = async (id: string, action: 'pause' | 'resume' | 'mark_paid') => {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen space-y-5 bg-canvas p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} rows={1} />)}
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-canvas p-6">
        <Card elevated={false}><div className="p-6"><p className="text-sm text-crit">Couldn&apos;t load invoices — {error}</p></div></Card>
      </div>
    );
  }

  const s = data.summary;
  const qw = data.quick_win;

  // ── No invoices recorded yet ─────────────────────────────────────────────
  if (data.is_empty) {
    return (
      <div className="min-h-screen space-y-5 bg-canvas p-6">
        <InvoicePanel onCreated={load} />
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent/15">
              <FileText className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">
                No invoices yet. Create your first invoice to start chasing.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-dim">
                Review invoices, track recorded payments, and prepare follow-up drafts for owner review.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 bg-canvas p-6">

      {/* ── CREATE + LOGGED INVOICES ────────────────────────────────────── */}
      <InvoicePanel onCreated={load} />

      {/* ── TOP ROW ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Outstanding"
          value={money(s.outstanding_cents)}
          state="warn"
          rows={[{ label: 'Status', value: 'To collect' }]}
        />
        <MetricCard
          label="Collected This Month"
          value={money(s.collected_this_month_cents)}
          state="good"
          rows={[{ label: 'Status', value: 'Recorded paid' }]}
        />
        <MetricCard
          label="Overdue > 7 Days"
          value={s.overdue_over_7_count}
          state={s.overdue_over_7_count > 0 ? 'crit' : undefined}
          rows={[{ label: 'Action', value: s.overdue_over_7_count === 0 ? 'Clear' : 'Chase now' }]}
        />
        <MetricCard
          label="Avg Days to Payment"
          value={s.avg_days_to_payment ?? '—'}
          rows={[{ label: 'From', value: 'Invoice → paid' }]}
        />
      </div>

      {/* ── QUICK WIN BANNER ────────────────────────────────────────────── */}
      {qw && (
        <div className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-warn/20">
              <PhoneCall className="h-4 w-4 text-warn" />
            </div>
            <div>
              <p className="text-sm font-semibold text-warn">
                {qw.count} invoice{qw.count === 1 ? ' is' : 's are'} at the final collection step
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Consider a personal call to{' '}
                <span className="font-medium text-text">{qw.top_name}</span> for{' '}
                <span className="font-medium text-text">{money(qw.top_amount_cents)}</span>
                {qw.count > 1 && <> · {money(qw.total_amount_cents)} at this stage in total</>}
              </p>
            </div>
          </div>
          <button
            onClick={() => setStageFilter('step4')}
            className="flex-shrink-0 rounded-lg bg-warn px-4 py-2.5 text-xs font-semibold text-canvas transition-colors hover:bg-warn"
          >
            Show these invoices
          </button>
        </div>
      )}

      {/* ── COLLECTION FUNNEL ───────────────────────────────────────────── */}
      <Card elevated={false}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className={tokens.type.cardTitle}>Collection Funnel</h2>
            <p className="mt-0.5 text-xs text-dim">
              Where every invoice sits in the chase sequence — click a stage to filter
            </p>
          </div>
          {stageFilter && (
            <button
              onClick={() => setStageFilter(null)}
              className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent"
            >
              Clear filter ✕
            </button>
          )}
        </div>
        <div className="p-5">
          <div style={{ width: '100%', height: 230 }}>
            <ResponsiveContainer>
              <BarChart
                data={data.funnel}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                barCategoryGap="22%"
              >
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis
                  type="category" dataKey="label" width={128}
                  tickLine={false} axisLine={false}
                  tick={{ fill: tokens.colors.text.secondary, fontSize: 12 }}
                />
                <Tooltip content={<FunnelTooltip />} cursor={{ fill: tokens.colors.bg.cardHover }} />
                <Bar
                  dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}
                  background={{ fill: tokens.colors.bg.cardHover, radius: 4 } as any}
                  className="cursor-pointer"
                  onClick={(entry: any) => {
                    const key = entry?.payload?.key ?? entry?.key;
                    if (key) setStageFilter((prev) => (prev === key ? null : key));
                  }}
                >
                  {data.funnel.map((f: any) => (
                    <Cell
                      key={f.key}
                      fill={STAGE_COLOR[f.key]}
                      opacity={stageFilter && stageFilter !== f.key ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
            <span className="flex items-center gap-1.5 text-xs text-dim">
              <span className="h-2 w-2 rounded-full bg-good" /> Paid
            </span>
            <span className="flex items-center gap-1.5 text-xs text-dim">
              <span className="h-2 w-2 rounded-full bg-warn" /> Chase in progress
            </span>
            <span className="flex items-center gap-1.5 text-xs text-dim">
              <span className="h-2 w-2 rounded-full bg-crit" /> Final step
            </span>
            <span className="flex items-center gap-1.5 text-xs text-dim">
              <span className="h-2 w-2 rounded-full bg-dim" /> Sent, not chased
            </span>
          </div>
        </div>
      </Card>

      {/* ── INVOICE LIST ────────────────────────────────────────────────── */}
      <Card>
        <div className="border-b border-line px-5 py-4">
          <h2 className={tokens.type.cardTitle}>Invoices</h2>
          <p className="mt-0.5 text-xs text-dim">
            {visible.length} invoice{visible.length === 1 ? '' : 's'} · most overdue first
            {stageFilter && ` · ${data.funnel.find((f: any) => f.key === stageFilter)?.label} only`}
          </p>
        </div>

        {actionError && (
          <p className="border-b border-line px-5 py-3 text-xs text-crit">{actionError}</p>
        )}

        <div className="divide-y divide-line">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileText className="h-6 w-6 text-line-strong" />
              <p className="text-sm text-dim">No invoices at this stage.</p>
            </div>
          ) : (
            visible.map((inv) => {
              const isBusy = busyId === inv.id;
              return (
                <div key={inv.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <p className="truncate text-sm font-medium text-text">
                        {inv.customer_name || 'Unknown customer'}
                      </p>
                      {inv.is_paid && (
                        <span className="rounded-full border border-good/20 bg-good/10 px-2 py-0.5 text-[11px] font-medium text-good">
                          Paid
                        </span>
                      )}
                      {inv.is_paused && (
                        <span className="rounded-full border border-dim/30 bg-dim/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                          Paused
                        </span>
                      )}
                      {inv.status === 'draft' && <span className="text-xs text-dim">Draft — not sent</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {!inv.is_paid && inv.days_overdue > 0 && (
                        <span className="text-xs font-medium text-crit">
                          {inv.days_overdue} days overdue
                        </span>
                      )}
                      {!inv.is_paid && <ChaseDots step={inv.chase_step} />}
                      <span className="text-xs text-dim">
                        Last action: {timeAgo(inv.last_chase_at)}
                      </span>
                    </div>
                  </div>

                  <p className="text-2xl font-bold tracking-tight text-text sm:w-32 sm:text-right">
                    {money(inv.amount_cents)}
                  </p>

                  {['draft', 'sent', 'overdue', 'paused'].includes(inv.status) && (
                    <div className="flex flex-shrink-0 gap-2">
                      {inv.status !== 'draft' && <button
                        onClick={() => act(inv.id, inv.is_paused ? 'resume' : 'pause')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-line disabled:opacity-50"
                      >
                        {isBusy ? <Pending />
                          : inv.is_paused ? <Play className="h-3.5 w-3.5" />
                          : <Pause className="h-3.5 w-3.5" />}
                        {inv.is_paused ? 'Resume' : 'Pause'}
                      </button>}
                      <button
                        onClick={() => act(inv.id, 'mark_paid')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-good px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-good disabled:opacity-50"
                      >
                        {isBusy ? <Pending /> : <Check className="h-3.5 w-3.5" />}
                        Mark Paid
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
