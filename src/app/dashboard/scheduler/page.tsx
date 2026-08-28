'use client';

import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Check, Plus, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatusPill } from '@/components/dashboard/StatusPill';
import {
  Spinner, ErrorMessage, SuccessMessage, postJSON, getJSON,
} from '@/components/dashboard/AgentState';
import { TEST_CLIENT_ID } from '@/lib/client-config';

type Appointment = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  requested_date: string | null;
  requested_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  service_type: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
};

const EMPTY_FORM = {
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  requested_date: '',
  requested_time: '',
  service_type: '',
  notes: '',
};

function statusOf(s: string | null) {
  const key = (s || 'pending').toLowerCase();
  if (key === 'confirmed') return 'success' as const;
  if (key === 'cancelled' || key === 'canceled') return 'error' as const;
  return 'running' as const;
}

function formatDate(d: string | null) {
  if (!d) return null;
  const parsed = new Date(d + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const field =
  'w-full rounded-lg border border-[#1F1F23] bg-[#17171A] px-3 py-2 text-sm text-[#F4F4F5] placeholder:text-[#52525B] focus:border-[#7C3AED]/50 focus:outline-none';

export default function SchedulerPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Confirming happens per row, so the busy flag is keyed by appointment.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmTime, setConfirmTime] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await getJSON(
        '/api/agents/scheduler/appointments?client_id=' + encodeURIComponent(TEST_CLIENT_ID),
      );
      setAppointments(json.appointments || []);
      setByStatus(json.by_status || {});
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const json = await postJSON('/api/agents/scheduler/request', {
        client_id: TEST_CLIENT_ID,
        ...form,
      });
      setFormSuccess(
        json?.appointment?.customer_name
          ? 'Booking request logged for ' + json.appointment.customer_name + '.'
          : 'Booking request logged.',
      );
      setForm(EMPTY_FORM);
      await load();
    } catch (err: any) {
      setFormError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (appt: Appointment) => {
    // The endpoint requires a time; fall back to what the customer asked for.
    const time = confirmTime[appt.id] || appt.requested_time || '';
    if (!time) {
      setRowError('Enter a time to confirm this appointment.');
      return;
    }
    setConfirmingId(appt.id);
    setRowError(null);
    try {
      await postJSON('/api/agents/scheduler/confirm', {
        appointment_id: appt.id,
        confirmed_time: time,
      });
      await load();
    } catch (err: any) {
      setRowError(err?.message || String(err));
    } finally {
      setConfirmingId(null);
    }
  };

  const pending = appointments.filter((a) => (a.status || 'pending').toLowerCase() === 'pending');

  return (
    <div className="min-h-screen space-y-6 bg-[#0A0A0B] p-6">
      <PageHeader
        title="Scheduler"
        subtitle={
          loading
            ? 'Loading appointments…'
            : appointments.length + ' appointment' + (appointments.length === 1 ? '' : 's') +
              ' · ' + pending.length + ' awaiting confirmation'
        }
        action={
          <>
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#1F1F23] bg-transparent px-4 py-2 text-sm font-medium text-[#A1A1AA] transition-colors hover:border-[#2A2A30] hover:text-[#F4F4F5]"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="btn-accent-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New request
            </button>
          </>
        }
      />

      {/* ── Booking request form ─────────────────────────────────────────── */}
      {showForm && (
        <form
          onSubmit={submitRequest}
          className="space-y-4 rounded-lg border border-[#1F1F23] bg-[#111113] p-5"
        >
          <h2 className="text-base font-semibold text-[#F4F4F5]">New booking request</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Customer name *</span>
              <input
                required
                className={field}
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Service type</span>
              <input
                className={field}
                value={form.service_type}
                onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                placeholder="Consultation"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Email</span>
              <input
                type="email"
                className={field}
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                placeholder="jane@example.com"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Phone</span>
              <input
                className={field}
                value={form.customer_phone}
                onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
                placeholder="+1 555 010 0000"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Requested date *</span>
              <input
                required
                type="date"
                className={field}
                value={form.requested_date}
                onChange={(e) => setForm({ ...form, requested_date: e.target.value })}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-[#71717A]">Requested time</span>
              <input
                type="time"
                className={field}
                value={form.requested_time}
                onChange={(e) => setForm({ ...form, requested_time: e.target.value })}
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#71717A]">Notes</span>
            <textarea
              rows={2}
              className={field}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything the business should know"
            />
          </label>

          <p className="text-xs text-[#52525B]">
            An email or phone number is required so the customer can be reached.
          </p>

          <ErrorMessage message={formError} />
          <SuccessMessage message={formSuccess} />

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Spinner /> : <CalendarDays className="h-4 w-4" />}
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      )}

      {/* ── Appointments ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-2xl font-semibold leading-8 tracking-tight text-[#F4F4F5]">
            Appointments
          </h2>
          {Object.keys(byStatus).length > 0 && (
            <span className="text-xs text-[#71717A]">
              {Object.entries(byStatus).map(([k, v]) => v + ' ' + k).join(' · ')}
            </span>
          )}
        </div>

        <ErrorMessage message={loadError} />
        <ErrorMessage message={rowError} />

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg border border-[#1F1F23] bg-[#111113]" />
            ))}
          </div>
        ) : appointments.length === 0 && !loadError ? (
          <div className="rounded-lg border border-[#1F1F23] bg-[#111113]">
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#7C3AED]/10">
                <CalendarDays className="h-6 w-6 text-[#7C3AED]" />
              </div>
              <p className="text-sm font-medium text-[#F4F4F5]">No appointments yet</p>
              <p className="max-w-sm text-sm text-[#71717A]">
                Booking requests from your website land here for confirmation.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((a) => {
              const isPending = (a.status || 'pending').toLowerCase() === 'pending';
              const when = formatDate(a.confirmed_date || a.requested_date);
              const time = a.confirmed_time || a.requested_time;
              return (
                <div
                  key={a.id}
                  className="rounded-lg border border-[#1F1F23] bg-[#111113] p-4 transition-colors hover:border-[#2A2A30]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[#F4F4F5]">
                        {a.customer_name || 'Unnamed customer'}
                      </p>
                      <p className="mt-0.5 text-sm text-[#71717A]">
                        {[a.service_type, when, time].filter(Boolean).join(' · ') || 'No date set'}
                      </p>
                      <p className="mt-1 text-xs text-[#52525B]">
                        {[a.customer_email, a.customer_phone].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                    </div>
                    <StatusPill status={statusOf(a.status)} label={a.status || 'pending'} />
                  </div>

                  {a.notes && (
                    <p className="mt-3 border-t border-[#1F1F23] pt-3 text-sm text-[#A1A1AA]">
                      {a.notes}
                    </p>
                  )}

                  {isPending && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#1F1F23] pt-3">
                      <input
                        type="time"
                        aria-label="Confirmed time"
                        className="rounded-lg border border-[#1F1F23] bg-[#17171A] px-2.5 py-1.5 text-xs text-[#F4F4F5] focus:border-[#7C3AED]/50 focus:outline-none"
                        value={confirmTime[a.id] ?? (a.requested_time || '')}
                        onChange={(e) => setConfirmTime({ ...confirmTime, [a.id]: e.target.value })}
                      />
                      <button
                        onClick={() => confirm(a)}
                        disabled={confirmingId === a.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F1F23] px-2.5 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#7C3AED]/40 hover:text-[#F4F4F5] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {confirmingId === a.id ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                        {confirmingId === a.id ? 'Confirming…' : 'Confirm'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
