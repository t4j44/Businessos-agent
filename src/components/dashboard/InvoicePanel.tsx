'use client';

import { useState, useEffect, useCallback } from 'react';
import { FilePlus2, RefreshCw, Mail } from 'lucide-react';
import {
  Spinner, ErrorMessage, SuccessMessage, postJSON, getJSON,
} from './AgentState';
import { TEST_CLIENT_ID } from '@/lib/client-config';

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
  paid: 'border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981]',
  sent: 'border-[#7C3AED]/20 bg-[#7C3AED]/10 text-[#7C3AED]',
  overdue: 'border-[#EF4444]/20 bg-[#EF4444]/10 text-[#EF4444]',
  paused: 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]',
};

function money(cents: number | null) {
  return '$' + ((Number(cents) || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

const field =
  'w-full rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2 text-sm text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#7C3AED]/50 focus:outline-none';

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
        '/api/invoices?client_id=' + encodeURIComponent(TEST_CLIENT_ID) + '&limit=25',
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
        client_id: TEST_CLIENT_ID,
        customer_name: form.customer_name || null,
        customer_email: form.customer_email,
        // The route accepts dollars and converts; sending `amount` keeps the
        // form honest about what the operator typed.
        amount: Number(form.amount),
        due_date: form.due_date || null,
      });

      const emailed = json?.email?.sent;
      setFormSuccess(
        'Invoice created' + (emailed ? ' and emailed to ' + form.customer_email : '') + '.',
      );
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
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-[#1F1F23] bg-[#111113] p-5">
        <div>
          <h2 className="text-base font-semibold text-[#F4F4F5]">Create invoice</h2>
          <p className="mt-0.5 text-sm text-[#71717A]">
            Logging an invoice sends the first email straight away.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[#71717A]">Customer name</span>
            <input
              className={field}
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="Acme Ltd"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-[#71717A]">Customer email *</span>
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
            <span className="text-xs font-medium text-[#71717A]">Amount (USD) *</span>
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
            <span className="text-xs font-medium text-[#71717A]">Due date</span>
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
          className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Spinner /> : <FilePlus2 className="h-4 w-4" />}
          {submitting ? 'Creating…' : 'Create invoice'}
        </button>
      </form>

      {/* ── Logged invoices ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[#1F1F23] bg-[#111113]">
        <div className="flex items-center justify-between gap-3 border-b border-[#1F1F23] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#F4F4F5]">Logged invoices</h2>
            <p className="mt-0.5 text-sm text-[#71717A]">
              {listLoading ? 'Loading…' : invoices.length + ' on record'}
            </p>
          </div>
          <button
            onClick={loadList}
            className="rounded-lg p-1.5 text-[#71717A] transition-colors hover:bg-[#17171A] hover:text-[#F4F4F5]"
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
                <div key={i} className="h-14 animate-pulse rounded-lg bg-[#17171A]" />
              ))}
            </div>
          ) : invoices.length === 0 && !listError ? (
            <p className="py-10 text-center text-sm text-[#71717A]">
              Nothing logged yet — create the first one.
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#F4F4F5]">
                      {inv.customer_name || inv.customer_email || 'Unnamed'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[#71717A]">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      {inv.customer_email}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold text-[#F4F4F5]">
                      {money(inv.amount_cents)}
                    </span>
                    <span
                      className={
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium ' +
                        (STATUS_TINT[String(inv.status)] ?? 'border-[#2A2A30] bg-[#52525B]/10 text-[#A1A1AA]')
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
