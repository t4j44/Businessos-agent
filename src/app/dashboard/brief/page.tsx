'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, ArrowRight } from 'lucide-react';
import * as tokens from '@/lib/design-tokens';

// Index for /dashboard/brief — the sidebar links here, while the detail view
// lives at /dashboard/brief/[id]. Shows the most recent brief.
export default function WeeklyBriefPage() {
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/metrics');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setBrief(json.latest_brief);
      } catch (err: any) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090B] p-6">
        <div className="h-96 animate-pulse rounded-xl border border-[#27272A] bg-[#111113]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] p-6">
      <div className="rounded-xl border border-[#27272A] bg-[#111113]">
        <div className="flex items-center justify-between border-b border-[#27272A] px-5 py-4">
          <div>
            <h1 className={tokens.type.cardTitle}>Weekly Brief</h1>
            <p className="mt-0.5 text-xs text-[#71717A]">
              {brief?.week_start
                ? `Week of ${new Date(brief.week_start).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric',
                  })}`
                : 'Your Monday report'}
            </p>
          </div>
          {brief?.ware_score != null && (
            <span className="rounded-full border border-[#6366F1]/20 bg-[#6366F1]/10 px-3 py-1 text-sm font-bold text-[#6366F1]">
              WARE {brief.ware_score}
            </span>
          )}
        </div>

        <div className="p-5">
          {error ? (
            <p className="text-sm text-[#EF4444]">Couldn&apos;t load your brief — {error}</p>
          ) : !brief ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6366F1]/10">
                <FileText className="h-6 w-6 text-[#6366F1]" />
              </div>
              <p className="text-sm font-medium text-[#FAFAFA]">No brief yet</p>
              <p className="max-w-sm text-sm text-[#71717A]">
                Your Monday report appears once your agents have a week of activity behind them.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-white p-5">
                <div className="brief-content" dangerouslySetInnerHTML={{ __html: brief.brief_html }} />
              </div>
              {brief.id && (
                <Link
                  href={`/dashboard/brief/${brief.id}`}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#6366F1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4F46E5]"
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
