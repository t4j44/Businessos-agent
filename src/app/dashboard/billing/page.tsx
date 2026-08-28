'use client';

import { useState, useEffect, useCallback } from 'react';
import { CreditCard } from 'lucide-react';

interface Plan {
  tier: string;
  label: string;
  price_monthly: number | null;
  status: string | null;
  billing_connected: boolean;
  member_since: string | null;
}

interface Usage {
  leads_total: number;
  calls_total: number;
  voice_minutes_this_month: number;
  tokens_used: number;
  token_limit: number | null;
  cost_usd_this_month: number;
  cost_usd_lifetime: number | null;
}

// A meter only renders when there is a real limit to measure against.
function Meter({ label, used, limit, format, color }: {
  label: string;
  used: number;
  limit: number | null;
  format: (n: number) => string;
  color: string;
}) {
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : null;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-[#A1A1AA]">{label}</span>
        <span className="text-white font-medium">
          {format(used)}{limit ? ` / ${format(limit)}` : ''}
        </span>
      </div>
      {pct !== null ? (
        <div className="w-full bg-[#17171A] h-2 rounded-full overflow-hidden">
          <div className={`${color} h-full`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <p className="text-xs text-[#52525B]">No limit set on your plan</p>
      )}
    </div>
  );
}

export default function BillingDashboard() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/billing');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPlan(json.plan);
      setUsage(json.usage);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleManageBilling = async () => {
    setLoadingPortal(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json?.error || 'Could not open the billing portal.');
      window.location.href = json.url;
    } catch (err: any) {
      setPortalError(err?.message || String(err));
    } finally {
      setLoadingPortal(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <div className="h-20 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-56 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
          <div className="h-56 rounded-xl border border-[#1F1F23] bg-[#111113] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !plan || !usage) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto text-[#F4F4F5]">
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load billing — {error ?? 'no data returned'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto text-[#F4F4F5]">
      <div className="mb-8">
        <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-[#F4F4F5] mb-1">Billing &amp; Usage</h1>
        <p className="text-[#A1A1AA]">Manage your subscription, usage limits, and invoices.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Current Plan */}
        <div className="col-span-1 md:col-span-2 bg-[#111113] border border-[#1F1F23] rounded-xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#7C3AED] opacity-10 rounded-full blur-3xl transform translate-x-10 -translate-y-10"></div>

          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="text-sm font-medium text-[#7C3AED] mb-1">CURRENT PLAN</div>
              <h2 className="text-3xl font-semibold text-[#F4F4F5] mb-2 capitalize">{plan.label}</h2>
              <p className="text-[#A1A1AA] text-sm">
                {plan.billing_connected
                  ? 'Billing is connected — manage renewals in the Stripe portal.'
                  : 'No payment method on file yet.'}
              </p>
            </div>
            <div className="text-right">
              {plan.price_monthly !== null ? (
                <>
                  <div className="text-3xl font-semibold text-[#F4F4F5]">${plan.price_monthly}</div>
                  <div className="text-[#A1A1AA] text-sm">/month</div>
                </>
              ) : (
                <div className="text-[#52525B] text-3xl font-bold">—</div>
              )}
            </div>
          </div>

          <div className="border-t border-[#1F1F23] pt-5 mt-2 flex flex-col sm:flex-row gap-4 items-center">
            <button
              onClick={handleManageBilling}
              disabled={loadingPortal || !plan.billing_connected}
              title={plan.billing_connected ? undefined : 'Connect a payment method first'}
              className="px-5 py-2 bg-[#17171A] hover:bg-[#1F1F23] text-white text-sm font-medium rounded-lg transition-colors border border-[#1F1F23] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingPortal ? 'Loading...' : 'Manage Billing'}
            </button>
            {plan.tier !== 'agency' && (
              <button
                onClick={() => window.location.href = '/pricing'}
                className="px-5 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-medium rounded-lg transition-colors"
              >
                Upgrade Plan
              </button>
            )}
            {portalError && <p className="text-xs text-red-400">{portalError}</p>}
          </div>
        </div>

        {/* Usage meters */}
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
          <h3 className="text-lg font-semibold text-[#F4F4F5] mb-4">Current Usage</h3>

          <div className="space-y-5">
            <Meter
              label="AI tokens"
              used={usage.tokens_used}
              limit={usage.token_limit}
              format={(n) => n.toLocaleString()}
              color="bg-[#7C3AED]"
            />
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-[#A1A1AA]">Voice minutes (this month)</span>
                <span className="text-white font-medium">{usage.voice_minutes_this_month}</span>
              </div>
              <p className="text-xs text-[#52525B]">
                Across {usage.calls_total} call{usage.calls_total === 1 ? '' : 's'} handled
              </p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-[#A1A1AA]">Agent cost (this month)</span>
                <span className="text-white font-medium">${usage.cost_usd_this_month.toFixed(2)}</span>
              </div>
              <p className="text-xs text-[#52525B]">Metered from every agent run</p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-[#A1A1AA]">Leads stored</span>
                <span className="text-white font-medium">{usage.leads_total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice History */}
      <div className="bg-[#111113] border border-[#1F1F23] rounded-xl overflow-hidden">
        <div className="p-5 border-b border-[#1F1F23]">
          <h3 className="text-lg font-semibold text-[#F4F4F5]">Invoice History</h3>
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7C3AED]/10">
            <CreditCard className="h-6 w-6 text-[#7C3AED]" />
          </div>
          <p className="text-sm text-[#A1A1AA]">
            {plan.billing_connected
              ? 'Your subscription invoices live in the Stripe billing portal.'
              : 'No subscription invoices yet — they appear once billing is connected.'}
          </p>
          {plan.billing_connected && (
            <button
              onClick={handleManageBilling}
              disabled={loadingPortal}
              className="text-[#7C3AED] hover:text-[#7C3AED] font-medium text-sm disabled:opacity-50"
            >
              Open billing portal →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
