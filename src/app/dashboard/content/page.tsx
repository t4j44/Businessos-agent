'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Calendar, Eye, Heart, MessageCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

const PLATFORM_COLOR: Record<string, string> = {
  LinkedIn: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  Twitter:  'bg-sky-500/15 text-sky-400 border-sky-500/20',
  X:        'bg-sky-500/15 text-sky-400 border-sky-500/20',
  Instagram:'bg-pink-500/15 text-pink-400 border-pink-500/20',
  Facebook: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
};
const DEFAULT_PLATFORM_COLOR = 'bg-slate-500/15 text-slate-400 border-slate-500/20';

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  published: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  draft:     'bg-slate-500/15 text-slate-400 border-slate-500/20',
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
  const [activeTab, setActiveTab] = useState<'queue' | 'analytics'>('queue');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/content');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPosts(json.posts || []);
      setStats(json.stats);
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
    try {
      const res = await fetch('/api/agents/creative', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (err: any) {
      setGenerateError(err?.message || String(err));
    } finally {
      setGenerating(false);
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

  const platformClass = (p: string) => PLATFORM_COLOR[p] ?? DEFAULT_PLATFORM_COLOR;

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-violet-400" />
        Creative Studio
      </h1>
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {generating
          ? <RefreshCw className="w-4 h-4 animate-spin" />
          : <Sparkles className="w-4 h-4" />}
        {generating ? 'Generating…' : 'Generate Content'}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-slate-200">
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load content — {error}</p>
        </div>
      </div>
    );
  }

  // ── Nothing generated yet ────────────────────────────────────────────────
  if (posts.length === 0) {
    return (
      <div className="p-6 space-y-6 text-slate-200">
        {header}
        {generateError && <p className="text-sm text-red-400">{generateError}</p>}
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50">
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15">
              <Sparkles className="h-7 w-7 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                No content yet. Your creative agent will generate posts.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
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
    <div className="p-6 space-y-6 text-slate-200">
      {header}
      {generateError && <p className="text-sm text-red-400">{generateError}</p>}

      {/* Analytics strip */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Posts Published',
              value: stats.posts_published.toLocaleString(),
              note: `${stats.published_this_month} this month`,
              hasData: stats.posts_published > 0,
            },
            {
              label: 'Scheduled',
              value: stats.scheduled.toLocaleString(),
              note: `${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} waiting`,
              hasData: stats.scheduled > 0 || stats.drafts > 0,
            },
            {
              label: 'Total Impressions',
              value: stats.total_impressions?.toLocaleString() ?? '',
              note: stats.total_impressions === null ? 'No analytics synced yet' : 'Across published posts',
              hasData: stats.total_impressions !== null,
            },
            {
              label: 'Avg Engagement',
              value: stats.avg_engagement_rate !== null ? `${stats.avg_engagement_rate}%` : '',
              note: stats.avg_engagement_rate === null ? 'No analytics synced yet' : 'Likes + comments / views',
              hasData: stats.avg_engagement_rate !== null,
            },
          ].map((s) => (
            <div key={s.label} className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-4">
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.hasData ? 'text-white' : 'text-slate-600'}`}>
                {s.hasData ? s.value : '—'}
              </p>
              <p className="text-slate-500 text-xs mt-1">{s.note}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700/50">
        {(['queue', 'analytics'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === t ? 'border-violet-500 text-violet-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'queue' ? 'Content Queue' : 'Performance'}
          </button>
        ))}
      </div>

      {/* Content Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {posts.map((post) => {
            const when = formatDate(post.scheduled_at);
            return (
              <div
                key={post.id}
                className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-5 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${platformClass(post.platform)}`}>
                      {post.platform}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_STYLE[post.status] ?? STATUS_STYLE.draft}`}>
                      {post.status}
                    </span>
                  </div>
                  {when && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 flex-shrink-0">
                      <Calendar className="w-3.5 h-3.5" />
                      {when}
                    </div>
                  )}
                </div>

                {post.hook && <p className="text-white text-sm font-medium">{post.hook}</p>}
                <p className="text-slate-300 text-sm leading-relaxed">{post.content}</p>
                {post.cta && <p className="text-violet-400 text-xs">{post.cta}</p>}

                {post.metrics ? (
                  <div className="flex items-center gap-5 pt-1 text-xs text-slate-500 border-t border-slate-700/40">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{post.metrics.views?.toLocaleString() ?? '—'}</span>
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.metrics.likes ?? '—'}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{post.metrics.comments ?? '—'}</span>
                  </div>
                ) : post.status === 'draft' ? (
                  <div className="flex gap-2 pt-1 border-t border-slate-700/40">
                    <button
                      onClick={() => handleApprove(post.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-500/20 rounded-lg text-xs font-medium transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve &amp; Schedule
                    </button>
                  </div>
                ) : post.status === 'published' ? (
                  <p className="pt-1 border-t border-slate-700/40 text-xs text-slate-600">
                    No analytics synced for this post yet.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Performance tab */}
      {activeTab === 'analytics' && (
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-6">
          <h2 className="text-white font-semibold text-sm mb-4">Top Performing Posts</h2>
          {publishedWithMetrics.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              No performance data yet — it appears once published posts report back.
            </p>
          ) : (
            <div className="space-y-3">
              {publishedWithMetrics
                .slice()
                .sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))
                .map((p, i) => (
                  <div key={p.id} className="flex items-center gap-4 py-3 border-b border-slate-700/40 last:border-0">
                    <span className="text-slate-600 text-xs w-4">{i + 1}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${platformClass(p.platform)}`}>{p.platform}</span>
                    <p className="flex-1 text-sm text-slate-300 line-clamp-1">{p.content}</p>
                    <div className="flex items-center gap-4 text-xs text-slate-500 flex-shrink-0">
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
