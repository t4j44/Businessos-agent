import * as Sentry from '@sentry/nextjs'
import type { Event } from '@sentry/nextjs'

// Shared Sentry configuration and the PII scrubber.
//
// One module so the server, edge and browser runtimes cannot drift apart on
// privacy: all three call baseSentryOptions(), and the scrubber is the last
// thing that touches an event before it leaves the process.
//
// WHAT MUST NEVER REACH SENTRY. This app handles other people's customers:
// widget chat messages, review text, invoice recipients, lead lists, call
// transcripts. An error report is not worth leaking any of it, so the default
// here is to drop a whole field rather than try to decide which parts of it are
// safe. `sendDefaultPii` is false, which already keeps Sentry from attaching IP
// addresses, cookies and headers — the scrubber then removes them again, plus
// request bodies, because the SDK's definition of PII and ours are not the same
// and a future version changing its default must not change ours.

/** Present only when the matching DSN is configured. */
export function serverDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || undefined
}

export function browserDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined
}

// Errors are always captured; this only samples performance traces, which are
// not what this is for. 0.05 rather than the 0.1 ceiling because tracing is the
// expensive part of a Sentry plan and failure visibility is the goal.
const TRACES_SAMPLE_RATE = 0.05

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g
// Long digit runs with phone-ish punctuation. An optional leading + or ( is
// consumed so "(555) 234 5678" is replaced whole rather than leaving a stray
// bracket behind. The digit count is checked in redact() so that an ISO date
// (8 digits) survives and a real number does not.
const DIGIT_RUN = /\+?\(?\d[\d\s().-]{8,}\d/g

/**
 * Removes addresses and phone numbers from free text.
 *
 * Error messages carry them more often than you would guess — "no customer for
 * a@b.test", a Postgres unique-violation quoting the conflicting row, a Twilio
 * rejection naming the number. Over-redaction is the safe direction here, so a
 * long numeric id may come back as [phone]; losing that is cheaper than
 * publishing a customer's phone number to a third party.
 */
export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(DIGIT_RUN, (match) =>
      match.replace(/\D/g, '').length >= 10 ? '[phone]' : match,
    )
}

function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

/**
 * The last gate before an event is sent. Mutates and returns the event.
 *
 * Exported and tested directly: this is the part that would quietly leak
 * customer data if it regressed, and it is pure, so there is no excuse for not
 * pinning it.
 */
export function scrubEvent<T extends Event>(event: T): T {
  // Identity. `user` can hold an id, email and IP; `extra` is arbitrary and
  // whatever a caller happened to attach.
  delete event.user
  delete event.extra

  if (event.request) {
    // Authorization and Cookie live here, as does the Supabase session.
    delete event.request.headers
    delete event.request.cookies
    // The request body. A widget chat POST carries the visitor's message.
    delete event.request.data
    // A query string can carry a client_id, an unsubscribe token or an email.
    delete event.request.query_string
    if (event.request.url) event.request.url = stripQuery(event.request.url)
  }

  if (typeof event.message === 'string') event.message = redact(event.message)

  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = redact(value.value)
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === 'string') crumb.message = redact(crumb.message)
    // Breadcrumb data is mostly http detail, which is useful, and request
    // bodies and full URLs, which are not. Keep the two safe fields by name
    // rather than guessing which of the rest are harmless.
    if (crumb.data) {
      const { method, status_code, url } = crumb.data as Record<string, unknown>
      const kept: Record<string, unknown> = {}
      if (method !== undefined) kept.method = method
      if (status_code !== undefined) kept.status_code = status_code
      if (typeof url === 'string') kept.url = stripQuery(url)
      crumb.data = kept
    }
  }

  return event
}

/**
 * Sends one error to Sentry, if Sentry is on.
 *
 * `getClient()` is the guard rather than a DSN check: it is undefined until
 * init() has actually run, so this is a no-op in tests, in CI and in any
 * deployment without a DSN — without the caller needing to know any of that.
 *
 * `reference` is the id the user was shown by serverError(), which is the whole
 * point of wiring this up: a customer quoting "Reference: 3f9a1c22" leads
 * straight to the Sentry issue, and the server log line, for that one failure.
 */
export function reportError(
  error: unknown,
  context: { scope: string; reference?: string; tags?: Record<string, string> },
): void {
  if (!Sentry.getClient()) return
  try {
    Sentry.withScope((scope) => {
      // Searchable in Sentry: tags are indexed, so `reference:3f9a1c22` finds
      // the issue directly.
      scope.setTag('scope', context.scope)
      if (context.reference) scope.setTag('reference', context.reference)
      for (const [key, value] of Object.entries(context.tags ?? {})) {
        scope.setTag(key, value)
      }
      Sentry.captureException(error)
    })
  } catch {
    // Reporting a failure must never become a second failure. A broken
    // transport cannot be allowed to turn a handled 500 into a crash.
  }
}

/**
 * Options every runtime shares. `dsn` is passed in because the server and the
 * browser read different variables.
 */
export function baseSentryOptions(dsn: string) {
  return {
    dsn,
    // Never attach IP addresses, cookies, headers or user identity.
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // No session replay anywhere: it records the DOM, which on this app means
    // a customer list or a chat transcript. Not adding replayIntegration() is
    // what actually keeps it off — this is here so the intent is explicit.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // So a staging mistake is not read as a production outage.
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    // Generic rather than annotated with ErrorEvent/TransactionEvent: the SDK
    // re-exports ErrorEvent but not TransactionEvent, and a generic callback
    // satisfies both signatures while returning the exact shape it was handed.
    beforeSend: <T extends Event>(event: T): T => scrubEvent(event),
    // Traces get the same treatment; a transaction carries request data too.
    beforeSendTransaction: <T extends Event>(event: T): T => scrubEvent(event),
  }
}
