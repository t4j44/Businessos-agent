'use client';

import { useEffect, useState } from 'react';
import { Inbox, ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';

type Summary = { id: string; last_activity_at: string; last_message_preview: string | null; message_count: number; handoff_status: string; visitor_name: string | null };
type Conversation = { id: string; message_count: number; handoff_status: string; handoff_request_key: string | null; visitor_name: string | null; visitor_email: string | null; visitor_phone: string | null; handoff_reason: string | null; requested_at: string | null; resolved_at: string | null };
type Message = { id: number; role: string; content: string; created_at: string };
type Detail = { conversation: Conversation; messages: Message[]; has_older: boolean };
const button = 'rounded-lg border border-line px-3 py-2 text-sm text-text hover:bg-raised disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

async function json(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

export default function ConversationsPage() {
  const [rows, setRows] = useState<Summary[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(0), [filter, setFilter] = useState('requested'), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/conversations?page=${page}&status=${filter}`, { signal: controller.signal }).then(json)
      .then(data => { setRows(data.conversations); setTotal(data.total); })
      .catch(error => { if (error.name !== 'AbortError') setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, filter, refresh]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    const controller = new AbortController();
    setDetailLoading(true);
    fetch(`/api/conversations/${selected}`, { signal: controller.signal }).then(json)
      .then(setDetail).catch(error => { if (error.name !== 'AbortError') setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, refresh]);

  async function older() {
    if (!detail || !selected || !detail.messages.length) return;
    setBusy(true); setError('');
    try {
      const next: Detail = await json(await fetch(`/api/conversations/${selected}?before=${detail.messages[0].id}`));
      setDetail(current => current && current.conversation.id === next.conversation.id
        ? { ...next, messages: [...next.messages, ...current.messages] } : current);
    } catch (error) { setError(error instanceof Error ? error.message : 'Older messages could not be loaded.'); }
    finally { setBusy(false); }
  }

  async function resolve() {
    if (!detail || !selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await json(await fetch(`/api/conversations/${selected}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', request_key: detail.conversation.handoff_request_key }) }));
      setNotice('Marked resolved. No message was sent to the visitor.'); setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Request could not be resolved.'); }
    finally { setBusy(false); }
  }

  const conversation = detail?.conversation;
  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-3 text-2xl font-semibold text-text"><Inbox className="h-6 w-6 text-accent" />Conversation inbox</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Review website chats and requests for human help. Contact visitors through your usual business channels, then mark requests resolved.</p></div>
      <button className={button} disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="mr-2 inline h-4 w-4" />Refresh</button>
    </header>
    {error && <p role="alert" className="rounded-xl border border-crit/30 bg-crit/10 p-4 text-sm text-crit">{error}</p>}
    {notice && <p role="status" className="text-sm text-good">{notice}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section aria-label="Conversation list" className="min-w-0 rounded-xl border border-line bg-surface p-4">
        <label className="block text-xs text-muted">Show conversations<select value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setPage(0); setSelected(null); setNotice(''); }} className="mt-2 block w-full rounded-lg border border-line bg-raised p-2 text-sm text-text">
          <option value="requested">Needs human help</option><option value="all">All conversations</option><option value="resolved">Resolved requests</option>
        </select></label>
        {loading ? <p role="status" className="py-8 text-sm text-muted">Loading conversations…</p> : rows.length === 0 ? <p className="py-8 text-sm text-muted">No conversations in this view. Saved website chats appear under All conversations.</p> :
          <ul className="mt-3 divide-y divide-line">{rows.map(row => <li key={row.id}><button onClick={() => { setSelected(row.id); setNotice(''); }} disabled={busy} aria-pressed={selected === row.id}
            className={`w-full rounded-lg px-2 py-4 text-left hover:bg-raised disabled:opacity-50 ${selected === row.id ? 'bg-raised' : ''}`}>
            <span className="block text-sm font-medium text-text">{row.visitor_name || 'Website visitor'}{row.handoff_status === 'requested' && <span className="ml-2 text-xs text-warn">Needs help</span>}</span>
            <span className="mt-1 block break-words text-xs text-muted">{row.last_message_preview || 'Human help requested'}</span>
            <span className="mt-2 block text-xs text-dim">{row.message_count} messages · {new Date(row.last_activity_at).toLocaleString()}</span>
          </button></li>)}</ul>}
        <div className="mt-4 flex items-center justify-between gap-2"><button className={button} aria-label="Previous inbox page" disabled={page === 0 || loading || busy} onClick={() => setPage(page - 1)}><ArrowLeft className="h-4 w-4" /></button><span className="text-xs text-muted">Page {page + 1} · {total} conversations</span><button className={button} aria-label="Next inbox page" disabled={(page + 1) * 50 >= total || loading || busy} onClick={() => setPage(page + 1)}><ArrowRight className="h-4 w-4" /></button></div>
      </section>
      <section aria-label="Conversation details" aria-live="polite" className="min-w-0 rounded-xl border border-line bg-surface p-5">
        {detailLoading ? <p className="text-sm text-muted">Loading conversation…</p> : !detail || !conversation ? <p className="text-sm text-muted">Select a conversation to read its saved messages.</p> : <>
          <h2 className="font-medium text-text">{conversation.visitor_name || 'Website visitor'}</h2>
          {conversation.handoff_status !== 'none' && <div className="my-4 space-y-3 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
            <p className="font-medium text-text">{conversation.handoff_status === 'requested' ? 'Human help requested' : 'Request resolved'}</p>
            <p className="whitespace-pre-wrap break-words text-muted">{conversation.handoff_reason}</p>
            <p className="break-all text-text">{[conversation.visitor_email, conversation.visitor_phone].filter(Boolean).join(' · ')}</p>
            <p className="text-xs text-muted">Contact details were supplied by the visitor and are unverified. No customer identity or private account access has been confirmed.</p>
            {conversation.handoff_status === 'requested' && <button className={button} disabled={busy} onClick={resolve}>Mark resolved after handling</button>}
          </div>}
          {detail.has_older && <button className={`${button} my-3`} disabled={busy} onClick={older}>Load older messages</button>}
          <p className="my-3 text-xs text-muted">{detail.messages.length} of {conversation.message_count} saved messages</p>
          <ol className="space-y-3">{detail.messages.map(message => <li key={message.id} className={`rounded-lg border border-line p-3 ${message.role === 'user' ? 'bg-raised' : ''}`}>
            <p className="mb-1 text-xs font-medium text-muted">{message.role === 'user' ? 'Visitor' : 'AI assistant'} · {new Date(message.created_at).toLocaleString()}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-text">{message.content}</p>
          </li>)}</ol>
          {detail.messages.length === 0 && <p className="text-sm text-muted">This visitor requested help without a saved AI conversation.</p>}
        </>}
      </section>
    </div>
  </div>;
}
