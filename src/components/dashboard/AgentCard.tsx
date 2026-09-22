'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Play, ArrowUpRight } from 'lucide-react'
import { StatusPill } from './StatusPill'
import { Pending } from '@/components/ui/Skeleton'
import {
  type AgentDefinition,
  type RunStatus,
  relativeTime,
} from '@/lib/agent-catalog'

export type AgentRunInfo = {
  status: RunStatus
  lastRunAt?: string | null
  count?: number
}

export function AgentCard({
  agent,
  run,
  clientId,
  onRan,
}: {
  agent: AgentDefinition
  run: AgentRunInfo
  clientId?: string | null
  onRan?: () => void
}) {
  // Local run state is optimistic: the card shows Running immediately, then
  // hands off to the refreshed server status once onRan() reloads metrics.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status: RunStatus = busy ? 'running' : run.status
  const canRun = agent.trigger === 'manual' && !!agent.endpoint && !!clientId

  const handleRun = async () => {
    if (!canRun || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(agent.endpoint as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      onRan?.()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={
        'glass glass-interactive flex flex-col rounded-lg p-4' +
        // A running agent keeps a steady accent glow. Steady, not pulsing —
        // the StatusPill already says Running, and two things blinking at the
        // same fact is noise.
        (status === 'running' ? ' glass-live' : '')
      }
    >
      {/* Name + status */}
      <div className="flex items-start justify-between gap-3">
        <Link
          href={agent.href}
          className="group min-w-0 focus:outline-none focus-visible:underline"
        >
          <span className="flex items-center gap-1">
            <span className="label-caps truncate text-text">{agent.name}</span>
            <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-faint transition-colors group-hover:text-muted" />
          </span>
        </Link>
        <StatusPill status={status} />
      </div>

      <p className="mt-1 text-sm leading-5 text-dim">{agent.description}</p>

      {/* Last run + action */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="numeric min-w-0 truncate text-xs text-dim">
          {busy ? 'Running now…' : relativeTime(run.lastRunAt)}
        </span>

        {canRun ? (
          <button
            type="button"
            onClick={handleRun}
            disabled={busy}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Pending />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {busy ? 'Running' : 'Run Now'}
          </button>
        ) : (
          // Event-driven agents have no on-demand entry point, so the card
          // says what actually starts them rather than offering a dead button.
          <span
            className="flex-shrink-0 text-xs text-faint"
            title={agent.eventNote}
          >
            {agent.eventNote ?? 'Automatic'}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-crit">{error}</p>}
    </div>
  )
}
