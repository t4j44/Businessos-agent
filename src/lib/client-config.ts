// DEV FIXTURE ONLY — never import this from a route that runs in production.
//
// The old comment here said the app was "still single-tenant in the UI" and that
// TEST_CLIENT_ID should be replaced "when auth lands". Auth has landed: every
// production route now derives its tenant from requireSession() (or, for the
// cron-invoked agents, from the request body only after a valid CRON_SECRET),
// and no dashboard page or component sends a client_id any more.
//
// The constant survives solely as fixture data for the /api/agents/*/test
// diagnostic routes, which call notFoundInProduction() and therefore return 404
// whenever VERCEL_ENV is set or NODE_ENV === 'production'. It is not reachable
// from a deployed environment.
//
// If you are reaching for this value in new code, you want requireSession()
// instead. A production route that trusted this constant — or a browser-supplied
// client_id — would read another tenant's data.
export const TEST_CLIENT_ID = 'c9c5d722-8b90-4d41-9dc9-b10152ea4dbd'
