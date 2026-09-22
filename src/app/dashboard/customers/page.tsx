'use client';

import { useEffect, useState } from 'react';
import { Users, ArrowLeft, ArrowRight } from 'lucide-react';

type Customer = { id: string; name: string | null; email: string | null; phone: string | null; status: string; score: number };
type Interaction = { id: string; agent_name: string; interaction_type: string; summary: string; created_at: string };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ customer: Customer; interactions: Interaction[]; total_interactions: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/customers?page=${page}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Customers could not be loaded.');
      setCustomers(data.customers); setTotal(data.total);
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page]);
  async function open(id: string) {
    setBusy(true); setError(''); setSelected(null);
    try {
      const response = await fetch(`/api/customers/${id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'History could not be loaded.');
      setSelected(data);
    } catch (error) { setError(error instanceof Error ? error.message : 'History could not be loaded.'); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
    <header><div className="flex items-center gap-3"><Users className="h-6 w-6 text-accent" /><h1 className="text-2xl font-semibold text-text">Customers</h1></div>
      <p className="mt-2 max-w-2xl text-sm text-muted">People identified by an email or phone number, with their recorded business interactions. Anonymous website chats stay separate.</p></header>
    {error && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 p-4 text-sm text-bad">{error}</p>}
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label="Customer list" className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-3 font-medium text-text">{total} customers</h2>
        {loading ? <p role="status" className="text-sm text-muted">Loading customers…</p> : customers.length === 0 ? <p className="py-8 text-sm text-muted">No identified customers yet. Verified calls and recorded customer workflows will appear here.</p> :
          <ul className="divide-y divide-line">{customers.map(customer => <li key={customer.id}><button disabled={busy} onClick={() => open(customer.id)} className="w-full rounded-lg px-2 py-4 text-left hover:bg-line/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <span className="block font-medium text-text">{customer.name || customer.email || customer.phone || 'Unnamed customer'}</span>
            <span className="mt-1 block break-all text-xs text-muted">{[customer.email, customer.phone].filter(Boolean).join(' · ')}</span>
            <span className="mt-1 block text-xs text-dim">{customer.status}</span>
          </button></li>)}</ul>}
        <div className="mt-4 flex items-center justify-between text-sm"><button aria-label="Previous customer page" disabled={page === 0 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border border-line p-2 disabled:opacity-40"><ArrowLeft className="h-4 w-4" /></button><span className="text-muted">Page {page + 1}</span><button aria-label="Next customer page" disabled={(page + 1) * 50 >= total || loading} onClick={() => setPage(page + 1)} className="rounded-lg border border-line p-2 disabled:opacity-40"><ArrowRight className="h-4 w-4" /></button></div>
      </section>
      <section aria-label="Customer history" aria-live="polite" className="rounded-2xl border border-line bg-surface p-5">
        {busy ? <p className="text-sm text-muted">Loading history…</p> : !selected ? <p className="text-sm text-muted">Select a customer to read their history.</p> : <>
          <h2 className="font-medium text-text">{selected.customer.name || selected.customer.email || selected.customer.phone}</h2>
          <p className="mt-1 text-xs text-dim">Showing {selected.interactions.length} of {selected.total_interactions} recorded interactions.</p>
          {selected.interactions.length === 0 && <p className="mt-6 text-sm text-muted">No interactions have been recorded.</p>}
          <ol className="mt-5 space-y-5">{selected.interactions.map(item => <li key={item.id} className="border-l-2 border-accent/30 pl-4">
            <p className="text-xs font-medium text-accent">{item.agent_name.replace(/_/g, ' ')} · {item.interaction_type.replace(/_/g, ' ')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text">{item.summary}</p>
            <time className="mt-2 block text-xs text-dim" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
          </li>)}</ol>
        </>}
      </section>
    </div>
  </div>;
}
