import * as Sentry from '@sentry/nextjs'
import { baseSentryOptions, serverDsn } from '@/lib/sentry'

// Server and edge error reporting.
//
// Next.js calls register() once per runtime at startup, and onRequestError for
// every unhandled error in a route handler, server component or middleware.
// Both runtimes are initialised here rather than in separate config files,
// which is the Next 15+/16 convention this project is on (Next 16.3.5).
//
// WITH NO DSN, SENTRY IS ENTIRELY OFF. register() returns before init, so the
// SDK is never started and captureException becomes a no-op. The test suite and
// CI therefore need no DSN and no network, which is deliberate: CI runs with
// inert placeholders and must not depend on a Sentry account existing.

export async function register() {
  const dsn = serverDsn()
  if (!dsn) return

  // Identical options in both runtimes, including the PII scrubber. The edge
  // runtime has a smaller integration set, which the SDK handles itself.
  Sentry.init(baseSentryOptions(dsn))
}

// Unhandled errors from the App Router. Sentry's helper reads the Next-provided
// request and route context; the beforeSend scrubber still strips headers,
// cookies, bodies and query strings from whatever it builds.
export const onRequestError = Sentry.captureRequestError
