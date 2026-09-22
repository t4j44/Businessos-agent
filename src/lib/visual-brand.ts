// Visual brand extraction from a site's own markup.
//
// No scraping service and no new dependency: one native fetch() for the page,
// plus up to a few same-origin stylesheets. Runs before readWebsite() in
// brand-scout, because Crawl4AI/Jina both return prose — the colours, fonts and
// image tags only survive in the raw HTML.

import { fetchPublicText } from './safe-fetch'

const HTML_TIMEOUT_MS = 15000
const CSS_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 600_000
const MAX_CSS_BYTES = 300_000
// A brand palette lives in the site's stylesheet far more often than in inline
// markup, so a few are pulled in. Capped to keep the added latency bounded.
const MAX_STYLESHEETS = 3

const UA = 'Mozilla/5.0 (compatible; BusinessOS-BrandScout/1.0; +https://businessos.ai)'

export type ColorCount = { hex: string; count: number }

export type VisualBrand = {
  /** Up to 3 non-neutral hexes, most frequent first: primary, secondary, accent. */
  colors: string[]
  /** Everything counted, for debugging a surprising result. */
  color_counts: ColorCount[]
  /** Google Font families in document order. */
  fonts: string[]
  /** Up to 5 absolute photo URLs. */
  image_urls: string[]
  html_bytes: number
  stylesheets_read: number
  error?: string
}

export const EMPTY_VISUAL_BRAND: VisualBrand = {
  colors: [],
  color_counts: [],
  fonts: [],
  image_urls: [],
  html_bytes: 0,
  stylesheets_read: 0,
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs: number, maxBytes: number): Promise<string> {
  return fetchPublicText(url, { timeoutMs, maxBytes })
}

/** Raw HTML of the page. Throws so the caller can log why extraction was empty. */
export async function fetchRawHtml(url: string): Promise<string> {
  return fetchText(url, HTML_TIMEOUT_MS, MAX_HTML_BYTES)
}

// ── Colours ──────────────────────────────────────────────────────────────────

// Greys and near-black/near-white are useless as a brand colour even though the
// spec only names black and white — a site's most frequent hex is almost always
// #f8f9fa or #333. Saturation and lightness thresholds catch the whole family.
export function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  return s < 0.15 || l < 0.08 || l > 0.92
}

function expandHex(raw: string): string | null {
  const body = raw.slice(1).toLowerCase()
  if (body.length === 3) {
    return '#' + body[0] + body[0] + body[1] + body[1] + body[2] + body[2]
  }
  if (body.length === 6) return '#' + body
  // 4- and 8-digit forms carry alpha; 5 and 7 are typos. Ignoring them stops an
  // #aabbccdd being truncated into a colour nobody chose.
  return null
}

/**
 * Every #RGB and #RRGGBB in the text, counted by frequency, neutrals removed.
 * Descending by count, then by hex for a stable order on ties.
 */
export function extractHexColors(text: string): ColorCount[] {
  // Matched wide, then length-filtered, so an 8-digit hex cannot be read as a
  // 6-digit one.
  const matches = text.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  const counts = new Map<string, number>()

  for (const match of matches) {
    const hex = expandHex(match)
    if (!hex) continue
    if (isNeutral(hex)) continue
    counts.set(hex, (counts.get(hex) || 0) + 1)
  }

  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}

// ── Google Fonts ─────────────────────────────────────────────────────────────

/**
 * Font families from any fonts.googleapis.com reference — a <link href>, or an
 * @import inside a <style> block. Matching the URL rather than the tag catches
 * both without two patterns.
 */
export function extractGoogleFonts(html: string): string[] {
  const urls = html.match(/https:\/\/fonts\.googleapis\.com\/[^"')\s>]+/gi) || []
  const fonts: string[] = []
  const seen = new Set<string>()

  for (const raw of urls) {
    // The href arrives HTML-escaped in most documents.
    const url = raw.replace(/&amp;/gi, '&')
    const query = url.split('?')[1]
    if (!query) continue

    for (const part of query.split('&')) {
      if (!/^family=/i.test(part)) continue
      const value = part.slice('family='.length)

      // css2 lists one family per param; css1 joins them with a pipe.
      for (const entry of value.split('|')) {
        // Strip axis/weight suffixes: 'Inter:wght@400;700' -> 'Inter'.
        const nameRaw = entry.split(':')[0]
        if (!nameRaw) continue
        let name: string
        try {
          name = decodeURIComponent(nameRaw.replace(/\+/g, ' ')).trim()
        } catch {
          name = nameRaw.replace(/\+/g, ' ').trim()
        }
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        fonts.push(name)
      }
    }
  }

  return fonts
}

// ── Images ───────────────────────────────────────────────────────────────────

const PHOTO_EXT = /\.(jpe?g|png|webp)(\?|#|$)/i

// Chrome, sprites and tracking pixels, by the names they always carry.
const NON_PHOTO =
  /(icon|logo|sprite|favicon|badge|avatar|placeholder|spinner|loader|pixel|tracking|blank|spacer|1x1|arrow|chevron|bullet)/i

function absolutize(src: string, baseUrl: string): string | null {
  try {
    return new URL(src, baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * Up to `limit` content photos, absolute. Keeps .jpg/.jpeg/.png/.webp and drops
 * icon-ish names, data: URIs, svg/gif, and any <img> declaring a dimension
 * under 100px.
 */
export function extractImageUrls(html: string, baseUrl: string, limit = 5): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  const consider = (src: string | undefined | null) => {
    if (!src || found.length >= limit) return
    const trimmed = src.trim()
    if (!trimmed || /^data:/i.test(trimmed)) return
    if (!PHOTO_EXT.test(trimmed)) return
    if (NON_PHOTO.test(trimmed)) return

    const abs = absolutize(trimmed, baseUrl)
    if (!abs) return
    const key = abs.split('#')[0]
    if (seen.has(key)) return
    seen.add(key)
    found.push(abs)
  }

  // <img> tags first, so width/height attributes can be inspected per tag.
  const imgTags = html.match(/<img\b[^>]*>/gi) || []
  for (const tag of imgTags) {
    if (found.length >= limit) break

    // "under 100px context" — a declared small dimension means chrome, not
    // content. Percentage and missing values are left alone.
    const width = tag.match(/\bwidth\s*=\s*["']?(\d+)/i)
    const height = tag.match(/\bheight\s*=\s*["']?(\d+)/i)
    if (width && Number(width[1]) < 100) continue
    if (height && Number(height[1]) < 100) continue

    // data-src covers the lazy-loading case where src holds a placeholder.
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
    const dataSrc = tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)
    consider(dataSrc?.[1])
    consider(src?.[1])
  }

  // CSS background images, inline or in a <style> block.
  const backgrounds = html.match(/background-image\s*:[^;}]*url\([^)]+\)/gi) || []
  for (const decl of backgrounds) {
    if (found.length >= limit) break
    const inner = decl.match(/url\(\s*["']?([^"')]+)["']?\s*\)/i)
    consider(inner?.[1])
  }

  return found
}

// ── Stylesheets ──────────────────────────────────────────────────────────────

// Same-origin only: a third-party CDN's stylesheet describes their design
// system, not this client's brand.
function stylesheetUrls(html: string, baseUrl: string): string[] {
  const links = html.match(/<link\b[^>]*>/gi) || []
  const out: string[] = []
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return out
  }

  for (const tag of links) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const abs = absolutize(href.replace(/&amp;/gi, '&'), baseUrl)
    if (!abs || !abs.startsWith(origin)) continue
    if (out.includes(abs)) continue
    out.push(abs)
    if (out.length >= MAX_STYLESHEETS) break
  }

  return out
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Fetches the page (and a few of its stylesheets) and pulls out the palette,
 * fonts and photos.
 *
 * Never throws. Visual data is an enrichment — a site that blocks the request
 * must still get a text brand profile, so failure returns empty fields with the
 * reason attached.
 */
export async function extractVisualBrand(url: string): Promise<VisualBrand> {
  let html: string
  try {
    html = await fetchRawHtml(url)
  } catch (e: any) {
    const reason = e?.message || String(e)
    console.warn(`[visual-brand] could not fetch raw HTML for ${url}: ${reason}`)
    return { ...EMPTY_VISUAL_BRAND, error: reason }
  }

  // Colours are read from the markup plus same-origin CSS; fonts and images
  // only ever come from the markup.
  let colorSource = html
  let stylesheetsRead = 0

  for (const href of stylesheetUrls(html, url)) {
    try {
      colorSource += '\n' + (await fetchText(href, CSS_TIMEOUT_MS, MAX_CSS_BYTES))
      stylesheetsRead++
    } catch (e: any) {
      console.warn(`[visual-brand] stylesheet skipped (${href}): ${e?.message || e}`)
    }
  }

  const colorCounts = extractHexColors(colorSource)

  return {
    colors: colorCounts.slice(0, 3).map((c) => c.hex),
    color_counts: colorCounts.slice(0, 12),
    fonts: extractGoogleFonts(html),
    image_urls: extractImageUrls(html, url, 5),
    html_bytes: html.length,
    stylesheets_read: stylesheetsRead,
  }
}
