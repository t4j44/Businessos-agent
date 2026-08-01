'use client';

import { useState } from 'react';
import {
  Play,
  Loader2,
  CheckCircle2,
  Building2,
  Phone,
  Star,
  Receipt,
  BarChart3,
} from 'lucide-react';

type AgentState = {
  loading: boolean;
  error: string | null;
  data: any | null;
};

type AgentConfig = {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  icon: React.ElementType;
  render: (data: any) => React.ReactNode;
};

const DEFAULT_STATE: AgentState = { loading: false, error: null, data: null };

// ─── Per-agent result renderers ────────────────────────────────────────────

function BrandScoutResult({ data }: { data: any }) {
  const brand = data.brand_profile || {};
  const products = Array.isArray(brand.products_json) ? brand.products_json.slice(0, 3) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-white font-semibold text-base">{brand.company_name || 'Unknown company'}</p>
        {data.saved_to_db && (
          <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved to DB
          </span>
        )}
      </div>
      {brand.value_proposition && (
        <p className="text-slate-400 text-sm leading-relaxed">{brand.value_proposition}</p>
      )}
      {products.length > 0 && (
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1.5">Products</p>
          <ul className="space-y-1">
            {products.map((p: any, i: number) => (
              <li key={i} className="text-slate-300 text-sm">
                <span className="font-medium">{p.name}</span>
                {p.description && <span className="text-slate-500"> — {p.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CallCenterResult({ data }: { data: any }) {
  const script: string = data.mode_a_script?.script || '';
  const analysis = data.mode_b_analysis || {};

  return (
    <div className="space-y-4">
      <div>
        <p className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1.5">
          Call Script (preview)
        </p>
        <p className="text-slate-300 text-sm whitespace-pre-line leading-relaxed">
          {script.slice(0, 300)}
          {script.length > 300 ? '…' : ''}
        </p>
      </div>
      <div className="pt-3 border-t border-slate-700/40">
        <p className="text-slate-500 text-xs uppercase tracking-wide font-medium mb-1.5">
          Sample Call Analysis
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-[#2563EB]/20 text-[#2563EB]">
            Sentiment: {analysis.sentiment_score ?? '—'}/100
          </span>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              analysis.resolved ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'
            }`}
          >
            {analysis.resolved ? 'Resolved' : 'Not Resolved'}
          </span>
          {analysis.escalated && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-600/20 text-amber-400">
              Escalated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReputationResult({ data }: { data: any }) {
  const positive = data.positive_review || {};
  const negative = data.negative_review || {};

  return (
    <div className="space-y-4">
      <div>
        <p className="text-emerald-400 text-xs uppercase tracking-wide font-medium mb-1.5">
          Response to 5★ Review
        </p>
        <p className="text-slate-300 text-sm leading-relaxed">{positive.response_text}</p>
      </div>
      <div className="pt-3 border-t border-slate-700/40">
        <p className="text-red-400 text-xs uppercase tracking-wide font-medium mb-1.5">
          Response to 2★ Review
        </p>
        <p className="text-slate-300 text-sm leading-relaxed">{negative.response_text}</p>
        {negative.complaint_theme && (
          <p className="text-slate-500 text-xs mt-1.5">Complaint theme: {negative.complaint_theme}</p>
        )}
      </div>
    </div>
  );
}

function InvoiceChaseResult({ data }: { data: any }) {
  const messages = Array.isArray(data.messages) ? data.messages : [];

  return (
    <ol className="space-y-3">
      {messages.map((m: any, i: number) => (
        <li key={i} className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700/60 text-slate-300 text-xs font-bold flex items-center justify-center">
            {m.step ?? i + 1}
          </span>
          <div className="min-w-0">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[#2563EB]/20 text-[#2563EB] uppercase">
              {m.channel}
            </span>
            <p className="text-slate-300 text-sm mt-1 whitespace-pre-line leading-relaxed">{m.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function BiReporterResult({ data }: { data: any }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium px-2 py-1 rounded-full bg-[#2563EB]/20 text-[#2563EB]">
          WARE Score: {data.ware_score}
        </span>
        <span
          className={`text-xs font-medium px-2 py-1 rounded-full ${
            data.has_negative_section ? 'bg-red-600/20 text-red-400' : 'bg-emerald-600/20 text-emerald-400'
          }`}
        >
          {data.has_negative_section ? 'Flags issues' : 'No issues flagged'}
        </span>
      </div>
      <div className="bg-white rounded-lg p-5">
        <div className="brief-content" dangerouslySetInnerHTML={{ __html: data.brief_html }} />
      </div>
    </div>
  );
}

// ─── Agent registry ─────────────────────────────────────────────────────────

const AGENTS: AgentConfig[] = [
  {
    id: 'brand-scout',
    name: 'Brand Scout',
    description: "Extracts brand DNA — tone, products, FAQs — from a client's website.",
    endpoint: '/api/agents/brand-scout/test',
    icon: Building2,
    render: (data) => <BrandScoutResult data={data} />,
  },
  {
    id: 'call-center',
    name: 'Call Center Bot',
    description: 'Generates a phone-handling script and analyzes call transcripts.',
    endpoint: '/api/agents/call-center/test',
    icon: Phone,
    render: (data) => <CallCenterResult data={data} />,
  },
  {
    id: 'reputation',
    name: 'Reputation Intelligence',
    description: 'Drafts on-brand responses to reviews and flags complaint themes.',
    endpoint: '/api/agents/reputation/test',
    icon: Star,
    render: (data) => <ReputationResult data={data} />,
  },
  {
    id: 'invoice-chase',
    name: 'Invoice Chase',
    description: 'Generates the 5-step overdue-invoice message sequence.',
    endpoint: '/api/agents/invoice-chase/test',
    icon: Receipt,
    render: (data) => <InvoiceChaseResult data={data} />,
  },
  {
    id: 'bi-reporter',
    name: 'BI Reporter',
    description: 'Writes the honest weekly Monday Brief — no spin, ever.',
    endpoint: '/api/agents/bi-reporter/test',
    icon: BarChart3,
    render: (data) => <BiReporterResult data={data} />,
  },
];

// ─── Card shell ──────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  state,
  onRun,
}: {
  agent: AgentConfig;
  state: AgentState;
  onRun: () => void;
}) {
  const Icon = agent.icon;

  return (
    <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 flex flex-col">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-700/50">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#2563EB]/15 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-sm">{agent.name}</h2>
            <p className="text-slate-500 text-xs mt-0.5">{agent.description}</p>
          </div>
        </div>
        <button
          onClick={onRun}
          disabled={state.loading}
          className="flex-shrink-0 flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#2563EB] hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-400 rounded-lg transition-colors"
        >
          {state.loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" /> Run Test
            </>
          )}
        </button>
      </div>

      <div className="p-5">
        {state.loading && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-[#2563EB]" />
            <p className="text-xs">Calling the agent — this can take 10–40s…</p>
          </div>
        )}

        {!state.loading && state.error && <p className="text-red-400 text-sm">{state.error}</p>}

        {!state.loading && !state.error && state.data && agent.render(state.data)}

        {!state.loading && !state.error && !state.data && (
          <p className="text-slate-600 text-sm">No result yet — click &quot;Run Test&quot;.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentLabPage() {
  const [results, setResults] = useState<Record<string, AgentState>>({});

  const handleRun = async (agent: AgentConfig) => {
    setResults((prev) => ({ ...prev, [agent.id]: { loading: true, error: null, data: null } }));
    try {
      const res = await fetch(agent.endpoint);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
      }
      setResults((prev) => ({ ...prev, [agent.id]: { loading: false, error: null, data: json } }));
    } catch (err: any) {
      setResults((prev) => ({
        ...prev,
        [agent.id]: { loading: false, error: err?.message || String(err), data: null },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Agent Lab</h1>
          <p className="text-slate-400 text-sm mt-1">
            Run all 5 Business OS agents against their test endpoints, right from this page.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {AGENTS.map((agent) => (
            <div key={agent.id} className={agent.id === 'bi-reporter' ? 'lg:col-span-2' : ''}>
              <AgentCard
                agent={agent}
                state={results[agent.id] ?? DEFAULT_STATE}
                onRun={() => handleRun(agent)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
