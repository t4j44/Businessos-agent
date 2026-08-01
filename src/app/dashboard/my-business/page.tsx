'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Pencil, Check, X, Plus, Trash2, RefreshCw, Loader2, Globe,
  Brain, MessageSquare, Building2, Save, ArrowRight, Database,
} from 'lucide-react';
import * as tokens from '@/lib/design-tokens';

const CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const TONE_TYPES = ['formal', 'casual', 'technical'];

const CHUNK_BADGE: Record<string, string> = {
  brand:   'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/25',
  product: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/25',
  voice:   'bg-[#A855F7]/10 text-[#A855F7] border-[#A855F7]/25',
  faq:     'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/25',
  asset:   'bg-[#A1A1AA]/10 text-[#A1A1AA] border-[#3F3F46]',
};

// Chunks are raw Jina markdown — strip image tags, links, headings and bare
// URLs so the preview is readable prose rather than scrape output.
function cleanChunk(raw: string): string {
  return String(raw || '')
    .replace(/!\[.*?\]\(.*?\)/g, '[image]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Chunking splits mid-markdown, so a chunk can start or end mid-tag in ways
    // the patterns above cannot match.
    .replace(/!?\[[^\]]*\]\([^)]*$/, '')   // trailing "[alt](half-a-url"
    .replace(/!?\[[^\]]*$/, '')            // trailing bare "[alt"
    .replace(/^[^\]]{0,80}\]\(\s*/, '')    // leading "...logo.](" remnant
    .replace(/^\S*[/?=]\S*\)\s*/, '')      // leading truncated URL/path ending ")"
    .replace(/#{1,6}\s/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// "Jul 27"
function shortDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[#27272A] bg-[#111113] ${className}`}>{children}</div>
  );
}

function FieldShell({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#27272A] px-5 py-4 last:border-b-0">
      <p className={tokens.type.metricLabel}>{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[#52525B]">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

// Click-to-edit text. Enter commits a single-line edit; Escape cancels.
function EditableText({
  value, onChange, multiline = false, placeholder = 'Not set',
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const commit = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value ?? ''); setEditing(false); };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#18181B]"
      >
        <span className={`flex-1 ${value ? 'text-sm text-[#E4E4E7]' : 'text-sm italic text-[#52525B]'} whitespace-pre-line`}>
          {value || placeholder}
        </span>
        <Pencil className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-transparent transition-colors group-hover:text-[#71717A]" />
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
          className="w-full resize-none rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#6366F1] focus:outline-none"
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') cancel();
          }}
          className="w-full rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#6366F1] focus:outline-none"
        />
      )}
      <div className="flex gap-2">
        <button
          onClick={commit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366F1] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#4F46E5]"
        >
          <Check className="h-3.5 w-3.5" /> Done
        </button>
        <button
          onClick={cancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#27272A] px-2.5 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#27272A]"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
      {!multiline && <p className="text-[11px] text-[#52525B]">Press Enter to save · Esc to cancel</p>}
    </div>
  );
}

// Editable list of plain strings (pain points).
function StringList({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="space-y-2">
      {list.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <input
            value={item}
            onChange={(e) => {
              const next = [...list];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-sm text-[#E4E4E7] focus:border-[#6366F1] focus:outline-none"
          />
          <button
            onClick={() => onChange(list.filter((_, idx) => idx !== i))}
            className="mt-1 rounded-lg p-1.5 text-[#52525B] transition-colors hover:bg-[#27272A] hover:text-[#EF4444]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...list, ''])}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6366F1] transition-colors hover:text-[#818CF8]"
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}

// Editable tag list (competitors).
function TagList({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const list = Array.isArray(items) ? items : [];
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.length === 0 && <span className="text-sm italic text-[#52525B]">None recorded</span>}
        {list.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#27272A] bg-[#18181B] px-2.5 py-1 text-xs text-[#E4E4E7]"
          >
            {tag}
            <button
              onClick={() => onChange(list.filter((_, idx) => idx !== i))}
              className="text-[#52525B] transition-colors hover:text-[#EF4444]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          placeholder="Add a competitor…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...list, draft.trim()]);
              setDraft('');
            }
          }}
          className="flex-1 rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:border-[#6366F1] focus:outline-none"
        />
      </div>
    </div>
  );
}

// Editable product cards.
function ProductList({
  items, onChange,
}: { items: any[]; onChange: (v: any[]) => void }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="space-y-3">
      {list.map((p, i) => (
        <div key={i} className="rounded-lg border border-[#27272A] bg-[#18181B] p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <input
                value={p?.name ?? ''}
                placeholder="Product name"
                onChange={(e) => {
                  const next = [...list];
                  next[i] = { ...next[i], name: e.target.value };
                  onChange(next);
                }}
                className="w-full rounded-md border border-[#27272A] bg-[#111113] px-2.5 py-1.5 text-sm font-medium text-[#FAFAFA] focus:border-[#6366F1] focus:outline-none"
              />
              <textarea
                value={p?.description ?? ''}
                placeholder="What it does"
                rows={2}
                onChange={(e) => {
                  const next = [...list];
                  next[i] = { ...next[i], description: e.target.value };
                  onChange(next);
                }}
                className="w-full resize-none rounded-md border border-[#27272A] bg-[#111113] px-2.5 py-1.5 text-xs text-[#A1A1AA] focus:border-[#6366F1] focus:outline-none"
              />
            </div>
            <button
              onClick={() => onChange(list.filter((_, idx) => idx !== i))}
              className="rounded-lg p-1.5 text-[#52525B] transition-colors hover:bg-[#27272A] hover:text-[#EF4444]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...list, { name: '', description: '' }])}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6366F1] transition-colors hover:text-[#818CF8]"
      >
        <Plus className="h-3.5 w-3.5" /> Add product
      </button>
    </div>
  );
}

export default function MyBusinessPage() {
  const [tab, setTab] = useState<'profile' | 'memory' | 'chat'>('profile');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pending edits, keyed by brand_profiles column.
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/my-business');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setEdits({});
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const brand = data?.brand || {};
  const val = (field: string) => (field in edits ? edits[field] : brand?.[field]);

  // Website URL lives on the client record, not the brand profile.
  const urlValue = 'url' in edits ? edits.url : data?.client?.url;

  // Chunks that clean down to nothing (pure image/link markup) are not shown.
  const visibleChunks = (data?.chunks || [])
    .map((c: any) => ({ ...c, cleaned: cleanChunk(c.content) }))
    .filter((c: any) => c.cleaned.length > 0);
  const setField = (field: string, value: any) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  const dirtyFields = Object.keys(edits);

  const saveChanges = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      for (const field of dirtyFields) {
        const res = await fetch('/api/my-business', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: CLIENT_ID, field, value: edits[field] }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(`${field}: ${json?.error || `HTTP ${res.status}`}`);
      }
      await load();
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const rescan = async () => {
    if (!data?.client?.url) return;
    setRescanning(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/agents/brand-scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: data.client.url, client_id: CLIENT_ID }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      await load();
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setRescanning(false);
    }
  };

  const deleteChunk = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/my-business/chunks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setData((prev: any) => ({
        ...prev,
        chunks: prev.chunks.filter((c: any) => c.id !== id),
        chunk_count: prev.chunk_count - 1,
      }));
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen space-y-4 bg-[#09090B] p-6">
        <div className="h-14 animate-pulse rounded-xl border border-[#27272A] bg-[#111113]" />
        <div className="h-96 animate-pulse rounded-xl border border-[#27272A] bg-[#111113]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#09090B] p-6">
        <Card><div className="p-6"><p className="text-sm text-[#EF4444]">Couldn&apos;t load your business — {error}</p></div></Card>
      </div>
    );
  }

  const TABS = [
    { key: 'profile', label: 'Brand Profile', icon: Building2 },
    { key: 'memory',  label: 'Brand Memory',  icon: Brain },
    { key: 'chat',    label: 'Onboarding Chat', icon: MessageSquare },
  ] as const;

  return (
    <div className="min-h-screen space-y-4 bg-[#09090B] p-6">

      {/* ── Header + re-scan ─────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[#FAFAFA]">
              {val('company_name') || data?.client?.name || 'Your Business'}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#71717A]">
              <Globe className="h-3.5 w-3.5 flex-shrink-0" />
              {data?.client?.url || 'No website on file'}
            </p>
          </div>
          <button
            onClick={rescan}
            disabled={rescanning || !data?.client?.url}
            className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-2.5 text-sm font-medium text-[#E4E4E7] transition-colors hover:border-[#3F3F46] disabled:opacity-50"
          >
            {rescanning
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Re-reading your website…</>
              : <><RefreshCw className="h-4 w-4" /> Re-scan my website</>}
          </button>
        </div>
      </Card>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-[#27272A]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-[#6366F1] text-[#FAFAFA]'
                : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {saveError && (
        <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-2.5">
          <p className="text-xs text-[#EF4444]">{saveError}</p>
        </div>
      )}

      {/* ── TAB 1 — Brand Profile ────────────────────────────────────────── */}
      {tab === 'profile' && (
        <>
          {!data?.brand ? (
            <Card>
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6366F1]/15">
                  <Building2 className="h-6 w-6 text-[#6366F1]" />
                </div>
                <p className="text-sm font-medium text-[#FAFAFA]">
                  No brand profile yet — scan your website to get started
                </p>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#6366F1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4F46E5]"
                >
                  Scan my website <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Card>
          ) : (
            <Card>
              <FieldShell label="Company name">
                <EditableText value={val('company_name') ?? ''} onChange={(v) => setField('company_name', v)} />
              </FieldShell>

              <FieldShell label="Website URL" hint="The site your AI reads to learn your brand">
                <EditableText
                  value={urlValue ?? ''}
                  onChange={(v) => setField('url', v)}
                  placeholder="https://yourbusiness.com"
                />
              </FieldShell>

              <FieldShell label="Who you help" hint="The customers your business serves">
                <EditableText multiline value={val('icp_summary') ?? ''} onChange={(v) => setField('icp_summary', v)} />
              </FieldShell>

              <FieldShell label="Communication tone" hint="How your brand sounds">
                <EditableText multiline value={val('tone_description') ?? ''} onChange={(v) => setField('tone_description', v)} />
              </FieldShell>

              <FieldShell label="Tone type">
                <select
                  value={val('tone_type') ?? ''}
                  onChange={(e) => setField('tone_type', e.target.value)}
                  className="rounded-lg border border-[#27272A] bg-[#18181B] px-3 py-2 text-sm text-[#FAFAFA] focus:border-[#6366F1] focus:outline-none"
                >
                  <option value="">Not set</option>
                  {TONE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </FieldShell>

              <FieldShell label="Your products">
                <ProductList items={val('products_json') ?? []} onChange={(v) => setField('products_json', v)} />
              </FieldShell>

              <FieldShell label="Problems you solve">
                <StringList items={val('pain_points_json') ?? []} onChange={(v) => setField('pain_points_json', v)} />
              </FieldShell>

              <FieldShell label="Your value proposition">
                <EditableText value={val('value_proposition') ?? ''} onChange={(v) => setField('value_proposition', v)} />
              </FieldShell>

              <FieldShell label="Competitors">
                <TagList items={val('competitors_json') ?? []} onChange={(v) => setField('competitors_json', v)} />
              </FieldShell>

              <FieldShell label="Greeting message" hint="What your AI receptionist says when answering">
                <EditableText multiline value={val('greeting_text') ?? ''} onChange={(v) => setField('greeting_text', v)} />
              </FieldShell>
            </Card>
          )}

          {/* Save bar appears only when something changed */}
          {dirtyFields.length > 0 && (
            <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-[#6366F1]/40 bg-[#18181B] px-5 py-3 shadow-lg">
              <p className="text-sm text-[#A1A1AA]">
                {dirtyFields.length} unsaved change{dirtyFields.length === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setEdits({})}
                  disabled={saving}
                  className="rounded-lg border border-[#27272A] px-3 py-2 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-[#27272A] disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#6366F1] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#4F46E5] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save changes
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB 2 — Brand Memory ─────────────────────────────────────────── */}
      {tab === 'memory' && (
        <Card>
          <div className="flex items-center justify-between border-b border-[#27272A] px-5 py-4">
            <div>
              <h2 className={tokens.type.cardTitle}>Brand Memory</h2>
              <p className="mt-0.5 text-xs text-[#71717A]">
                {visibleChunks.length} piece{visibleChunks.length === 1 ? '' : 's'} of brand knowledge
              </p>
            </div>
            <Database className="h-4 w-4 text-[#52525B]" />
          </div>

          {visibleChunks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Brain className="h-6 w-6 text-[#3F3F46]" />
              <p className="text-sm text-[#71717A]">
                No brand memory yet — re-scan your website to build it.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#27272A]">
              {visibleChunks.map((c: any) => (
                <div key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          CHUNK_BADGE[c.chunk_type] || CHUNK_BADGE.asset
                        }`}
                      >
                        {c.chunk_type}
                      </span>
                      <span className="text-[11px] text-[#52525B]">{shortDate(c.created_at)}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#A1A1AA]">
                      {c.cleaned}
                      {c.cleaned.length >= 120 ? '…' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteChunk(c.id)}
                    disabled={deletingId === c.id}
                    title="Remove from brand memory"
                    className="mt-0.5 rounded-lg p-1.5 text-[#52525B] transition-colors hover:bg-[#27272A] hover:text-[#EF4444] disabled:opacity-50"
                  >
                    {deletingId === c.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── TAB 3 — Onboarding Chat ──────────────────────────────────────── */}
      {tab === 'chat' && (
        <Card>
          <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#6366F1]/15">
              <MessageSquare className="h-6 w-6 text-[#6366F1]" />
            </div>
            <p className="max-w-md text-sm text-[#A1A1AA]">
              Re-do the setup conversation to update your AI team&apos;s understanding of
              your business.
            </p>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-lg bg-[#6366F1] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4F46E5]"
            >
              Start fresh onboarding <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
