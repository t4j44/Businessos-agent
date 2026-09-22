'use client';

import { sanitizeReportHtml } from '@/lib/report-html';

import React, { useState, useEffect, use } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { ArrowLeft, Printer, Share2, DownloadCloud } from 'lucide-react';
import Link from 'next/link';

export default function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = supabaseBrowser;

  useEffect(() => {
    fetchBrief();
  }, [id]);

  const formatWeekStart = (value: string | null | undefined) => {
    if (!value) return 'Unknown';
    const parsed = new Date(value.length <= 10 ? value + 'T00:00:00' : value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleDateString();
  };

  const fetchBrief = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        const { data: client } = await supabase.from('clients').select('id').eq('user_id', user.id).single();
        if (client) {
            const { data } = await supabase
              .from('weekly_briefs')
              .select('*')
              .eq('id', id)
              .eq('client_id', client.id)
              .single();
            if (data) {
                setBrief(data);
            }
        }
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied to clipboard!');
  };

  if (loading) return <div className="p-8 text-sm text-muted">Loading Brief...</div>;
  if (!brief) return <div className="p-8 text-sm text-crit">Brief not found or you don't have access.</div>;

  return (
    <div className="min-h-screen bg-canvas p-6 text-text">
      
      {/* Top Navigation Bar - Hidden in print */}
      <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center print:hidden border-b border-line pb-4">
        <Link href="/dashboard" className="text-muted hover:text-text flex items-center gap-2 text-sm font-medium transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <div className="flex gap-3">
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted bg-transparent hover:text-text border border-line hover:border-line-strong rounded-lg transition-colors"
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors"
          >
             <DownloadCloud className="w-4 h-4" /> Download PDF / Print
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto print-area print:text-black">
        {/* Document Container */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg p-8 md:p-12 print:border-none">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-[#E4E4E7] pb-8 mb-8">
            <div>
              <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-[#18181B] mb-2">Executive Strategy Brief</h1>
              <p className="text-sm text-faint font-medium">
                Week Starting: {formatWeekStart(brief.week_start)}
              </p>
            </div>
            
            <div className="mt-4 md:mt-0 flex flex-col items-end">
              <span className="text-xs font-semibold text-dim uppercase tracking-wider mb-1">WARE Score</span>
              <div className="text-5xl font-bold text-[#047857]">{brief.ware_score}</div>
            </div>
          </div>

          <div 
            className="brief-content"
            dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(brief.brief_html) }}
          />

          {/* Nightwatch writes intelligence_report_json onto the week's brief. */}
          <div className="mt-10 pt-8 border-t border-[#E4E4E7]">
            <h2 className="text-lg font-semibold text-[#18181B] mb-3">Intelligence Briefing</h2>
            {brief.intelligence_report_json ? (
              <div className="space-y-4 text-sm text-line-strong">
                {brief.intelligence_report_json.executive_summary && (
                  <p className="leading-relaxed">{brief.intelligence_report_json.executive_summary}</p>
                )}

                {brief.intelligence_report_json.priority_alert && (
                  <p className="rounded-lg border border-[#B91C1C]/30 bg-[#B91C1C]/5 px-3 py-2 font-medium text-[#B91C1C]">
                    Priority alert: {brief.intelligence_report_json.priority_alert}
                  </p>
                )}

                {([
                  ['Competitor moves', brief.intelligence_report_json.competitor_moves],
                  ['Audience insights', brief.intelligence_report_json.audience_insights],
                  ['Trend opportunities', brief.intelligence_report_json.trend_opportunities],
                ] as [string, string[] | undefined][])
                  .filter(([, items]) => Array.isArray(items) && items.length > 0)
                  .map(([label, items]) => (
                    <div key={label}>
                      <p className="font-semibold text-[#18181B]">{label}</p>
                      <ul className="mt-1 list-disc pl-5 space-y-1">
                        {items!.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  ))}

                {brief.intelligence_report_json.weekly_strategy_suggestion && (
                  <p>
                    <span className="font-semibold text-[#18181B]">This week: </span>
                    {brief.intelligence_report_json.weekly_strategy_suggestion}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-dim">
                No intelligence data yet — Nightwatch attaches its overnight findings here.
              </p>
            )}
          </div>

          <div className="mt-12 pt-8 border-t border-[#E4E4E7] text-center text-faint text-sm font-medium">
             Prepared algorithmically by Business OS AI.
          </div>
        </div>
      </div>
    </div>
  );
}