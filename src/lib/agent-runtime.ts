import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from './supabase'
import { logAgentRun } from './log'
import { isUuid } from './validation'

export class AgentRuntimeError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export type AgentAction = 'analyze' | 'draft' | 'send' | 'publish' | 'delete'

/** Shared execution boundary. Identity must already come from a session,
 * a verified provider mapping, or a public assistant's validated tenant ID.
 * Limits are enforced by PostgreSQL, across all serverless instances. */
export async function beginAgentRun(params: {
  clientId: string; agent: string; action: AgentAction; subject: string;
  hourlyLimit: number; subjectLimit: number; reserveTokens?: number;
}) {
  if (!isUuid(params.clientId)) throw new AgentRuntimeError('Unknown business.', 404)
  const { data: client, error } = await supabaseAdmin.from('clients')
    .select('id, status, name, settings_json').eq('id', params.clientId).maybeSingle()
  if (error) throw new AgentRuntimeError('Business settings are temporarily unavailable.', 503)
  if (!client || !['active', 'trial', 'pilot'].includes(client.status)) {
    throw new AgentRuntimeError('This assistant is not active.', 403)
  }
  const config = client.settings_json?.agents?.[params.agent]
  if (config?.enabled === false) throw new AgentRuntimeError('This assistant is paused.', 403)
  // External actions use explicit, separately audited workflows. A text model
  // cannot grant itself permission by placing an instruction in its output.
  if (!['analyze', 'draft'].includes(params.action)) {
    throw new AgentRuntimeError('This action requires an approved execution workflow.', 403)
  }
  const { data: allowed, error: quotaError } = await supabaseAdmin.rpc('reserve_agent_quota', {
    p_client_id: params.clientId, p_agent: params.agent, p_subject: params.subject,
    p_hourly_limit: params.hourlyLimit, p_subject_limit: params.subjectLimit,
    p_reserved_tokens: params.reserveTokens ?? 0,
  })
  if (quotaError) throw new AgentRuntimeError('Usage controls are temporarily unavailable. Please try again later.', 503)
  if (allowed !== true) throw new AgentRuntimeError('This assistant has reached its usage limit. Please try again later.', 429)
  const runId = randomUUID()
  const startedAt = Date.now()
  let finished = false
  return {
    client,
    runId,
    async finish(status: 'completed' | 'error', summary: string, usage?: {
      inputTokens?: number; outputTokens?: number; cost?: number; metadata?: Record<string, unknown>;
    }) {
      if (finished) return
      finished = true
      if (status === 'completed' && usage?.inputTokens !== undefined && usage.outputTokens !== undefined && params.reserveTokens) {
        // Allow for the embedding query too; failed/unknown provider requests
        // retain their full reservation. This is a spend ceiling, not billing.
        const { error: settlementError } = await supabaseAdmin.rpc('settle_agent_quota', {
          p_client_id: params.clientId, p_reserved_tokens: params.reserveTokens,
          p_actual_tokens: usage.inputTokens + usage.outputTokens + 2500,
          p_period: new Date(startedAt).toISOString().slice(0, 7) + '-01',
        })
        if (settlementError) console.error('[agent-runtime] quota settlement failed:', settlementError.code)
      }
      // Reservations are deliberately conservative. Failed runs retain their
      // reservation rather than risk undercounting a provider request.
      await logAgentRun({ client_id: params.clientId, agent_type: params.agent, status,
        output_summary: summary, input_tokens: usage?.inputTokens, output_tokens: usage?.outputTokens,
        cost_usd: usage?.cost, metadata: { ...usage?.metadata, run_id: runId, action: params.action,
          duration_ms: Date.now() - startedAt, reserved_tokens: params.reserveTokens ?? 0 } })
    },
  }
}
