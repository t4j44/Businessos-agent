import * as Sentry from '@sentry/nextjs'
import { baseSentryOptions, browserDsn } from '@/lib/sentry'

// Browser error reporting.
//
// Next 15+/16 loads instrumentation-client.ts on the client before the app
// hydrates. The DSN has to be NEXT_PUBLIC_ to exist in the browser bundle at
// all; a Sentry DSN is designed to be public (it can only submit events, not
// read them), which is why this one is safe to ship and SENTRY_DSN is not.
//
// With no NEXT_PUBLIC_SENTRY_DSN this does nothing, so a local or CI build needs
// no Sentry account.
//
// NO SESSION REPLAY. replayIntegration() is deliberately not added: it records
// the DOM, and on this app that DOM is a customer list, an invoice, or a chat
// transcript belonging to somebody else's business.

const dsn = browserDsn()

if (dsn) {
  Sentry.init({
    ...baseSentryOptions(dsn),
    // Browser-side breadcrumbs are the main PII risk here: the SDK records
    // console output and fetch URLs by default. scrubEvent() strips the
    // breadcrumb payloads and redacts addresses, but keeping the count low
    // limits how much ever gets built in the first place.
    maxBreadcrumbs: 20,
  })
}

// Lets Sentry tie a client-side error to the navigation that caused it. Next
// calls this on every App Router transition.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
