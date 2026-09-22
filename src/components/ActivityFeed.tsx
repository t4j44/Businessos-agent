'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Activity } from 'lucide-react';
import { StatusPill } from '@/components/dashboard/StatusPill';
import { ErrorMessage, getJSON } from '@/components/dashboard/AgentState';
import { normalizeStatus, relativeTime } from '@/lib/agent-catalog';
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { SkeletonRow } from '@/components/ui/Skeleton';

type AgentRun = {
  id: string;
  agent_type: string | null;
  status: string | null;
  output_summary: string | null;
  cost_usd: number | null;
  created_at: string | null;
};

const POLL_MS = 10_000;
const SUMMARY_MAX = 80;

// Keyed by the agent_type each route writes to agent_runs — not by display
// name, which is why call_center_inbound and receptionist appear here too.
const AGENT_META: Record<string, { icon: string; name: string }> = {
  brand_scout:             { icon: '🔍', name: 'Brand Scout' },
  creative:                { icon: '🎨', name: 'Creative' },
  reputation_intelligence: { icon: '⭐', name: 'Reputation' },
  invoice_chase:           { icon: '💰', name: 'Invoice Chase' },
  bi_reporter:             { icon: '📊', name: 'BI Reporter' },
  receptionist:            { icon: '💬', name: 'Receptionist' },
  scheduler:               { icon: '📅', name: 'Scheduler' },
  call_center:             { icon: '📞', name: 'Call Center' },
  call_center_inbound:     { icon: '📞', name: 'Call Center' },
  hunter:                  { icon: '🎯', name: 'Hunter' },
  market_intelligence:     { icon: '🕵️', name: 'Market Intelligence' },
  audience_intelligence:   { icon: '🎯', name: 'Audience Intelligence' },
  trend_radar:             { icon: '📡', name: 'Trend Radar' },
  nightwatch:              { icon: '🌙', name: 'Nightwatch' },
};

function metaFor(agentType: string | null) {
  const key = String(agentType || '').toLowerCase();
  if (AGENT_META[key]) return AGENT_META[key];
  // An agent nobody has mapped yet still gets a readable row.
  const name = key
    ? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Unknown agent';
  return { icon: '🤖', name };
}

function truncate(text: string | null, max = SUMMARY_MAX) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + '…';
}

// Runs cost fractions of a cent, so the usual 2-decimal currency format would
// render almost everything as "$0.00".
function formatCost(cost: number | null) {
  const value = Number(cost) || 0;
  if (value === 0) return '$0.000';
  if (value < 1) return '$' + value.toFixed(3);
  return '$' + value.toFixed(2);
}

export function ActivityFeed({ clientId = TEST_CLIENT_ID }: { clientId?: string }) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const newestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await getJSON(
        '/api/agent-runs?client_id=' + encodeURIComponent(clientId) + '&limit=20',
      );
      setRuns(json.runs || []);
      setError(null);
    } catch (err: any) {
      // Keep the last good rows on screen; a dropped poll should not blank
      // the feed the operator is watching.
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // Poll. Polling pauses while the tab is hidden so a backgrounded dashboard
  // is not firing a request every 10 seconds forever.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(load, POLL_MS);
      setLive(true);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      setLive(false);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        load();
        start();
      }
    };

    load();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Rows arrive newest-first, so the newest entry is the top of the list.
  // Only scroll when the operator is already near the top — yanking the view
  // out from under someone reading older rows would be worse than not moving.
  useEffect(() => {
    const newest = runs[0]?.id ?? null;
    if (!newest || newest === newestIdRef.current) return;

    const firstRender = newestIdRef.current === null;
    newestIdRef.current = newest;
    if (firstRender) return;

    const el = scrollRef.current;
    if (el && el.scrollTop < 120) {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [runs]);

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-text">Live activity</h2>
        </div>

        <span
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ' +
            (live
              ? 'border-good/20 bg-good/10 text-good'
              : 'border-faint/20 bg-faint/10 text-dim')
          }
          title={live ? 'Refreshing every 10 seconds' : 'Paused while this tab is in the background'}
        >
          <span className={'h-1.5 w-1.5 rounded-full ' + (live ? 'bg-good animate-pulse' : 'bg-faint')} />
          {live ? 'Live' : 'Paused'}
        </span>
      </div>

      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto">
        {error && (
          <div className="px-5 pt-4">
            <ErrorMessage message={"Couldn't refresh activity — " + error} />
          </div>
        )}

        {loading ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
              <Activity className="h-6 w-6 text-accent" />
            </div>
            <p className="text-sm text-dim">
              No agent runs yet — run your first agent above
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => {
              const meta = metaFor(run.agent_type);
              const summary = truncate(run.output_summary);
              return (
                <li
                  key={run.id}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-raised"
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-base"
                    aria-hidden
                  >
                    {meta.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-text">{meta.name}</span>
                      <StatusPill status={normalizeStatus(run.status)} label={run.status ?? undefined} />
                    </div>
                    {summary && (
                      <p className="mt-1 text-sm leading-5 text-dim">{summary}</p>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs tabular-nums text-muted">{formatCost(run.cost_usd)}</p>
                    <p className="mt-0.5 text-xs text-faint">{relativeTime(run.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default ActivityFeed;
