// Where each kind of ICP actually gathers on Reddit.
//
// Shared by the Audience Intelligence agent (which searches these communities)
// and Trend Radar (which reads their hot feeds), so the mapping has one home
// rather than drifting between two route files.
//
// Matched loosely, because `industry` arrives as free text from the caller
// ("dental", "SaaS CRM", "accounting for tradies").

const SUBREDDIT_MAP: { match: string[]; subs: string[] }[] = [
  { match: ['dental', 'healthcare', 'health', 'medical'], subs: ['Dentistry', 'Dentists', 'smallbusiness'] },
  { match: ['saas', 'software', 'tech'], subs: ['SaaS', 'startups', 'entrepreneur'] },
  { match: ['accounting', 'finance', 'bookkeeping'], subs: ['Accounting', 'smallbusiness', 'financialindependence'] },
  { match: ['ecommerce', 'e-commerce', 'retail', 'shop'], subs: ['ecommerce', 'Entrepreneur', 'smallbusiness'] },
  { match: ['agency', 'marketing', 'advertising'], subs: ['marketing', 'PPC', 'startups'] },
]

const DEFAULT_SUBS = ['smallbusiness', 'Entrepreneur', 'freelance']

export function industrySubreddits(industry: string): string[] {
  const needle = String(industry || '').toLowerCase()

  const entry = SUBREDDIT_MAP.find((row) => row.match.some((m) => needle.includes(m)))
  const subs = entry ? [...entry.subs] : [...DEFAULT_SUBS]

  // Always leave the caller with a general small-business community to fall
  // back on.
  if (subs.length < 2 && !subs.includes('smallbusiness')) {
    subs.push('smallbusiness')
  }

  return Array.from(new Set(subs))
}
