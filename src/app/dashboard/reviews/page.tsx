'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Star, Check, Pencil, RefreshCw, ChevronDown, ChevronUp, ArrowLeft,
  TrendingUp, AlertTriangle, MessageSquare, Loader2,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';
import { ResponseCard } from '@/components/dashboard/ResponseCard';

type Sentiment = 'praise' | 'neutral' | 'complaint';

const PLATFORMS = ['Google', 'Yelp', 'G2', 'Capterra'];

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  praise: '#10B981',
  neutral: '#71717A',
  complaint: '#EF4444',
};

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  praise: 'Praise',
  neutral: 'Neutral',
  complaint: 'Complaint',
};

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < Math.round(rating) ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-[#3F3F46]'
          }`}
        />
      ))}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#1F1F23] bg-[#111113] ${className}`}>{children}</div>
  );
}

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2">
      <p className="text-xs font-medium text-[#F4F4F5]">
        {label}: {row.your_rating ?? '—'} stars, {row.review_count} review
        {row.review_count === 1 ? '' : 's'}
      </p>
      <p className="mt-0.5 text-[11px] text-[#71717A]">
        Industry average: {row.industry_average}
      </p>
    </div>
  );
}

export default function ReviewsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | null>(null);
  const [platformTab, setPlatformTab] = useState<string>('Google');
  const [themeFilter, setThemeFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/reputation/analyze');
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

  const reviews: any[] = data?.reviews || [];
  const trendData = data?.sentiment_over_time;

  const donutData = useMemo(() => {
    const b = data?.sentiment_breakdown;
    if (!b) return [] as any[];
    return ([
      { key: 'praise', name: 'Praise', value: b.praise },
      { key: 'neutral', name: 'Neutral', value: b.neutral },
      { key: 'complaint', name: 'Complaint', value: b.complaint },
    ] as any[]).filter((d) => d.value > 0);
  }, [data]);

  // Drill-down panel: reviews of the clicked sentiment.
  const sentimentReviews = useMemo(
    () => (sentimentFilter ? reviews.filter((r) => r.sentiment === sentimentFilter) : []),
    [reviews, sentimentFilter],
  );

  // Queue: filtered by platform tab, then optionally by complaint theme.
  const queueReviews = useMemo(() => {
    let list = reviews.filter(
      (r) => (r.platform || '').toLowerCase() === platformTab.toLowerCase(),
    );
    if (themeFilter) list = list.filter((r) => r.complaint_theme === themeFilter);
    return list;
  }, [reviews, platformTab, themeFilter]);

  const patchReview = async (id: string, action: 'approve' | 'save', response_text?: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, response_text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData((prev: any) => ({
        ...prev,
        reviews: prev.reviews.map((r: any) =>
          r.id === id
            ? {
                ...r,
                responded: json.review?.responded ?? r.responded,
                response_text: json.review?.response_text ?? r.response_text,
              }
            : r,
        ),
      }));
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const regenerate = async (review: any) => {
    setBusyId(review.id);
    setActionError(null);
    try {
      const res = await fetch('/api/agents/reputation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: data.client_id,
          review_id: review.id,
          review_text: review.review_text,
          star_rating: review.star_rating,
          platform: review.platform,
          reviewer_name: review.reviewer_name,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData((prev: any) => ({
        ...prev,
        reviews: prev.reviews.map((r: any) =>
          r.id === review.id
            ? { ...r, response_text: json.response ?? json.response_text ?? r.response_text }
            : r,
        ),
      }));
    } catch (err: any) {
      setActionError(err?.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-80 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113] lg:col-span-7" />
          <div className="h-80 animate-pulse rounded-xl border border-[#1F1F23] bg-[#111113] lg:col-span-5" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <Card>
          <div className="p-6">
            <p className="text-sm text-[#EF4444]">Couldn&apos;t load reviews — {error}</p>
          </div>
        </Card>
      </div>
    );
  }

  const s = data.summary;

  // ── No reviews collected yet ─────────────────────────────────────────────
  if (data.is_empty) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] p-6">
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#7C3AED]/15">
              <Star className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F4F4F5]">
                No reviews yet. Your agents will monitor and respond automatically.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                As reviews come in across Google, Yelp, G2 and Capterra, they land here
                with sentiment, themes, and a drafted reply.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#0A0A0B] p-6">

      {/* ── TOP ROW ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className={tokens.type.metricLabel}>Average Rating</p>
          <p className={`mt-3 ${tokens.type.metric} text-[#F4F4F5]`}>{s.avg_rating}</p>
          <div className="mt-2 flex items-center gap-2">
            <Stars rating={s.avg_rating} />
            <span className="text-xs text-[#71717A]">{s.total_reviews} reviews</span>
          </div>
        </Card>

        <Card className="p-5">
          <p className={tokens.type.metricLabel}>Response Rate</p>
          <p className={`mt-3 ${tokens.type.metric} ${s.response_rate >= 80 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
            {s.response_rate}%
          </p>
          <p className="mt-2 text-xs text-[#71717A]">
            {s.responded} of {s.total_reviews} answered
          </p>
        </Card>

        <Card className="p-5">
          <p className={tokens.type.metricLabel}>Top Complaint</p>
          <p className="mt-3 flex items-start gap-1.5 text-sm font-semibold leading-snug text-[#EF4444]">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="line-clamp-2">{s.top_complaint || 'No complaints yet'}</span>
          </p>
          <p className="mt-2 text-xs text-[#71717A]">Most common reason for low scores</p>
        </Card>

        <Card className="p-5">
          <p className={tokens.type.metricLabel}>Predicted Improvement</p>
          <p className={`mt-3 ${tokens.type.metric} text-[#10B981]`}>+{s.predicted_improvement}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-[#71717A]">
            <TrendingUp className="h-3.5 w-3.5 flex-shrink-0 text-[#10B981]" />
            stars if the top complaint is fixed
          </p>
        </Card>
      </div>

      {/* ── MAIN SPLIT ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        {/* LEFT 55% — trend, or sentiment drill-down */}
        <Card className="lg:col-span-7">
          {!sentimentFilter ? (
            <>
              <div className="border-b border-[#1F1F23] px-5 py-4">
                <h2 className={tokens.type.cardTitle}>Sentiment Over Time</h2>
                <p className="mt-0.5 text-xs text-[#71717A]">
                  Your rating vs industry average, last 12 weeks
                </p>
                {!data.trend_has_history && (
                  <p className="mt-2 inline-block rounded-md border border-[#1F1F23] bg-[#17171A] px-2 py-1 text-[11px] font-medium text-[#A1A1AA]">
                    Not enough history yet — the trend fills in as reviews arrive
                  </p>
                )}
              </div>
              <div className="p-5">
                <div style={{ width: '100%', height: 268 }}>
                  <ResponsiveContainer>
                    <LineChart data={trendData} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                      <CartesianGrid stroke="#1F1F23" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="week" tickLine={false} axisLine={false}
                        tick={{ fill: '#71717A', fontSize: 11 }} interval="preserveStartEnd"
                      />
                      <YAxis
                        domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tickLine={false} axisLine={false}
                        tick={{ fill: '#71717A', fontSize: 11 }}
                      />
                      <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#3F3F46' }} />
                      <Line
                        type="monotone" dataKey="industry_average" name="Industry Average"
                        stroke="#71717A" strokeWidth={2} strokeDasharray="4 4" dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone" dataKey="your_rating" name="Your Rating"
                        stroke="#10B981" strokeWidth={2.5}
                        dot={{ r: 3, fill: '#10B981', strokeWidth: 0 }}
                        activeDot={{ r: 5 }} connectNulls
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex items-center gap-4 border-t border-[#1F1F23] pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                    <span className="h-0.5 w-4 rounded bg-[#10B981]" /> Your Rating
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                    <span className="h-0.5 w-4 rounded bg-[#71717A]" /> Industry Average
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-[#1F1F23] px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: SENTIMENT_COLOR[sentimentFilter] }}
                  />
                  <h2 className={tokens.type.cardTitle}>
                    {SENTIMENT_LABEL[sentimentFilter]} reviews ({sentimentReviews.length})
                  </h2>
                </div>
                <button
                  onClick={() => setSentimentFilter(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F1F23] px-2.5 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#17171A]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to trend
                </button>
              </div>
              <div className="max-h-[330px] space-y-3 overflow-y-auto p-5">
                {sentimentReviews.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#71717A]">No reviews in this group.</p>
                ) : (
                  sentimentReviews.map((r) => (
                    <div key={r.id} className="rounded-lg border border-[#1F1F23] bg-[#17171A] p-4">
                      <div className="flex items-center gap-2">
                        <Stars rating={r.star_rating} />
                        <span className="text-xs text-[#71717A]">{r.platform}</span>
                      </div>
                      <p className={`mt-2 ${tokens.type.body}`}>{r.review_text}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </Card>

        {/* RIGHT 45% — donut */}
        <Card className="lg:col-span-5">
          <div className="border-b border-[#1F1F23] px-5 py-4">
            <h2 className={tokens.type.cardTitle}>What customers say</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">Click a segment to see those reviews</p>
          </div>
          <div className="p-5">
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
                      if (key) setSentimentFilter(key as Sentiment);
                    }}
                  >
                    {donutData.map((d) => (
                      <Cell key={d.key} fill={SENTIMENT_COLOR[d.key as Sentiment]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold tracking-tight text-[#F4F4F5]">{s.avg_rating}</span>
                <span className="text-[11px] font-medium text-[#71717A]">overall</span>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-[#1F1F23] pt-4">
              {(['praise', 'neutral', 'complaint'] as Sentiment[]).map((key) => {
                const b = data.sentiment_breakdown;
                const value = b[key];
                return (
                  <button
                    key={key}
                    onClick={() => setSentimentFilter(value > 0 ? key : null)}
                    disabled={value === 0}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors ${
                      value > 0 ? 'hover:bg-[#17171A]' : 'opacity-40'
                    } ${sentimentFilter === key ? 'bg-[#17171A]' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: SENTIMENT_COLOR[key] }}
                      />
                      <span className="text-sm text-[#A1A1AA]">{SENTIMENT_LABEL[key]}</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums text-[#F4F4F5]">
                      {b[`${key}_pct`]}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* ── QUEUE + COMPLAINT INTELLIGENCE ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">

        <Card className="lg:col-span-8">
          <div className="border-b border-[#1F1F23] px-5 pt-4">
            <div className="flex items-center justify-between">
              <h2 className={tokens.type.cardTitle}>Review Queue</h2>
              {themeFilter && (
                <button
                  onClick={() => setThemeFilter(null)}
                  className="rounded-full border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-2.5 py-1 text-[11px] font-medium text-[#7C3AED]"
                >
                  {themeFilter} ✕
                </button>
              )}
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {PLATFORMS.map((p) => {
                const count = data.platforms?.find((x: any) => x.name === p)?.count ?? 0;
                const active = platformTab === p;
                return (
                  <button
                    key={p}
                    onClick={() => setPlatformTab(p)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'border-[#7C3AED] text-[#F4F4F5]'
                        : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
                    }`}
                  >
                    {p} <span className="ml-1 text-xs text-[#52525B]">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 p-5">
            {actionError && <p className="text-xs text-[#EF4444]">{actionError}</p>}

            {queueReviews.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <MessageSquare className="h-6 w-6 text-[#3F3F46]" />
                <p className="text-sm text-[#71717A]">
                  No {platformTab} reviews{themeFilter ? ' with this theme' : ''} yet.
                </p>
              </div>
            ) : (
              queueReviews.map((r) => {
                const isOpen = expanded === r.id;
                const isBusy = busyId === r.id;
                return (
                  <div key={r.id} className="rounded-lg border border-[#1F1F23] bg-[#17171A]">
                    <div className="p-4">
                      <div className="flex items-center gap-2.5">
                        <span className="rounded-md border border-[#1F1F23] bg-[#111113] px-2 py-0.5 text-[11px] font-medium text-[#A1A1AA]">
                          {r.platform}
                        </span>
                        <Stars rating={r.star_rating} />
                        {r.responded && (
                          <span className="ml-auto rounded-full border border-[#10B981]/20 bg-[#10B981]/10 px-2 py-0.5 text-[11px] font-medium text-[#10B981]">
                            Responded
                          </span>
                        )}
                      </div>
                      <p className={`mt-2.5 ${tokens.type.body}`}>{r.review_text}</p>

                      <button
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] transition-colors hover:text-[#A78BFA]"
                      >
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {isOpen ? 'Hide' : 'View'} AI-drafted response
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[#1F1F23] p-4">
                        {editingId === r.id ? (
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={5}
                            className="w-full resize-none rounded-lg border border-[#1F1F23] bg-[#111113] px-3 py-2.5 text-sm text-[#F4F4F5] focus:border-[#7C3AED] focus:outline-none"
                          />
                        ) : (
                          <ResponseCard text={r.response_text} />
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {editingId === r.id ? (
                            <>
                              <button
                                onClick={async () => {
                                  await patchReview(r.id, 'save', editText);
                                  setEditingId(null);
                                }}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded-lg border border-[#1F1F23] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#1F1F23]"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => patchReview(r.id, 'approve')}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#059669] disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(r.id);
                                  setEditText(r.response_text || '');
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F1F23] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#1F1F23]"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Edit
                              </button>
                              <button
                                onClick={() => regenerate(r)}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:opacity-50"
                              >
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Regenerate
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Complaint Intelligence */}
        <Card className="h-fit lg:col-span-4">
          <div className="border-b border-[#1F1F23] px-5 py-4">
            <h2 className={tokens.type.cardTitle}>Complaint Intelligence</h2>
            <p className="mt-0.5 text-xs text-[#71717A]">Click a theme to filter the queue</p>
          </div>
          <div className="p-5">
            {(!data.complaint_themes || data.complaint_themes.length === 0) ? (
              <p className="py-8 text-center text-sm text-[#71717A]">No complaint themes found.</p>
            ) : (
              <div className="space-y-2">
                {data.complaint_themes.map((t: any, i: number) => {
                  const active = themeFilter === t.theme;
                  const max = data.complaint_themes[0].count || 1;
                  return (
                    <button
                      key={t.theme}
                      onClick={() => setThemeFilter(active ? null : t.theme)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-[#7C3AED]/40 bg-[#7C3AED]/10'
                          : 'border-[#1F1F23] bg-[#17171A] hover:border-[#3F3F46]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 text-[11px] font-bold text-[#52525B]">#{i + 1}</span>
                          <span className="line-clamp-2 text-xs text-[#A1A1AA]">{t.theme}</span>
                        </span>
                        <span className="flex-shrink-0 text-xs font-bold tabular-nums text-[#EF4444]">
                          {t.count}
                        </span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1F1F23]">
                        <div
                          className="h-full rounded-full bg-[#EF4444]"
                          style={{ width: `${(t.count / max) * 100}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
