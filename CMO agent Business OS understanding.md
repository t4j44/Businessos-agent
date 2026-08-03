# CMO agent Business OS Understanding

## Purpose

This document is a deep project map for the Business OS workspace. It explains what exists, how the app is wired, which files are real versus placeholder, where the current build breaks, and what the codebase is trying to become.

The analysis is based on the active root project under `src/`, the root config files, the Supabase schema, the widget bundle, and the production build output.

## Executive Summary

Business OS is a Next.js App Router application that is trying to bundle a multi-agent SaaS: lead generation, receptionist chat, reviews, billing, onboarding, approvals, and a branded embeddable widget. The product architecture is coherent, the data model exists, and several important flows are implemented. However, the project is not currently shippable because `npm run build` fails with parser errors in five files, and some important pages still behave like mock/demo surfaces rather than fully live product areas.

The active application is the root workspace, not the `businessos/` subfolder. The `businessos/` directory is effectively a leftover scaffold with starter content, while the real code lives in `src/`, `public/widget/`, and `supabase/`.

## Workspace Read

### Top-Level Files

- `package.json`: root Next.js project dependencies and scripts.
- `tsconfig.json`: active TypeScript configuration with `@/*` mapped to `./src/*`.
- `tailwind.config.ts`: Tailwind configuration at the root.
- `postcss.config.js`: PostCSS setup at the root.
- `current-situation.md`: stale audit-style project summary; useful, but not fully up to date.

### Secondary Folder

- `businessos/README.md`: default create-next-app README.
- `businessos/app/page.tsx`: starter landing page, not the active product.
- `businessos/tsconfig.json`, `businessos/next.config.ts`, `businessos/postcss.config.mjs`: separate scaffold config copies.

## Architecture Overview

This project is organized around these layers:

1. App routes in `src/app/`.
2. Shared UI and dashboard components in `src/components/`.
3. Service clients and wrappers in `src/lib/`.
4. Database schema in `supabase/migrations/`.
5. Embeddable client widget in `public/widget/widget.js`.

The general product shape is:

- Login and onboarding create a client record.
- The dashboard reads operational data for leads, reviews, billing, and briefs.
- API routes back the agents and the widget.
- Stripe handles subscription purchase and billing portal entry.
- Supabase is the core persistence layer.

## File-by-File Analysis

### Root Application Entry

#### `src/app/page.tsx`

This is the root landing route, and it immediately redirects to `/dashboard`. That tells us the product is treated as a logged-in SaaS, not a marketing site first.

#### `src/app/layout.tsx`

This is the global app shell. It sets the Inter font, imports `globals.css`, and defines the basic HTML body. The visual theme is dark, with a fixed background color on the body.

#### `src/app/globals.css`

Global styles exist in the app tree, though the file content was not the focus of this review. From the rendered pages and Tailwind usage, this is the stylesheet that supports the app-wide look and feel.

### Auth and Entry Flow

#### `src/app/login/page.tsx`

This is a functional login page with Supabase magic-link sign-in and Google OAuth. It has a polished custom UI and a note explaining Google provider setup for Supabase. This is a real user entry point, not a stub.

#### `src/app/api/auth/callback/route.ts`

This route handles OAuth callback exchange and likely decides whether the user should go to onboarding or the dashboard. It is part of the real auth flow and is not a placeholder.

#### `src/app/onboarding/page.tsx`

This is a multi-step onboarding UI that collects company name, website, industry, description, ICP, problem statement, growth goal, tone, brand color, and timezone. It is a real form with validation and a simulated activation/loading sequence.

#### `src/app/api/onboarding/route.ts`

This route receives onboarding data, checks auth, and writes client and brand profile data to Supabase. It includes a mock bypass path when environment variables are missing. The route is implemented, but it is still dependent on real database setup to function fully.

#### `src/app/brand-review/page.tsx`

This route exists and is part of the onboarding journey. It is currently described elsewhere in the workspace as still being a stub-like surface, so it should be treated as incomplete unless further product logic is added.

### Pricing and Billing

#### `src/app/pricing/page.tsx`

This is a full pricing UI with five tiers, monthly and annual toggles, and a checkout action that posts to `/api/checkout`. It is a real page, but the current build output shows a syntax parser failure here, so this file currently blocks production compilation.

#### `src/app/api/checkout/route.ts`

This is the subscription checkout endpoint. It reads the current user, resolves the client record, selects a plan tier, and creates a Stripe Checkout Session when Stripe is configured. It also has a mock return path when no Stripe secret exists. The route contains a compile-time syntax issue in the current workspace build, and it also references an undefined `session` variable in the Stripe customer lookup path.

#### `src/app/api/billing/portal/route.ts`

This route creates a Stripe Billing Portal session for the current client. The route exists and is logically correct in shape, but the build currently fails on a malformed template string in this file.

#### `src/app/dashboard/billing/page.tsx`

This dashboard page provides billing context for the user. Based on the audit notes and the surrounding route design, it is part real UI and part mock-backed billing overview.

#### `src/lib/stripe.ts`

This file initializes Stripe and contains the `PLAN_TIERS` mapping plus a helper to create or reuse Stripe customers. It is one of the key service files in the project. The price IDs are placeholders, so live checkout cannot work until real Stripe price IDs are supplied.

### Dashboard Shell

#### `src/app/dashboard/layout.tsx`

This is the dashboard frame. It uses `Sidebar` and `Header`, maps pathname to page title, and wraps all dashboard pages in a dark full-screen shell. This is a real structural component and anchors the dashboard UX.

#### `src/components/dashboard/Sidebar.tsx`

This is a real navigation component for the dashboard. It supports navigation, collapsibility, mobile handling, plan display, and sign-out behavior.

#### `src/components/dashboard/Header.tsx`

This component renders the top bar, including the active page title and lightweight notification/brand affordances. It is real and part of the dashboard identity.

#### `src/components/dashboard/MetricCard.tsx`

This is a reusable metric display with trend indicators and loading-state behavior. It is a real dashboard primitive.

#### `src/components/dashboard/AgentStatusBadge.tsx`

This badge maps agent run states to color-coded UI states. It is a real status component.

#### `src/components/dashboard/ApprovalsQueue.tsx`

This component renders approval items and likely wires approve/reject actions to the approvals API. It is real, but it depends on the project’s TypeScript alias setup and live Supabase data to be fully useful.

#### `src/components/dashboard/MondayBrief.tsx`

This component surfaces the weekly brief, likely with a fallback/mock path when data is missing. It is a real component, but still depends on database content to feel production-ready.

### Dashboard Pages

#### `src/app/dashboard/page.tsx`

This is the main dashboard landing page. It combines metric cards, recent agent activity, hot leads, a Monday brief, and an approvals queue. The page is mostly mock-backed in places, but it is not a placeholder page.

#### `src/app/dashboard/leads/page.tsx`

This is the Hunter/leads page. It is a rich UI with stats, filters, lead details, and a drawer-style interaction model. It appears designed as a working operational surface, even if some data paths still use mock fallback behavior.

#### `src/app/dashboard/reviews/page.tsx`

This is the reviews/reputation page. It is a real page with platform tabs, sentiment visualization, complaint intelligence, and response queue behavior.

#### `src/app/dashboard/content/page.tsx`

This route currently appears to be a stub or placeholder surface in the current project state.

#### `src/app/dashboard/calls/page.tsx`

This route currently appears to be a stub or placeholder surface in the current project state.

#### `src/app/dashboard/enrichment/page.tsx`

This route currently appears to be a stub or placeholder surface in the current project state.

#### `src/app/dashboard/settings/page.tsx`

This route currently appears to be a stub or placeholder surface in the current project state.

#### `src/app/dashboard/brief/[id]/page.tsx`

This page renders a detailed weekly brief and includes print/share style actions. It is real, but it currently reads `brief.week_start_date` while the schema uses `week_start`, so the data shape is mismatched and this page is likely to misbehave until aligned.

### Agent APIs

#### `src/app/api/agents/hunter/config/route.ts`

This route reads and writes hunter campaign settings for the current client. It is real and useful for configuration management. The build currently fails here because the file contains a duplicated stray block after the main route implementation.

#### `src/app/api/agents/reviews/respond/route.ts`

This route is part of the reviews automation flow, handling approval and regeneration actions. It is a real agent endpoint.

#### `src/app/api/agents/creative/route.ts`

This is currently a placeholder route that returns generic GET/POST messages.

#### `src/app/api/agents/callcenter/route.ts`

This is currently a placeholder route that returns generic GET/POST messages.

#### `src/app/api/agents/callcenter/index-kb/route.ts`

This is currently a placeholder route that returns generic GET/POST messages.

#### `src/app/api/agents/enrichment/csv-import/route.ts`

This is currently a placeholder route that returns generic GET/POST messages.

#### `src/app/api/agents/enrichment/business-card/route.ts`

This route exists as part of enrichment, and based on the project audit it remains an incomplete surface.

### Widget APIs and Widget Bundle

#### `src/app/api/widget/config/route.ts`

This route serves widget brand configuration and uses CORS plus short CDN-style caching. It is a real and important public API because the external widget depends on it.

#### `src/app/api/widget/chat/route.ts`

This is one of the most complete routes in the project. It performs message validation, uses Voyage embeddings, queries Supabase RAG chunks, calls Anthropic for a response, classifies the result, and logs agent runs. It also contains a dedicated dev-test path that returns demo responses when `client_id` equals `dev-test-client`.

#### `public/widget/widget.js`

This is a substantial vanilla JavaScript widget bundle. It handles bootstrapping, session state, theme loading, message rendering, typing indicators, the send flow, and booking-card display for qualified prospects. It avoids innerHTML for user-generated text and is clearly designed to be embeddable on third-party sites.

#### `src/app/test/widget/page.tsx`

This appears to be a local test surface for the widget and its development toolbar.

#### `src/app/test/widget/DevToolbar.tsx`

This is a development-only helper for widget testing.

### Webhooks and External Automation

#### `src/app/api/webhooks/stripe/route.ts`

This route handles Stripe webhook events for subscription creation, cancellation, and invoice payment status. It updates Supabase, triggers optional n8n callbacks, and may send emails through Resend. It is a real integration route, but the build currently fails here because of a malformed template string in the logger path.

#### `src/app/api/webhooks/bland/route.ts`

This is currently a placeholder webhook route.

#### `src/app/api/webhooks/instantly/route.ts`

This is currently a placeholder webhook route.

### Additional API Routes

#### `src/app/api/approvals/[id]/route.ts`

This route updates approval status and is part of the approve/reject workflow. It is a real operational API.

### Shared UI Components

#### `src/components/ui/Button.tsx`

This is a real button component with variants, sizes, loading state, and disabled handling. It is not a stub.

#### `src/components/ui/Card.tsx`

This is a real card primitive used across the app.

#### `src/components/ui/Badge.tsx`

This is a real badge component for status and label display.

#### `src/components/ui/Input.tsx`

This is a real input component with styling and placeholder support.

#### `src/components/ui/Modal.tsx`

This is a real modal component for overlay interactions.

### Service Libraries

#### `src/lib/supabase.ts`

This is the main Supabase client module. It provides browser and server access patterns and helper logic for client identification.

#### `src/lib/supabase-route.ts`

This is the route-specific Supabase helper used by server routes that need request-aware auth handling.

#### `src/lib/anthropic.ts`

This file is currently a placeholder wrapper rather than a full AI client abstraction.

#### `src/lib/voyage.ts`

This file is currently a placeholder wrapper rather than a full embeddings client abstraction.

#### `src/lib/bland.ts`

This file is currently a placeholder wrapper rather than a full Bland integration wrapper.

#### `src/lib/resend.ts`

This file is currently a placeholder wrapper rather than a full Resend integration wrapper.

#### `src/lib/hubspot.ts`

This file is currently a placeholder wrapper rather than a full HubSpot integration wrapper.

#### `src/lib/jina.ts`

This library exists in the codebase and likely supports content or crawl-related workflows.

#### `src/lib/ai.ts`

This library exists as part of the AI integration layer.

#### `src/lib/log.ts`

This library exists for logging support and instrumentation.

### Schema

#### `supabase/migrations/001_initial_schema.sql`

This migration is a major strength of the repo. It defines the core tables the product expects: clients, brand profiles, rag chunks, campaigns, leads, agent runs, api usage, content calendar, bookings, call transcripts, invoices, reviews, weekly briefs, and approvals queue.

The schema also enables Row Level Security on all of the major tables and includes client isolation policies. That means the project is not just UI; it has a real multi-tenant data model.

Important detail: the weekly briefs table uses `week_start`, which matters because the brief detail page currently reads a different field name.

## Build and Runtime Status

### Production Build

`npm run build` currently fails. The build error is not a subtle TypeScript problem; it is a parser-level failure in multiple files.

The current failing files are:

- `src/app/pricing/page.tsx`
- `src/app/api/agents/hunter/config/route.ts`
- `src/app/api/billing/portal/route.ts`
- `src/app/api/checkout/route.ts`
- `src/app/api/webhooks/stripe/route.ts`

### Root Cause Pattern

The build failures are caused by malformed template literals and a duplicated stray code block, not by missing types. This means the project has real source corruption in a few files and cannot be considered production-buildable until those are repaired.

### Runtime Risks

- Checkout uses placeholder Stripe price IDs.
- Checkout also references an undefined `session` variable in the customer lookup path.
- The brief detail page uses a field name that does not match the schema.
- Several lib wrappers are placeholders, so any code depending on them will be fragile or incomplete.
- Several routes still depend on environment variables and real Supabase credentials, so the app will fall back to mocks or fail in a partially configured environment.

## What Is Real Versus What Is Still Mocked

### Real, Functional Surfaces

- Login and auth flow.
- Onboarding form and onboarding API.
- Dashboard shell.
- Leads, reviews, billing, and brief pages as actual product routes.
- Widget configuration route.
- Widget chat route.
- Stripe webhook route conceptually, although it is currently broken at build time.
- Schema and multi-tenant database structure.

### Demo or Placeholder Surfaces

- `src/app/api/agents/creative/route.ts`
- `src/app/api/agents/callcenter/route.ts`
- `src/app/api/agents/callcenter/index-kb/route.ts`
- `src/app/api/agents/enrichment/csv-import/route.ts`
- `src/app/api/webhooks/bland/route.ts`
- `src/app/api/webhooks/instantly/route.ts`
- `src/lib/anthropic.ts`
- `src/lib/voyage.ts`
- `src/lib/bland.ts`
- `src/lib/resend.ts`
- `src/lib/hubspot.ts`

## Priority Fix Order

1. Repair the five build-breaking syntax issues so the app compiles again.
2. Fix the undefined checkout customer reference in `src/app/api/checkout/route.ts`.
3. Align the brief detail page with `weekly_briefs.week_start`.
4. Replace placeholder Stripe price IDs with real Stripe configuration.
5. Decide which placeholder routes and libraries should be implemented next versus intentionally deferred.
6. Clean up the `businessos/` leftover scaffold or clearly separate it from the active app.

## Short Project Assessment

Business OS is a real SaaS codebase with a clear multi-agent architecture, an actual schema, and several substantial product surfaces already in place. The most important conclusion is that the project is not empty or speculative; it is partially built but currently blocked by a handful of hard syntax errors and several integration gaps.

If the goal is to make this production-ready, the next best step is to fix the compiler blockers first, then harden the checkout and widget/data mismatches, and then turn the remaining placeholder agent routes into real implementations.