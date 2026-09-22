'use client';

import { sanitizeReportHtml } from '@/lib/report-html';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FileText, ArrowRight, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import {
  Spinner, ErrorMessage, SuccessMessage, postJSON, getJSON,
} from '@/components/dashboard/AgentState';
import { TEST_CLIENT_ID } from '@/lib/client-config';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

// Index for /dashboard/brief — the sidebar links here, while the detail view
// lives at /dashboard/brief/[id]. Shows the most recent brief and can ask the
// BI reporter for a fresh one.
export default function WeeklyBriefPage() {
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await getJSON('/api/dashboard/metrics');
      setBrief(json.latest_brief);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(null);
    try {
      const json = await postJSON('/api/agents/bi-reporter', {
        client_id: TEST_CLIENT_ID,
      });

      // The agent hands the finished HTML straight back, so the new brief can
      // be shown immediately rather than waiting on the metrics round-trip.
      if (json?.brief_html) {
        setBrief({
          id: json.brief_id ?? null,
          brief_html: json.brief_html,
          ware_score: json.ware_score ?? null,
          week_start: json.week_start ?? json.week_start_date ?? null,
        });
      }
      setGenerateSuccess('Brief generated.');
      // Re-sync with the stored record so ids and scores match the database.
      load();
    } catch (err: any) {
      setGenerateError(err?.message || String(err));
    } finally {
      setGenerating(false);
    }
  };

  const generateButton = (
    <button
      onClick={generate}
      disabled={generating}
      className="btn-accent-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {generating ? <Spinner /> : <Sparkles className="h-4 w-4" />}
      {generating ? 'Generating…' : 'Generate Brief'}
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen space-y-6 bg-canvas p-6">
        <Skeleton className="h-10 w-64" />
        <SkeletonCard className="min-h-96" rows={4} />
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 bg-canvas p-6">
      <PageHeader
        title="Weekly Brief"
        subtitle={
          brief?.week_start
            ? 'Week of ' + new Date(brief.week_start).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              })
            : 'Your Monday report'
        }
        action={
          <>
            {brief?.ware_score != null && (
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent">
                WARE {brief.ware_score}
              </span>
            )}
            {generateButton}
          </>
        }
      />

      <ErrorMessage message={error ? "Couldn't load your brief — " + error : null} />
      <ErrorMessage message={generateError} />
      <SuccessMessage message={generateSuccess} />

      <div className="rounded-lg border border-line bg-surface">
        <div className="p-5">
          {generating && !brief ? (
            <div className="space-y-4 py-8" role="status" aria-label="Writing brief">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-6 h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <p className="pt-4 text-sm text-muted">
                Writing your brief — this reads a week of agent activity, so it takes a moment.
              </p>
            </div>
          ) : !brief ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                <FileText className="h-6 w-6 text-accent" />
              </div>
              <p className="text-sm font-medium text-text">No brief yet</p>
              <p className="max-w-sm text-sm text-dim">
                Your Monday report appears once your agents have a week of activity
                behind them — or generate one now.
              </p>
              {generateButton}
            </div>
          ) : (
            <>
              {/* Briefs are model-authored HTML styled for white paper, so the
                  container stays light even on the dark dashboard. */}
              <div className="rounded-lg bg-white p-5">
                <div className="brief-content" dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(brief.brief_html) }} />
              </div>
              {brief.id && (
                <Link
                  href={'/dashboard/brief/' + brief.id}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Open full brief <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
