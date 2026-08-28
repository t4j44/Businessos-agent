'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Upload, RefreshCw, CheckCircle2, Clock, AlertCircle, Zap, Building2, Mail, Globe } from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  running:   'bg-[#7C3AED]/15 text-[#7C3AED] border-[#7C3AED]/20',
  queued:    'bg-[#52525B]/15 text-[#A1A1AA] border-[#2A2A30]/20',
  failed:    'bg-red-500/15 text-red-400 border-red-500/20',
};

const STATUS_ICON: Record<string, React.ElementType> = {
  completed: CheckCircle2,
  running:   RefreshCw,
  queued:    Clock,
  failed:    AlertCircle,
};

interface QueueItem {
  id: string;
  name: string;
  company: string;
  email: string | null;
  linkedin: string | null;
  status: string;
  created_at: string;
}

interface Stats {
  leads_enriched: number;
  emails_found: number;
  companies_scraped: number;
  enrichment_rate: number | null;
}

interface Source {
  name: string;
  desc: string;
  connected: boolean;
}

function timeAgo(iso: string) {
  if (!iso) return '';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function EnrichmentPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/enrichment');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setQueue(json.queue || []);
      setStats(json.stats);
      setSources(json.sources || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploadCsv = async (file: File) => {
    setUploading(true);
    setUploadMessage(null);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/agents/enrichment/csv-import', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setUploadMessage(
        `Imported ${json.imported} lead${json.imported === 1 ? '' : 's'}` +
        (json.skipped ? ` · ${json.skipped} row${json.skipped === 1 ? '' : 's'} skipped` : ''),
      );
      await load();
    } catch (err: any) {
      setUploadError(err?.message || String(err));
    } finally {
      setUploading(false);
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadCsv(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadCsv(file);
  };

  const running = queue.filter((r) => r.status === 'running').length;

  const uploadButton = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        onChange={onFilePicked}
        className="hidden"
      />
      <button
        onClick={() => fileInput.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 px-4 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
      >
        {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {uploading ? 'Importing…' : 'Upload CSV'}
      </button>
    </>
  );

  const header = (
    <div className="flex items-center justify-between">
      <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-[#F4F4F5] flex items-center gap-2">
        <Database className="w-6 h-6 text-[#7C3AED]" />
        Enrichment Engine
      </h1>
      {uploadButton}
    </div>
  );

  const uploadFeedback = (uploadMessage || uploadError) && (
    <p className={`text-sm ${uploadError ? 'text-red-400' : 'text-emerald-400'}`}>
      {uploadError ?? uploadMessage}
    </p>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-[#1F1F23]/50 bg-[#111113] animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-xl border border-[#1F1F23]/50 bg-[#111113] animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-[#F4F4F5]">
        <div className="bg-[#111113] rounded-xl border border-[#1F1F23]/50 p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load enrichment data — {error}</p>
        </div>
      </div>
    );
  }

  // ── Nothing to enrich yet ────────────────────────────────────────────────
  if (queue.length === 0) {
    return (
      <div className="p-6 space-y-6 text-[#F4F4F5]">
        {header}
        {uploadFeedback}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`bg-[#111113] rounded-xl border-2 border-dashed transition-colors ${
            dragging ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-[#1F1F23]/50'
          }`}
        >
          <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#7C3AED]/15">
              <Database className="h-7 w-7 text-[#7C3AED]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                No leads to enrich yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[#71717A]">
                Drop a CSV here or import leads from Outreach. Every lead your agents
                find gets an email, LinkedIn profile, and company context attached here.
              </p>
            </div>
            {uploadButton}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-[#F4F4F5]">
      {header}
      {uploadFeedback}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Leads Enriched',    value: stats.leads_enriched.toLocaleString(),    icon: Database,  color: 'text-[#7C3AED]',    hasData: stats.leads_enriched > 0 },
            { label: 'Emails Found',      value: stats.emails_found.toLocaleString(),      icon: Mail,      color: 'text-emerald-400', hasData: stats.emails_found > 0 },
            { label: 'Companies Scraped', value: stats.companies_scraped.toLocaleString(), icon: Building2, color: 'text-[#7C3AED]',  hasData: stats.companies_scraped > 0 },
            { label: 'Enrichment Rate',   value: `${stats.enrichment_rate}%`,              icon: Zap,       color: 'text-amber-400',   hasData: stats.enrichment_rate !== null },
          ].map((s) => (
            <div key={s.label} className="bg-[#111113] rounded-xl border border-[#1F1F23]/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <p className="text-[#A1A1AA] text-xs font-medium uppercase tracking-wider">{s.label}</p>
              </div>
              <p className={`text-2xl font-bold ${s.hasData ? 'text-white' : 'text-[#52525B]'}`}>
                {s.hasData ? s.value : '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Enrichment Queue */}
        <div className="lg:col-span-2 bg-[#111113] rounded-xl border border-[#1F1F23]/50">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F1F23]/50">
            <h2 className="text-white font-semibold text-sm">Enrichment Queue</h2>
            <span className="text-xs text-[#71717A]">{running} running</span>
          </div>

          <div className="divide-y divide-[#1F1F23]/40">
            {queue.map((item) => {
              const Icon = STATUS_ICON[item.status];
              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#F4F4F5] text-sm font-medium">{item.name}</p>
                    <p className="text-[#71717A] text-xs flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {item.company || 'Unknown company'}
                    </p>
                  </div>

                  {/* Enriched data */}
                  {item.email ? (
                    <div className="hidden sm:flex flex-col text-xs text-[#A1A1AA] min-w-0">
                      <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 flex-shrink-0" />{item.email}</span>
                      {item.linkedin && (
                        <span className="flex items-center gap-1 truncate text-[#52525B]"><Globe className="w-3 h-3 flex-shrink-0" />{item.linkedin}</span>
                      )}
                    </div>
                  ) : (
                    <span className="hidden sm:block text-xs text-[#52525B] italic w-40">Awaiting enrichment</span>
                  )}

                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border flex-shrink-0 ${STATUS_STYLE[item.status]}`}>
                    <Icon className={`w-3 h-3 ${item.status === 'running' ? 'animate-spin' : ''}`} />
                    {item.status}
                  </span>

                  <span className="text-xs text-[#52525B] flex-shrink-0 w-20 text-right">{timeAgo(item.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Data sources */}
        <div className="bg-[#111113] rounded-xl border border-[#1F1F23]/50">
          <div className="px-5 py-4 border-b border-[#1F1F23]/50">
            <h2 className="text-white font-semibold text-sm">Data Sources</h2>
            <p className="text-xs text-[#71717A] mt-0.5">Based on configured API keys</p>
          </div>
          <div className="divide-y divide-[#1F1F23]/40">
            {sources.map((src) => (
              <div key={src.name} className="flex items-center gap-3 px-5 py-3.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${src.connected ? 'bg-emerald-400' : 'bg-[#2A2A30]'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[#F4F4F5] text-sm font-medium">{src.name}</p>
                  <p className="text-[#71717A] text-xs truncate">{src.desc}</p>
                </div>
                <span className={`text-xs font-medium ${src.connected ? 'text-emerald-400' : 'text-[#71717A]'}`}>
                  {src.connected ? 'connected' : 'not configured'}
                </span>
              </div>
            ))}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`mx-4 mb-4 mt-2 border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
              dragging ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-[#1F1F23]/50 hover:border-[#2A2A30]/50'
            }`}
          >
            <Upload className="w-6 h-6 text-[#71717A] mx-auto mb-2" />
            <p className="text-xs text-[#71717A]">Drag a CSV here or</p>
            <button
              onClick={() => fileInput.current?.click()}
              className="text-xs text-[#7C3AED] hover:text-[#7C3AED] font-medium mt-1"
            >
              browse files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
