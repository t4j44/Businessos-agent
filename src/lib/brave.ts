// BRAVE_API_KEY — get at brave.com/search/api → subscribe to the free tier (2,000 queries/mo)
// Add to .env.local: BRAVE_API_KEY=BSA...
//
// Every failure path returns [] rather than throwing: search is an enrichment
// step for the market intelligence agent, so a missing key or a bad response
// should degrade the analysis, not fail the run.

const BASE = 'https://api.search.brave.com/res/v1/web/search'

// A hung search would otherwise stall the whole daily run, since these are
// issued in parallel and awaited together.
const TIMEOUT_MS = 10_000

export interface BraveResult {
  title: string
  url: string
  description: string
}

export async function braveSearch(
  query: string,
  count = 5,
): Promise<BraveResult[]> {
  // Read once into a local so the value is a plain string at the call site.
  const apiKey = process.env.BRAVE_API_KEY

  if (!apiKey) {
    console.warn('[brave] BRAVE_API_KEY not set — returning empty results')
    return []
  }

  try {
    const url = `${BASE}?q=${encodeURIComponent(query)}&count=${count}&country=us`
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      console.error('[brave] HTTP', res.status, await res.text())
      return []
    }

    const data = await res.json()
    return (data.web?.results || []).slice(0, count).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      description: r.description || '',
    }))
  } catch (e) {
    console.error('[brave] search failed:', e)
    return []
  }
}
