import Link from 'next/link'
import { LegalFooter } from '@/components/LegalFooter'
import type { LegalDocument } from '@/lib/legal'

// Shared shell for /privacy, /terms and /support, so the three pages cannot
// drift on layout or on the "Coming soon" behaviour.
//
// While the placeholder is in place the page deliberately does NOT render an
// empty document body: an empty privacy policy reads as "we collect nothing",
// which would be a worse claim than saying it is not written yet.
export function LegalPage({
  title,
  document,
  children,
}: {
  title: string
  document: LegalDocument
  /** Extra content shown under the body — the support email, for instance. */
  children?: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-canvas px-6 py-12">
      <main className="mx-auto max-w-3xl">
        <Link href="/" className="text-xs text-dim hover:text-text hover:underline">
          &larr; Back
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-text">{title}</h1>

        {document.isPlaceholder ? (
          <div
            role="status"
            className="mt-6 rounded-lg border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-text"
          >
            <span className="font-medium">Coming soon.</span>{' '}
            <span className="text-dim">
              This document has not been published yet. It is excluded from search engines
              until it is.
            </span>
          </div>
        ) : (
          <article
            className="legal-prose mt-6 text-sm leading-relaxed text-muted"
            // Built from content/legal/*.md by markdownToHtml() and then passed
            // through sanitize-html, so only allowlisted tags reach the page.
            dangerouslySetInnerHTML={{ __html: document.html }}
          />
        )}

        {children}

        <LegalFooter />
      </main>
    </div>
  )
}
