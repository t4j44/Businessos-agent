'use client'

import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Pending } from '@/components/ui/Skeleton'

// Shared loading / error / success affordances, so every agent action on the
// dashboard reports itself the same way.

/**
 * Kept under its old name so existing call sites do not change, but nothing
 * rotates any more. A barber-pole makes a wait feel longer than it is; three
 * dots breathing in sequence say the same thing without the drag.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <Pending className={className} />
}

export function LoadingRow({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorMessage({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-crit/20 bg-crit/10 px-3 py-2 text-sm text-crit"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

export function SuccessMessage({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-good/20 bg-good/10 px-3 py-2 text-sm text-good">
      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

// Every agent call on the dashboard goes through this, so a non-200 always
// surfaces the server's own message instead of a bare "failed to fetch".
export async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json as T
}

export async function getJSON<T = any>(url: string): Promise<T> {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json as T
}
