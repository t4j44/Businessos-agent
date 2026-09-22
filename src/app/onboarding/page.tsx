'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Pending } from '@/components/ui/Skeleton';
import {
  Send, ArrowRight, Sparkles, Upload, FileText, X, Loader2, CheckCircle2, Check,
} from 'lucide-react';

type Role = 'ai' | 'user';
type Message = { id: number; role: Role; text: string };

// 'url' → waiting for the website. 'assets' → offering the file upload.
// 'review' → showing what was pulled out of an uploaded file for confirmation.
// 'confirm' → waiting on the first yes/no. 'correct' → collecting further
// corrections. 'done' → finished.
type Phase = 'url' | 'assets' | 'review' | 'confirm' | 'correct' | 'done';

const OPENING =
  "Hi! I'm here to set up your AI team. It only takes a few minutes.\n\nWhat's your business website? I'll read it and learn everything about you.";

const ASSETS_PROMPT =
  "Want to share anything else? You can upload your logo, brand guidelines, or any documents. I'll use them to make your agents even more accurate.\n\n(Or just skip this — you can always add files later in Settings.)";

const CONFIRM_AGAIN =
  'So — does everything above look right, or is there anything to correct?';

const FINISH =
  'Perfect — your AI team knows your business now. Every agent will work in your voice and for your customers.\n\nReady to see your dashboard?';

// Vercel rejects a request body over ~4.5MB with its own HTML error page, before
// the route ever runs — so the browser has to be the one that says no. The cap
// applies to the whole request, not just the largest file in it.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const ACCEPT_ATTR =
  '.png,.jpg,.jpeg,.webp,.svg,.pdf,.txt,.md,.markdown,.docx,' +
  'image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,' +
  'text/plain,text/markdown,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Extension is the reliable signal: browsers report .md as text/markdown,
// text/plain, application/octet-stream or nothing at all depending on the OS.
// The server classifies the same way.
const ACCEPTED_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'svg',
  'pdf', 'txt', 'text', 'md', 'mdx', 'markdown', 'docx',
];

const ACCEPTED_LABEL = 'PNG, JPG, WEBP, SVG, PDF, TXT, MD, or DOCX';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AFFIRMATIVE =
  /\b(yes|yep|yeah|yup|correct|right|looks good|sounds good|sound right|perfect|exactly|spot on|accurate|all good|thats right|that's right)\b|👍|✅/i;

const NOTHING_ELSE =
  /\b(no|nope|nothing|nothing else|thats all|that's all|thats it|that's it|done|all good|we're good|were good|good to go)\b/i;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

// Maps a free-text correction onto the brand_profiles field it refers to.
function detectField(text: string): string | 'products' | null {
  const t = text.toLowerCase();
  if (/\b(tone|voice|style|sound|casual|formal|technical|friendly)\b/.test(t)) {
    return 'tone_description';
  }
  if (/\b(customer|customers|client|clients|audience|sell to|serve|icp|market)\b/.test(t)) {
    return 'icp_summary';
  }
  if (/\b(product|products|offering|offerings|service|services)\b/.test(t)) {
    return 'products';
  }
  if (/\b(value prop|proposition|selling point|pitch|tagline)\b/.test(t)) {
    return 'value_proposition';
  }
  if (/\b(name|called)\b/.test(t)) {
    return 'company_name';
  }
  return null;
}

function buildRecap(b: any): string {
  const products = Array.isArray(b?.products_json) ? b.products_json : [];
  const lines: string[] = [`Got it! Here's what I learned about ${b?.company_name}:`, ''];

  if (b?.icp_summary) lines.push(`You help ${b.icp_summary}`, '');

  if (products.length) {
    lines.push('Your main offerings:');
    for (const p of products) {
      lines.push(`• ${p.name}${p.description ? ` — ${p.description}` : ''}`);
    }
    lines.push('');
  }

  if (b?.tone_description) lines.push(`Your communication style is ${b.tone_description}`, '');

  lines.push('Does that sound right, or is there anything to correct?');
  return lines.join('\n');
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3">
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce" />
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-dim animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

// Every line here was emitted by the analyze route at the moment that step
// actually ran. Nothing is on a timer, and there is no progress bar, because
// there is no total to measure against.
function StageList({ stages }: { stages: string[] }) {
  return (
    <ol className="space-y-2 px-4 py-3">
      {stages.map((stage, i) => {
        const isCurrent = i === stages.length - 1;
        return (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
            {isCurrent ? (
              <Pending className="mt-2 h-3.5 w-3.5 flex-shrink-0 justify-center text-accent" />
            ) : (
              <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-good" />
            )}
            <span className={isCurrent ? 'text-text' : 'text-dim'}>{stage}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A file whose text has been extracted and is waiting to be confirmed. */
type PendingDoc = { name: string; path: string; text: string; truncated: boolean };

export default function OnboardingPage() {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'ai', text: OPENING }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('url');

  // Live progress from /api/onboarding/analyze while it works.
  const [stages, setStages] = useState<string[]>([]);

  // Full-screen hand-off while Brand Scout enriches the profile.
  // null = not finishing, 'working' = running, otherwise the closing line.
  const [finishing, setFinishing] = useState<null | 'working' | 'done' | 'partial'>(null);

  const [showUploader, setShowUploader] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  // Extracted documents queued for confirmation, oldest first.
  const [pending, setPending] = useState<PendingDoc[]>([]);
  const [draft, setDraft] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);

  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, showUploader, rejected, stages, pending]);

  const push = (role: Role, text: string) =>
    setMessages((prev) => [...prev, { id: nextId.current++, role, text }]);

  const aiReply = async (text: string, thinkMs = 450) => {
    setBusy(true);
    await sleep(thinkMs);
    push('ai', text);
    setBusy(false);
  };

  // ── STEP 2/3 — validate the URL, analyze the site, present the Brand DNA ──
  //
  // The response is newline-delimited JSON: one { stage } line per real step,
  // then a final { done } or { error }. Auth and payload problems still arrive
  // as ordinary non-200 responses, before the stream opens.
  const handleUrl = async (text: string) => {
    // A bare domain is what people actually type. The server adds the scheme
    // (normalizeUrl), so this only checks that the input looks like a domain
    // at all — it used to demand "http" and reject "zqtion.com" outright.
    const looksLikeDomain = /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}([/?#].*)?$/i.test(text);
    if (!looksLikeDomain) {
      await aiReply(
        "That doesn't look like a web address — something like yourbusiness.com or https://yourbusiness.com.",
      );
      return;
    }

    setBusy(true);
    setStages([]);

    try {
      const res = await fetch('/api/onboarding/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text }),
      });

      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        let message = `Request failed (HTTP ${res.status})`;
        try {
          message = JSON.parse(raw)?.error || message;
        } catch {
          if (raw) message = `${message}. ${raw.slice(0, 120)}`;
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result: any = null;
      let failure: string | null = null;

      const consume = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          return; // A partial line; the next read completes it.
        }
        if (event.stage) setStages((prev) => [...prev, event.stage]);
        else if (event.done) result = event;
        else if (event.error) failure = event.error;
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(consume);
      }
      consume(buffer);

      if (failure) throw new Error(failure);
      if (!result) throw new Error('The analysis ended before it finished. Please try again.');

      setStages([]);
      push('ai', buildRecap(result.brand_profile));

      // STEP 3b — offer to collect brand assets.
      await sleep(500);
      push('ai', ASSETS_PROMPT);
      setPhase('assets');
    } catch (err: any) {
      setStages([]);
      push('ai', `Sorry — ${err?.message || String(err)}\n\nWant to try that address again?`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await aiReply(FINISH);
    setPhase('done');
    void runBrandScoutAndRedirect();
  };

  // Brand Scout adds the visual brand and the RAG chunks on top of the profile
  // /analyze already wrote. It takes ~20s, so the user gets a screen that says
  // so rather than a frozen chat.
  const runBrandScoutAndRedirect = async () => {
    setFinishing('working');
    const startedAt = Date.now();

    let complete = false;
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      complete = res.ok && !!json?.brand_scout_complete;
    } catch (err) {
      // The account already exists — this step only enriches it.
      console.error('[onboarding] brand scout call failed:', err);
    }

    // Hold the screen briefly even on a fast response, so the state change is
    // legible rather than a flash.
    const elapsed = Date.now() - startedAt;
    if (elapsed < 3000) await sleep(3000 - elapsed);

    setFinishing(complete ? 'done' : 'partial');
    await sleep(1500);
    router.push('/dashboard');
  };

  // ── STEP 3b — uploads ────────────────────────────────────────────────────
  const handleSkip = async () => {
    setShowUploader(false);
    setRejected([]);
    push('user', 'Skip for now');
    await aiReply(CONFIRM_AGAIN);
    setPhase('confirm');
  };

  // Called once the confirmation queue drains, however it drained.
  const afterUploads = async () => {
    setPending([]);
    setDraft('');
    await aiReply(CONFIRM_AGAIN);
    setPhase('confirm');
  };

  const openNextDoc = (queue: PendingDoc[]) => {
    if (queue.length === 0) {
      void afterUploads();
      return;
    }
    setPending(queue);
    setDraft(queue[0].text);
    setPhase('review');
    push(
      'ai',
      `I picked this up from ${queue[0].name}. Anything to add or correct before I save it?`,
    );
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const picked = Array.from(fileList);
    const valid: File[] = [];
    const bad: string[] = [];

    for (const f of picked) {
      if (!ACCEPTED_EXTENSIONS.includes(extensionOf(f.name))) {
        bad.push(`${f.name} — only ${ACCEPTED_LABEL} are supported`);
      } else if (f.size > MAX_FILE_BYTES) {
        bad.push(
          `${f.name} is ${formatBytes(f.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)} per file`,
        );
      } else {
        valid.push(f);
      }
    }

    // The whole request shares one body, so several small files can still be
    // rejected by the host as a single oversized upload.
    const total = valid.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      bad.push(
        `Those files come to ${formatBytes(total)} together — the limit is ` +
          `${formatBytes(MAX_TOTAL_BYTES)} per upload. Send them a few at a time.`,
      );
      setRejected(bad);
      return;
    }

    setRejected(bad);
    if (valid.length === 0) return;

    setShowUploader(false);
    push('user', `Uploaded: ${valid.map((f) => f.name).join(', ')}`);
    setBusy(true);

    let queue: PendingDoc[] = [];

    try {
      const body = new FormData();
      for (const f of valid) body.append('files', f);

      const res = await fetch('/api/onboarding/upload', { method: 'POST', body });

      // A request the host rejected before it reached the route comes back as
      // an HTML error page, so res.json() would throw a parse error over the
      // top of the actual reason.
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const raw = (await res.text().catch(() => '')).trim();
        throw new Error(
          `Upload failed (HTTP ${res.status}). ${raw.slice(0, 120) || 'The server returned no details.'}`,
        );
      }

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        throw new Error(
          json?.error ||
            (res.status === 413
              ? 'the server wouldn’t accept a file that large'
              : `Request failed (HTTP ${res.status})`),
        );
      }

      const stored = Array.isArray(json.uploaded) ? json.uploaded : [];
      if (stored.length > 0) {
        push('ai', `Got ${stored.length === 1 ? 'that' : 'those'} — saved to your brand assets.`);
      }

      // Anything the server could read becomes a confirmation turn.
      queue = stored
        .filter((f: any) => typeof f.extracted === 'string' && f.extracted.trim())
        .map((f: any) => ({
          name: f.name,
          path: f.path || f.name,
          text: f.extracted,
          truncated: !!f.truncated,
        }));

      const notes = stored.filter((f: any) => f.note).map((f: any) => `• ${f.name} — ${f.note}`);
      if (notes.length) push('ai', notes.join('\n'));

      if (Array.isArray(json.failed) && json.failed.length > 0) {
        push(
          'ai',
          `A couple didn't make it through:\n${json.failed
            .map((f: any) => `• ${f.name} — ${f.reason}`)
            .join('\n')}`,
        );
      }
    } catch (err: any) {
      push('ai', `I couldn't save those — ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
      setRejected([]);
    }

    if (queue.length > 0) openNextDoc(queue);
    else await afterUploads();
  };

  // ── STEP 3c — confirm what was extracted, then save the edited version ───
  const saveDoc = async () => {
    const doc = pending[0];
    if (!doc || savingDoc) return;

    const text = draft.trim();
    if (!text) {
      // Nothing left after editing is the same decision as skipping.
      skipDoc();
      return;
    }

    setSavingDoc(true);
    try {
      const res = await fetch('/api/onboarding/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: doc.path }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);

      push(
        'ai',
        `Saved — that's ${json.saved} piece${json.saved === 1 ? '' : 's'} added to your brand memory.`,
      );
    } catch (err: any) {
      push('ai', `I couldn't save that — ${err?.message || String(err)}`);
    } finally {
      setSavingDoc(false);
      openNextDoc(pending.slice(1));
    }
  };

  const skipDoc = () => {
    const doc = pending[0];
    if (doc) push('user', `Skip ${doc.name}`);
    openNextDoc(pending.slice(1));
  };

  // ── STEP 4 — apply a correction to the matching field ────────────────────
  const applyCorrection = async (text: string) => {
    const field = detectField(text);

    if (!field) {
      await aiReply(
        'I want to get this right — which part should I fix: your company name, who you help, your tone, or your main selling point?',
      );
      setPhase('correct');
      return;
    }

    // products_json holds structured data, so a sentence can't be written into it.
    if (field === 'products') {
      await aiReply(
        "Got it — your offerings are stored as structured data, so I've left them untouched rather than overwrite them with a note. You can fine-tune them in the dashboard.\n\nAnything else to fix?",
      );
      setPhase('correct');
      return;
    }

    setBusy(true);
    await sleep(300);
    push('ai', 'Got it, updating that.');

    try {
      const res = await fetch('/api/onboarding/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value: text }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);

      push('ai', 'Anything else to fix?');
    } catch (err: any) {
      push('ai', `I couldn't save that — ${err?.message || String(err)}\n\nAnything else to fix?`);
    } finally {
      setBusy(false);
      setPhase('correct');
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || phase === 'done' || phase === 'assets' || phase === 'review') return;

    setInput('');
    push('user', text);

    if (phase === 'url') return handleUrl(text);

    if (phase === 'confirm') {
      if (AFFIRMATIVE.test(text)) return finish();
      return applyCorrection(text);
    }

    if (phase === 'correct') {
      // After a correction, "no"/"all good" means there is nothing left to fix.
      if (NOTHING_ELSE.test(text) || AFFIRMATIVE.test(text)) return finish();
      return applyCorrection(text);
    }
  };

  const inputDisabled =
    busy || phase === 'done' || phase === 'assets' || phase === 'review';

  const reviewing = phase === 'review' ? pending[0] : null;

  return (
    <div className="min-h-screen bg-canvas flex flex-col">

      {/* ── Hand-off overlay ────────────────────────────────────────────
          Covers the chat while Brand Scout runs, so the wait is explained
          rather than looking like a hung page. */}
      {finishing && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas px-6 text-center"
        >
          {finishing === 'working' ? (
            <>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-accent/10">
                <Pending />
              </div>
              <p className="text-base font-semibold text-text">
                Analyzing your brand...
              </p>
              <p className="mt-1.5 text-sm text-dim">
                This takes about 20 seconds.
              </p>
            </>
          ) : (
            <>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-good/10">
                <CheckCircle2 className="h-7 w-7 text-good" />
              </div>
              <p className="text-base font-semibold text-text">
                {finishing === 'done'
                  ? 'Brand DNA created. Taking you to your dashboard...'
                  : 'Account created. You can analyze your brand from the dashboard.'}
              </p>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-line px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Set Up Your AI Team</h1>
            <p className="text-dim text-xs">Just tell me about your business</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-surface border border-line/50 text-text rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {/* Live progress, or the typing indicator when there is nothing to
              report yet. */}
          {busy && (
            <div className="flex justify-start">
              <div
                role="status"
                aria-live="polite"
                className="max-w-[85%] rounded-2xl rounded-bl-sm border border-line/50 bg-surface"
              >
                {stages.length > 0 ? <StageList stages={stages} /> : <TypingDots />}
              </div>
            </div>
          )}

          {/* STEP 3b — choice buttons */}
          {phase === 'assets' && !busy && !showUploader && (
            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  setShowUploader(true);
                  setRejected([]);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-blue-600 text-white text-sm font-medium transition-colors"
              >
                <Upload className="w-4 h-4" /> Upload files
              </button>
              <button
                onClick={handleSkip}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface border border-line hover:border-line-strong text-muted text-sm font-medium transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* STEP 3b — drag & drop area */}
          {phase === 'assets' && showUploader && !busy && (
            <div className="space-y-2.5">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragging
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-surface hover:border-line-strong'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-5 h-5 text-accent" />
                </div>
                <p className="text-text text-sm font-medium">
                  Drop files here, or click to browse
                </p>
                <p className="text-dim text-xs mt-1">
                  {ACCEPTED_LABEL} · up to {formatBytes(MAX_FILE_BYTES)} each
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPT_ATTR}
                  onChange={(e) => handleFiles(e.target.files)}
                  className="hidden"
                />
              </div>

              {rejected.length > 0 && (
                <div className="space-y-1">
                  {rejected.map((r, i) => (
                    <p key={i} className="text-red-400 text-xs flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                      {r}
                    </p>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setShowUploader(false);
                  setRejected([]);
                }}
                className="inline-flex items-center gap-1.5 text-dim hover:text-muted text-xs transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          )}

          {/* STEP 3c — confirm the extraction before anything is written */}
          {reviewing && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
                <p className="text-sm font-medium text-text">{reviewing.name}</p>
                {pending.length > 1 && (
                  <span className="ml-auto text-xs text-dim">
                    1 of {pending.length}
                  </span>
                )}
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={savingDoc}
                rows={10}
                aria-label={`Text extracted from ${reviewing.name}`}
                className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm leading-relaxed text-text placeholder-faint focus:border-accent/50 focus:outline-none disabled:opacity-50"
              />

              {reviewing.truncated && (
                <p className="mt-2 text-xs text-dim">
                  That document was long, so this is the first part of it.
                </p>
              )}

              <div className="mt-3 flex gap-2.5">
                <button
                  onClick={saveDoc}
                  disabled={savingDoc}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDoc ? <Pending /> : <Check className="h-4 w-4" />}
                  {savingDoc ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={skipDoc}
                  disabled={savingDoc}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex justify-start">
              <a
                href="/dashboard"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-blue-600 text-white text-sm font-medium transition-colors"
              >
                See My Dashboard <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-line px-6 py-4">
        <form onSubmit={handleSend} className="max-w-2xl mx-auto flex gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={inputDisabled}
            placeholder={
              phase === 'done'
                ? 'All set!'
                : phase === 'review'
                  ? 'Edit the text above, then Save or Skip…'
                  : phase === 'assets'
                    ? 'Choose an option above…'
                    : phase === 'url'
                      ? 'https://yourbusiness.com'
                      : 'Type your answer…'
            }
            className="flex-1 bg-surface border border-line rounded-lg px-4 py-3 text-sm text-white placeholder-faint focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={inputDisabled || !input.trim()}
            className="flex items-center justify-center px-4 rounded-lg bg-accent hover:bg-blue-600 disabled:bg-raised disabled:text-dim text-white transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
