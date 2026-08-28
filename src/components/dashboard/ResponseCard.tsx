'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// A generated reply, presented so it can be pasted straight into the review
// platform: the full text, unclipped, with a one-click copy.
export function ResponseCard({
  text,
  emptyLabel = 'No response drafted yet.',
}: {
  text?: string | null;
  emptyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  if (!text) {
    return <p className="text-sm leading-5 text-[#71717A]">{emptyLabel}</p>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Clipboard blocked — select the text and copy manually.');
    }
  };

  return (
    <div className="rounded-lg border border-[#1F1F23] bg-[#17171A]">
      <div className="flex items-center justify-between gap-3 border-b border-[#1F1F23] px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[#71717A]">
          Drafted reply
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#1F1F23] px-2 py-1 text-xs font-medium text-[#A1A1AA] transition-colors hover:border-[#2A2A30] hover:text-[#F4F4F5]"
        >
          {copied ? <Check className="h-3 w-3 text-[#10B981]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-[#A1A1AA]">
        {text}
      </p>

      {copyError && <p className="px-3 pb-2 text-xs text-[#EF4444]">{copyError}</p>}
    </div>
  );
}
