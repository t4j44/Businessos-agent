# Pilot runbook

Updated 2026-09-25. This is an execution and verification guide, not a declaration that production is ready.

## Current execution record

**Pilot acceptance: BLOCKED. New planned agents are frozen until every hosted acceptance scenario passes.**

- The original 023–035 milestone was preserved and pushed to `codex/staging-pilot` as [35dea56](https://github.com/t4j44/Businessos-agent/commit/35dea56d61e881580d82f0ba1e17056f8b52c177). [GitHub Actions passed for that commit](https://github.com/t4j44/Businessos-agent/actions/runs/35759595561). Main was not advanced.
- Recovery checkpoint [9867443](https://github.com/t4j44/Businessos-agent/commit/98674438e5f0cb1e984e9da179b3095fb844a386) was also pushed; [its GitHub Actions run passed](https://github.com/t4j44/Businessos-agent/actions/runs/36064283866). This verifies the code checks, not a staging deployment.
- `vercel.json` disables automatic deployment for this branch. The existing local project link, `businessos-agent-8suy`, is not evidence that the project is disposable staging. Identify the staging project and its isolated database before lifting the hold.
- Read-only checks of the configured Supabase endpoint returned HTTP 401 on 2026-09-22 and again at 2026-09-24T21:47:50Z, which is 2026-09-25 in Dhaka. The last request was HEAD `/rest/v1/clients?select=id&limit=0`; zero customer rows were read and no database writes occurred. Credentials being present did not prove access.
- No hosted migration, restricted deployment, authenticated two-tenant walkthrough, live calendar action or voice call has been performed. The browser tool stopped because it could not reliably identify the current URL; browser automation was not continued.
- Needed to resume hosted work: staging Supabase/Vercel project names or dashboard links, valid privately stored staging keys and operator migration access, two authorized synthetic accounts, test calendar authorization, Bland account/number plus signing secret, an approved test-call recipient and spending limit. Never paste credentials into reports or chat.

Additive migration 036 now implements scheduler email delivery recovery. Migrations 023–035 remain unchanged. The recovery code still requires hosted acceptance and a configured dispatcher.

## Local checks

Use Node 22 or newer and the root application (not the old nested `businessos` directory):

```powershell
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm start -- --hostname 127.0.0.1
```

On this machine the global `npx` shim is broken. Equivalent commands that were used successfully are:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test tests/*.test.cjs
node node_modules/next/dist/bin/next build
node node_modules/next/dist/bin/next start --hostname 127.0.0.1
```

For npm itself: `node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' <arguments>`.

`npm run typecheck` generates Next.js route types before running TypeScript. For a fresh checkout using the direct commands, run `node node_modules/next/dist/bin/next typegen` first. Run type checking and builds sequentially: both use generated files in `.next`.

The current local result is **58 passing tests**, strict type checking and a Next.js **16.3.5** production build generating **92 static pages**. `npm audit --json` reported **zero known vulnerabilities** on 2026-09-18; this is an older advisory snapshot. GitHub Actions runs installation, types, tests and build with read-only permissions and inert public placeholders. The 023–035 checkpoint passed remote CI; this does not validate Supabase or any provider.

For local production smoke checks, start on port 3187 and run `node tests/smoke.cjs`. All **25 checks passed on 2026-09-25** against the production build on port 3189, including delivery history, retry and worker authorization. The suite supplies no real tenant IDs or credentials and refuses non-local hosts. Set `SMOKE_ORIGIN` to use another local port. A signed-in staging walkthrough remains required.

For widget interaction testing without live services, run `node tests/widget-preview.cjs` and open `http://127.0.0.1:3188`. The page serves the real widget with simulated API responses. This verifies form/layout behavior, not actual request persistence; API and database regression tests cover the latter separately. Stop the fixture with Ctrl+C when finished.

Tests execute actual TypeScript code with provider doubles plus all migrations on PGlite PostgreSQL/pgvector. They do not need real credentials and do not send messages. Strict TypeScript is enabled. The obsolete `next lint` script has been removed; a separate ESLint policy is not yet configured. Local fonts remove the Google-font network dependency during builds.

## Database rollout

The new migration range is **023–036**. Migration 022 and other pre-existing modifications were already in the working tree when this work began. The original 023–035 files are preserved in commit 35dea56; 036 is a separate additive recovery change.

1. In a disposable Supabase staging project, inspect migration history and back up any existing data before applying unapplied migrations in numerical order. Do not rerun old catch-up scripts blindly against a live database.
2. Confirm the installed vector extension schema and 1024-dimension columns. The new public retrieval and brand replacement functions support `public` and `extensions`; local tests exercise both. Check legacy migrations/functions against the deployed schema as well.
3. Apply unapplied migrations 023–036 using the normal Supabase workflow. Use a privileged operator connection, not an anonymous browser connection. Missing functions deliberately cause affected operations to fail closed. Migration 035 is required for chat; 036 is required for the new Scheduler routes and reminder worker. It does not backfill emails for legacy appointments.
4. Verify two independent auth users/businesses using the actual Supabase anon/authenticated roles. The service-role key bypasses row-level security and must stay server-side.
5. Review legacy invalid contact links before validating the two new `NOT VALID` foreign keys. New writes are constrained immediately; old rows are retained for review.
6. Existing knowledge becomes internal. Owners explicitly approve suitable business facts in My Business. Old unclassified chunks are retained, and legacy editable profile values are conservatively protected because their old provenance is unknown.
7. Deploy to a restricted staging environment, execute the acceptance matrix below, then make a separate production release decision with the concrete diff and migration results.

No migration was applied to the user's hosted database during this task. Do not mark rollout complete based on the PGlite test alone.

### Migration map

| Range | Effect |
|---|---|
| 023 | Duration/resource appointment confirmation with tenant/calendar locking |
| 024 | Public knowledge approvals, durable visitor messages and usage reservations |
| 025 | Verified inbound-number mappings and idempotent voice receipts |
| 026 | Tenant-safe customer resolution, score updates and interaction links |
| 027 | Protected owner corrections and atomic website knowledge replacement |
| 028 | Durable approval decisions distinct from execution |
| 029 | Invoice draft persistence, uniqueness and generation leases |
| 030 | Atomic receptionist pause control |
| 031 | Billing event receipts and state reconciliation |
| 032 | Shared SQL metrics for dashboard and weekly report |
| 033 | Call-analysis leases, bounded attempts and atomic follow-up creation |
| 034 | Retry-safe booking intake and customer history linkage |
| 035 | Conversation history backfill/index, human-help intake, message tracking and owner resolution |
| 036 | Atomic scheduler email queue, booking versions, leases, immutable payloads, retry/reconciliation controls and business-timezone reminders |

### Recovery

Prefer forward fixes or pause affected agents. Do not recover by granting browser writes to protected tables or deleting receipts. Keep a copy of prior migrations and a tested backup. Restoring the old application alone does not undo new database privileges or schemas.

The Inbox shows website conversations and pending human-help requests. Contact details are visitor-supplied and unverified; do not merge a visitor into a customer account or expose private history based on those details. AI replies pause for that conversation until the owner resolves the request. Resolution is version-checked so a stale tab cannot resolve a reopened request. No email/SMS notification is sent: owners must review the inbox and use their own communication channel. The current summary counter tracks insertion; a future retention/deletion workflow must also reconcile these counters and previews.

An expired call-analysis lease can be reclaimed, up to three provider attempts. Calls at the retry limit need operator review. Quota failures do not consume a provider attempt. The guarded `/api/cron/call-analysis` processes at most five calls; it is **not added to the production schedule** yet. Owners can analyze a stored transcript from Calls. A missing transcript is marked unavailable. This worker still needs fair per-tenant dispatch/backoff before large unattended batches.

Invoice drafts have a ten-minute generation lease. A failed or expired generation may be reclaimed. Existing drafts are reused. Drafting never advances `chase_step`; delivery implementation must recheck invoice state, obtain approval, use a provider idempotency key, record a receipt, and only then advance the step.

New invoice creation stores a draft first. Only an email response with a provider receipt can move it to sent. If email succeeds but the status update fails, the response tells the owner to reconcile the existing invoice instead of creating it again. This is a recovery warning, not a complete outbox: automatic retry-safe creation and delivery reconciliation remain unfinished. No payment URL is fabricated; a supplied public HTTPS URL still needs verification against the business's actual payment provider.

Booking requests require `request_key` (UUID) or `Idempotency-Key`, with the same normalized payload on retry. Changed details under the same key return 409. Confirmation is idempotent for the same date/time/duration. Migration 036 queues notifications inside the booking transaction; API responses report queued rather than sent. A failed transaction creates neither a booking transition nor its email jobs.

### Scheduler delivery and recovery

The Scheduler page shows booking notifications, their status and recovery actions. Owner APIs derive the tenant from the session. Browser roles cannot read the underlying queue, whose prepared bodies include private unsubscribe links.

1. Configure Resend, a verified sender, postal address and canonical HTTPS app URL. Resolve missing owner contact email or suppression issues before retrying blocked jobs.
2. Use **Process delivery** for an eligible job, or invoke `/api/cron/scheduler-delivery` with `Authorization: Bearer <CRON_SECRET>` from the staging operator environment. The worker is not yet added to a hosted schedule. Configure and verify a suitable cadence before promising unattended confirmations; the existing daily reminder job only enqueues.
3. The worker leases a job for two minutes, freezes the exact email before sending, and reuses `scheduler/<job-id>` on every attempt. A provider receipt must be saved before status becomes `accepted`. Accepted does not mean delivered to an inbox.
4. Transient failures back off; expired leases can be reclaimed. The dispatcher orders work across tenants. Six attempts or 23 hours since the first provider attempt require review rather than an unsafe resend beyond Resend's 24-hour idempotency window.
5. For an uncertain send, find its email receipt in Resend and use **Verify receipt**. The server fetches the real provider record and matches its unique marker, complete HTML, sender, subject and recipient before recording acceptance. An arbitrary receipt ID is insufficient. Jobs that never reached the provider may be retried after configuration/storage repair.
6. Changed/cancelled bookings invalidate pending old notifications; the worker checks the version again before sending. A change after dispatch begins can still race an in-flight email. Include that race in staging acceptance and use an explicit correction workflow if required.
7. Reminders use each client's valid database timezone and are queued once per booking version. Stale reminders are not automatically sent on later days. Invalid timezones and missing customer email need operator correction. This pilot path is email-only: SMS dispatch is disabled until its own receipt/recovery contract is implemented and verified.

Keep receipts and leases during recovery. Do not reset accepted jobs, change retry keys, or delete provider history to force another attempt.

## Configuration checklist

Enter values directly in local/private environment files or provider dashboards. Never paste secrets into a report, code, or chat. Presence is not verification.

| Capability | Variables / external setup | Current evidence |
|---|---|---|
| Account and persistence | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; migrations and auth redirect settings | Key names were present locally; hosted schema, permissions and valid auth not verified |
| AI and embeddings | `OPENROUTER_API_KEY`; sufficient budget; existing BGE-M3 index | Key name present; live model accuracy and credentials not tested |
| Own URL | `NEXT_PUBLIC_APP_URL` using the canonical HTTPS origin | Required for billing redirects, email links and job callbacks |
| Cron | `CRON_SECRET`; platform schedule and plan supporting job duration | Missing in the earlier configuration check; recheck privately |
| Voice | `BLAND_API_KEY`, `BLAND_WEBHOOK_SECRET`; provider-owned number in `voice_agents`, verified operator mapping, test callback and live state | Both keys absent in the earlier check; no live phone line verified |
| Email | `RESEND_API_KEY`, verified sender domain, configured sender address, `COMPANY_POSTAL_ADDRESS`, suppression and unsubscribe configuration | Resend key name present; postal address missing in earlier check; no delivery test |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, sender number and documented customer consent | Authentication token missing in earlier check |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_{STARTER,CORE,GROWTH,SCALE,AGENCY}_{MONTHLY,ANNUAL,PILOT}` for each offered option | Key names present, but real price IDs and test-account reconciliation not verified |
| Self-hosted crawler | `CRAWL4AI_URL`, `CRAWL4AI_PRIVATE_NETWORK_BLOCKED=true` only after network isolation is enforced on that worker | Worker isolation not verified; Jina is the default fallback |
| Research and publishing | Agent-specific search/social/CRM credentials with tenant scopes | Provider integration acceptance tests still required |

The UI now says configured/verification needed when only a key is present. For voice, a live state additionally requires an account number match and a previously verified signed inbound call. That is connection evidence, not certification of voice quality.

## Acceptance matrix before a real customer pilot

**Hosted status for every scenario below: NOT RUN / BLOCKED on staging access.** No cell is considered passed because of a local fixture or the green GitHub build. Record the staging deployment URL, exact commit, migration history, UTC timestamp, two synthetic account IDs, HTTP/DB observations and provider receipt IDs for each scenario. Keep authentication material outside the report.

| Scenario | Pass condition | Evidence to retain |
|---|---|---|
| Two businesses | A cannot read or mutate B's customers, appointments, approvals or knowledge by changing IDs | HTTP results and actual Supabase RLS checks |
| Rescan | Owner corrections and manual documents survive; failed embedding/database replacement retains prior memory | Before/after IDs and forced failure |
| Public knowledge | Internal notes/customer finance details never appear in visitor context; changed facts need reapproval | Retrieval fixtures and owner chat evaluation |
| Pause/budget | Paused, inactive or quota-exhausted assistants cannot call the model | Provider call count and status codes |
| Chat | Server history survives restart; forged browser history is ignored; a failed save is not logged completed | Two-turn conversation and persistence failure |
| Human help | One request per pending conversation; no automatic identity merge; other tenants denied; AI stops while pending; stale resolution cannot close a new request | Inbox, request version, database rows and provider call count |
| Booking retry/conflict | Repeated request has one appointment/interaction; different tenant gets no access; overlap rejected | Database rows and email counts |
| Delivery recovery | Crash before/after provider acceptance recovers one email under the same key; foreign tenants denied; stale versions stopped; overdue ambiguous sends require a matched receipt | Queue rows, lease/version history, Resend receipts, recovery UI and forced failures |
| Calendar | Business timezone, opening hours, external busy slots, create/update/cancel and provider retries behave consistently | Authorized calendar event IDs, boundary dates/DST fixtures and before/after availability |
| Voice authenticity | Invalid signature/unknown number rejected; replay creates one call; duration correct | Signed test call and receipt |
| Voice analysis | Duplicate workers cannot repeat a follow-up; assessment never claims a send or booking | Lease, stored assessment and approval row |
| Invoice/review | Draft and approval do not become sent/published; paid/cancelled invoices not chased | Before/after workflow state |
| Stripe | Real test-mode price, signed updated/deleted/failed events, replay/stale events, DB failure retries, invalid signature | Stripe test events and durable receipt/state |
| Metrics | Missing values remain unknown; >1000-row totals match SQL; cash uses payment date; no false AI attribution | Independent SQL comparisons |
| Email/SMS | Verified domain/number, recipient consent where needed, suppression respected, receipts retained | Provider test records |
| User experience | Owner can review/correct knowledge, pause replies, see customer history, request/confirm a booking and recover errors at mobile/desktop widths | Authenticated staging walkthrough |

## Architecture in plain English

The owner's login decides which business a request belongs to. The server checks that identity before using its privileged database connection. Website extraction creates internal evidence; the owner chooses what the public assistant may use. Website visitors get a random session token whose hash identifies stored history. Database transactions keep counters, booking transitions and webhook receipts consistent. AI drafts are separate from real external actions. Approved external actions remain awaiting execution until a provider-specific workflow can prove delivery.

```mermaid
flowchart LR
  Owner[Authenticated owner] --> API[Tenant-checked API]
  Site[Website / uploaded documents] --> Scout[Source extraction]
  Scout --> Internal[Internal business knowledge]
  API --> Review[Owner review and corrections]
  Internal --> Review --> Public[Approved public knowledge]
  Visitor[Visitor session] --> Runtime[Quota and pause checks]
  Public --> Runtime --> AI[Shared AI provider]
  AI --> History[Durable reply / draft]
  History --> Inbox[Owner conversation inbox]
  Visitor --> Help[Explicit request for human help]
  Help --> Inbox
  Inbox --> Resolution[Manual follow-up and recorded resolution]
  Phone[Signed provider event] --> Receipt[Verified number and event receipt]
  Receipt --> Call[Stored transcript]
  Call --> Lease[Leased analysis] --> Followup[Owner follow-up queue]
  API --> Booking[Atomic request and confirmation]
  Booking --> Customers[Customer history]
  Receipt --> Customers
  API --> Approval[Recorded approval]
  Approval --> Pending[Awaiting provider execution]
```
