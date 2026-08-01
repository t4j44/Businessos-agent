'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, ArrowRight, Sparkles, Upload, FileText, X } from 'lucide-react';

type Role = 'ai' | 'user';
type Message = { id: number; role: Role; text: string };

// 'url' → waiting for the website. 'assets' → offering the file upload.
// 'confirm' → waiting on the first yes/no. 'correct' → collecting further
// corrections. 'done' → finished.
type Phase = 'url' | 'assets' | 'confirm' | 'correct' | 'done';

const OPENING =
  "Hi! I'm here to set up your AI team. It only takes a few minutes.\n\nWhat's your business website? I'll read it and learn everything about you.";

const ASSETS_PROMPT =
  "Want to share anything else? You can upload your logo, brand guidelines, or any documents. I'll use them to make your agents even more accurate.\n\n(Or just skip this — you can always add files later in Settings.)";

const CONFIRM_AGAIN =
  'So — does everything above look right, or is there anything to correct?';

const FINISH =
  'Perfect — your AI team knows your business now. Every agent will work in your voice and for your customers.\n\nReady to see your dashboard?';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'application/pdf'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AFFIRMATIVE =
  /\b(yes|yep|yeah|yup|correct|right|looks good|sounds good|sound right|perfect|exactly|spot on|accurate|all good|thats right|that's right)\b|👍|✅/i;

const NOTHING_ELSE =
  /\b(no|nope|nothing|nothing else|thats all|that's all|thats it|that's it|done|all good|we're good|were good|good to go)\b/i;

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
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

export default function OnboardingPage() {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: 'ai', text: OPENING }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('url');
  const [clientId, setClientId] = useState<string | null>(null);

  const [showUploader, setShowUploader] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, showUploader, rejected]);

  const push = (role: Role, text: string) =>
    setMessages((prev) => [...prev, { id: nextId.current++, role, text }]);

  const aiReply = async (text: string, thinkMs = 450) => {
    setBusy(true);
    await sleep(thinkMs);
    push('ai', text);
    setBusy(false);
  };

  // ── STEP 2/3 — validate the URL, analyze the site, present the Brand DNA ──
  const handleUrl = async (text: string) => {
    if (!text.toLowerCase().startsWith('http')) {
      await aiReply(
        "That doesn't look like a full web address — please include http:// or https:// (for example, https://yourbusiness.com).",
      );
      return;
    }

    setBusy(true);
    await sleep(300);
    push('ai', 'Reading your website now — give me 20-30 seconds...');

    try {
      const res = await fetch('/api/onboarding/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);

      setClientId(json.client_id);
      push('ai', buildRecap(json.brand_profile));

      // STEP 3b — offer to collect brand assets.
      await sleep(500);
      push('ai', ASSETS_PROMPT);
      setPhase('assets');
    } catch (err: any) {
      push('ai', `Sorry — ${err?.message || String(err)}\n\nWant to try that address again?`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await aiReply(FINISH);
    setPhase('done');
  };

  // ── STEP 3b — uploads ────────────────────────────────────────────────────
  const handleSkip = async () => {
    setShowUploader(false);
    setRejected([]);
    push('user', 'Skip for now');
    await aiReply(CONFIRM_AGAIN);
    setPhase('confirm');
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const picked = Array.from(fileList);
    const valid: File[] = [];
    const bad: string[] = [];

    for (const f of picked) {
      if (!ACCEPTED.includes(f.type)) {
        bad.push(`${f.name} — only PNG, JPG, SVG, and PDF are supported`);
      } else if (f.size > MAX_BYTES) {
        bad.push(`${f.name} — larger than 10MB`);
      } else {
        valid.push(f);
      }
    }

    setRejected(bad);
    if (valid.length === 0) return;

    setShowUploader(false);
    push('user', `Uploaded: ${valid.map((f) => f.name).join(', ')}`);
    setBusy(true);

    try {
      const body = new FormData();
      body.append('client_id', clientId || '');
      for (const f of valid) body.append('files', f);

      const res = await fetch('/api/onboarding/upload', { method: 'POST', body });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (HTTP ${res.status})`);

      push('ai', "Got those! I've added them to your brand profile.");

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
      await aiReply(CONFIRM_AGAIN);
      setPhase('confirm');
    }
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
        body: JSON.stringify({ client_id: clientId, field, value: text }),
      });
      const json = await res.json();
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
    if (!text || busy || phase === 'done' || phase === 'assets') return;

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

  const inputDisabled = busy || phase === 'done' || phase === 'assets';

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#2563EB]/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-sm">Set Up Your AI Team</h1>
            <p className="text-slate-500 text-xs">Just tell me about your business</p>
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
                    ? 'bg-[#2563EB] text-white rounded-br-sm'
                    : 'bg-[#1E293B] border border-slate-700/50 text-slate-200 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-[#1E293B] border border-slate-700/50 rounded-2xl rounded-bl-sm">
                <TypingDots />
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
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-blue-600 text-white text-sm font-medium transition-colors"
              >
                <Upload className="w-4 h-4" /> Upload files
              </button>
              <button
                onClick={handleSkip}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1E293B] border border-slate-700 hover:border-slate-600 text-slate-300 text-sm font-medium transition-colors"
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
                    ? 'border-[#2563EB] bg-[#2563EB]/10'
                    : 'border-slate-700 bg-[#1E293B] hover:border-slate-600'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-[#2563EB]/15 flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-5 h-5 text-[#2563EB]" />
                </div>
                <p className="text-slate-200 text-sm font-medium">
                  Drop files here, or click to browse
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  PNG, JPG, SVG, or PDF · up to 10MB each
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.svg,.pdf,image/png,image/jpeg,image/svg+xml,application/pdf"
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
                className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex justify-start">
              <a
                href="/dashboard"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-blue-600 text-white text-sm font-medium transition-colors"
              >
                See My Dashboard <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 px-6 py-4">
        <form onSubmit={handleSend} className="max-w-2xl mx-auto flex gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={inputDisabled}
            placeholder={
              phase === 'done'
                ? 'All set!'
                : phase === 'assets'
                  ? 'Choose an option above…'
                  : phase === 'url'
                    ? 'https://yourbusiness.com'
                    : 'Type your answer…'
            }
            className="flex-1 bg-[#1E293B] border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#2563EB] transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={inputDisabled || !input.trim()}
            className="flex items-center justify-center px-4 rounded-lg bg-[#2563EB] hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
