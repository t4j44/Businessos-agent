// The agent roster shown on the dashboard.
//
// `agentType` matches the value each route passes to logAgentRun(), which is
// how a card finds its own last run in /api/dashboard/metrics.
//
// Not every agent can be started from a button. Some need a real inbound
// payload — a call transcript, a review, a booking request — so they run when
// that event arrives, not on demand. Those carry `trigger: 'event'` and render
// a disabled action with an explanation rather than a button that would 400.

export type AgentTrigger = 'manual' | 'event'

export type AgentDefinition = {
  agentType: string
  name: string
  description: string
  /** POST target for Run Now. Present only when trigger === 'manual'. */
  endpoint?: string
  trigger: AgentTrigger
  /** Shown instead of a button for event-driven agents. */
  eventNote?: string
  /** Where the card links for detail. */
  href: string
  /** Emoji shown in the activity feed and agent card. */
  icon?: string
  /** 'active' | 'beta' | 'paused' — informational only. */
  status?: string
  /** Groups agents on the dashboard, e.g. 'intelligence'. */
  category?: string
}

export const AGENTS: AgentDefinition[] = [
  {
    agentType: 'call_center',
    name: 'Call Center',
    description: 'Answers your phone and resolves calls 24/7',
    trigger: 'event',
    eventNote: 'Runs on every inbound call',
    href: '/dashboard/calls',
  },
  {
    agentType: 'receptionist',
    name: 'Receptionist',
    description: 'Answers chat on your website',
    trigger: 'event',
    eventNote: 'Runs on every website chat',
    href: '/dashboard/receptionist',
  },
  {
    agentType: 'reputation_intelligence',
    name: 'Reputation',
    description: 'Reads new reviews and drafts replies',
    endpoint: '/api/agents/reputation/analyze',
    trigger: 'manual',
    href: '/dashboard/reviews',
  },
  {
    agentType: 'invoice_chase',
    name: 'Invoice Chase',
    description: 'Follows up on every unpaid invoice',
    endpoint: '/api/agents/invoice-chase/run',
    trigger: 'manual',
    href: '/dashboard/invoices',
  },
  {
    agentType: 'creative',
    name: 'Creative',
    description: 'Writes and schedules your social content',
    endpoint: '/api/agents/creative',
    trigger: 'manual',
    href: '/dashboard/content',
  },
  {
    agentType: 'bi_reporter',
    name: 'BI Reporter',
    description: 'Compiles your Monday brief',
    endpoint: '/api/agents/bi-reporter/generate',
    trigger: 'manual',
    href: '/dashboard/brief',
  },
  {
    agentType: 'scheduler',
    name: 'Scheduler',
    description: 'Books and confirms appointments',
    trigger: 'event',
    eventNote: 'Runs on every booking request',
    href: '/dashboard/scheduler',
  },
  {
    agentType: 'brand_scout',
    name: 'Brand Scout',
    description: 'Learns your brand voice from your website',
    trigger: 'event',
    eventNote: 'Runs from My Business',
    href: '/dashboard/my-business',
  },
  {
    agentType: 'market_intelligence',
    name: 'Market Intelligence',
    description: 'Monitors competitor moves and market opportunities nightly',
    icon: '🕵️',
    status: 'active',
    category: 'intelligence',
    trigger: 'event',
    eventNote: 'Runs nightly via Nightwatch',
    href: '/dashboard/brief',
  },
  {
    agentType: 'audience_intelligence',
    name: 'Audience Intelligence',
    description: 'Scans Reddit for ICP pain points and exact buying language',
    icon: '🎯',
    status: 'active',
    category: 'intelligence',
    trigger: 'event',
    eventNote: 'Runs nightly via Nightwatch',
    href: '/dashboard/brief',
  },
  {
    agentType: 'trend_radar',
    name: 'Trend Radar',
    description: 'Identifies trending topics to post before the moment passes',
    icon: '📡',
    status: 'active',
    category: 'intelligence',
    trigger: 'event',
    eventNote: 'Runs nightly via Nightwatch',
    href: '/dashboard',
  },
  {
    // `agentType` must match what the routes actually pass to logAgentRun().
    // All three Hunter steps (prospect, enrich, generate) log 'hunter', so the
    // catalog registers that — 'hunter_prospect' bound to no run at all.
    agentType: 'hunter',
    name: 'Hunter',
    description: 'Discovers local business leads, enriches them, and writes the outbound',
    icon: '🗺️',
    status: 'active',
    category: 'hunter',
    // 'event', not 'manual': the dashboard's Run Now posts { client_id } only,
    // and prospecting needs a search query — it would 400. The Hunter page is
    // where a run is actually started.
    trigger: 'event',
    eventNote: 'Runs from the Hunter page',
    href: '/dashboard/hunter',
  },
  {
    agentType: 'call_center_inbound',
    name: 'Call Center (Inbound)',
    description: 'Handles inbound calls arriving through the telephony webhook',
    icon: '📞',
    status: 'active',
    category: 'voice',
    trigger: 'event',
    eventNote: 'Runs on every inbound call',
    href: '/dashboard/calls',
  },
  {
    agentType: 'nightwatch',
    name: 'Nightwatch',
    description: 'Runs all intelligence agents nightly, builds your Monday Brief',
    icon: '🌙',
    status: 'active',
    category: 'intelligence',
    endpoint: '/api/agents/nightwatch',
    trigger: 'manual',
    href: '/dashboard/brief',
  },
]

// ── Run status ────────────────────────────────────────────────────────────
export type RunStatus = 'running' | 'success' | 'error' | 'never'

// agent_runs.status is free text written by several routes, so it is
// normalised to the four states the pill knows how to render.
export function normalizeStatus(raw?: string | null): RunStatus {
  if (!raw) return 'never'
  const s = String(raw).toLowerCase()
  if (s === 'completed' || s === 'success' || s === 'ok') return 'success'
  if (s === 'failed' || s === 'error') return 'error'
  if (s === 'running' || s === 'pending' || s === 'queued' || s === 'started') return 'running'
  return 'never'
}

// "3m ago" / "2h ago" / "4d ago" — compact enough for a card corner.
export function relativeTime(iso?: string | null): string {
  if (!iso) return 'Never run'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Never run'
  const diff = Date.now() - then
  if (diff < 0) return 'Just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
