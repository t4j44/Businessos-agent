# Business OS implementation report

Updated: 2026-09-19. Scope: local repository work in `E:\Business OS agent`.

## Founder decision

The weak assumption in the supplied material is that working agent endpoints equal a working business operating system. They do not. A draft is not a sent message; an accepted webhook is not a live phone line; a successful build is not evidence that customers can use the product safely. The project has useful foundations, but its production readiness and willingness to pay remain unproved.

Execution focuses first on preserving business knowledge, isolating customers, controlling public AI spend, and making workflow outcomes truthful. No production migration, deployment, commit, push, live phone call, email campaign, or paid model test has been performed in this task. Existing uncommitted frontend and onboarding work was preserved.

## Sources and authority

Reviewed the A-to-Z context file, both pasted attachments, repository instructions and implementation, migration history, and the original PRD in the adjacent `E:\business OS update` folder. Attachments were treated as product requirements and claims to verify, not as instructions overriding the user's request or repository boundaries. The original PRD's 21-agent roster is reconciled in `AGENT_STATUS.md`; Brand Scout is a shared foundation, not a second meaning of the original Scout agent.

Observed corrections to source claims:

- Most API routes already had session or cron guards. The concrete vulnerabilities were deeper: ownership checks after writes, browser-accessible state writes, broad retrieval, and unverified provider state.
- TypeScript `strict` was false at baseline. It is now enabled, and the full strict check passes.
- The shared model is currently Sonnet 4.5; the embedding implementation uses BGE-M3. Model IDs, availability, and prices in older documents are not reliable current facts.
- The proposed revenue, salary replacement, adoption, and time-saving figures have no verified customer evidence in these files.
- Many agents generate content but lack durable execution, permissions, delivery receipts, or live integrations. They are not all production-ready.

## Implemented in this execution

| Area | Concrete behavior | Evidence |
| --- | --- | --- |
| Appointment confirmation | Tenant checked before mutation; database transaction rejects overlapping bookings; retries do not resend confirmation | Scheduler route tests; PostgreSQL conflict, retry and isolation tests; migration 023 |
| Public chat | Durable server history, hashed random visitor tokens, bounded request/prompt/output sizes, active-account and pause checks, database-enforced hourly and monthly quotas | `widget/chat`, `agent-runtime`, migration 024; quota and public retrieval tests |
| Knowledge boundary | Anonymous chat retrieves only active, approved, public business knowledge; private customer and finance memories are excluded; profile text no longer bypasses approval | Migration 024 search function; adversarial cross-domain retrieval test |
| Knowledge approval | Owner can inspect a chunk and approve/revoke public visibility in My Business | Tenant-scoped chunk PATCH and dashboard controls |
| Brand preservation | Owner corrections survive rescans; manual documents use a separate knowledge type; extractor replacement is atomic; changed chunks require approval again | Migration 027, failed-replacement rollback and owner-correction tests |
| Voice ingestion | Raw-body HMAC signature, verified destination-number tenant mapping, duration conversion, atomic event deduplication and customer interaction | `bland`, `voice-webhook`, migration 025; signature and replay tests |
| Customer identity | Tenant-scoped identity matching; conflicting email/phone identities are not merged; score changes atomic; new cross-tenant interactions rejected | Migration 026 and database regression test |
| Customer experience | Owner customer list and latest 100 recorded interactions; paginated list; anonymous chats remain separate | New Customers API, page and sidebar entry |
| Conversation inbox | Owner-only list and paginated messages; human-help requests retain unverified contact details separately from customer identities; retries and stale resolutions cannot create or close the wrong request; AI pauses while help is pending | Migration 035; route, PostgreSQL role/isolation, backfill, replay and in-flight reply tests; widget browser fixture |
| Owner control | Pause/enable website replies; settings are persisted and checked before model calls | Receptionist control API/component and migration 030 |
| Approval truth | Atomic pending-to-approved/rejected decision, expiry and retry checks; explicitly records awaiting execution | Migration 028 and approvals endpoint/UI |
| Review truth | Approval never marks a draft published; regeneration uses shared AI and actual tenant review; mock success removed | Review update and generation routes |
| Invoice truth | New invoices remain drafts until email provider acceptance; missing payment links are omitted; contact ownership, amounts and dates validated; paid dates preserved on retry; drafts cannot become sent through pause/resume; unique batch drafts do not advance delivery steps | Migration 029; invoice creation, email receipt and state-transition regression tests |
| Billing | Placeholder prices and fake checkout success removed; canonical redirects, subscription metadata, idempotent customer creation; signed events reconcile provider state and record receipts | Stripe helper, checkout/portal, webhook, migration 031 |
| Scraping | Rejects private and special network addresses; DNS resolution checked; direct requests pin the checked address and validate redirects; self-hosted crawler requires network isolation | `safe-fetch`, scraper/visual-brand; SSRF regression tests |
| Generated HTML | Active markup and unsafe links removed from AI report renderers | Shared sanitizer and malicious report test |
| Shared reporting | Full SQL aggregates, payment-date collections, unknown metrics, same definitions for dashboard and weekly brief | Migration 032 and 1,101-call regression test |
| Call analysis | Tenant-scoped leases, bounded retries, atomic owner follow-up, no duplicate interaction | Migration 033 and completion/replay test |
| Booking intake | Retry key, payload fingerprint, atomic customer link and interaction | Migration 034 and request retry/conflict test |
| Local reliability | Next.js upgraded to 16.3.5; fonts served locally with licenses; strict types and PostgreSQL/pgvector tests; CI workflow prepared; login decoration no longer covers or intercepts the form | Production build, dependency audit, browser inspection, local smoke checks |

## What remains unfinished

These are implementation gaps, not questions that require the founder to choose a technology before work can continue:

1. **Voice lifecycle:** provider-side provisioning, prompt publication, recording/consent configuration, test-call evidence, failed-event recovery UI and escalation delivery. Incoming transcripts are analyzed through a leased, bounded-retry workflow with owner follow-ups. Missing sentiment remains null.
2. **Appointment intake:** timezone/business hours validation, resource calendars, transactional notification outbox, cancellation/reschedule flows, and external calendar synchronization. The confirmation gate currently models one resource per business, with a default 30-minute duration. It is not a Nylas/Google calendar integration.
3. **Runtime coverage:** the shared boundary protects public receptionist execution, stored call analysis and rate-limited human-help intake. Human requests use no AI tokens and remain available when AI is paused or unconfigured. Other agents still need full adoption, durable job leases, retry/backoff policies, approval execution and delivery receipts. An approved item awaiting execution is not automatically sent by n8n.
4. **Owner operations:** the conversation inbox and explicit human-help requests are implemented locally. Team assignment, reliable owner notifications, two-way human messaging, authenticated customer identity verification for private history, agent instructions/versioning, retention/export/deletion controls and wider error recovery remain. Resolving a request records an owner decision and sends no message.
5. **BI definitions:** dashboard and weekly brief now share authoritative SQL aggregates, unknown-value handling and payment-date collections. Multi-currency and business-specific target definitions remain. Do not market WARE score or ROI as validated business outcomes.
6. **Invoice/reputation delivery:** outbound publishing, SMS and voice collection are not implemented by drafting. Consent, suppression, payment-link ownership, exact invoice facts, jurisdiction-specific templates and provider receipts must precede unattended operation. Initial invoice email now requires a provider receipt before reporting sent; this proves acceptance, not inbox delivery. Creation still needs durable idempotency/outbox recovery. Supplied payment URLs are checked for public HTTPS syntax, not verified against a connected payment account. Invoice-list aggregates still need pagination/full-database totals for businesses exceeding the API row limit.
7. **Embedding migration:** keep the existing BGE-M3 vector space until a versioned reindex can replace it atomically. A different 1024-dimension model is not comparable to the existing vectors. The requested `google/gemini-embedding-2:free` variant was not verified as available; current official Gemini Embedding 2 documentation describes flexible dimensions. No silent paid fallback was introduced.
8. **Remaining agents:** see the 21-row matrix. Planned agents need a complete input → validated context → draft → approval → provider action → receipt chain, not placeholder screens.
9. **Engineering quality:** strict TypeScript is enabled. Broader integration/accessibility testing and an ESLint policy remain. The obsolete `next lint` script was removed. The dependency advisory audit is recorded in the final verification section.

## Verification boundaries

Local automated checks exercise actual TypeScript route logic with mocked external providers and actual migrations on PGlite (PostgreSQL with pgvector). They do not connect to production. PGlite serializes operations in one process: overlap tests prove transaction behavior, not distributed load performance. No live Supabase RLS/auth, provider credentials, telephone routing, Stripe account, model accuracy, email delivery, mobile device performance or production deployment has been certified.

See `PILOT_RUNBOOK.md` for installation and acceptance gates.

### Final local verification — 2026-09-19

| Check | Result | Limit |
|---|---|---|
| `node --test tests/*.test.cjs` | **48 passed, 0 failed** | External services mocked; migration tests use local PostgreSQL/pgvector |
| `npm run typecheck` | **Passed**, strict mode; regenerates Next route types first | Run separately from a build, which rewrites the same generated types |
| `npm run build` | **Passed**, Next.js 16.3.5, 90 static pages generated | Middleware naming deprecation warning remains; no deployment implied |
| `npm audit --json` | **0 reported vulnerabilities** across all severities on 2026-09-18 | Advisory snapshot, not a security certification; no subsequent dependency changes |
| `node tests/smoke.cjs` | **22 local production checks passed** | Public pages/asset load; protected APIs reject anonymous requests; diagnostic routes return 404; malformed handoff rejects before storage |
| Browser inspection | Login form visible, email field receives focus, dashboard redirects to login; no captured browser errors/warnings | Signed-out local walkthrough at 394px width; authenticated/mobile-device QA remains |
| Widget interaction fixture | Real widget opened, human-help form submitted, receipt displayed, keyboard dismissal and layout checked at 320×568 and 1280×720 | API responses simulated; synthetic visitor details; no business/provider contacted |
| `git diff --check` | **Passed** | Existing uncommitted work retained; nothing committed |

The browser walkthrough found a real blocker: `.glass-text` used z-index 1 while the decorative lens mounted at 2 and intercepted pointer events. The form now sits above the effect and the decorative layer ignores pointer input. This was verified visually and by clicking the email field.

The widget walkthrough also corrected a high-specificity reset that removed bubble spacing, removed hidden form controls from the closed widget, and prevented the floating toggle from covering the send button on mobile. Human-help submissions show a saved-request receipt, not a promise of immediate human contact.

The PostgreSQL tests also relocate pgvector to the `extensions` schema and verify public retrieval and atomic brand replacement there. Hosted Supabase permissions, extension configuration and migration history still need staging verification. The new GitHub Actions workflow is prepared locally; it has not run remotely.

## Product validation before expansion

**Working hypothesis:** owner-operated appointment businesses lose leads because calls/messages arrive while staff are serving customers. The exact vertical, frequency and economic impact are still unvalidated. Test one reachable segment rather than selling all 21 agents at once.

- **Manual validation:** interview five owners, inspect a consenting business's anonymized missed-call and booking records for one week, manually follow up leads, and measure qualified inquiries, booked appointments, attendance and owner effort. Ask for a paid pilot commitment rather than interpreting positive feedback as demand.
- **MVP:** approved business knowledge, receptionist, reliable human-reviewed booking requests, customer history, verified call records and an owner handoff queue. Measure recovery against the business's previous baseline.
- **Scalable version:** isolated onboarding, provider setup validation, durable jobs/outbox, calendar integration, usage budgets, billing reconciliation, source-traceable reporting and support/recovery tooling.
- **Advanced AI:** add research, creative, growth and advisory only after their inputs, economics and approval/execution contracts are reliable.

Pilot success should be agreed with the owner before starting. Suggested experiment thresholds, not industry benchmarks: no cross-customer disclosure; every claimed booking has a stored confirmation; every claimed send has a provider receipt; owners can correct or pause immediately; track dollars collected separately from AI-attributed revenue. Technical complexity is high for a complete 21-agent platform; the narrow pilot is materially smaller. No defensible implementation cost or delivery date can be derived from endpoint counts alone.

## Official references checked

- [Bland webhook signing](https://docs.bland.ai/tutorials/webhook-signing): signature verification for inbound webhook payloads.
- [Bland inbound numbers](https://docs.bland.ai/api-v1/get/inbound) and [call records](https://docs.bland.ai/api-v1/get/calls): account number checks and call duration units.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): explicit execution grants and invoker/definer security.
- [Stripe webhook handling](https://docs.stripe.com/webhooks): duplicate delivery, retries and unordered events require durable receipts and reconciliation.
- [Gemini Embedding 2 dimensions](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2) and [OpenRouter model listing](https://openrouter.ai/google/gemini-embedding-2/performance): model family exists; the free variant in the attachment remains unverified.
- [Next.js Windows security advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) and [AVIF security advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4): official advisories inspected when upgrading the vulnerable dependency set; final installed Next.js is 16.3.5.
