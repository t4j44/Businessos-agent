'use client'

import { useEffect, useState } from 'react'
import { getJSON, postJSON } from './AgentState'

type Delivery = { id: string; kind: string; status: string; first_attempt_at: string | null; last_error: string | null; provider_id: string | null }

export function SchedulerDeliveries() {
  const [rows, setRows] = useState<Delivery[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [receipts, setReceipts] = useState<Record<string, string>>({})
  async function load() {
    try {
      const result = await getJSON(`/api/scheduler/deliveries?page=${page}`)
      setRows(result.deliveries || []); setTotal(result.total || 0); setError('')
    } catch { setError('Could not load booking notifications.') }
  }
  useEffect(() => { void load() }, [page])
  async function retry(id: string) {
    setBusy(id)
    try { await postJSON('/api/scheduler/deliveries', { id }); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Retry failed.') }
    finally { setBusy(null) }
  }
  async function reconcile(id: string) {
    setBusy(id)
    try { await postJSON('/api/scheduler/deliveries', { id, action: 'reconcile', provider_id: receipts[id] }); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Receipt verification failed.') }
    finally { setBusy(null) }
  }
  return <section className="rounded-lg border border-line bg-surface p-5 space-y-3" aria-label="Booking notifications">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Booking notifications</h2>
      <button type="button" onClick={() => void load()} className="text-sm underline">Refresh</button></div>
    <p className="text-sm text-muted">Queued emails need delivery. Accepted means the email provider received the message; it does not prove inbox delivery.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {rows.length === 0 && !error && <p className="text-sm text-muted">No notifications on this page.</p>}
    {rows.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm">
      <div><p className="capitalize">{row.kind.replaceAll('_', ' ')} · {row.status}</p>
        {row.last_error && <p className="text-muted">{row.last_error.replaceAll('_', ' ')}</p>}
        {row.status === 'review' && <p className="text-muted">Check the provider record before attempting another send.</p>}</div>
      {(['pending','blocked'].includes(row.status) || (row.status === 'review' && !row.first_attempt_at)) && <button type="button" disabled={busy !== null} onClick={() => void retry(row.id)}
        className="rounded border border-line px-3 py-1.5 disabled:opacity-50">{busy === row.id ? 'Processing…' : 'Process delivery'}</button>}
      {row.status === 'review' && row.first_attempt_at && <div className="flex flex-wrap gap-2">
        <input aria-label="Provider email receipt ID" placeholder="Provider email receipt ID" value={receipts[row.id] || ''}
          onChange={event => setReceipts({ ...receipts, [row.id]: event.target.value })} className="rounded border border-line bg-raised p-2 text-sm" />
        <button disabled={busy !== null || !receipts[row.id]} onClick={() => void reconcile(row.id)} className="underline disabled:opacity-50">Verify receipt</button>
      </div>}
    </div>)}
    <div className="flex items-center gap-4 text-sm"><button disabled={page === 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">Previous</button>
      <span>Page {page}</span><button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Next</button></div>
  </section>
}
