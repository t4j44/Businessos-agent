'use client';

import React, { useState, useEffect } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { Check, X, Edit3, FileSignature, Star, Mail, PenTool, ExternalLink, Clock } from 'lucide-react';
import type { ApprovalsQueue as ApprovalItem } from '@/types';

export function ApprovalsQueue() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  const supabase = supabaseBrowser;

  useEffect(() => {
    fetchApprovals();
  }, []);

  const fetchApprovals = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
       const { data: client } = await supabase.from('clients').select('id').eq('user_id', user.id).single();
       if (client) {
          const { data } = await supabase
            .from('approvals_queue')
            .select('*')
            .eq('client_id', client.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
          if (data) setItems(data as ApprovalItem[]);
       }
    }
    setLoading(false);
  };

  const handleAction = async (id: string, action: 'approved' | 'rejected') => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        setItems(prev => prev.filter(item => item.id !== id));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingId(null);
    }
  };

  const getTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    return hours > 0 ? `Expires in ${hours}h` : `Expires in ${Math.floor(diff / 60000)}m`;
  };

  if (loading) return <div className="text-[#A1A1AA] text-sm py-4">Loading queue...</div>;
  if (items.length === 0) return <div className="text-[#71717A] text-sm py-4">All caught up! No pending approvals.</div>;

  return (
    <div className="space-y-4">
      {items.map(item => {
        const payload = item.payload_json || {};
        
        let icon = <Check className="w-5 h-5 text-[#A1A1AA]" />;
        let title ="Pending Action";
        let content = null;
        let showEdit = false;

        if (item.action_type === 'contract_send') {
          icon = <FileSignature className="w-5 h-5 text-[#7C3AED]" />;
          title ="Contract ready to send";
          content = (
            <div className="text-sm text-[#A1A1AA]">
               <p><span className="text-[#71717A] font-medium">Contact:</span> {payload.contact_name}</p>
               <p><span className="text-[#71717A] font-medium">Value:</span> {payload.deal_value}</p>
            </div>
          );
          showEdit = true;
        } else if (item.action_type === 'post_review_response' || item.action_type === 'review_response') {
          icon = <Star className="w-5 h-5 text-amber-400" />;
          title ="Review response ready";
          content = (
            <div className="text-sm text-[#A1A1AA] space-y-1">
               <p><span className="text-[#71717A] font-medium">{payload.platform} Rating:</span> {payload.rating} Stars</p>
               <p className="bg-[#0A0A0B] p-2 border border-[#1F1F23] rounded mt-2 text-xs text-[#A1A1AA] line-clamp-2">"{payload.response_text || payload.draft_text}"</p>
            </div>
          );
          showEdit = true;
        } else if (item.action_type === 'hunter_email') {
          icon = <Mail className="w-5 h-5 text-[#7C3AED]" />;
          title ="Email needs review";
          content = (
            <div className="text-sm text-[#A1A1AA] space-y-1">
               <p><span className="text-[#71717A] font-medium">Lead:</span> {payload.lead_name} ({payload.company})</p>
               <p className="bg-[#0A0A0B] p-2 border border-[#1F1F23] rounded mt-2 text-xs text-[#A1A1AA] line-clamp-2">"{payload.email_content}"</p>
            </div>
          );
        } else if (item.action_type === 'content_post') {
          icon = <PenTool className="w-5 h-5 text-emerald-400" />;
          title ="Post ready to publish";
          content = (
            <div className="text-sm text-[#A1A1AA] space-y-1">
               <p><span className="text-[#71717A] font-medium">Platform:</span> {payload.platform}</p>
               <p><span className="text-[#71717A] font-medium">Scheduled:</span> {payload.scheduled_time}</p>
               <p className="bg-[#0A0A0B] p-2 border border-[#1F1F23] rounded mt-2 text-xs text-[#A1A1AA] line-clamp-2">"{payload.content_preview}"</p>
            </div>
          );
          showEdit = true;
        }

        return (
          <div key={item.id} className="bg-[#111113] border border-[#1F1F23]/50 rounded-xl p-4 flex flex-col md:flex-row gap-4 hover:border-[#2A2A30] transition-colors">
            
            <div className="flex-1 min-w-0">
               <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-[#17171A] rounded-lg shrink-0">
                     {icon}
                  </div>
                  <div>
                     <h4 className="text-white font-semibold text-sm">{title}</h4>
                     <div className="flex items-center gap-2 mt-0.5">
                       <span className="text-xs text-[#71717A]">{new Date(item.created_at).toLocaleDateString()}</span>
                       {item.expires_at && (
                         <>
                           <span className="text-[#52525B]">•</span>
                           <span className="text-xs font-medium text-amber-500 flex items-center gap-1">
                             <Clock className="w-3 h-3" /> {getTimeRemaining(item.expires_at)}
                           </span>
                         </>
                       )}
                     </div>
                  </div>
               </div>
               
               {content}

               {item.action_type === 'contract_send' && payload.preview_url && (
                  <button className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:text-[#7C3AED] transition-colors">
                     <ExternalLink className="w-3.5 h-3.5" /> Preview document
                  </button>
               )}
            </div>
            
            <div className="md:w-32 flex flex-row md:flex-col gap-2 shrink-0 border-t md:border-t-0 md:border-l border-[#1F1F23]/50 pt-3 md:pt-0 md:pl-4">
               <button 
                 onClick={() => handleAction(item.id, 'approved')}
                 disabled={processingId === item.id}
                 className="flex-1 flex items-center justify-center gap-1.5 bg-[#7C3AED] hover:bg-[#7C3AED] text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
               >
                 <Check className="w-4 h-4" /> Approve
               </button>
               {showEdit && (
                 <button className="flex-1 flex items-center justify-center gap-1.5 bg-[#17171A] hover:bg-[#1F1F23] text-[#A1A1AA] rounded-lg py-2 text-sm font-medium transition-colors border border-[#1F1F23]">
                   <Edit3 className="w-4 h-4" /> Edit
                 </button>
               )}
               <button 
                 onClick={() => handleAction(item.id, 'rejected')}
                 disabled={processingId === item.id}
                 className="flex-1 flex items-center justify-center gap-1.5 bg-transparent hover:bg-red-500/10 text-[#A1A1AA] hover:text-red-400 rounded-lg py-2 text-sm font-medium transition-colors border border-transparent hover:border-red-500/20 disabled:opacity-50"
               >
                 <X className="w-4 h-4" /> Reject
               </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}