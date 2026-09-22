// Website reader. Crawl4AI first (real browser, handles JS-rendered sites),
// Jina Reader second (free, no key, fine on static pages).
//
// Crawl4AI is skipped entirely when CRAWL4AI_URL is unset, so with no config
// this behaves exactly like the old Jina-only reader.

import { parsePublicUrl, resolvePublicUrl } from './safe-fetch'

export function normalizeUrl(url: string): string {
  if (typeof url !== 'string' || url.length > 2048) throw new Error('Enter a valid public website URL.')
  let normalized = url.trim()
  if (!normalized.startsWith('http://') && 
      !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized
  }
  return parsePublicUrl(normalized).href.replace(/\/$/, '')
}

export async function readWebsite(
  url: string,
  maxChars: number = 6000
): Promise<string> {
  url = (await resolvePublicUrl(normalizeUrl(url))).url.href
  // Try Crawl4AI first (best quality, handles JS sites)
  // A browser worker also follows subresources/redirects. Only enable it after
  // its network policy blocks private ranges; seed validation alone is not enough.
  if (process.env.CRAWL4AI_URL && process.env.CRAWL4AI_PRIVATE_NETWORK_BLOCKED === 'true') {
    try {
      const res = await fetch(process.env.CRAWL4AI_URL + '/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [url],
          priority: 8,
          word_count_threshold: 50,
          excluded_tags: ['nav', 'footer', 'script', 'style'],
          remove_overlay_elements: true,
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout
      })
      if (res.ok) {
        const data = await res.json()
        const markdown = data?.results?.[0]?.markdown?.fit_markdown
          || data?.results?.[0]?.markdown?.raw_markdown
          || ''
        if (markdown && markdown.length > 200) {
          console.log('Crawl4AI success:', url, markdown.length, 'chars')
          return markdown.slice(0, maxChars)
        }
      }
    } catch (e) {
      console.warn('Crawl4AI failed, falling back to Jina:', e)
    }
  }

  // Fallback: Jina Reader (free, no key, works on simple sites)
  try {
    const res = await fetch('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain' },
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) {
      const text = await res.text()
      if (text && text.length > 100) {
        console.log('Jina success:', url, text.length, 'chars')
        return text.slice(0, maxChars)
      }
    }
  } catch (e) {
    console.warn('Jina also failed:', e)
  }

  console.error('Both scrapers failed for:', url)
  return ''
}
