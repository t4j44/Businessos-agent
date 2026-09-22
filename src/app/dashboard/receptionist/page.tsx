'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Copy, Check, RefreshCw, Phone, CalendarCheck } from 'lucide-react';
import { ReceptionistControl } from '@/components/dashboard/ReceptionistControl';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { ErrorMessage, getJSON } from '@/components/dashboard/AgentState';
import { Skeleton } from '@/components/ui/Skeleton';

type WidgetConfig = {
  company_name: string;
  brand_color_primary: string;
  logo_url: string | null;
  welcome_message: string;
  greeting_text: string | null;
  booking_url: string | null;
  phone: string | null;
  cta_label: string;
  plan_tier: string;
};

const WIDGET_SRC = '/widget/widget.js';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wider text-dim">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-text">{value}</span>
    </div>
  );
}

export default function ReceptionistPage() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const session = await getJSON('/api/dashboard/client');
      const id = session.id;
      if (!id) throw new Error('Complete business setup first.');
      setClientId(id);
      const json = await getJSON('/api/widget/config?client_id=' + encodeURIComponent(id));
      setConfig(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Mount the real widget on this page so the preview is the shipped script,
  // not a mock-up of it. widget.js reads data-client-id off its own tag.
  useEffect(() => {
    if (!clientId) return;
    if (document.querySelector('script[data-bos-widget]')) {
      setWidgetLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.setAttribute('data-client-id', clientId);
    script.setAttribute('data-bos-widget', 'true');
    script.onload = () => setWidgetLoaded(true);
    script.onerror = () => setError('Could not load ' + WIDGET_SRC);
    document.body.appendChild(script);

    return () => {
      // Leave the script itself in place (re-running it would double-mount the
      // launcher); only clear anything it rendered.
      document.querySelectorAll('[id^="bos-widget"], [class^="bos-widget"]').forEach((el) => el.remove());
      script.removeAttribute('data-bos-widget');
      script.remove();
      setWidgetLoaded(false);
    };
  }, [clientId]);

  const embedSnippet =
    '<script src="' + (typeof window === 'undefined' ? '' : window.location.origin) + '/widget/widget.js" data-client-id="' +
    (clientId || '') +
    '" async></script>';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard is blocked in this browser — copy the snippet manually.');
    }
  };

  return (
    <div className="min-h-screen space-y-6 bg-canvas p-6">
      <PageHeader
        title="Receptionist"
        subtitle="The chat widget your customers see, running live on this page."
        action={
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-transparent px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            <RefreshCw className="h-4 w-4" />
      <ReceptionistControl /> Reload config
          </button>
        }
      />

      <ErrorMessage message={error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Live config ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text">Widget configuration</h2>
            <span
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ' +
                (widgetLoaded
                  ? 'border-good/20 bg-good/10 text-good'
                  : 'border-warn/20 bg-warn/10 text-warn')
              }
            >
              <span className={'h-1.5 w-1.5 rounded-full ' + (widgetLoaded ? 'bg-good' : 'bg-warn animate-pulse')} />
              {widgetLoaded ? 'Widget mounted' : 'Mounting…'}
            </span>
          </div>

          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          ) : config ? (
            <div>
              <Row label="Company" value={config.company_name} />
              <Row
                label="Brand colour"
                value={
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-4 w-4 flex-shrink-0 rounded border border-line-strong"
                      style={{ backgroundColor: config.brand_color_primary }}
                    />
                    <code className="text-xs">{config.brand_color_primary}</code>
                  </span>
                }
              />
              <Row label="Welcome message" value={config.welcome_message} />
              <Row label="CTA label" value={config.cta_label} />
              <Row
                label="Phone"
                value={
                  config.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-dim" />
                      {config.phone}
                    </span>
                  ) : (
                    <span className="text-faint">Not set</span>
                  )
                }
              />
              <Row
                label="Booking URL"
                value={
                  config.booking_url ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarCheck className="h-3.5 w-3.5 text-dim" />
                      {config.booking_url}
                    </span>
                  ) : (
                    <span className="text-faint">Not set</span>
                  )
                }
              />
              <Row label="Plan" value={<span className="capitalize">{config.plan_tier}</span>} />
            </div>
          ) : (
            !error && <p className="text-sm text-dim">No configuration returned.</p>
          )}
        </div>

        {/* ── Embed snippet ──────────────────────────────────────────────── */}
        <div className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-text">Install on your site</h2>
          <p className="mt-1 text-sm text-dim">
            Paste this before the closing body tag. One line, no dependencies.
          </p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-raised p-3">
            <code className="whitespace-pre text-xs text-muted">{embedSnippet}</code>
          </div>

          <button
            onClick={copy}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-transparent px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy snippet'}
          </button>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/10 p-3">
            <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
            <p className="text-sm text-muted">
              The launcher in the corner of this page is the live widget. Open it to
              talk to the receptionist exactly as a visitor would.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
