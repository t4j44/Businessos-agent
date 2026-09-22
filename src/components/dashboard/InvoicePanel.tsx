'use client';

import { useState, useEffect, useCallback } from 'react';
import { FilePlus2, RefreshCw, Mail } from 'lucide-react';
import {
  Spinner, ErrorMessage, SuccessMessage, postJSON, getJSON,
} from './AgentState';

type Invoice = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  amount_cents: number | null;
  due_date: string | null;
  status: string | null;
  chase_step: number | null;
  days_overdue: number | null;
  created_at: string | null;
};

const EMPTY = {
  customer_name: '',
  customer_email: '',
  amount: '',
  due_date: '',
};

const STATUS_TINT: Record<string, string> = {
  paid: 'border-good/20 bg-good/10 text-good',
  sent: 'border-accent/20 bg-accent/10 text-accent',
  overdue: 'border-crit/20 bg-crit/10 text-crit',
  paused: 'border-warn/20 bg-warn/10 text-warn',
};

function money(cents: number | null) {
  return '$' + ((Number(cents) || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

const field =
  'w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none';

// Create an invoice and see what has been logged. Creation goes through
// POST /api/invoices, which also sends the first-touch email; the chase ladder
// picks the row up separately once it goes overdue.
export function InvoicePanel({ onCreated }: { onCreated?: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const json = await getJSON(
        '/api/invoices?limit=25',
      );
      setInvoices(json.invoices || []);
      setListError(null);
    } catch (err: any) {
      setListError(err?.message || String(err));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const json = await postJSON('/api/invoices', {
        customer_name: form.customer_name || null,
        customer_email: form.customer_email,
        // The route accepts dollars and converts; sending `amount` keeps the
        // form honest about what the operator typed.
        amount: Number(form.amount),
        due_date: form.due_date || null,
      });

      const emailed = json?.email?.sent;
      setFormSuccess(
        emailed ? 'Invoice created. Email accepted for ' + form.customer_email + '.' : 'Invoice saved as a draft. Email was not accepted.',
      );
      if (json?.email?.error || json?.email?.skipped) setFormError(json.email.error || json.email.skipped);
      setForm(EMPTY);
      await loadList();
      onCreated?.();
    } catch (err: any) {
      setFormError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* ── Create ─────────────────────────────────────────────────────── */}
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5">
        <div>
          <h2 className="text-base font-semibold text-text">Create invoice</h2>
          <p className="mt-0.5 text-sm text-dim">
            Creates the invoice and attempts its first email. Unsent invoices remain drafts.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-dim">Customer name</span>
            <input
              className={field}
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Acme Ltd"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-dim">Customer email *</span>
            <input
              required
              type="email"
              className={field}
              value={form.customer_email}
              onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
              placeholder="billing@acme.com"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-dim">Amount (USD) *</span>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              className={field}
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="1200.00"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-dim">Due date</span>
            <input
              type="date"
              className={field}
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </label>
        </div>

        <ErrorMessage message={formError} />
        <SuccessMessage message={formSuccess} />

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Spinner /> : <FilePlus2 className="h-4 w-4" />}
          {submitting ? 'Creating…' : 'Create invoice'}
        </button>
      </form>

      {/* ── Logged invoices ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-text">Logged invoices</h2>
            <p className="mt-0.5 text-sm text-dim">
              {listLoading ? 'Loading…' : invoices.length + ' on record'}
            </p>
          </div>
          <button
            onClick={loadList}
            className="rounded-lg p-1.5 text-dim transition-colors hover:bg-raised hover:text-text"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-3">
          <ErrorMessage message={listError} />

          {listLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-raised" />
              ))}
            </div>
          ) : invoices.length === 0 && !listError ? (
            <p className="py-10 text-center text-sm text-dim">
              Nothing logged yet — create the first one.
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text">
                      {inv.customer_name || inv.customer_email || 'Unnamed'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-dim">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      {inv.customer_email}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold text-text">
                      {money(inv.amount_cents)}
                    </span>
                    <span
                      className={
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium ' +
                        (STATUS_TINT[String(inv.status)] ?? 'border-line-strong bg-faint/10 text-muted')
                      }
                    >
                      {inv.status || 'unknown'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
