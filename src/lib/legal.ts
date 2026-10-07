import fs from 'node:fs'
import path from 'node:path'
import sanitizeHtml from 'sanitize-html'

// Renders the legal and support pages from content/legal/*.md.
//
// WHY A HAND-WRITTEN MARKDOWN RENDERER. A policy is a few headings, paragraphs,
// lists and links, and adding a Markdown library plus its dependency tree to
// render three static documents is not a trade worth making — this project is
// already carrying seven unfixable advisories from one build-time dependency.
// sanitize-html was already a dependency and runs last, so whatever this
// converter or the pasted file produces, only the allowlisted tags survive.
//
// WHEN THE CONTENT IS READ. These pages are statically prerendered, so the file
// is read at build time and the result is baked into the HTML. Pasting a new
// policy therefore needs a redeploy to appear, and nothing reads from disk at
// request time — which also means Next's file tracing does not have to ship
// content/ into the serverless bundle.

export const PLACEHOLDER = 'PASTE GENERATED POLICY HERE'

export type LegalDocument = {
  /** Sanitized HTML, empty while the placeholder is still in place. */
  html: string
  /** True until real text is pasted in. Drives "Coming soon" and noindex. */
  isPlaceholder: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Inline formatting, applied to already-escaped text. */
function inline(text: string): string {
  return text
    // `code` before the others so its contents are not re-processed.
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    // [text](url). The href is allowlisted by sanitize-html afterwards, so a
    // javascript: or data: URL cannot survive even if one is pasted in.
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
}

/**
 * The supported subset: ATX headings h1-h4, paragraphs, unordered and ordered
 * lists, blockquotes, horizontal rules, and the inline forms above. Anything
 * else is treated as paragraph text rather than silently dropped.
 */
export function markdownToHtml(markdown: string): string {
  const lines = escapeHtml(markdown.replace(/\r\n/g, '\n')).split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let paragraph: string[] = []

  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }
  const close = () => { closeParagraph(); closeList() }

  for (const raw of lines) {
    const line = raw.trim()

    if (!line) { close(); continue }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      close()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { close(); out.push('<hr />'); continue }

    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      closeParagraph()
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      closeParagraph()
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(numbered[1])}</li>`)
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      close()
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  close()
  return out.join('\n')
}

/** The same allowlist discipline as sanitizeReportHtml, minus tables. */
function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i',
      'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a',
    ],
    allowedAttributes: { a: ['href', 'rel', 'target'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  })
}

/**
 * Reads one document by slug. A missing file is treated exactly like the
 * placeholder: the page says "Coming soon" rather than failing the build, so a
 * deleted or unreadable file can never publish an empty policy as if it were
 * the real one.
 */
export function readLegalDocument(slug: 'privacy' | 'terms' | 'support'): LegalDocument {
  let source = ''
  try {
    source = fs.readFileSync(path.join(process.cwd(), 'content', 'legal', `${slug}.md`), 'utf8')
  } catch {
    return { html: '', isPlaceholder: true }
  }

  const body = source.trim()
  if (!body || body.includes(PLACEHOLDER)) return { html: '', isPlaceholder: true }

  return { html: sanitize(markdownToHtml(body)), isPlaceholder: false }
}

/** Where a customer should write. Shown on /support and used by mailto links. */
export function supportEmail(): string | null {
  const value = process.env.SUPPORT_EMAIL?.trim()
  return value || null
}
