import { NextResponse } from 'next/server'
import { reportError } from './sentry'

// One place to turn an unexpected failure into a response.
//
// Routes used to return `{ error: err.message }` with status 500. That message
// is whatever Postgres, Stripe, Resend or the AI provider produced, so the
// browser could be shown column names, constraint names, internal row counts or
// provider account detail — none of which help the person reading it, and some
// of which describe the schema to an attacker.
//
// Everything unexpected now collapses to the same opaque sentence plus a short
// random reference. The full error is written to the server log under that same
// reference, so a support request quoting "Reference: 3f9a1c22" leads straight
// to the real stack trace.
//
// WHAT THIS IS NOT FOR. Deliberate, useful messages must keep reaching the
// user: validation 400s (ValidationError), AuthError 401/403s, 404s, 409
// conflicts, 429 quota messages, and the 503 "not configured" messages that
// tell an operator which environment variable is missing. Those are written for
// the reader. Only the "something broke and we did not expect it" path belongs
// here.

const GENERIC = 'Something went wrong.'

// Eight hex characters: long enough not to collide across the logs an operator
// would search, short enough to read over the phone. Not a secret, and it
// identifies the log line rather than the error, so it leaks nothing.
function newReference(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

/**
 * Logs `err` in full under `context` with a fresh reference, and returns the
 * body to send to the browser.
 *
 * Use this when the call site is not a plain 500 JSON response — an internal
 * helper that returns `{ status, body }`, for instance.
 */
export function serverErrorPayload(err: unknown, context: string): { error: string } {
  const reference = newReference()
  // Second argument, not interpolated: console.error renders an Error with its
  // stack, and a Supabase PostgrestError with its code and details.
  console.error(`[${context}] unexpected failure ref=${reference}`, err)
  // And to Sentry under the same reference, so the id the user was given is
  // searchable. A no-op when Sentry is not configured.
  reportError(err, { scope: context, reference })
  return { error: `${GENERIC} Reference: ${reference}` }
}

/**
 * The common case: log the failure and return a 500 carrying only the
 * reference.
 *
 * `extra` preserves response fields a caller already relied on — several agent
 * routes answer `{ success: false, error }`, and dropping `success` would
 * change the shape the dashboard checks.
 */
export function serverError(
  err: unknown,
  context: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ...extra, ...serverErrorPayload(err, context) }, { status: 500 })
}

/**
 * Just the opaque sentence, for the two places that are not a 500 response at
 * all: an error event on an already-open stream, and one failed item inside an
 * otherwise successful batch.
 */
export function serverErrorMessage(err: unknown, context: string): string {
  return serverErrorPayload(err, context).error
}
