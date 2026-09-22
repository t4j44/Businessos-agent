import { supabaseAdmin } from '@/lib/supabase';
import { cronHandler } from '@/lib/cron';
import { analyzeStoredCall } from '@/lib/call-analysis';

export const maxDuration = 300;
export const GET = cronHandler({ name:'call-analysis', agentType:'call_center', async run() {
  const { data: calls, error } = await supabaseAdmin.from('call_transcripts').select('id,client_id')
    .in('analysis_status',['pending','failed','processing']).lt('analysis_attempts',3)
    .or(`analysis_lease_until.is.null,analysis_lease_until.lt.${new Date().toISOString()}`)
    .order('created_at',{ascending:true}).limit(5);
  if (error) throw new Error('Pending call assessments are unavailable.');
  let acted=0, errors=0; const skipped: Record<string,number> = {};
  for (const call of calls || []) {
    try { const result=await analyzeStoredCall(call.client_id,call.id);
      if (result.outcome==='completed') acted++; else skipped[result.outcome]=(skipped[result.outcome]||0)+1;
    } catch { errors++; }
  }
  return { scanned:calls?.length || 0,acted,errors,skipped };
} });
