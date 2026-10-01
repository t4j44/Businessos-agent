'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Calendar, Eye, Heart, MessageCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { PlatformIcon, platformTint, platformLabel } from '@/components/dashboard/PlatformIcon';
import { Spinner, ErrorMessage, SuccessMessage, postJSON } from '@/components/dashboard/AgentState';
import { normalizeStatus, relativeTime, AGENTS } from '@/lib/agent-catalog';
import { StatusPill } from '@/components/dashboard/StatusPill';
import { MetricCard } from '@/components/ui/MetricCard';
import { SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';

// What a Generate Content click asks the creative agent for.
// NOTE: the route's parameters are `platform` (single value or list) and
// `days` — it has no `platforms`/`count`, so sending those would silently
// fall back to all platforms across 30 days.
const GENERATE_PLATFORMS = ['instagram', 'facebook', 'linkedin'];
const GENERATE_DAYS = 5;


const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  published: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  draft:     'bg-faint/15 text-muted border-line-strong/20',
};

interface Metrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

interface Post {
  id: string;
  platform: string;
  content: string;
  hook: string | null;
  cta: string | null;
  status: string;
  scheduled_at: string | null;
  metrics: Metrics | null;
}

interface Stats {
  posts_published: number;
  published_this_month: number;
  scheduled: number;
  drafts: number;
  total_impressions: number | null;
  avg_engagement_rate: number | null;
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function ContentPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [agentRuns, setAgentRuns] = useState<any[]>([]);
  const [pendingDraft, setPendingDraft] = useState<any>(null);
  const [approving, setApproving] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'analytics'>('queue');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/content');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPosts(json.posts || []);
      setStats(json.stats);
      setAgentRuns(json.agent_runs || []);
      setPendingDraft(json.pending_draft || null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(null);
    try {
      // No client_id: the route derives the tenant from the session.
      const json = await postJSON('/api/agents/creative', {
        platform: GENERATE_PLATFORMS,
        days: GENERATE_DAYS,
      });
      const made = json?.posts?.length ?? json?.calendar?.length ?? null;
      setGenerateSuccess(
        made != null
          ? 'Generated ' + made + ' post' + (made === 1 ? '' : 's') + '.'
          : 'Content generated.',
      );
      await load();
    } catch (err: any) {
      setGenerateError(err?.message || String(err));
    } finally {
      setGenerating(false);
    }
  };

  const approveDraft = async () => {
    if (!pendingDraft?.id) return;
    setApproving(true);
    try {
      const res = await fetch(`/api/approvals/${pendingDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', action: 'approved' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setPendingDraft(null);
      load();
    } catch (err: any) {
      setGenerateError(err?.message || String(err));
    } finally {
      setApproving(false);
    }
  };

  const handleApprove = async (id: string) => {
    const previous = posts;
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, status: 'scheduled' } : p));
    try {
      const res = await fetch(`/api/dashboard/content/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'scheduled' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch {
      setPosts(previous);
    }
  };

  // Display names come from the agent catalog so this list cannot drift from
  // the roster shown elsewhere on the dashboard.
  const agentLabel = (type: string) => {
    const known = AGENTS.find((a) => a.agentType === type);
    if (known) return known.name;
    return String(type || 'Unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const money = (cost: number | null) => {
    const value = Number(cost) || 0;
    if (value === 0) return '$0.000';
    return value < 1 ? '$' + value.toFixed(3) : '$' + value.toFixed(2);
  };

  // Grouped by the Monday of the week each run happened in.
  const runsByWeek = agentRuns.reduce((acc: Record<string, any[]>, run: any) => {
    const d = new Date(run.created_at);
    if (Number.isNaN(d.getTime())) return acc;
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + ((day === 0 ? -6 : 1) - day));
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    (acc[key] ||= []).push(run);
    return acc;
  }, {});
  const weekKeys = Object.keys(runsByWeek).sort().reverse();

  const platformClass = (p: string) => platformTint(p);

  // The agent writes for several platforms in one run, so the queue is
  // grouped rather than shown as one undifferentiated list.
  const grouped = posts.reduce((acc: Record<string, Post[]>, post) => {
    const key = String(post.platform || 'unknown').toLowerCase();
    (acc[key] ||= []).push(post);
    return acc;
  }, {});
  const groupOrder = Object.keys(grouped).sort((a, b) => {
    const rank = (k: string) => {
      const i = GENERATE_PLATFORMS.indexOf(k);
      return i === -1 ? GENERATE_PLATFORMS.length : i;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-text flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-accent" />
        Creative Studio
      </h1>
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {generating ? <Spinner /> : <Sparkles className="w-4 h-4" />}
        {generating ? 'Generating…' : 'Generate Content'}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} rows={1} />)}
        </div>
        <SkeletonTable rows={7} cols={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-text">
        <div className="bg-surface rounded-xl border border-line/50 p-6">
          <ErrorMessage message={"Couldn't load content — " + error} />
        </div>
      </div>
    );
  }

  // ── Nothing generated yet ────────────────────────────────────────────────
  if (posts.length === 0) {
    return (
      <div className="p-6 space-y-6 text-text">
        {header}
        <ErrorMessage message={generateError} />
      <SuccessMessage message={generateSuccess} />
        <div className="bg-surface rounded-xl border border-line/50">
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent/15">
              <Sparkles className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                No content yet. Your creative agent will generate posts.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-dim">
                Drafts, scheduled posts, and their performance will all appear here
                once the agent starts writing.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const publishedWithMetrics = posts.filter((p) => p.status === 'published' && p.metrics);

  return (
    <div className="p-6 space-y-6 text-text">
      {header}
      <ErrorMessage message={generateError} />
      <SuccessMessage message={generateSuccess} />

      {/* Analytics strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Posts Published"
            value={stats.posts_published > 0 ? stats.posts_published : '—'}
            rows={[{ label: 'This month', value: stats.published_this_month }]}
          />
          <MetricCard
            label="Scheduled"
            value={(stats.scheduled > 0 || stats.drafts > 0) ? stats.scheduled : '—'}
            rows={[{ label: 'Drafts', value: stats.drafts }]}
          />
          <MetricCard
            label="Total Impressions"
            value={stats.total_impressions !== null ? stats.total_impressions : '—'}
            rows={[{ label: 'Scope', value: 'Published' }]}
          />
          <MetricCard
            label="Avg Engagement"
            value={stats.avg_engagement_rate !== null ? `${stats.avg_engagement_rate}%` : '—'}
            rows={[{ label: 'Formula', value: 'Engage / views' }]}
          />
        </div>
      )}

      {/* Trend Radar queues urgent drafts for approval. */}
      {pendingDraft && (
        <div className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent">
              Trend opportunity queued for approval
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {pendingDraft.payload_json?.description
                || pendingDraft.payload_json?.suggested_hook
                || pendingDraft.payload_json?.topic
                || 'A drafted post is waiting for your review.'}
            </p>
          </div>
          <button
            onClick={approveDraft}
            disabled={approving}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? <Spinner /> : <CheckCircle2 className="h-4 w-4" />}
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      )}

      {/* Agent activity, newest week first. */}
      {agentRuns.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold leading-8 tracking-tight text-text">
            Agent activity
          </h2>
          <div className="space-y-5">
            {weekKeys.map((week) => (
              <div key={week} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-dim">
                  Week of {new Date(week + 'T00:00:00').toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric',
                  })}
                </p>
                {runsByWeek[week].map((run: any) => (
                  <div
                    key={run.id}
                    className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">
                          {agentLabel(run.agent_type)}
                        </span>
                        <StatusPill status={normalizeStatus(run.status)} label={run.status ?? undefined} />
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3 text-xs text-dim">
                        <span className="tabular-nums">{money(run.cost_usd)}</span>
                        <span>{relativeTime(run.created_at)}</span>
                      </div>
                    </div>
                    {run.output_summary && (
                      <p className="mt-1.5 text-sm leading-5 text-dim">
                        {String(run.output_summary).slice(0, 150)}
                        {String(run.output_summary).length > 150 ? '…' : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line/50">
        {(['queue', 'analytics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t === 'queue' ? 'Content Queue' : 'Performance'}
          </button>
        ))}
      </div>

      {/* Content Queue — grouped by platform */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          {groupOrder.map((platformKey) => (
          <div key={platformKey} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${platformClass(platformKey)}`}>
                <PlatformIcon platform={platformKey} className="h-3.5 w-3.5" />
                {platformLabel(platformKey)}
              </span>
              <span className="text-xs text-dim">
                {grouped[platformKey].length} post{grouped[platformKey].length === 1 ? '' : 's'}
              </span>
            </div>
          {grouped[platformKey].map((post) => {
            const when = formatDate(post.scheduled_at);
            return (
              <div
                key={post.id}
                className="bg-surface rounded-xl border border-line/50 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded border ${platformClass(post.platform)}`}>
                      <PlatformIcon platform={post.platform} className="h-3.5 w-3.5" />
                      {platformLabel(post.platform)}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLE[post.status] ?? STATUS_STYLE.draft}`}>
                      {post.status}
                    </span>
                  </div>
                  {when && (
                    <div className="flex items-center gap-1 text-xs text-dim flex-shrink-0">
                      <Calendar className="w-3.5 h-3.5" />
                      {when}
                    </div>
                  )}
                </div>

                {post.hook && <p className="text-white text-sm font-medium">{post.hook}</p>}
                <p className="text-muted text-sm leading-relaxed">{post.content}</p>
                {post.cta && <p className="text-accent text-xs">{post.cta}</p>}

                {post.metrics ? (
                  <div className="flex items-center gap-5 pt-1 text-xs text-dim border-t border-line/40">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.metrics.views?.toLocaleString() ?? '—'}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.metrics.likes ?? '—'}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{post.metrics.comments ?? '—'}</span>
                  </div>
                ) : post.status === 'draft' ? (
                  <div className="flex gap-2 pt-1 border-t border-line/40">
                    <button
                      onClick={() => handleApprove(post.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 hover:bg-accent-hover/30 text-accent border border-accent/20 rounded-lg text-xs font-medium transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve &amp; Schedule
                    </button>
                  </div>
                ) : post.status === 'published' ? (
                  <p className="pt-1 border-t border-line/40 text-xs text-faint">
                    No analytics synced for this post yet.
                  </p>
                ) : null}
              </div>
            );
          })}
          </div>
          ))}
        </div>
      )}

      {/* Performance tab */}
      {activeTab === 'analytics' && (
        <div className="bg-surface rounded-xl border border-line/50 p-6">
          <h2 className="text-white font-semibold text-sm mb-4">Top Performing Posts</h2>
          {publishedWithMetrics.length === 0 ? (
            <p className="text-sm text-dim py-8 text-center">
              No performance data yet — it appears once published posts report back.
            </p>
          ) : (
            <div className="space-y-3">
              {publishedWithMetrics
                .slice()
                .sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))
                .map((p, i) => (
                  <div key={p.id} className="flex items-center gap-4 py-3 border-b border-line/40 last:border-0">
                    <span className="text-faint text-xs w-4">{i + 1}</span>
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border ${platformClass(p.platform)}`}>
                      <PlatformIcon platform={p.platform} className="h-3 w-3" />
                      {platformLabel(p.platform)}
                    </span>
                    <p className="flex-1 text-sm text-muted line-clamp-1">{p.content}</p>
                    <div className="flex items-center gap-4 text-xs text-dim flex-shrink-0">
                      <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{p.metrics?.views?.toLocaleString() ?? '—'}</span>
                      <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{p.metrics?.likes ?? '—'}</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
