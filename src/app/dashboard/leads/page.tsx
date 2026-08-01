'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Search, X, Plus, Flame, Ban,
  Building2, User, Clock, Save, SlidersHorizontal, CheckSquare,
  BarChart2, TrendingUp, Send, Users, Target,
} from 'lucide-react';

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

const SENIORITY_LEVELS = ['C-Suite', 'VP', 'Director', 'Manager', 'Individual Contributor'];

const LEAD_STATUSES = [
  { value: 'all',            label: 'All Statuses'    },
  { value: 'pending',        label: 'Pending'         },
  { value: 'emailed',        label: 'Emailed'         },
  { value: 'replied',        label: 'Replied'         },
  { value: 'hot',            label: 'Hot'             },
  { value: 'do_not_contact', label: 'Do Not Contact'  },
];

const STATUS_STYLES: Record<string, string> = {
  pending:         'bg-slate-500/15 text-slate-400 border-slate-500/25',
  emailed:         'bg-blue-500/15 text-blue-400 border-blue-500/25',
  replied:         'bg-violet-500/15 text-violet-400 border-violet-500/25',
  hot:             'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  do_not_contact:  'bg-red-500/15 text-red-400 border-red-500/25',
};

// ─── Types ─────────────────────────────────────────────────────────────────────

interface IcpConfig {
  titles: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  industries: string;
  seniority: string[];
  dailyEmailLimit: number;
  configured: boolean;
}

interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  bos_lead_score: number;
  status: string;
  company_context: string | null;
  last_contacted_at: string | null;
  created_at: string;
}

interface Stats {
  total_leads: number;
  emails_sent_this_month: number;
  contacted: number;
  replied: number;
  reply_rate: number | null;
  hot_leads: number;
  daily_sent: number;
  daily_limit: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getReplyRateColor(r: number) {
  return r > 5 ? 'text-emerald-400' : r >= 2 ? 'text-amber-400' : 'text-red-400';
}
function getScoreColor(s: number) {
  return s >= 70 ? 'bg-amber-400' : s >= 50 ? 'bg-emerald-400' : 'bg-[#2563EB]';
}

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group select-none">
      <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
        checked ? 'bg-[#2563EB] border-[#2563EB]' : 'border-slate-600 group-hover:border-slate-500 bg-slate-800'
      }`}>
        {checked && <CheckSquare className="w-3.5 h-3.5 text-white" />}
      </div>
      <span className="text-sm text-slate-300 group-hover:text-slate-200">{label}</span>
    </label>
  );
}

// A metric with no underlying activity renders a dash, never a zero that could
// be mistaken for a measured result.
function Stat({
  icon: Icon, label, value, hasData, valueClass = 'text-white',
}: {
  icon: React.ElementType; label: string; value: string; hasData: boolean; valueClass?: string;
}) {
  return (
    <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-4">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        <Icon className="w-4 h-4" />
        <h3 className="text-xs font-medium uppercase tracking-wider">{label}</h3>
      </div>
      <p className={`text-2xl font-semibold ${hasData ? valueClass : 'text-slate-600'}`}>
        {hasData ? value : '—'}
      </p>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HunterLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ICP
  const [icpOpen, setIcpOpen] = useState(false);
  const [icp, setIcp] = useState<IcpConfig | null>(null);
  const [savingIcp, setSavingIcp] = useState(false);
  const [icpError, setIcpError] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [page, setPage] = useState(0);

  // Drawer
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/leads');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setLeads(json.leads || []);
      setStats(json.stats);
      setIcp(json.icp);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtered + paginated leads
  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.company.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (minScore && l.bos_lead_score < parseInt(minScore)) return false;
      if (maxScore && l.bos_lead_score > parseInt(maxScore)) return false;
      return true;
    });
  }, [leads, search, statusFilter, minScore, maxScore]);

  const totalLeads = filtered.length;
  const pageLeads = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSaveConfig = async () => {
    if (!icp) return;
    setSavingIcp(true);
    setIcpError(null);
    try {
      const res = await fetch('/api/agents/hunter/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titles: icp.titles,
          company_size_min: icp.companySizeMin,
          company_size_max: icp.companySizeMax,
          industries: icp.industries,
          seniority: icp.seniority,
          daily_email_limit: icp.dailyEmailLimit,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setIcp((p) => (p ? { ...p, configured: true } : p));
      setIcpOpen(false);
      load();
    } catch (err: any) {
      setIcpError(err?.message || String(err));
    } finally {
      setSavingIcp(false);
    }
  };

  const addTitle = () => {
    const t = titleInput.trim();
    if (t && icp && !icp.titles.includes(t)) setIcp((p) => (p ? { ...p, titles: [...p.titles, t] } : p));
    setTitleInput('');
  };

  const removeTitle = (t: string) =>
    setIcp((p) => (p ? { ...p, titles: p.titles.filter((x) => x !== t) } : p));

  const toggleSeniority = (level: string) => setIcp((p) => p ? ({
    ...p,
    seniority: p.seniority.includes(level)
      ? p.seniority.filter((x) => x !== level)
      : [...p.seniority, level],
  }) : p);

  const updateLeadStatus = async (id: string, st: string) => {
    const previous = leads;
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, status: st } : l));
    if (selectedLead?.id === id) setSelectedLead((prev) => prev ? { ...prev, status: st } : prev);
    try {
      const res = await fetch(`/api/dashboard/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: st }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Roll back so the table never shows a status the database rejected.
      setLeads(previous);
      setSelectedLead((prev) => prev ? previous.find((l) => l.id === prev.id) ?? prev : prev);
    }
  };

  const handleApplyFilters = () => setPage(0);

  const icpPanel = icpOpen && icp && (
    <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-5 shadow-xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Job titles to target</label>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTitle()}
                placeholder="e.g. CTO, VP Engineering..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button onClick={addTitle} className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {icp.titles.map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#2563EB]/20 text-blue-300 border border-blue-500/20 text-xs font-medium">
                  {t}
                  <button onClick={() => removeTitle(t)} className="text-blue-400 hover:text-blue-200"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {icp.titles.length === 0 && <span className="text-xs text-slate-500 italic">No job titles specified.</span>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Company Size</label>
            <div className="flex items-center gap-4">
              <input
                type="number" min="1" placeholder="Min"
                value={icp.companySizeMin ?? ''}
                onChange={(e) => setIcp((p) => p ? ({ ...p, companySizeMin: e.target.value === '' ? null : parseInt(e.target.value) }) : p)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <span className="text-slate-500">to</span>
              <input
                type="number" min="2" placeholder="Max"
                value={icp.companySizeMax ?? ''}
                onChange={(e) => setIcp((p) => p ? ({ ...p, companySizeMax: e.target.value === '' ? null : parseInt(e.target.value) }) : p)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">employees</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Industries (comma separated)</label>
            <input
              type="text"
              value={icp.industries}
              placeholder="e.g. SaaS, Technology, Marketing"
              onChange={(e) => setIcp((p) => p ? ({ ...p, industries: e.target.value }) : p)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">Seniority levels</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SENIORITY_LEVELS.map((lvl) => (
                <Checkbox key={lvl} label={lvl} checked={icp.seniority.includes(lvl)} onChange={() => toggleSeniority(lvl)} />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">Daily email volume limit</label>
              <span className="text-sm font-bold text-white bg-slate-800 px-2.5 py-1 rounded-md">{icp.dailyEmailLimit}</span>
            </div>
            <input
              type="range" min="10" max="100" step="5"
              value={icp.dailyEmailLimit}
              onChange={(e) => setIcp((p) => p ? ({ ...p, dailyEmailLimit: parseInt(e.target.value) }) : p)}
              className="w-full accent-blue-500 bg-slate-800 h-2 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>10 (Cautious)</span>
              <span>100 (Aggressive)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-slate-700/50 flex items-center justify-end gap-4">
        {icpError && <p className="text-xs text-red-400">{icpError}</p>}
        <button
          onClick={handleSaveConfig}
          disabled={savingIcp}
          className="flex items-center gap-2 bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {savingIcp
            ? <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            : <Save className="w-4 h-4" />}
          Save Configuration
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6 bg-[#0F172A] min-h-full">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-[#0F172A] min-h-full">
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load leads — {error}</p>
        </div>
      </div>
    );
  }

  // ── No leads found yet ───────────────────────────────────────────────────
  if (leads.length === 0) {
    return (
      <div className="p-6 bg-[#0F172A] min-h-full space-y-6 text-slate-200">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Hunter Dashboard</h1>
          <button
            onClick={() => setIcpOpen(!icpOpen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              icpOpen
                ? 'bg-[#2563EB] text-white border-blue-600 shadow-lg shadow-blue-500/20'
                : 'bg-[#1E293B] text-slate-300 border-slate-700/50 hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Configure target ICP
          </button>
        </div>

        {icpPanel}

        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50">
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2563EB]/15">
              <Target className="h-7 w-7 text-[#2563EB]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                No leads yet. Configure your ICP to start finding prospects.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Once your ideal customer profile is set, the Hunter agent sources,
                enriches, and scores prospects here automatically.
              </p>
            </div>
            {!icpOpen && (
              <button
                onClick={() => setIcpOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Configure target ICP
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex relative overflow-hidden bg-[#0F172A] text-slate-200">

      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${selectedLead ? 'mr-96' : ''}`}>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Hunter Dashboard</h1>
            <button
              onClick={() => setIcpOpen(!icpOpen)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                icpOpen
                  ? 'bg-[#2563EB] text-white border-blue-600 shadow-lg shadow-blue-500/20'
                  : 'bg-[#1E293B] text-slate-300 border-slate-700/50 hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Configure target ICP
            </button>
          </div>

          {/* Stats Bar */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat
                icon={Users} label="Total leads"
                value={stats.total_leads.toLocaleString()}
                hasData={stats.total_leads > 0}
              />
              <Stat
                icon={Send} label="Emails sent (mo)"
                value={stats.emails_sent_this_month.toLocaleString()}
                hasData={stats.emails_sent_this_month > 0}
              />
              <Stat
                icon={BarChart2} label="Contacted"
                value={stats.contacted.toLocaleString()}
                hasData={stats.contacted > 0}
              />
              <Stat
                icon={TrendingUp} label="Reply Rate"
                value={stats.reply_rate !== null ? `${stats.reply_rate}%` : ''}
                hasData={stats.reply_rate !== null}
                valueClass={stats.reply_rate !== null ? getReplyRateColor(stats.reply_rate) : ''}
              />

              <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-4 flex flex-col justify-center">
                <div className="flex items-end justify-between mb-2">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Clock className="w-4 h-4" />
                    <h3 className="text-xs font-medium uppercase tracking-wider">Daily Limit</h3>
                  </div>
                  <span className="text-xs font-mono text-slate-300">{stats.daily_sent}/{stats.daily_limit}</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${Math.min(100, (stats.daily_sent / Math.max(1, stats.daily_limit)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {icpPanel}

          {/* Leads Table */}
          <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 flex flex-col">

            {/* Filters */}
            <div className="p-4 border-b border-slate-700/50 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name or company..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none text-slate-300 min-w-[140px]"
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                <span className="text-xs text-slate-500">Score</span>
                <input
                  type="number" placeholder="Min" value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                  className="w-12 bg-transparent text-sm text-slate-300 outline-none text-center"
                />
                <span className="text-slate-600">-</span>
                <input
                  type="number" placeholder="Max" value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  className="w-12 bg-transparent text-sm text-slate-300 outline-none text-center"
                />
              </div>

              <button
                onClick={handleApplyFilters}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Apply Filters
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#0F172A]/50 border-b border-slate-700/50 text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-md">
                  <tr>
                    <th className="px-5 py-4 w-1/4">Name & Email</th>
                    <th className="px-5 py-4 w-1/5">Company</th>
                    <th className="px-5 py-4 w-[120px]">Score</th>
                    <th className="px-5 py-4 w-[140px]">Status</th>
                    <th className="px-5 py-4 w-[140px]">Last Contact</th>
                    <th className="px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/30">
                  {pageLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-slate-500">
                        <Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                        <p>No leads found matching your criteria.</p>
                      </td>
                    </tr>
                  ) : pageLeads.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className={`hover:bg-slate-800/40 cursor-pointer transition-colors group ${
                        selectedLead?.id === lead.id
                          ? 'bg-[#2563EB]/10 border-l-2 border-[#2563EB]'
                          : 'border-l-2 border-transparent'
                      }`}
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium text-white">{lead.name}</p>
                        <p className="text-xs text-slate-500 truncate">{lead.email || '—'}</p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-sm text-slate-300">{lead.company || '—'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium w-6 text-slate-300">{lead.bos_lead_score}</span>
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getScoreColor(lead.bos_lead_score)}`}
                              style={{ width: `${lead.bos_lead_score}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border capitalize ${STATUS_STYLES[lead.status] ?? STATUS_STYLES.pending}`}>
                          {lead.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-400">{timeAgo(lead.last_contacted_at)}</td>
                      <td className="px-5 py-3 text-right">
                        <button className="opacity-0 group-hover:opacity-100 text-[#2563EB] hover:text-blue-400 text-sm font-medium transition-all mr-2">
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-5 py-3 border-t border-slate-700/50 bg-[#0F172A]/30 flex items-center justify-between text-sm text-slate-400">
              <p>
                Showing {totalLeads > 0 ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, totalLeads)} of {totalLeads} leads
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= totalLeads}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Lead Drawer */}
      <div className={`fixed inset-y-0 pt-16 right-0 w-96 bg-[#0F172A] border-l border-slate-700/80 shadow-2xl transform transition-transform duration-300 ease-out z-20 flex flex-col ${
        selectedLead ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {selectedLead && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/80 bg-[#1E293B]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 border border-slate-600/50 flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-white font-semibold text-base leading-tight">{selectedLead.name}</h2>
                  <p className="text-xs text-slate-400">{selectedLead.email || 'No email on file'}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">

              {/* Status + quick actions */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-700/50">
                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${STATUS_STYLES[selectedLead.status] ?? STATUS_STYLES.pending}`}>
                  {selectedLead.status.replace(/_/g, ' ')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateLeadStatus(selectedLead.id, 'hot')}
                    className="p-1.5 text-amber-500 hover:bg-amber-500/10 rounded-md border border-amber-500/20 transition"
                    title="Mark as Hot"
                  >
                    <Flame className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updateLeadStatus(selectedLead.id, 'do_not_contact')}
                    className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-md border border-red-500/20 transition"
                    title="Do not contact"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white">Lead Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Company</p>
                    <div className="flex items-center gap-1.5 text-slate-200">
                      <Building2 className="w-4 h-4 text-slate-400" />
                      {selectedLead.company || '—'}
                    </div>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Score</p>
                    <p className="text-slate-200 font-mono font-medium">{selectedLead.bos_lead_score}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Added</p>
                    <p className="text-slate-200">{timeAgo(selectedLead.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Last contacted</p>
                    <p className="text-slate-200">{timeAgo(selectedLead.last_contacted_at)}</p>
                  </div>
                </div>
              </div>

              {/* Enrichment */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Enrichment Data</h3>
                <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-3 text-sm text-slate-400 leading-relaxed font-mono whitespace-pre-wrap">
                  {selectedLead.company_context ?? 'Not enriched yet — the enrichment agent will fill this in.'}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
