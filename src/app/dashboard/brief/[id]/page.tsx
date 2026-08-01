'use client';

import React, { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { ArrowLeft, Printer, Share2, DownloadCloud } from 'lucide-react';
import Link from 'next/link';

export default function BriefPage({ params }: { params: { id: string } }) {
  const [brief, setBrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = supabaseBrowser;

  useEffect(() => {
    fetchBrief();
  }, [params.id]);

  const fetchBrief = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        const { data: client } = await supabase.from('clients').select('id').eq('user_id', user.id).single();
        if (client) {
            const { data } = await supabase
              .from('weekly_briefs')
              .select('*')
              .eq('id', params.id)
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

  if (loading) return <div className="p-8 text-slate-400">Loading Brief...</div>;
  if (!brief) return <div className="p-8 text-red-400">Brief not found or you don't have access.</div>;

  return (
    <div className="min-h-screen bg-[#0F172A] p-6 text-slate-200">
      
      {/* Top Navigation Bar - Hidden in print */}
      <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center print:hidden border-b border-slate-800 pb-4">
        <Link href="/dashboard" className="text-slate-400 hover:text-white flex items-center gap-2 text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </Link>
        <div className="flex gap-3">
          <button 
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#2563EB] hover:bg-blue-600 rounded-lg transition-colors"
          >
             <DownloadCloud className="w-4 h-4" /> Download PDF / Print
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto print-area print:text-black">
        {/* Document Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-8 md:p-12 print:bg-white print:border-none print:shadow-none bg-white">
          
          <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-slate-200 pb-8 mb-8">
            <div>
              <h1 className="text-3xl font-bold text-[#1B2A4A] mb-2">Executive Strategy Brief</h1>
              <p className="text-slate-500 font-medium">Week Starting: {new Date(brief.week_start_date).toLocaleDateString()}</p>
            </div>
            
            <div className="mt-4 md:mt-0 flex flex-col items-end">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">WARE Score</span>
              <div className="text-5xl font-black text-[#10B981]">{brief.ware_score}</div>
            </div>
          </div>

          <div 
            className="brief-content"
            dangerouslySetInnerHTML={{ __html: brief.brief_html }}
          />

          <div className="mt-12 pt-8 border-t border-slate-200 text-center text-slate-500 text-sm font-medium">
             Prepared algorithmically by Business OS AI.
          </div>
        </div>
      </div>
    </div>
  );
}