'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip,
} from 'recharts';
import {
  DollarSign, TrendingUp, AlertTriangle, Clock, PhoneCall,
  Pause, Play, Check, Loader2, FileText,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';
import { InvoicePanel } from '@/components/dashboard/InvoicePanel';

const STAGE_COLOR: Record<string, string> = {
  sent: '#71717A',
  step1: '#F59E0B',
  step2: '#F59E0B',
  step3: '#F59E0B',
  step4: '#EF4444',
  paid: '#10B981',
};

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#1F1F23] bg-[#111113] ${className}`}>{children}</div>
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
            i < step ? (step >= 4 ? 'bg-[#EF4444]' : 'bg-[#F59E0B]') : 'bg-[#3F3F46]'
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
    <div className="rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2">
      <p className="text-xs font-medium text-[#F4F4F5]">{row.label}</p>
      <p className="mt-0.5 text-[11px] text-[#A1A1AA]">
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
      <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <Card><div className="p-6"><p className="text-sm text-[#EF4444]">Couldn&apos;t load invoices — {error}</p></div></Card>
      </div>
    );
  }

  const s = data.summary;
  const qw = data.quick_win;

  // ── No invoices recorded yet ─────────────────────────────────────────────
  if (data.is_empty) {
    return (
      <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">
        <InvoicePanel onCreated={load} />
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#7C3AED]/15">
              <FileText className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F4F4F5]">
                No invoices yet. Create your first invoice to start chasing.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                Once invoices exist, the chase agent works the sequence and every
                stage, reminder, and payment shows up here.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">

      {/* ── CREATE + LOGGED INVOICES ────────────────────────────────────── */}
      <InvoicePanel onCreated={load} />

      {/* ── TOP ROW ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Outstanding</p>
            <DollarSign className="h-4 w-4 text-[#F59E0B]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} text-[#F59E0B]`}>{money(s.outstanding_cents)}</p>
          <p className="mt-2 text-xs text-[#71717A]">Still to be collected</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Collected This Month</p>
            <TrendingUp className="h-4 w-4 text-[#10B981]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} text-[#10B981]`}>
            {money(s.collected_this_month_cents)}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">Money in the bank</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Overdue &gt; 7 Days</p>
            <AlertTriangle className="h-4 w-4 text-[#EF4444]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${s.overdue_over_7_count > 0 ? 'text-[#EF4444]' : 'text-[#F4F4F5]'}`}>
            {s.overdue_over_7_count}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {s.overdue_over_7_count === 0 ? 'Nothing badly overdue' : 'Need chasing now'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Avg Days to Payment</p>
            <Clock className="h-4 w-4 text-[#71717A]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${s.avg_days_to_payment != null ? 'text-[#F4F4F5]' : 'text-[#3F3F46]'}`}>
            {s.avg_days_to_payment ?? '—'}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {s.avg_days_to_payment != null ? 'From invoice to payment' : 'No payments yet'}
          </p>
        </Card>
      </div>

      {/* ── QUICK WIN BANNER ────────────────────────────────────────────── */}
      {qw && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#F59E0B]/20">
              <PhoneCall className="h-4 w-4 text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#F59E0B]">
                {qw.count} invoice{qw.count === 1 ? ' is' : 's are'} at the final collection step
              </p>
              <p className="mt-0.5 text-sm text-[#A1A1AA]">
                Consider a personal call to{' '}
                <span className="font-medium text-[#F4F4F5]">{qw.top_name}</span> for{' '}
                <span className="font-medium text-[#F4F4F5]">{money(qw.top_amount_cents)}</span>
                {qw.count > 1 && <> · {money(qw.total_amount_cents)} at this stage in total</>}
              </p>
            </div>
          </div>
          <button
            onClick={() => setStageFilter('step4')}
            className="flex-shrink-0 rounded-lg bg-[#F59E0B] px-4 py-2.5 text-xs font-semibold text-[#0A0A0B] transition-colors hover:bg-[#D97706]"
          >
            Show these invoices
          </button>
        </div>
      )}

      {/* ── COLLECTION FUNNEL ───────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between border-b border-[#1F1F23] px-5 py-4">
          <div>
            <h2 className={tokens.type.cardTitle}>Collection Funnel</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">
              Where every invoice sits in the chase sequence — click a stage to filter
            </p>
          </div>
          {stageFilter && (
            <button
              onClick={() => setStageFilter(null)}
              className="rounded-full border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-2.5 py-1 text-[11px] font-medium text-[#7C3AED]"
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
                  tick={{ fill: '#A1A1AA', fontSize: 12 }}
                />
                <Tooltip content={<FunnelTooltip />} cursor={{ fill: '#17171A' }} />
                <Bar
                  dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false}
                  background={{ fill: '#17171A', radius: 4 } as any}
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

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#1F1F23] pt-3">
            <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
              <span className="h-2 w-2 rounded-full bg-[#10B981]" /> Paid
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" /> Chase in progress
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
              <span className="h-2 w-2 rounded-full bg-[#EF4444]" /> Final step
            </span>
            <span className="flex items-center gap-1.5 text-xs text-[#71717A]">
              <span className="h-2 w-2 rounded-full bg-[#71717A]" /> Sent, not chased
            </span>
          </div>
        </div>
      </Card>

      {/* ── INVOICE LIST ────────────────────────────────────────────────── */}
      <Card>
        <div className="border-b border-[#1F1F23] px-5 py-4">
          <h2 className={tokens.type.cardTitle}>Invoices</h2>
          <p className="mt-0.5 text-xs text-[#71717A]">
            {visible.length} invoice{visible.length === 1 ? '' : 's'} · most overdue first
            {stageFilter && ` · ${data.funnel.find((f: any) => f.key === stageFilter)?.label} only`}
          </p>
        </div>

        {actionError && (
          <p className="border-b border-[#1F1F23] px-5 py-3 text-xs text-[#EF4444]">{actionError}</p>
        )}

        <div className="divide-y divide-[#1F1F23]">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileText className="h-6 w-6 text-[#3F3F46]" />
              <p className="text-sm text-[#71717A]">No invoices at this stage.</p>
            </div>
          ) : (
            visible.map((inv) => {
              const isBusy = busyId === inv.id;
              return (
                <div key={inv.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <p className="truncate text-sm font-medium text-[#F4F4F5]">
                        {inv.customer_name || 'Unknown customer'}
                      </p>
                      {inv.is_paid && (
                        <span className="rounded-full border border-[#10B981]/20 bg-[#10B981]/10 px-2 py-0.5 text-[11px] font-medium text-[#10B981]">
                          Paid
                        </span>
                      )}
                      {inv.is_paused && (
                        <span className="rounded-full border border-[#71717A]/30 bg-[#71717A]/10 px-2 py-0.5 text-[11px] font-medium text-[#A1A1AA]">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {!inv.is_paid && inv.days_overdue > 0 && (
                        <span className="text-xs font-medium text-[#EF4444]">
                          {inv.days_overdue} days overdue
                        </span>
                      )}
                      {!inv.is_paid && <ChaseDots step={inv.chase_step} />}
                      <span className="text-xs text-[#71717A]">
                        Last action: {timeAgo(inv.last_chase_at)}
                      </span>
                    </div>
                  </div>

                  <p className="text-2xl font-bold tracking-tight text-[#F4F4F5] sm:w-32 sm:text-right">
                    {money(inv.amount_cents)}
                  </p>

                  {!inv.is_paid && (
                    <div className="flex flex-shrink-0 gap-2">
                      <button
                        onClick={() => act(inv.id, inv.is_paused ? 'resume' : 'pause')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F1F23] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#1F1F23] disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : inv.is_paused ? <Play className="h-3.5 w-3.5" />
                          : <Pause className="h-3.5 w-3.5" />}
                        {inv.is_paused ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        onClick={() => act(inv.id, 'mark_paid')}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
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
