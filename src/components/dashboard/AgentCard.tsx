'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Play, Loader2, ArrowUpRight } from 'lucide-react'
import { StatusPill } from './StatusPill'
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
    <div className="flex flex-col rounded-lg border border-[#1F1F23] bg-[#111113] p-4 transition-colors hover:border-[#2A2A30]">
      {/* Name + status */}
      <div className="flex items-start justify-between gap-3">
        <Link
          href={agent.href}
          className="group min-w-0 focus:outline-none focus-visible:underline"
        >
          <span className="flex items-center gap-1 text-base font-semibold leading-6 text-[#F4F4F5]">
            <span className="truncate">{agent.name}</span>
            <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-[#52525B] transition-colors group-hover:text-[#A1A1AA]" />
          </span>
        </Link>
        <StatusPill status={status} />
      </div>

      <p className="mt-1 text-sm leading-5 text-[#71717A]">{agent.description}</p>

      {/* Last run + action */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#1F1F23] pt-3">
        <span className="min-w-0 truncate text-xs text-[#71717A]">
          {busy ? 'Running now…' : relativeTime(run.lastRunAt)}
        </span>

        {canRun ? (
          <button
            type="button"
            onClick={handleRun}
            disabled={busy}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[#1F1F23] bg-transparent px-2.5 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#7C3AED]/40 hover:text-[#F4F4F5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {busy ? 'Running' : 'Run Now'}
          </button>
        ) : (
          // Event-driven agents have no on-demand entry point, so the card
          // says what actually starts them rather than offering a dead button.
          <span
            className="flex-shrink-0 text-xs text-[#52525B]"
            title={agent.eventNote}
          >
            {agent.eventNote ?? 'Automatic'}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-[#EF4444]">{error}</p>}
    </div>
  )
}
