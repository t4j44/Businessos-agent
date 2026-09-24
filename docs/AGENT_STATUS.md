# Business OS: 21-agent status matrix

Updated 2026-09-25. Status describes inspected local code, not a deployed service. "Partial" means working components exist but the complete execution contract is unfinished. The numbering follows the original PRD; Brand Scout is a shared foundation distinct from agent 14.

| # | Agent | Existing evidence | Executed improvements | Remaining release gate | Status |
|---|---|---|---|---|---|
| 1 | Hunter | `api/agents/hunter/{prospect,enrich,generate,config}`; Hunter dashboard; Overture import script | Safer shared website fetching and explicit tenant foundations | Dataset freshness/attribution, lead deduplication, source evidence, approved outreach, consent/suppression, provider receipts, full runtime budgets | Partial |
| 2 | Receptionist | Public widget/config/chat and owner preview | Approved public retrieval, durable history, quotas, pause control, owner inbox, explicit human-help intake, retry-safe resolution, AI pause while help is pending, mobile widget fixes | Customer identity verification, team notifications/assignment, two-way human messaging, live model evaluation, usage plan tuning | Local workflow; live verification pending |
| 3 | AI Scheduler | Request, confirm, list routes and dashboard | Atomic intake, conflict checks, migration 036 email outbox, frozen retry payloads, receipts/reconciliation, owner recovery and timezone reminders | Hosted delivery/worker schedule, opening hours and exact-time timezone validation, calendar sync, cancel/reschedule, in-flight send races; SMS delivery disabled pending recovery | Local workflow; hosted acceptance blocked |
| 4 | Call Center Bot | Call scripts, call dashboard, Bland webhook | Signed verified-number ingestion, durable receipts, seconds conversion, pending analysis, leased analysis/owner follow-up, manual analyze control, guarded cron worker | Account-number provisioning, prompt publish/version confirmation, real test call, recording/consent configuration, transfer and notification delivery | Local ingestion/analysis; provider setup required |
| 5 | Sales Agent | Leads and outreach surfaces; shared contacts | Shared tenant and identity foundations only | Distinct sales workflow, source-bound recommendations, pipeline state changes, approval and execution receipts | Planned integration |
| 6 | Invoice Chase | Generator, batch route, invoices dashboard, email helper | Stored invoice facts, durable unique drafts and leases; initial invoices remain drafts without email acceptance; payment placeholders removed; state transitions reject unsafe retries; no score penalties or delivery advance on generation | Preview/approval UX, payment-account verification, approved chase delivery, suppression/consent, outbox and retry-safe invoice creation | Chase drafts; initial email path locally tested |
| 7 | Contract Generator | Approval type and schema concepts | Approval decisions no longer claim execution | Versioned templates, deterministic commercial terms, document generation, qualified review, e-sign provider and completion events | Planned |
| 8 | Creative Agent | Multi-platform content generation and calendar UI | Shared HTML and tenant foundations; no new publishing integration | Evidence-bound claims, asset rights, complete brand brief, review/version history, provider publishing and receipts, factual evaluation | Draft generation exists |
| 9 | Reputation Intelligence | Review analysis, response generation, review dashboard | Real tenant review lookup, shared AI, persisted drafts, approval separated from publication, mock success removed | Authorized review import, external review dedupe, publication provider, attribution/source links, receipt reconciliation | Analysis/draft workflow |
| 10 | Data Enrichment | CSV import and Hunter enrichment | Shared safe-fetch and identity boundaries | File limits, robust multiline CSV parsing, provenance/confidence, duplicate resolution, safe opt-in handling | Partial |
| 11 | BI Reporter | Weekly brief generation and email route | Shared database aggregation, missing-data handling, payment-date collections, source tables/time window, safe HTML, no success on failed save | Business-specific metric definitions, multi-currency, dashboard acceptance tests, validated attribution and owner-approved reporting targets | Local reporting; definitions need pilot review |
| 12 | Strategist | Historical n8n-init reference, plan concepts | Removed unconfirmed fire-and-forget activation from billing webhook | Durable strategy jobs, evidence-bound plans, owner priorities, approval and follow-through | Planned |
| 13 | RevOps Manager | Billing, invoices, leads are separate pieces | Billing receipts and reconciliation foundations | Unified revenue stages, attribution, account reconciliation, permissioned actions, finance source of truth | Planned integration |
| 14 | Scout (account growth signals) | Original PRD description | Distinguished from website Brand Scout | Connected account signals, source records, freshness/confidence, useful alert evaluation | Planned |
| 15 | Conference Call AI | Original PRD description | None claimed | Meeting provider, consent, speaker/transcript fidelity, action-owner confirmation, tasks and follow-up receipts | Planned |
| 16 | Monday Brief | Weekly briefs, owner UI, scheduled BI wrapper | Uses BI improvements; sanitized render and current dynamic route params | Delivery idempotency, retries, owner preferences, timezone, provider test | Shares BI workflow; not a separate reasoning engine |
| 17 | Market Intelligence | `api/agents/intelligence/market` | Removed fallback test tenant; safer shared crawler | Source-level citations, freshness, extraction validation, cost/runtime enforcement, live search credentials | Research implementation; unverified |
| 18 | Audience Intelligence | `api/agents/intelligence/audience` | Removed fallback test tenant | Supported audience evidence, privacy constraints, uncertainty, source diversity, live search, evals | Research implementation; unverified |
| 19 | Trend Radar | `api/agents/intelligence/trends` | Removed fallback test tenant | Dated source proof, regional relevance, repeat detection, actionable owner validation | Research implementation; unverified |
| 20 | Nightwatch | Agent orchestration and daily schedule | Preserved prior fixes; removed implicit test tenant; shared foundations | Durable per-agent jobs, partial-failure recovery, rate/cost ceilings, evidence freshness, source dedupe | Orchestration exists; not production certified |
| 21 | Executive Advisory Suite | Advisory marked coming soon in navigation | None claimed | Explicit roles, evidence-bound proposals, decisions/assumptions log, approvals, measurable follow-up | Planned |

## Shared foundation: Brand Scout and business memory

Website text and visual extraction, owner-editable brand profile, embeddings and tenant-scoped retrieval already existed. This execution adds direct-fetch network protections, atomic extraction replacement, protected owner corrections, separate manual knowledge, provenance categories, and explicit approval before public retrieval. Unknown facts must be omitted. Old unclassified rows are preserved, not guessed to be safely deletable.

## Order of work

Checkpoint `35dea56` was pushed to `codex/staging-pilot`; [its GitHub checks passed](https://github.com/t4j44/Businessos-agent/actions/runs/35759595561). The configured Supabase access check returned HTTP 401 again on 2026-09-25 (Dhaka). No hosted migrations, restricted deployment, authenticated walkthrough or live voice call has been verified. Nylas and Bland credentials remain absent.

**Do not implement new planned agents until the full two-tenant hosted acceptance matrix passes.** See PILOT_RUNBOOK.md for the outstanding gates.

1. Prove one business's knowledge → inquiry → customer → appointment → owner follow-up path, with two test tenants and failures/retries included.
2. Close voice provisioning, owner notifications, delivery recovery and runtime adoption before unattended pilot operation. Validate the new inbox/handoff path with actual authenticated staging accounts.
3. Finish invoice and review delivery with approved payload versions, provider receipts and reconciliation.
4. Evaluate BI definitions and research sources against real owner decisions.
5. Add planned agents only after the full hosted matrix passes and their inputs/execution contracts are defined. No agent is marked complete solely because it has a prompt or endpoint.
