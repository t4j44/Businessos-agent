# Business OS — Pre-Deploy Verification

Static verification of prompts 21–24. No code was changed by this check.

> **Credential policy:** no environment variable value, key, token or secret
> appears in this document. Variables are reported by NAME and presence boolean
> only. A variable declared with an empty value is reported as **absent**,
> because `Boolean(process.env.X)` is false for it at runtime.

---

## Check 1 — Unauthenticated routes

Command:

```
grep -rLn "requireSession\|requireCronOrSession\|requireCron\|requireUser\|getSessionClient\|resolveClientId\|CRON_SECRET\|constructEvent\|notFoundInProduction\|BLAND_WEBHOOK_SECRET\|x-twilio-signature" src/app/api --include=route.ts
```

**5 of 76 routes** have no auth mechanism. Each was read individually.

| Route | Writes DB | Calls AI | Paid API | Intentionally public? |
|---|---|---|---|---|
| `/api/health` | no | no | no | **Yes** — uptime probe. Returns `{status, timestamp, agents}` and nothing client-identifying. |
| `/api/auth/callback` | no | no | no | **Yes** — the OAuth code exchange. It cannot require the session it creates. |
| `/api/unsubscribe` | yes (`suppression_list`, `leads`) | no | no | **Yes** — CAN-SPAM requires a one-click opt-out for recipients who are not users and have no session. The token is the credential; an unknown token renders the same page, so it cannot be used to probe list membership. |
| `/api/widget/config` | no | no | no | **Yes** — read-only branding, called cross-origin from customers' sites. |
| `/api/widget/chat` | yes (`widget_sessions`) | **yes** | **yes** | **Yes, by design** — embedded on customers' sites. Mitigated by rate limits (20/session/hr, 200/client/hr), an active-client check before any token spend, and a 2,000-char message cap. |

**Result: PASS.** All five are intentionally public with a stated reason. The
one that writes, calls AI and spends money (`widget/chat`) is throttled rather
than authenticated, which is the correct trade for an embeddable widget.

---

## Check 2 — client_id accepted from request input

```
grep -rn "body?.client_id\|body.client_id\|searchParams.get('client_id')" src/app/api --include=route.ts
```

Three hits, all permitted:

| Location | Category | Verdict |
|---|---|---|
| `agents/nightwatch/route.ts:472` | Cron path — the `POST` handler calls `requireCron(req)` before reading the body; the cron iterates every active client and has no session of its own | OK |
| `dashboard/client/route.ts:28` | Session wins first (`session?.clientId ||`); the query param is only reachable when there is no session, which is how the `/test` routes and local dev address a client | OK |
| `widget/config/route.ts:29` | Widget route — public by design, returns branding only | OK |

**Result: PASS.** No route accepts a body-supplied `client_id` while a session
exists.

---

## Check 3 — Email and SMS compliance

### `lib/resend.ts` — compliant

Both exported senders enforce, in order: refuse-if-no-`COMPANY_POSTAL_ADDRESS`
→ `isSuppressed()` → unsubscribe token → footer appended to HTML *and* text →
`List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` headers.

### `lib/sms.ts` — compliant

`isSuppressed()` → `hasPhoneConsent()` → ` Reply STOP to opt out.` appended,
with the **body** truncated to fit around it, never the opt-out.

### ❌ Two direct sends bypass all of it

| File | Line | What it sends | Missing |
|---|---|---|---|
| `api/agents/bi-reporter/generate/route.ts` | 73 | The **Monday Brief** to the client's `contact_email` | postal address, suppression check, `List-Unsubscribe`, unsubscribe link |
| `api/webhooks/bland/route.ts` | 123 | A **call escalation alert** to the client's `contact_email` | postal address, suppression check, `List-Unsubscribe` |

Both construct their own `new Resend(...)` and call `resend.emails.send()`
directly. Prompt 22 updated the *callers of `sendBrandedEmail`*; these two never
called it, so they were not touched.

The Monday Brief is a recurring commercial email — CAN-SPAM applies squarely.
The escalation alert is arguably transactional, but still carries no postal
address and ignores the suppression list, so a client who unsubscribes keeps
receiving it.

**Result: NO-GO.**

---

## Check 4 — Test routes closed in production

- **12 test routes** found; **14 files** carry `notFoundInProduction()`
  (the 12 plus `/api/test/env-check` and `/api/health/keys`).
- Files missing the guard: **none**.
- `'/test'` in `middleware.ts` `PUBLIC_PREFIXES`: **removed**.

**Result: PASS.**

---

## Check 5 — Environment completeness

Names and booleans only. Platform-injected (`NODE_ENV`, `VERCEL_ENV`) and one
regex artefact (`X`, from a comment in `auth-guard.ts`) are excluded.

| Variable | Present (non-empty) in .env.local |
|---|---|
| `ANTHROPIC_API_KEY` | yes |
| `BLAND_API_KEY` | **no** |
| `BLAND_WEBHOOK_SECRET` | **no** |
| `BRAVE_API_KEY` | **no** |
| `COMPANY_NAME` | **no** |
| `COMPANY_POSTAL_ADDRESS` | **no** |
| `CRAWL4AI_URL` | **no** |
| `CRON_SECRET` | **no** |
| `N8N_WEBHOOK_BASE_URL` | yes |
| `NEXT_PUBLIC_APP_URL` | **no** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes |
| `NEXT_PUBLIC_SUPABASE_URL` | yes |
| `OPENROUTER_API_KEY` | yes |
| `PYTHON_AGENTS_URL` | **no** |
| `RESEND_API_KEY` | yes |
| `RESEND_FROM_EMAIL` | **no** |
| `STRIPE_SECRET_KEY` | yes |
| `STRIPE_WEBHOOK_SECRET` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | yes |
| `TWILIO_ACCOUNT_SID` | yes |
| `TWILIO_AUTH_TOKEN` | **no** |
| `TWILIO_PHONE_NUMBER` | **no** |
| `VOYAGE_API_KEY` | yes |

### Absent variables ranked by consequence

**Blocking — a core path is dead without these:**

1. `COMPANY_POSTAL_ADDRESS` — `sendBrandedEmail` and `sendInvoiceEmail` both
   **refuse to send**. No email leaves the system at all.
2. `CRON_SECRET` — `hasCronSecret()` fails closed when unset, so **all five
   crons return 401** and every scheduled agent silently stops.
3. `NEXT_PUBLIC_APP_URL` — unsubscribe links render as a relative path with no
   host, so the CAN-SPAM opt-out link does not work.

**Degrading — a feature runs but incompletely:**

4. `BLAND_WEBHOOK_SECRET` — inbound call webhooks 401 (fails closed).
5. `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — no SMS, and the Twilio
   webhook's signature check fails closed.
6. `BRAVE_API_KEY` — the three intelligence agents run Reddit-only.
7. `COMPANY_NAME` — footers fall back to "Business OS".
8. `RESEND_FROM_EMAIL` — falls back to a hardcoded sender address.

**Optional:** `CRAWL4AI_URL` (scraper falls back to Jina), `PYTHON_AGENTS_URL`
(unused export).

### .env.example

Exists. **Lines containing a value after `=`: 0.** Names only, as required.

---

## Check 6 — Migration state · VERIFY MANUALLY

20 files on disk. Numbering runs 001–012, 014–021 — **013 is an intentional
gap** (documented in 014's header). There is no 020 gap; 020 is `lead_contact`.

**Every row below is `VERIFY MANUALLY` — the remote database cannot be queried
from this environment.**

| Migration | Statements | Applied? |
|---|---|---|
| **016_leads_places_fields** | `ALTER TABLE leads ADD COLUMN IF NOT EXISTS place_id TEXT, website TEXT, address TEXT, city TEXT, category TEXT, rating NUMERIC, review_count INT, prospect_query TEXT, outreach_status TEXT DEFAULT 'new'`; `CREATE UNIQUE INDEX idx_leads_client_place`; `CREATE INDEX idx_leads_outreach_status` | VERIFY MANUALLY |
| **017_leads_enrichment_fields** | `ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_found TEXT, email_confidence INT DEFAULT 0, email_source TEXT, icp_match_score INT, icp_match_reason TEXT, pain_points JSONB DEFAULT '[]', updated_at TIMESTAMPTZ DEFAULT now()`; `CREATE INDEX idx_leads_icp_score` | VERIFY MANUALLY |
| **018_compliance** | `CREATE TABLE suppression_list`; `CREATE UNIQUE INDEX suppression_unique`; `CREATE TABLE unsubscribe_tokens`; `CREATE UNIQUE INDEX unsubscribe_tokens_target`; `ALTER TABLE leads ADD email_consent BOOL DEFAULT true, email_consent_at, phone_consent_at, phone_consent_source`; `ALTER TABLE contacts ADD email_consent, email_consent_at, phone_consent BOOL DEFAULT false, phone_consent_at, phone_consent_source`; `CREATE INDEX idx_suppression_lookup` | VERIFY MANUALLY |
| **019_overture_places** | `CREATE TABLE overture_places`; `CREATE INDEX idx_overture_state_city`; `CREATE INDEX idx_overture_confidence`; `CREATE EXTENSION pg_trgm`; `CREATE INDEX idx_overture_category_trgm`; `CREATE INDEX idx_overture_name_trgm`; `ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT` | VERIFY MANUALLY |
| **020_lead_contact** | `ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_name TEXT, contact_role TEXT` | VERIFY MANUALLY |
| **021_catchup_missing_tables** | `CREATE TABLE campaigns / bookings / widget_sessions / appointments` + their indexes; `CREATE OR REPLACE FUNCTION upsert_widget_session`; RLS + `client_isolation` policies on all four | VERIFY MANUALLY |

A live audit previously found that **021's four tables did not exist** in the
database. Until 021 is run, the Scheduler, widget session tracking and Hunter
config write to tables that are not there — five of nine call sites fail
silently.

Every statement is `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF
EXISTS`, so all six are safe to re-run.

---

## Check 7 — Vercel configuration

**Crons: 5**

| Path | Schedule |
|---|---|
| `/api/cron/invoice-chase` | `0 9 * * *` |
| `/api/cron/bi-reporter` | `0 22 * * 0` |
| `/api/cron/reputation-scan` | `0 10 * * *` |
| `/api/cron/appointment-reminders` | `0 16 * * *` |
| `/api/agents/nightwatch` | `0 2 * * *` |

**Functions: 10 · highest `maxDuration` = 300s**

| maxDuration | Route |
|---|---|
| 300s | `agents/creative` |
| 300s | `agents/nightwatch` |
| 60s | `agents/brand-scout`, `agents/bi-reporter`, `agents/bi-reporter/generate`, `agents/invoice-chase/run`, `agents/reputation/analyze`, `agents/hunter/enrich` |
| 30s | `cron/appointment-reminders`, `agents/hunter/prospect` |

Stated plainly:

- **Vercel Hobby allows 2 crons; this project has 5.**
- **Vercel Hobby caps functions at 60s; the highest here is 300 seconds.**

**Both are a NO-GO on Hobby.** Either upgrade the plan, or reduce to 2 crons and
cap every function at 60s.

---

## Check 8 — Build

Run after `rm -rf .next`:

```
$ npx tsc --noEmit 2>&1 | tail -5
(no output)
exit code: 0

$ npm run build 2>&1 | grep -E "Compiled|Generating static pages|error"
✓ Compiled successfully in 27.9s
  Generating static pages using 11 workers (0/82) ...
✓ Generating static pages using 11 workers (82/82) in 4.4s
exit code: 0
```

**82 pages. TSC 0. Build 0. PASS.**

One environmental caveat: `next/font/google` fetches Inter at build time. After
`rm -rf .next` the first attempt failed with *"Failed to fetch `Inter` from
Google Fonts"* and succeeded on retry. Unrelated to application code, but cold
builds here are flaky; Vercel builds are unaffected.

---

# VERDICT: NO-GO

Blockers, in the order they should be cleared:

1. **`COMPANY_POSTAL_ADDRESS` is not set.** Every email path refuses to send.
   Nothing outbound works until this has a real value. (Check 5)
2. **`CRON_SECRET` is not set.** `hasCronSecret()` fails closed, so all five
   crons return 401 and every scheduled agent stops silently. (Check 5)
3. **Two email paths bypass compliance entirely** —
   `agents/bi-reporter/generate/route.ts:73` (Monday Brief) and
   `webhooks/bland/route.ts:123` (escalation alert) call
   `resend.emails.send()` directly with no postal address, no suppression
   check and no `List-Unsubscribe`. Route both through `sendBrandedEmail`.
   (Check 3)
4. **Vercel plan.** 5 crons against a Hobby limit of 2, and a 300s
   `maxDuration` against a Hobby cap of 60s. Upgrade, or cut to 2 crons and
   60s. (Check 7)
5. **`NEXT_PUBLIC_APP_URL` is not set.** Unsubscribe links render without a
   host, so the CAN-SPAM opt-out does not resolve. (Check 5)
6. **Migrations 016–021 unverified.** 021's four tables were previously
   confirmed missing from the live database. Run and confirm all six before
   onboarding anyone. (Check 6)

Non-blocking but expected to degrade behaviour on day one:
`BLAND_WEBHOOK_SECRET` (inbound calls 401), `TWILIO_AUTH_TOKEN` /
`TWILIO_PHONE_NUMBER` (no SMS), `BRAVE_API_KEY` (intelligence agents run
Reddit-only), `COMPANY_NAME` and `RESEND_FROM_EMAIL` (fall back to defaults).

Checks 1, 2, 4 and 8 pass. The authentication and test-route lockdown from
prompt 21 verifies clean.
