'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Phone, PhoneCall, PhoneMissed, Clock, ChevronDown, ChevronUp,
  AlertTriangle, FileText, User, CheckCircle2, Smile,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';
import { CallCenterStatus } from '@/components/dashboard/CallCenterStatus';

type Outcome = 'resolved' | 'escalated' | 'missed';

const OUTCOME_COLOR: Record<Outcome, string> = {
  resolved: '#10B981',
  escalated: '#F59E0B',
  missed: '#EF4444',
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  resolved: 'Resolved',
  escalated: 'Escalated',
  missed: 'Missed',
};

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#1F1F23] bg-[#111113] ${className}`}>{children}</div>
  );
}

function timeAgo(iso: string) {
  if (!iso) return '';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDuration(sec: number | null) {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// The stored summary can run long — the log shows only its first 2 sentences.
function twoSentences(text: string) {
  if (!text) return 'No summary available for this call.';
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return text;
  return parts.slice(0, 2).join(' ').trim();
}

// "Caller mentioned billing dispute" instead of a raw field value.
function plainReason(reason: string | null) {
  if (!reason) return 'Escalated to a human — no reason recorded.';
  const cleaned = String(reason).trim().replace(/^escalation_reason:\s*/i, '');
  const lowered = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  return `Caller mentioned ${lowered}`;
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const color = OUTCOME_COLOR[outcome];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: `${color}33`, backgroundColor: `${color}1A` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function DayTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const total = row.resolved + row.escalated;
  return (
    <div className="rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2">
      <p className="text-xs font-medium text-[#F4F4F5]">
        {label}: {total} call{total === 1 ? '' : 's'}
      </p>
      <p className="mt-0.5 text-[11px] text-[#10B981]">{row.resolved} resolved</p>
      {row.escalated > 0 && (
        <p className="text-[11px] text-[#F59E0B]">{row.escalated} escalated</p>
      )}
    </div>
  );
}

export default function CallsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/call-center/analyze');

      // A stale dev server or a bad path returns Next's HTML error page, which
      // would otherwise surface as "Unexpected token '<'". Check before parsing.
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          `The calls service returned ${res.status} instead of data. Try restarting the dev server.`,
        );
      }

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

  const calls: any[] = data?.calls || [];
  const escalatedCalls: any[] = data?.escalated_calls || [];

  const donutData = useMemo(() => {
    const o = data?.outcomes;
    if (!o) return [] as any[];
    return ([
      { key: 'resolved', name: 'Resolved', value: o.resolved },
      { key: 'escalated', name: 'Escalated', value: o.escalated },
      { key: 'missed', name: 'Missed', value: o.missed },
    ] as any[]).filter((d) => d.value > 0);
  }, [data]);

  const visibleCalls = useMemo(
    () => (outcomeFilter ? calls.filter((c) => c.outcome === outcomeFilter) : calls),
    [calls, outcomeFilter],
  );

  if (loading) {
    return (
      <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
          <div className="h-80 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <Card>
          <div className="p-6">
            <p className="text-sm text-[#EF4444]">Couldn&apos;t load calls — {error}</p>
          </div>
        </Card>
      </div>
    );
  }

  const s = data.summary;
  const avgDuration = formatDuration(s.avg_duration_sec);

  // Resolution rate, sentiment and escalations, computed from the rows already
  // loaded rather than a second request.
  const resolvedCount = data.outcomes?.resolved ?? 0;
  const escalatedCount = data.outcomes?.escalated ?? 0;
  const resolutionRate = s.total_calls > 0
    ? Math.round((resolvedCount / s.total_calls) * 100)
    : null;

  const sentimentScores = calls
    .map((c: any) => Number(c.sentiment_score))
    .filter((n: number) => Number.isFinite(n));
  const avgSentiment = sentimentScores.length > 0
    ? Math.round(sentimentScores.reduce((a: number, b: number) => a + b, 0) / sentimentScores.length)
    : null;
  const sentimentColor = avgSentiment == null
    ? 'text-[#3F3F46]'
    : avgSentiment >= 70 ? 'text-[#10B981]'
    : avgSentiment >= 40 ? 'text-[#F59E0B]'
    : 'text-[#EF4444]';

  // ── No calls recorded yet ────────────────────────────────────────────────
  if (s.total_calls === 0) {
    return (
      <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">
        <CallCenterStatus />
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#7C3AED]/15">
              <Phone className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F4F4F5]">
                No calls yet — your AI receptionist is ready to answer
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                Every call it handles will appear here with a summary, outcome, and
                sentiment score.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">

      {/* ── PROVIDER STATUS + LATEST CALLS ──────────────────────────────── */}
      <CallCenterStatus />

      {/* ── TOP ROW ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Total Calls</p>
            <Phone className="h-4 w-4 text-[#71717A]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} text-[#F4F4F5]`}>{s.total_calls}</p>
          <p className="mt-2 text-xs text-[#71717A]">Last 7 days</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Resolution Rate</p>
            <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${resolutionRate == null ? 'text-[#3F3F46]' : 'text-[#10B981]'}`}>
            {resolutionRate == null ? 'N/A' : `${resolutionRate}%`}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {resolutionRate == null ? 'No calls yet' : `${resolvedCount} resolved without a human`}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Avg Sentiment</p>
            <Smile className="h-4 w-4 text-[#71717A]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${sentimentColor}`}>
            {avgSentiment == null ? 'N/A' : avgSentiment}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {avgSentiment == null ? 'No sentiment scored yet' : 'Out of 100, across scored calls'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Escalations</p>
            <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${escalatedCount > 0 ? 'text-[#F59E0B]' : 'text-[#F4F4F5]'}`}>
            {escalatedCount}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {escalatedCount === 0 ? 'Nothing needed a human' : 'Handed to a human'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Demos Booked</p>
            <PhoneCall className="h-4 w-4 text-[#10B981]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} text-[#10B981]`}>{s.demos_booked}</p>
          <p className="mt-2 text-xs text-[#71717A]">From booked appointments</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Missed Calls</p>
            <PhoneMissed className="h-4 w-4 text-[#EF4444]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${s.missed_calls > 0 ? 'text-[#EF4444]' : 'text-[#F4F4F5]'}`}>
            {s.missed_calls}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {s.missed_calls === 0 ? 'Nothing slipped through' : 'Needs follow-up'}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className={tokens.type.metricLabel}>Avg Duration</p>
            <Clock className="h-4 w-4 text-[#71717A]" />
          </div>
          <p className={`mt-3 ${tokens.type.metric} ${avgDuration ? 'text-[#F4F4F5]' : 'text-[#3F3F46]'}`}>
            {avgDuration ?? '—'}
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {avgDuration ? 'Average call length' : 'Not tracked yet'}
          </p>
        </Card>
      </div>

      {/* ── CHARTS ROW ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* LEFT — donut */}
        <Card>
          <div className="border-b border-[#1F1F23] px-5 py-4">
            <h2 className={tokens.type.cardTitle}>Call Outcomes</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">Click a segment to filter the log below</p>
          </div>
          <div className="p-5">
            {donutData.length === 0 ? (
              <div className="flex h-[220px] flex-col items-center justify-center gap-2">
                <Phone className="h-6 w-6 text-[#3F3F46]" />
                <p className="text-sm text-[#71717A]">No calls yet</p>
              </div>
            ) : (
              <div className="relative" style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={3}
                      stroke="none"
                      isAnimationActive={false}
                      className="cursor-pointer focus:outline-none"
                      onClick={(entry: any) => {
                        const key = entry?.payload?.key ?? entry?.key;
                        if (key) setOutcomeFilter(key as Outcome);
                      }}
                    >
                      {donutData.map((d) => (
                        <Cell key={d.key} fill={OUTCOME_COLOR[d.key as Outcome]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tracking-tight text-[#F4F4F5]">
                    {s.total_calls}
                  </span>
                  <span className="text-[11px] font-medium text-[#71717A]">total calls</span>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2 border-t border-[#1F1F23] pt-4">
              {(['resolved', 'escalated', 'missed'] as Outcome[]).map((key) => {
                const value = data.outcomes[key];
                return (
                  <button
                    key={key}
                    onClick={() => setOutcomeFilter(value > 0 ? key : null)}
                    disabled={value === 0}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                      value > 0 ? 'hover:bg-[#17171A]' : 'opacity-40'
                    } ${outcomeFilter === key ? 'bg-[#17171A]' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: OUTCOME_COLOR[key] }}
                      />
                      <span className="text-sm text-[#A1A1AA]">{OUTCOME_LABEL[key]}</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums text-[#F4F4F5]">{value}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* RIGHT — stacked bars by day */}
        <Card>
          <div className="border-b border-[#1F1F23] px-5 py-4">
            <h2 className={tokens.type.cardTitle}>Calls by Day</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">Last 7 days, stacked by outcome</p>
          </div>
          <div className="p-5">
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={data.by_day} margin={{ top: 8, right: 8, bottom: 4, left: -22 }}>
                  <CartesianGrid stroke="#1F1F23" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day" tickLine={false} axisLine={false}
                    tick={{ fill: '#71717A', fontSize: 11 }}
                  />
                  <YAxis
                    allowDecimals={false} tickLine={false} axisLine={false}
                    tick={{ fill: '#71717A', fontSize: 11 }}
                  />
                  <Tooltip content={<DayTooltip />} cursor={{ fill: '#17171A' }} />
                  <Bar dataKey="resolved" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="escalated" stackId="a" fill="#F59E0B" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center gap-4 border-t border-[#1F1F23] pt-3">
              <span className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                <span className="h-2 w-2 rounded-sm bg-[#10B981]" /> Resolved
              </span>
              <span className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                <span className="h-2 w-2 rounded-sm bg-[#F59E0B]" /> Escalated
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── ESCALATION ALERTS ───────────────────────────────────────────── */}
      {escalatedCalls.length > 0 && (
        <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.07]">
          <div className="flex items-center gap-2.5 border-b border-[#F59E0B]/20 px-5 py-4">
            <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
            <h2 className="text-sm font-semibold text-[#F59E0B]">
              {escalatedCalls.length} call{escalatedCalls.length === 1 ? '' : 's'} need your attention
            </h2>
          </div>
          <div className="space-y-3 p-5">
            {escalatedCalls.map((c) => (
              <div key={c.id} className="rounded-lg border border-[#F59E0B]/25 bg-[#17171A] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[#F4F4F5]">
                    {c.caller_number || 'Unknown caller'}
                  </p>
                  <span className="text-xs text-[#71717A]">{timeAgo(c.created_at)}</span>
                </div>
                <p className="mt-1.5 text-sm text-[#F59E0B]">{plainReason(c.escalation_reason)}</p>
                <p className={`mt-2 ${tokens.type.body}`}>{twoSentences(c.summary)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CALL LOG ────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between border-b border-[#1F1F23] px-5 py-4">
          <div>
            <h2 className={tokens.type.cardTitle}>Call Log</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">
              {visibleCalls.length} call{visibleCalls.length === 1 ? '' : 's'}
              {outcomeFilter ? ` · ${OUTCOME_LABEL[outcomeFilter]} only` : ''}
            </p>
          </div>
          {outcomeFilter && (
            <button
              onClick={() => setOutcomeFilter(null)}
              className="rounded-full border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-2.5 py-1 text-[11px] font-medium text-[#7C3AED]"
            >
              Clear filter ✕
            </button>
          )}
        </div>

        <div className="divide-y divide-[#1F1F23]">
          {visibleCalls.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Phone className="h-6 w-6 text-[#3F3F46]" />
              <p className="text-sm text-[#71717A]">No calls to show.</p>
            </div>
          ) : (
            visibleCalls.map((c) => {
              const isOpen = expanded === c.id;
              const duration = formatDuration(c.duration_sec);
              return (
                <div key={c.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#17171A]"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#17171A]">
                      <User className="h-4 w-4 text-[#71717A]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#F4F4F5]">
                        {c.caller_number || 'Unknown caller'}
                      </p>
                      <p className="text-xs capitalize text-[#71717A]">{c.direction || 'inbound'}</p>
                    </div>

                    {duration && (
                      <span className="hidden flex-shrink-0 rounded-md border border-[#1F1F23] bg-[#17171A] px-2 py-0.5 text-[11px] font-medium text-[#A1A1AA] sm:inline">
                        {duration}
                      </span>
                    )}

                    <OutcomeBadge outcome={c.outcome} />

                    <span className="hidden w-20 flex-shrink-0 text-right text-xs text-[#71717A] sm:inline">
                      {timeAgo(c.created_at)}
                    </span>

                    {isOpen
                      ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-[#71717A]" />
                      : <ChevronDown className="h-4 w-4 flex-shrink-0 text-[#71717A]" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#1F1F23] bg-[#0D0D0F] px-5 py-4">
                      <p className={tokens.type.metricLabel}>What happened</p>
                      <p className={`mt-2 ${tokens.type.body}`}>{twoSentences(c.summary)}</p>

                      <button
                        onClick={() => setShowTranscript(showTranscript === c.id ? null : c.id)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] transition-colors hover:text-[#A78BFA]"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {showTranscript === c.id ? 'Hide full transcript' : 'View full transcript →'}
                      </button>

                      {showTranscript === c.id && (
                        <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#1F1F23] bg-[#111113] p-3 font-sans text-xs leading-relaxed text-[#A1A1AA]">
                          {c.transcript || 'No transcript recorded.'}
                        </pre>
                      )}
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
