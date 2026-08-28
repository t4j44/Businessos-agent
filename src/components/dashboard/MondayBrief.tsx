'use client';

import React, { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

export function MondayBrief() {
  const [briefs, setBriefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const supabase = supabaseBrowser;

  useEffect(() => {
    fetchBriefs();
  }, []);

  const fetchBriefs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('weekly_briefs')
      .select('*')
      .order('week_start', { ascending: false })
      .limit(10);

    if (error) setError(error.message);
    setBriefs(data ?? []);
    setLoading(false);
  };

  if (loading) return <div className="bg-[#111113] p-6 rounded-xl border border-[#1F1F23] animate-pulse h-64"></div>;

  if (error) {
    return (
      <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
        <p className="text-sm text-red-400">Couldn&apos;t load your briefs — {error}</p>
      </div>
    );
  }

  // ── No brief written yet ──────────────────────────────────────────────────
  if (briefs.length === 0) {
    return (
      <div className="bg-[#111113] border border-[#1F1F23] rounded-xl">
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7C3AED]/10">
            <BarChart3 className="h-6 w-6 text-[#7C3AED]" />
          </div>
          <p className="text-sm font-medium text-white">No Monday Brief yet</p>
          <p className="text-xs text-[#71717A] max-w-sm">
            Your first brief is written once your agents have a full week of activity
            to report on.
          </p>
        </div>
      </div>
    );
  }

  const latestBrief = briefs[0];

  return (
    <div className="bg-[#111113] border border-[#1F1F23] rounded-xl overflow-hidden flex flex-col">
      <div className="p-4 border-b border-[#1F1F23] flex justify-between items-center bg-[#17171A]/50">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">Monday Brief</h2>
          <span className="text-xs text-[#A1A1AA] bg-[#17171A] px-2 py-1 rounded">{latestBrief.week_start}</span>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0A0A0B] px-2.5 py-1 rounded-full border border-[#1F1F23]">
            <span className="text-xs text-[#A1A1AA]">WARE Score</span>
            <span className="text-sm font-bold text-emerald-400">{latestBrief.ware_score}</span>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="px-3 py-1.5 text-xs text-[#A1A1AA] hover:text-white bg-[#17171A] hover:bg-[#1F1F23] rounded transition-colors"
            >
              History ▼
            </button>
            {isDropdownOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-[#17171A] border border-[#1F1F23] rounded z-10">
                {briefs.map((b, i) => (
                  <Link 
                    key={b.id} 
                    href={`/dashboard/brief/${b.id}`}
                    className="block px-4 py-2 text-sm text-[#A1A1AA] hover:bg-[#1F1F23] border-b border-[#1F1F23]/50 last:border-0"
                  >
                    {b.week_start} {i === 0 && '(Latest)'}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 relative">
        <div 
          className="text-[#A1A1AA] text-sm max-h-[300px] overflow-hidden relative"
          dangerouslySetInnerHTML={{ __html: latestBrief.brief_html }}
        />
        {/* Gradient fade out effect */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#111113] to-transparent pointer-events-none"></div>
      </div>

      <div className="p-4 bg-[#17171A]/30 border-t border-[#1F1F23] text-center">
        <Link 
          href={`/dashboard/brief/${latestBrief.id}`}
          className="inline-block px-6 py-2 text-sm font-medium text-white bg-[#7C3AED] hover:bg-[#7C3AED] rounded-lg transition-colors"
        >
          View Full Brief
        </Link>
      </div>
    </div>
  );
}