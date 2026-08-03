# Business OS — Current Situation Audit
_Generated: 2026-05-16_

---

## 1. What Is Actually Built and Working

### Pages / UI
| Route | Status | Notes |
|---|---|---|
| `/dashboard` | ✅ REAL | Metric cards, agent feed (30s refresh), hot leads, Monday brief, approvals queue |
| `/dashboard/leads` | ✅ REAL | Stats bar, ICP panel, leads table + pagination/filters, lead drawer with tabs |
| `/dashboard/reviews` | ✅ REAL | Platform tabs, sentiment SVG chart, complaint intelligence, quick response queue |
| `/dashboard/billing` | ✅ REAL | Plan info, usage bar, mock invoice history, Stripe portal button |
| `/dashboard/brief/[id]` | ✅ REAL | Renders brief_html, print/share buttons |
| `/pricing` | ✅ REAL | 5 tiers, annual/monthly toggle, Stripe checkout |
| `/login` | ✅ REAL | Magic link + Google OAuth |
| `/dashboard/content` | ⛔ STUB | Placeholder `<h1>` only |
| `/dashboard/calls` | ⛔ STUB | Placeholder `<h1>` only |
| `/dashboard/enrichment` | ⛔ STUB | Placeholder `<h1>` only |
| `/dashboard/settings` | ⛔ STUB | Placeholder `<h1>` only |
| `/onboarding` | ⛔ STUB | Placeholder `<h1>` only |
| `/brand-review` | ⛔ STUB | Placeholder `<h1>` only |

### API Routes
| Route | Status | Notes |
|---|---|---|
| `/api/auth/callback` | ✅ REAL | OAuth code exchange, client record check, routes to dashboard or onboarding |
| `/api/checkout` | ✅ REAL | Stripe session creation; mock bypass when no STRIPE_SECRET_KEY |
| `/api/billing/portal` | ✅ REAL | Stripe portal session; mock bypass |
| `/api/webhooks/stripe` | ✅ REAL | subscription.created/deleted, invoice events, n8n triggers, Resend emails |
| `/api/agents/hunter/config` | ✅ REAL | GET/POST campaign settings_json (find-first-then-update-or-insert) |
| `/api/agents/reviews/respond` | ✅ REAL | approve + regenerate actions; Claude Haiku via fetch with mock fallback |
| `/api/approvals/[id]` | ✅ REAL | PATCH endpoint for approvals_queue status updates |
| `/api/widget/config` | ✅ REAL | CORS + 60s CDN cache; parallel fetch brand_profiles + clients |
| `/api/widget/chat` | ⛔ STUB | Returns `{message: 'POST widget/chat'}` — zero AI logic |
| `/api/onboarding` | ⛔ STUB | Returns placeholder JSON |
| `/api/agents/creative` | ⛔ STUB | Returns placeholder JSON |
| `/api/agents/callcenter` | ⛔ STUB | Returns placeholder JSON |
| `/api/agents/callcenter/index-kb` | ⛔ STUB | Returns placeholder JSON |
| `/api/agents/enrichment/csv-import` | ⛔ STUB | Returns placeholder JSON |
| `/api/agents/enrichment/business-card` | ⛔ STUB | Returns placeholder JSON |
| `/api/webhooks/bland` | ⛔ STUB | Returns placeholder JSON |
| `/api/webhooks/instantly` | ⛔ STUB | Returns placeholder JSON |

### Components
| Component | Status |
|---|---|
| `Sidebar.tsx` | ✅ REAL — nav, collapsible desktop, mobile drawer, plan badge, sign-out |
| `Header.tsx` | ✅ REAL — active ping dot, bell with notification badge, gradient avatar |
| `MetricCard.tsx` | ✅ REAL — trend arrows (TrendingUp/Down/Minus), skeleton loading state |
| `AgentStatusBadge.tsx` | ✅ REAL — color-coded: running=blue pulse, completed=green, failed=red, pending=amber |
| `MondayBrief.tsx` | ✅ REAL — Supabase fetch + mock fallback, history dropdown linking `/dashboard/brief/[id]` |
| `ApprovalsQueue.tsx` | ✅ REAL — mock fallback, approve/reject calling `/api/approvals/[id]`, but uses `@/types` alias |
| `Button.tsx` | ⛔ STUB — renders `<div>` |
| `Card.tsx` | ⛔ STUB — renders `<div>` |
| `Badge.tsx` | ⛔ STUB — renders `<div>` |
| `Input.tsx` | ⛔ STUB — renders `<div>` |
| `Modal.tsx` | ⛔ STUB — renders `<div>` |

### Widget
| File | Status |
|---|---|
| `public/widget/widget.js` | ✅ REAL — ~350 lines, vanilla JS IIFE, XSS-safe (textContent only), mobile responsive |
| `/api/widget/config` | ✅ REAL — serves brand config with CORS, 60s edge cache |
| `/api/widget/chat` | ⛔ STUB — returns placeholder; no embeddings, no RAG, no Claude call |

### Lib / Services
| File | Status |
|---|---|
| `lib/supabase.ts` | ✅ REAL — `supabaseBrowser` (anon), `supabaseServer` (service role), `getClientId` helper |
| `lib/stripe.ts` | ✅ REAL — Stripe SDK init, `PLAN_TIERS` map, `getOrCreateStripeCustomer` |
| `lib/anthropic.ts` | ⛔ STUB — returns `{}` |
| `lib/voyage.ts` | ⛔ STUB — returns `{}` |
| `lib/bland.ts` | ⛔ STUB — returns `{}` |
| `lib/resend.ts` | ⛔ STUB — returns `{}` |
| `lib/hubspot.ts` | ⛔ STUB — returns `{}` |

---

## 2. What Is Broken Right Now

1. **No `tsconfig.json` at project root** — `ApprovalsQueue.tsx` uses `@/types`; Next.js needs tsconfig to run TypeScript at all. Without it, `npm run dev` will either fail or silently drop type checking.
2. **Tailwind CSS not installed** — `tailwindcss` is absent from root `package.json`. No `tailwind.config.ts` or `postcss.config.js` exist. Every Tailwind class across every component renders as unstyled HTML.
3. **`/api/widget/chat` is a stub** — The Receptionist widget sends messages but gets back placeholder text. The entire AI chat feature is non-functional.
4. **All 28 environment variables are empty strings** — Supabase, Anthropic, Stripe, Voyage AI, and all third-party services have no credentials. Every DB query fails in a live environment. Pages fall back to mock data where available.
5. **Stripe price IDs are placeholders** — `lib/stripe.ts` defines `price_starter_mo`, `price_core_mo` etc. These are not real Stripe price IDs. Any live checkout attempt fails.
6. **`widget.js` API origin detection** — On external client sites, `/api/widget/config` resolves to the client's domain, not the Business OS server. The script correctly reads `data-api-origin` from the script tag, but if site owners omit it, config loading silently fails.
7. **No `@types/react-dom`** — Listed in dependencies but type package absent from devDependencies; may cause TS errors during build.
8. **UI components are stubs** — `Button`, `Card`, `Badge`, `Input`, `Modal` in `components/ui/` all render `<div>`. Pages importing from this directory get unstyled, non-functional elements.
9. **No Supabase schema migrations** — None of the 14+ tables referenced in code (`clients`, `leads`, `campaigns`, `agent_runs`, `rag_chunks`, etc.) have migration files in this repo. Tables must be created manually.
10. **`n8n` automation triggers will silently fail** — `N8N_WEBHOOK_BASE_URL` is empty. The Stripe webhook handler tries to call n8n on subscription events; these calls fail with no error surfaced to the user.

---

## 3. What Is Missing (Not Built At All)

- **Onboarding flow** — No wizard, no client record creation from UI, no brand profile setup steps
- **Brand review page** — Referenced in nav but is a stub
- **Content agent dashboard** — Calendar, post queue, Buffer OAuth
- **Calls agent dashboard** — Call log, transcript viewer, Bland AI configuration
- **Enrichment agent dashboard** — CSV import UI, business card scanner, field mapping
- **Settings page** — Team members, API key management, webhook configuration, notification preferences
- **Real AI lib wrappers** — `anthropic.ts`, `voyage.ts` are stubs; AI-calling code in routes uses raw `fetch` (works but is fragile and duplicated)
- **pgvector RAG pipeline** — No `match_rag_chunks` Supabase RPC tested or documented; no document chunking/indexing flow
- **KB indexing endpoint** — `/api/agents/callcenter/index-kb` is a stub; no file upload, no embedding pipeline
- **Bland.ai call webhook** — Transcript delivery, call classification on completion
- **Instantly.ai email webhook** — Open/reply/bounce event tracking
- **Supabase database schema** — No SQL migration files in this repo

---

## 4. TypeScript Errors (Will Block `npm run build`)

| File | Error |
|---|---|
| `src/components/dashboard/ApprovalsQueue.tsx` | `@/types` unresolvable — tsconfig path alias not configured |
| Any file using `@/` imports | Same — no tsconfig.json at root |
| `src/lib/stripe.ts` | Placeholder price IDs pass type check but fail at Stripe runtime |
| `src/app/api/widget/chat/route.ts` | Stub — no type errors but returns wrong shape |
| All stub `lib/` files | Any caller expecting real return shapes will get empty `{}` |

**Estimated hard errors: 2–4. Warnings: 15–25. Build will likely fail without tsconfig.**

---

## 5. Missing Dependencies

```bash
# Critical — UI is completely unstyled without this
npm install tailwindcss @tailwindcss/postcss postcss

# Missing type definitions
npm install -D @types/react-dom

# Recommended — currently using raw fetch for Claude calls
npm install @anthropic-ai/sdk
```

**Missing config files (must be created):**
- `tsconfig.json` — CRITICAL, Next.js TypeScript requires it
- `tailwind.config.ts` — Required for Tailwind to scan component files
- `postcss.config.js` — Required for Tailwind compilation

---

## 6. Environment Variable Status

**All 28 variables in `.env.local` are empty strings.**

| Priority | Variables | Impact if Missing |
|---|---|---|
| P0 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Every page crashes — no auth, no data reads |
| P1 | `ANTHROPIC_API_KEY` | AI review responses fall to mock; widget chat completely fails |
| P1 | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Checkout bypasses to mock; webhooks fail |
| P2 | `VOYAGE_API_KEY` | Widget RAG embeddings fail |
| P2 | `RESEND_API_KEY` | Transactional emails silently fail |
| P3 | All 18 remaining keys | Respective agent features non-functional |

**Minimum viable set to run locally:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 7. What Breaks on `npm run dev`

**Will likely crash before serving:**
- Missing `tsconfig.json` causes Next.js to fail TypeScript compilation setup
- Missing Tailwind/PostCSS config means CSS pipeline errors at first page render (dev server may still start but styles are absent)

**Will show errors at runtime (pages load, features fail):**
- Every Supabase call → connection error; pages fall back to mock data where coded, hang on skeletons where not
- `/dashboard` metric cards: infinite loading skeletons (no DB)
- `/dashboard/reviews`: shows 3 mock reviews — appears to work
- `/dashboard/billing`: shows mock invoice data — appears to work
- Widget config endpoint: 500 error (Supabase not configured)
- Widget chat: returns placeholder string (stub)
- Approve/Reject on ApprovalsQueue: calls `/api/approvals/[id]` which exists ✅ but Supabase update fails (no credentials)

**Summary:** `npm run dev` will crash or produce a broken dev environment until `tsconfig.json` is added. With tsconfig present and Tailwind skipped, the dev server starts but renders completely unstyled pages with non-functional data fetching.

---

## 8. Priority Fix Order

### P0 — Blocking `npm run dev`
1. Add `tsconfig.json` at project root
2. Install Tailwind CSS + create `tailwind.config.ts` + `postcss.config.js`
3. Fill in `.env.local` with real Supabase credentials

### P1 — Core Feature Completeness
4. **Implement `/api/widget/chat/route.ts`** — flagship feature is completely non-functional
5. **Add `ANTHROPIC_API_KEY`** — reviews agent and widget both need it
6. **Add `STRIPE_SECRET_KEY` + real price IDs** — no user can subscribe without this

### P2 — Production Readiness
7. Implement `lib/anthropic.ts` and `lib/voyage.ts` as real wrappers (DRY up fetch calls)
8. Create Supabase schema migrations (SQL files for all 14 tables)
9. Add `@types/react-dom` and fix `@/` alias in tsconfig paths
10. Fix `widget.js` API origin to always use absolute URL to Business OS server

### P3 — Feature Completion
11. Build onboarding multi-step flow
12. Build content, calls, enrichment, settings pages
13. Implement Bland.ai and Instantly.ai webhooks
14. Implement real UI components (Button, Card, Badge, Input, Modal)

---

## 9. Completion Percentage Per Feature

| Feature | % Complete | Main Blocker |
|---|---|---|
| **Main Dashboard shell** | 90% | Env vars for live data; Tailwind for styles |
| **Hunter Agent (Leads)** | 80% | Needs real DB + env vars to test end-to-end |
| **Receptionist Widget (UI + Config)** | 90% | Widget JS and config route complete |
| **Receptionist Widget (AI Chat)** | 5% | Chat route is a stub — no AI, no RAG |
| **Reviews / Reputation Agent** | 75% | UI + approve/regenerate work; needs real DB |
| **Monday Brief / BI Reporter** | 70% | Render pipeline works; needs DB to generate briefs |
| **Billing + Stripe** | 70% | UI complete; needs real price IDs and keys |
| **Authentication** | 80% | Auth callback + middleware real; needs Supabase env vars |
| **Approvals Queue** | 80% | Route exists; needs Supabase for live updates |
| **Content Agent** | 5% | Stub page only |
| **Calls Agent** | 5% | Stub page only |
| **Enrichment Agent** | 5% | Stub page only |
| **Settings** | 0% | Not started |
| **Onboarding** | 0% | Not started |
| **Overall** | **~42%** | Infrastructure blockers prevent any feature running end-to-end |

---

## 10. Next 3 Actions (In Order)

### Action 1 — Add `tsconfig.json` + Tailwind so `npm run dev` works
```jsonc
// tsconfig.json (minimum viable)
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
Then: `npm install tailwindcss @tailwindcss/postcss postcss` + create `tailwind.config.ts` + `postcss.config.js`

### Action 2 — Implement `/api/widget/chat/route.ts`
The Receptionist widget is the most customer-visible differentiator and its AI core is a stub. Full implementation:
1. Validate `client_id` + `session_id` + check `api_usage` budget
2. Call Voyage AI `voyage-3-lite` to embed the incoming message
3. Call Supabase RPC `match_rag_chunks` with the embedding vector
4. Build system prompt with RAG context + brand config
5. Call Claude Sonnet 4.6 via fetch
6. Classify response (`qualified_prospect` / `support` / `browser`)
7. If `qualified_prospect` and `conversation_history.length > 3`: include booking card data
8. Log to `agent_runs` table
9. Return `{response, classification, session_id}` with CORS headers

### Action 3 — Fill `.env.local` with real credentials (Supabase minimum)
With just `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` filled in, the dashboard will switch from mock data to live DB queries, making the full app testable end-to-end. Create the Supabase tables to match the 14 interfaces in `src/types/index.ts`.
