'use client'

import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

// Shared loading / error / success affordances, so every agent action on the
// dashboard reports itself the same way.

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />
}

export function LoadingRow({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#A1A1AA]" role="status">
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
      className="flex items-start gap-2 rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/10 px-3 py-2 text-sm text-[#EF4444]"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

export function SuccessMessage({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#10B981]/20 bg-[#10B981]/10 px-3 py-2 text-sm text-[#10B981]">
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
