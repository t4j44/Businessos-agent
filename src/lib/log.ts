import { supabaseAdmin } from './supabase'

// client_id is nullable: a cron's "this schedule fired" row belongs to no
// tenant. agent_runs.client_id has no NOT NULL (migration 001), and the
// per-client dashboard queries filter by client_id so system rows never leak
// into a customer's feed.
export async function logAgentRun(params: {
  client_id: string | null, agent_type: string, status: string,
  input_tokens?: number, output_tokens?: number, cost_usd?: number,
  quality_score?: number, output_summary?: string, metadata?: any,
}) {
  try {
    const { error } = await supabaseAdmin.from('agent_runs').insert({
      client_id: params.client_id,
      agent_type: params.agent_type,
      status: params.status,
      input_tokens: params.input_tokens || 0,
      output_tokens: params.output_tokens || 0,
      cost_usd: params.cost_usd || 0,
      quality_score: params.quality_score,
      output_summary: params.output_summary,
      metadata: params.metadata || {},
    })
    if (error) {
      console.error('[agent-log] write failed:', error.code)
      return false
    }
    return true
  } catch (e) {
    console.error('Log failed:', e)
    return false
  }
}
