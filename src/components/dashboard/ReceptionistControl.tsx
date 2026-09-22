'use client';
import { useEffect, useState } from 'react';

export function ReceptionistControl() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/receptionist/control').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (active) setEnabled(data.enabled);
    }).catch(error => { if (active) setError(error.message || 'Settings unavailable.'); });
    return () => { active = false; };
  }, []);
  async function toggle() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/receptionist/control', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setEnabled(data.enabled);
    } catch (error) { setError(error instanceof Error ? error.message : 'Settings could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-medium text-text">Website replies</h2><p className="mt-1 text-xs text-muted">{enabled === null ? 'Loading control…' : enabled ? 'Enabled. Replies require an active account and available usage.' : 'Paused. New messages will receive a contact-the-business notice.'}</p></div>
      <button disabled={enabled === null || busy} onClick={toggle} className="rounded-lg border border-line px-4 py-2 text-sm text-text hover:bg-line/40 disabled:opacity-40">{busy ? 'Saving…' : enabled ? 'Pause replies' : 'Enable replies'}</button></div>
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
  </section>;
}
