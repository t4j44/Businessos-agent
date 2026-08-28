'use client';

import { useState, useEffect } from 'react';
import { Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, AlertTriangle } from 'lucide-react';
import { ErrorMessage, getJSON } from './AgentState';
import { TEST_CLIENT_ID } from '@/lib/client-config';

type Call = {
  id: string;
  direction: string | null;
  caller_number: string | null;
  duration_sec: number | null;
  summary: string | null;
  resolved: boolean | null;
  escalated: boolean | null;
  created_at: string | null;
};

type StatusPayload = {
  connected: boolean;
  provider: string;
  hint: string | null;
  recent_calls: Call[];
};

function duration(sec: number | null) {
  if (sec == null) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

function when(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Connection state for the telephony provider plus the client's latest calls.
// BLAND_AI_KEY is a server secret, so the API reports presence only.
export function CallCenterStatus() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const json = await getJSON(
          '/api/agents/call-center/status?client_id=' + encodeURIComponent(TEST_CLIENT_ID) + '&limit=5',
        );
        setData(json);
        setError(null);
      } catch (err: any) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg border border-[#1F1F23] bg-[#111113]" />;
  }

  if (error) return <ErrorMessage message={"Couldn't load call status — " + error} />;
  if (!data) return null;

  const { connected, provider, hint, recent_calls: calls } = data;

  return (
    <div className="rounded-lg border border-[#1F1F23] bg-[#111113]">
      {/* Connection */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1F1F23] px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ' +
              (connected ? 'bg-[#10B981]/10' : 'bg-[#F59E0B]/10')
            }
          >
            {connected
              ? <Phone className="h-4 w-4 text-[#10B981]" />
              : <PhoneOff className="h-4 w-4 text-[#F59E0B]" />}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[#F4F4F5]">{provider}</p>
            <p className="mt-0.5 text-sm text-[#71717A]">
              {connected ? 'Connected and answering calls' : hint || 'Not configured'}
            </p>
          </div>
        </div>

        <span
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ' +
            (connected
              ? 'border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981]'
              : 'border-[#F59E0B]/20 bg-[#F59E0B]/10 text-[#F59E0B]')
          }
        >
          <span className={'h-1.5 w-1.5 rounded-full ' + (connected ? 'bg-[#10B981]' : 'bg-[#F59E0B]')} />
          {connected ? 'Connected' : 'Configure API key'}
        </span>
      </div>

      {/* Last 5 calls */}
      <div className="px-5 py-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#71717A]">
          Recent calls
        </p>

        {calls.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#71717A]">
            No calls recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {calls.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-[#1F1F23] bg-[#17171A] p-3"
              >
                <div className="mt-0.5 flex-shrink-0">
                  {c.escalated ? (
                    <AlertTriangle className="h-4 w-4 text-[#EF4444]" />
                  ) : c.direction === 'outbound' ? (
                    <PhoneOutgoing className="h-4 w-4 text-[#71717A]" />
                  ) : (
                    <PhoneIncoming className="h-4 w-4 text-[#71717A]" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-[#F4F4F5]">
                      {c.caller_number || 'Unknown number'}
                    </span>
                    {c.resolved && (
                      <span className="rounded-full border border-[#10B981]/20 bg-[#10B981]/10 px-1.5 py-px text-[10px] font-medium text-[#10B981]">
                        resolved
                      </span>
                    )}
                    {c.escalated && (
                      <span className="rounded-full border border-[#EF4444]/20 bg-[#EF4444]/10 px-1.5 py-px text-[10px] font-medium text-[#EF4444]">
                        escalated
                      </span>
                    )}
                  </div>
                  {c.summary && (
                    <p className="mt-1 line-clamp-2 text-sm text-[#A1A1AA]">{c.summary}</p>
                  )}
                </div>

                <div className="flex-shrink-0 text-right">
                  <p className="text-xs text-[#71717A]">{when(c.created_at)}</p>
                  {duration(c.duration_sec) && (
                    <p className="mt-0.5 text-xs text-[#52525B]">{duration(c.duration_sec)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
