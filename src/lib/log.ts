import { supabaseAdmin } from './supabase'

export async function logAgentRun(params: {
  client_id: string, agent_type: string, status: string,
  input_tokens?: number, output_tokens?: number, cost_usd?: number,
  quality_score?: number, output_summary?: string, metadata?: any,
}) {
  try {
    await supabaseAdmin.from('agent_runs').insert({
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
  } catch (e) {
    console.error('Log failed:', e)
  }
}
