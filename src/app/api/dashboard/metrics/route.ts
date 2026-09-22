import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireSession, authErrorResponse } from '@/lib/auth-guard';
import { getBusinessMetrics, operationalScore } from '@/lib/metrics';
import { sanitizeReportHtml } from '@/lib/report-html';

export async function GET() {
  try {
    const { clientId } = await requireSession();
    const until = new Date().toISOString();
    const since = new Date(Date.parse(until) - 7 * 86400000).toISOString();
    const metrics = await getBusinessMetrics(clientId, since, until);
    const results = await Promise.all([
      supabaseAdmin.from('agent_runs').select('agent_type,status,output_summary,created_at').eq('client_id',clientId).gte('created_at',since).lt('created_at',until).order('created_at',{ascending:false}).limit(6),
      supabaseAdmin.from('weekly_briefs').select('id,brief_html,ware_score,week_start').eq('client_id',clientId).order('created_at',{ascending:false}).limit(1),
      supabaseAdmin.from('approvals_queue').select('id,action_type,payload_json,created_at,expires_at',{count:'exact'}).eq('client_id',clientId).eq('status','pending').gt('expires_at',until).order('created_at',{ascending:false}).limit(50),
      supabaseAdmin.from('leads').select('id,name,company,bos_lead_score,status').eq('client_id',clientId).order('bos_lead_score',{ascending:false}).limit(5),
      supabaseAdmin.from('leads').select('id',{count:'exact',head:true}).eq('client_id',clientId).gte('created_at',since).lt('created_at',until),
      supabaseAdmin.from('leads').select('id',{count:'exact',head:true}).eq('client_id',clientId).gte('last_contacted_at',since).lt('last_contacted_at',until),
    ]);
    if (results.some(result => result.error)) throw new Error('Dashboard records unavailable.');
    const [recent,briefs,approvals,leads,leadCount,contactedCount] = results;
    const brief = briefs.data?.[0];
    const html = sanitizeReportHtml(brief?.brief_html || '');
    const payload = {
      client_id:clientId,window_days:7,period:metrics.period,source_tables:metrics.source_tables,
      ware_score:operationalScore(metrics),score_definition:'Internal operational indicator; not validated ROI',
      calls:metrics.calls,reviews:metrics.reviews,
      invoices:{total_sent:metrics.invoices.total,cohort:metrics.invoices.cohort,
        paid:metrics.invoices.paid,overdue:metrics.invoices.overdue,by_stage:metrics.invoices.by_stage,
        amount_collected_cents:Math.round(metrics.invoices.collected_in_period*100),
        total_amount_cents:Math.round(metrics.invoices.sum_amount_due*100),
        paid_amount_cents:Math.round(metrics.invoices.collected_in_period*100)},
      agent_runs:{...metrics.agent_runs,total_cost_usd:metrics.agent_runs.sum_cost_usd,recent:recent.data},
      approvals:{pending_count:approvals.count,pending:approvals.count,items:approvals.data},
      latest_brief:brief ? {...brief,brief_html:html,summary:html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,240)} : null,
      hot_leads:leads.data,leads:{total:leadCount.count,contacted:contactedCount.count},
    };
    const is_empty = !metrics.calls.total && !metrics.reviews.total && !metrics.invoices.total
      && !metrics.agent_runs.total && !approvals.count && !brief;
    return NextResponse.json({...payload,is_empty});
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({error:'Dashboard data is unavailable. Please try again.'},{status:503});
  }
}
