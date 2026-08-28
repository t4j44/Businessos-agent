'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Phone, Star, Receipt, BarChart3, ListChecks,
  Crosshair, Eye, Target, Radio, Moon, Loader2, AlertTriangle,
} from 'lucide-react';

// The three Hunter pipeline steps, each with its own run button and state.
const HUNTER_TESTS = [
  {
    id: 'hunter',
    label: 'Generate Test',
    endpoint: '/api/agents/hunter/generate/test',
    description: 'Writes a cold email sequence for a fixed sample lead',
  },
  {
    id: 'hunter-prospect',
    label: 'Prospect Test',
    endpoint: '/api/agents/hunter/prospect/test',
    description: 'Searches Google Places for "dental clinics in Austin TX" (costs ~$0.001)',
  },
  {
    id: 'hunter-enrich',
    label: 'Enrich Test',
    endpoint: '/api/agents/hunter/enrich/test',
    description: 'Enriches the first stored lead (website scrape + DNS + ICP score)',
  },
];

// Agent test dashboard.
//
// Every tab calls the agent's own /test route, which runs the real agent
// against the test client. These cost real money and several of them write to
// Supabase, so the destructive ones carry a warning.

// ── Tabs ───────────────────────────────────────────────────────────────────
type TabId =
  | 'brand-scout' | 'call-center' | 'reputation' | 'invoice-chase' | 'bi-reporter'
  | 'run-all' | 'hunter' | 'market' | 'audience' | 'trends' | 'nightwatch';

type Tab = {
  id: TabId;
  label: string;
  icon: React.ElementType;
  endpoint?: string;
};

const TABS: Tab[] = [
  { id: 'brand-scout',   label: 'Brand Scout',            icon: Building2,  endpoint: '/api/agents/brand-scout/test' },
  { id: 'call-center',   label: 'Call Center',            icon: Phone,      endpoint: '/api/agents/call-center/test' },
  { id: 'reputation',    label: 'Reputation',             icon: Star,       endpoint: '/api/agents/reputation/test' },
  { id: 'invoice-chase', label: 'Invoice Chase',          icon: Receipt,    endpoint: '/api/agents/invoice-chase/test' },
  { id: 'bi-reporter',   label: 'BI Reporter',            icon: BarChart3,  endpoint: '/api/agents/bi-reporter/test' },
  { id: 'run-all',       label: 'Run All Tests',          icon: ListChecks },
  { id: 'hunter',        label: 'Hunter',                 icon: Target },
  { id: 'market',        label: 'Market Intelligence',    icon: Crosshair,  endpoint: '/api/agents/intelligence/market/test' },
  { id: 'audience',      label: 'Audience Intelligence',  icon: Eye,        endpoint: '/api/agents/intelligence/audience/test' },
  { id: 'trends',        label: 'Trend Radar',            icon: Radio,      endpoint: '/api/agents/intelligence/trends/test' },
  { id: 'nightwatch',    label: 'Nightwatch',             icon: Moon,       endpoint: '/api/agents/nightwatch/test' },
];

// ── Run-all suite ──────────────────────────────────────────────────────────
// 1-5 run sequentially to stay under provider rate limits; 6-9 are independent
// and run together; Nightwatch runs last because it invokes three agents of
// its own.
const SEQUENTIAL = [
  { id: 'brand-scout',   name: 'Brand Scout',           endpoint: '/api/agents/brand-scout/test' },
  { id: 'call-center',   name: 'Call Center Bot',       endpoint: '/api/agents/call-center/test' },
  { id: 'reputation',    name: 'Reputation Intelligence', endpoint: '/api/agents/reputation/test' },
  { id: 'invoice-chase', name: 'Invoice Chase',         endpoint: '/api/agents/invoice-chase/test' },
  { id: 'bi-reporter',   name: 'BI Reporter',           endpoint: '/api/agents/bi-reporter/test' },
];

const PARALLEL = [
  { id: 'hunter',   name: 'Hunter',                 endpoint: '/api/agents/hunter/generate/test' },
  { id: 'market',   name: 'Market Intelligence',    endpoint: '/api/agents/intelligence/market/test' },
  { id: 'audience', name: 'Audience Intelligence',  endpoint: '/api/agents/intelligence/audience/test' },
  { id: 'trends',   name: 'Trend Radar',            endpoint: '/api/agents/intelligence/trends/test' },
];

const NIGHTWATCH = { id: 'nightwatch', name: 'Nightwatch', endpoint: '/api/agents/nightwatch/test' };

// Roughly how often each agent runs on its default schedule, for the monthly
// projection in the footer. Nightwatch already covers the three intelligence
// agents, so they are not counted again.
const RUNS_PER_MONTH: Record<string, number> = {
  'brand-scout': 1,
  'call-center': 300,
  reputation: 30,
  'invoice-chase': 30,
  'bi-reporter': 4,
  hunter: 100,
  market: 0,
  audience: 0,
  trends: 0,
  nightwatch: 30,
};

type RunState = {
  status: 'idle' | 'running' | 'pass' | 'fail';
  data?: any;
  error?: string;
  cost?: number;
  ms?: number;
};

const money = (v: number | undefined) => {
  const n = Number(v) || 0;
  return n < 1 ? '$' + n.toFixed(4) : '$' + n.toFixed(2);
};

// ── Shared bits ────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-[#1F1F23] bg-[#111113] ${className}`}>{children}</div>
  );
}

function Dot({ label, ok }: { label: string; ok: boolean | undefined }) {
  const color = ok === undefined ? 'bg-[#52525B]' : ok ? 'bg-[#10B981]' : 'bg-[#EF4444]';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#71717A]" title={
      ok === undefined ? 'Checking…' : ok ? 'Configured' : 'Missing'
    }>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#F59E0B]/25 bg-[#F59E0B]/10 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#F59E0B]" />
      <p className="text-sm text-[#F59E0B]">{text}</p>
    </div>
  );
}

function Verdict({ pass }: { pass: boolean }) {
  return (
    <span className={
      'rounded-full border px-2 py-0.5 text-xs font-medium ' +
      (pass
        ? 'border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981]'
        : 'border-[#EF4444]/20 bg-[#EF4444]/10 text-[#EF4444]')
    }>
      {pass ? 'PASS' : 'FAIL'}
    </span>
  );
}

function List({ title, items }: { title: string; items: any[] | undefined }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-[#71717A]">{title}</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-[#A1A1AA]">
        {items.map((it, i) => (
          <li key={i}>{typeof it === 'string' ? it : JSON.stringify(it)}</li>
        ))}
      </ul>
    </div>
  );
}

const field =
  'w-full rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2 text-sm text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#7C3AED]/50 focus:outline-none';

function RunButton({
  onClick, running, label, danger = false,
}: { onClick: () => void; running: boolean; label: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className={
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ' +
        (danger ? 'bg-[#B45309] hover:bg-[#92400E]' : 'bg-[#7C3AED] hover:bg-[#6D28D9]')
      }
    >
      {running && <Loader2 className="h-4 w-4 animate-spin" />}
      {running ? 'Running…' : label}
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function TestDashboard() {
  const [tab, setTab] = useState<TabId>('brand-scout');
  const [env, setEnv] = useState<Record<string, boolean> | null>(null);
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  // Inputs are shown so the fixtures are visible; the /test routes carry their
  // own fixed payloads, so editing these does not change what is sent.
  const [marketIndustry, setMarketIndustry] = useState('SaaS CRM');
  const [marketCompetitors, setMarketCompetitors] = useState('hubspot.com, salesforce.com');
  const [icp, setIcp] = useState('dental clinic owners in the US');
  const [trendIndustry, setTrendIndustry] = useState('dental');

  const [includeNightwatch, setIncludeNightwatch] = useState(false);
  const [suiteRunning, setSuiteRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/test/env-check');
        setEnv(await res.json());
      } catch {
        setEnv({});
      }
    })();
  }, []);

  const runOne = useCallback(async (id: string, endpoint: string): Promise<RunState> => {
    const startedAt = Date.now();
    setRuns((p) => ({ ...p, [id]: { status: 'running' } }));

    try {
      const res = await fetch(endpoint);
      const data = await res.json().catch(() => ({}));
      const ms = Date.now() - startedAt;
      const cost = Number(data?.cost_usd ?? data?.total_cost_usd) || 0;

      const state: RunState = {
        status: res.ok && data?.error == null ? 'pass' : 'fail',
        data,
        error: data?.error,
        cost,
        ms,
      };
      setRuns((p) => ({ ...p, [id]: state }));
      return state;
    } catch (err: any) {
      const state: RunState = {
        status: 'fail',
        error: err?.message || String(err),
        ms: Date.now() - startedAt,
        cost: 0,
      };
      setRuns((p) => ({ ...p, [id]: state }));
      return state;
    }
  }, []);

  const runAll = async () => {
    setSuiteRunning(true);
    try {
      // 1-5, one at a time.
      for (const a of SEQUENTIAL) await runOne(a.id, a.endpoint);
      // 6-9 together.
      await Promise.all(PARALLEL.map((a) => runOne(a.id, a.endpoint)));
      // 10 last, and only on request.
      if (includeNightwatch) await runOne(NIGHTWATCH.id, NIGHTWATCH.endpoint);
    } finally {
      setSuiteRunning(false);
    }
  };

  const suite = [...SEQUENTIAL, ...PARALLEL, ...(includeNightwatch ? [NIGHTWATCH] : [])];
  const done = suite.filter((a) => runs[a.id]?.status === 'pass' || runs[a.id]?.status === 'fail');
  const passed = suite.filter((a) => runs[a.id]?.status === 'pass').length;
  const totalCost = done.reduce((sum, a) => sum + (runs[a.id]?.cost || 0), 0);
  const monthly = done.reduce(
    (sum, a) => sum + (runs[a.id]?.cost || 0) * (RUNS_PER_MONTH[a.id] ?? 0),
    0,
  );

  const state = (id: string) => runs[id] || { status: 'idle' as const };
  const activeTab = TABS.find((t) => t.id === tab)!;

  // ── Result renderers ─────────────────────────────────────────────────
  const renderGeneric = (id: string) => {
    const s = state(id);
    if (s.status === 'idle') return null;
    if (s.status === 'running') return <p className="text-sm text-[#A1A1AA]">Running…</p>;
    return (
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Verdict pass={s.status === 'pass'} />
          <span className="text-xs text-[#71717A]">{money(s.cost)} · {s.ms}ms</span>
        </div>
        {s.error && <p className="mb-2 text-sm text-[#EF4444]">{s.error}</p>}
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-[#71717A]">
          {JSON.stringify(s.data, null, 2)}
        </pre>
      </Card>
    );
  };

  const renderMarket = () => {
    const s = state('market');
    const d = s.data;
    if (s.status === 'idle' || s.status === 'running') return renderGeneric('market');

    const level = Number(d?.threat_level);
    const pass = Number.isFinite(level) && level >= 1 && level <= 10;

    return (
      <div className="space-y-3">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Verdict pass={pass} />
            <span className="text-xs text-[#71717A]">
              {d?.competitors_analysed ?? 0} competitors · {d?.sites_read ?? 0} sites read · {money(d?.cost_usd)}
            </span>
          </div>
          {s.error && <p className="text-sm text-[#EF4444]">{s.error}</p>}

          {pass && (
            <div className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wider text-[#71717A]">
                Threat level {level}/10
              </p>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#1F1F23]">
                <div
                  className={
                    'h-full rounded-full ' +
                    (level >= 8 ? 'bg-[#EF4444]' : level >= 5 ? 'bg-[#F59E0B]' : 'bg-[#10B981]')
                  }
                  style={{ width: `${level * 10}%` }}
                />
              </div>
            </div>
          )}

          {d?.summary && <p className="text-sm text-[#A1A1AA]">{d.summary}</p>}
        </Card>

        <Card className="space-y-3 p-4">
          <List
            title="Key competitor moves"
            items={(d?.key_competitor_moves || []).map(
              (m: any) => `${m.competitor}: ${m.move} — ${m.implication}`,
            )}
          />
          <List title="Market opportunities" items={d?.market_opportunities} />
        </Card>
      </div>
    );
  };

  const renderAudience = () => {
    const s = state('audience');
    const d = s.data;
    if (s.status === 'idle' || s.status === 'running') return renderGeneric('audience');

    const pains = Array.isArray(d?.top_pain_points) ? d.top_pain_points : [];
    const pass = pains.length >= 1;

    return (
      <div className="space-y-3">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Verdict pass={pass} />
            <span className="text-xs text-[#71717A]">
              {d?.reddit_posts_found ?? 0} reddit posts · {d?.rag_chunks_stored ?? 0} RAG chunks stored · {money(d?.cost_usd)}
            </span>
          </div>
          {s.error && <p className="text-sm text-[#EF4444]">{s.error}</p>}

          {pains.length > 0 && (
            <div className="space-y-2">
              {pains.map((p: any, i: number) => (
                <div key={i} className="rounded-lg border border-[#1F1F23] bg-[#17171A] p-3">
                  <p className="text-sm font-medium text-[#F4F4F5]">{p.pain}</p>
                  {p.exact_quote && (
                    <p className="mt-1 text-sm italic text-[#A1A1AA]">&ldquo;{p.exact_quote}&rdquo;</p>
                  )}
                  <p className="mt-1 text-xs text-[#71717A]">
                    {[p.emotion, p.frequency].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <List title="Buying triggers" items={d?.buying_triggers} />
          <List
            title="Objections"
            items={(d?.objections || []).map((o: any) => `${o.objection} (fear: ${o.underlying_fear})`)}
          />
        </Card>
      </div>
    );
  };

  const renderTrends = () => {
    const s = state('trends');
    const d = s.data;
    if (s.status === 'idle' || s.status === 'running') return renderGeneric('trends');

    const trends = Array.isArray(d?.trends) ? d.trends : null;
    const pass = trends !== null;
    const postToday = Number(d?.post_today_count) || 0;

    return (
      <div className="space-y-3">
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Verdict pass={pass} />
            <span className="text-xs text-[#71717A]">
              {d?.reddit_posts_scanned ?? 0} posts scanned · {money(d?.cost_usd)}
            </span>
            <span className={
              'rounded-full border px-2 py-0.5 text-xs font-medium ' +
              (postToday > 0
                ? 'border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981]'
                : 'border-[#2A2A30] bg-[#52525B]/10 text-[#71717A]')
            }>
              {postToday} to post today
            </span>
          </div>
          {s.error && <p className="text-sm text-[#EF4444]">{s.error}</p>}
          {d?.top_opportunity && <p className="text-sm text-[#A1A1AA]">{d.top_opportunity}</p>}
        </Card>

        {trends && trends.length > 0 && (
          <Card className="space-y-2 p-4">
            {trends.map((t: any, i: number) => (
              <div key={i} className="rounded-lg border border-[#1F1F23] bg-[#17171A] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[#F4F4F5]">{t.topic}</span>
                  <span className={
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium ' +
                    (t.urgency === 'post today'
                      ? 'border-[#EF4444]/20 bg-[#EF4444]/10 text-[#EF4444]'
                      : t.urgency === 'this week'
                        ? 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]'
                        : 'border-[#2A2A30] bg-[#52525B]/10 text-[#71717A]')
                  }>
                    {t.urgency}
                  </span>
                </div>
                {t.suggested_hook && (
                  <p className="mt-1 text-sm text-[#A1A1AA]">{t.suggested_hook}</p>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>
    );
  };

  const renderNightwatch = () => {
    const s = state('nightwatch');
    const d = s.data;
    if (s.status === 'idle' || s.status === 'running') return renderGeneric('nightwatch');

    const score = Number(d?.intelligence_score);
    const cost = Number(d?.total_cost_usd) || 0;
    const pass = Number.isFinite(score) && cost < 0.75;

    return (
      <div className="space-y-3">
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Verdict pass={pass} />
            <span className="text-xs text-[#71717A]">
              {d?.agents_run ?? 0} agents · {money(cost)} · score {Number.isFinite(score) ? score : 'n/a'}/100
              {d?.week_start ? ` · week of ${d.week_start}` : ''}
            </span>
          </div>
          {s.error && <p className="text-sm text-[#EF4444]">{s.error}</p>}
          {d?.executive_summary && <p className="text-sm text-[#A1A1AA]">{d.executive_summary}</p>}
          {d?.priority_alert && (
            <p className="mt-2 rounded-lg border border-[#EF4444]/25 bg-[#EF4444]/10 px-3 py-2 text-sm text-[#EF4444]">
              Priority alert: {d.priority_alert}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Competitor moves', d?.competitor_moves?.length ?? 0],
              ['Audience insights', d?.audience_insights?.length ?? 0],
              ['Trend opportunities', d?.trend_opportunities?.length ?? 0],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <p className="text-2xl font-semibold text-[#F4F4F5]">{String(n)}</p>
                <p className="mt-0.5 text-xs text-[#71717A]">{label}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] p-6">
      <div className="mx-auto max-w-4xl space-y-5">

        {/* Header + key status */}
        <div>
          <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-[#F4F4F5]">
            Agent Test Dashboard
          </h1>
          <p className="mt-1 text-sm text-[#71717A]">
            Each test runs the real agent against the test client and costs real money.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Dot label="OPENROUTER" ok={env?.openrouter} />
            <Dot label="VOYAGE" ok={env?.voyage} />
            <Dot label="BRAVE" ok={env?.brave} />
            <Dot label="BLAND" ok={env?.bland} />
            <Dot label="STRIPE" ok={env?.stripe} />
            <Dot label="RESEND" ok={env?.resend} />
          </div>
        </div>

        {/* Mobile: dropdown. Desktop: scrolling tab bar. */}
        <div className="sm:hidden">
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value as TabId)}
            aria-label="Select test"
            className={field}
          >
            {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        <div className="hidden overflow-x-auto border-b border-[#1F1F23] sm:block">
          <div className="flex min-w-max gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={
                    '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ' +
                    (active
                      ? 'border-[#7C3AED] text-[#F4F4F5]'
                      : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]')
                  }
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Core agent tabs (1-5) ───────────────────────────────────── */}
        {['brand-scout', 'call-center', 'reputation', 'invoice-chase', 'bi-reporter'].includes(tab) && (
          <div className="space-y-3">
            <RunButton
              onClick={() => runOne(tab, activeTab.endpoint!)}
              running={state(tab).status === 'running'}
              label={`Run ${activeTab.label}`}
            />
            {renderGeneric(tab)}
          </div>
        )}

        {/* ── TAB 6 — Run all ─────────────────────────────────────────── */}
        {tab === 'run-all' && (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-[#A1A1AA]">
              <input
                type="checkbox"
                checked={includeNightwatch}
                onChange={(e) => setIncludeNightwatch(e.target.checked)}
                className="h-4 w-4 accent-[#7C3AED]"
              />
              Include Nightwatch (expensive ~$0.30)
            </label>

            <RunButton
              onClick={runAll}
              running={suiteRunning}
              label={`Run All Agent Tests (${suite.length})`}
            />

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#1F1F23] text-xs uppercase tracking-wider text-[#71717A]">
                      <th className="px-4 py-2.5 font-medium">Agent</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Cost</th>
                      <th className="px-4 py-2.5 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suite.map((a) => {
                      const s = state(a.id);
                      return (
                        <tr key={a.id} className="border-b border-[#1F1F23] last:border-0">
                          <td className="px-4 py-2.5 text-[#F4F4F5]">{a.name}</td>
                          <td className="px-4 py-2.5">
                            {s.status === 'idle' && <span className="text-xs text-[#52525B]">—</span>}
                            {s.status === 'running' && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-[#F59E0B]">
                                <Loader2 className="h-3 w-3 animate-spin" /> running
                              </span>
                            )}
                            {(s.status === 'pass' || s.status === 'fail') && (
                              <Verdict pass={s.status === 'pass'} />
                            )}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-[#A1A1AA]">
                            {s.cost != null ? money(s.cost) : '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-[#71717A]">
                            {s.ms != null ? `${s.ms}ms` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-[#1F1F23] px-4 py-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#71717A]">Total cost</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">{money(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#71717A]">Pass rate</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">
                    {passed}/{done.length || suite.length} passed
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-[#71717A]">Est. monthly</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#F4F4F5]">{money(monthly)}</p>
                  <p className="mt-0.5 text-[11px] text-[#52525B]">At default schedules</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ── Hunter — prospect → enrich → generate ───────────────────── */}
        {tab === 'hunter' && (
          <div className="space-y-3">
            <Warning text="Prospect and Enrich both write real rows to the leads table on every run." />
            {HUNTER_TESTS.map((t) => (
              <Card key={t.id} className="space-y-3 p-4">
                <div>
                  <p className="text-sm font-semibold text-[#F4F4F5]">{t.label}</p>
                  <p className="mt-0.5 text-sm text-[#71717A]">{t.description}</p>
                </div>
                <RunButton
                  onClick={() => runOne(t.id, t.endpoint)}
                  running={state(t.id).status === 'running'}
                  label={`Run ${t.label}`}
                />
                {renderGeneric(t.id)}
              </Card>
            ))}
          </div>
        )}

        {/* ── TAB 7 — Market Intelligence ─────────────────────────────── */}
        {tab === 'market' && (
          <div className="space-y-3">
            <Card className="space-y-3 p-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#71717A]">Industry</span>
                <input className={field} value={marketIndustry} onChange={(e) => setMarketIndustry(e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#71717A]">Competitors (comma-separated)</span>
                <input className={field} value={marketCompetitors} onChange={(e) => setMarketCompetitors(e.target.value)} />
              </label>
              <p className="text-xs text-[#52525B]">
                The test route sends its own fixed payload, so these show the fixture rather than change it.
              </p>
            </Card>
            <RunButton
              onClick={() => runOne('market', '/api/agents/intelligence/market/test')}
              running={state('market').status === 'running'}
              label="Run Market Intelligence"
            />
            {renderMarket()}
          </div>
        )}

        {/* ── TAB 8 — Audience Intelligence ───────────────────────────── */}
        {tab === 'audience' && (
          <div className="space-y-3">
            <Warning text="This writes real RAG chunks to Supabase on every run" />
            <Card className="space-y-3 p-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#71717A]">ICP description</span>
                <input className={field} value={icp} onChange={(e) => setIcp(e.target.value)} />
              </label>
              <p className="text-xs text-[#52525B]">
                The test route sends its own fixed payload, so this shows the fixture rather than change it.
              </p>
            </Card>
            <RunButton
              onClick={() => runOne('audience', '/api/agents/intelligence/audience/test')}
              running={state('audience').status === 'running'}
              label="Run Audience Intelligence"
            />
            {renderAudience()}
          </div>
        )}

        {/* ── TAB 9 — Trend Radar ─────────────────────────────────────── */}
        {tab === 'trends' && (
          <div className="space-y-3">
            <Warning text="This writes trend opportunities to your approvals queue on every run" />
            <Card className="space-y-3 p-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#71717A]">Industry</span>
                <input className={field} value={trendIndustry} onChange={(e) => setTrendIndustry(e.target.value)} />
              </label>
              <p className="text-xs text-[#52525B]">
                The test route sends its own fixed payload, so this shows the fixture rather than change it.
              </p>
            </Card>
            <RunButton
              onClick={() => runOne('trends', '/api/agents/intelligence/trends/test')}
              running={state('trends').status === 'running'}
              label="Run Trend Radar"
            />
            {renderTrends()}
          </div>
        )}

        {/* ── TAB 10 — Nightwatch ─────────────────────────────────────── */}
        {tab === 'nightwatch' && (
          <div className="space-y-3">
            <Warning text="Nightwatch runs all 3 intelligence agents + synthesis. Most expensive test (~$0.30). Only run when needed." />
            <RunButton
              onClick={() => runOne('nightwatch', '/api/agents/nightwatch/test')}
              running={state('nightwatch').status === 'running'}
              label="Run Nightwatch Test"
              danger
            />
            {renderNightwatch()}
          </div>
        )}
      </div>
    </div>
  );
}
