const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

// A Postgres error of the kind Supabase hands back. The message names a real
// column and constraint, which is exactly what must never reach the browser.
const DB_ERROR = {
  message: 'column leads.bos_lead_score does not exist',
  code: '42703',
  details: 'relation "leads" has 14 columns',
  hint: 'Perhaps you meant to reference the column "leads.lead_score".',
};

// Every fragment of the database error that would be a disclosure on its own.
const FORBIDDEN = [
  DB_ERROR.message,
  DB_ERROR.details,
  DB_ERROR.hint,
  'bos_lead_score',
  '42703',
  'does not exist',
];

const REFERENCE = /^Something went wrong\. Reference: [0-9a-f]{8}$/;

// Supabase query builders are chainable and awaited at the end, so every method
// returns the same object and the object itself is thenable.
function queryDouble(result) {
  const chain = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve(result);
      return () => chain;
    },
    apply() { return chain; },
  });
  return { from: () => chain, rpc: async () => result };
}

function captureLogs(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try { return run(lines); } finally { console.error = original; }
}

// Must await inside the patch: restoring in a synchronous `finally` would hand
// console.error back before an async route had logged anything.
async function captureLogsAsync(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try { return await run(lines); } finally { console.error = original; }
}

const authOk = {
  requireSession: async () => ({ clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'u1' }),
  requireCronOrSession: async () => ({ clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', viaCron: false }),
  authErrorResponse: () => null,
  isProduction: () => false,
};

test('a database error message never appears in a 500 response', async () => {
  const bodies = [];

  const logs = await captureLogsAsync(async (lines) => {
    // Case 1 — a Supabase query that fails and is returned as an error object.
    const leads = loadTs('src/app/api/dashboard/leads/route.ts', {
      '@/lib/auth-guard': authOk,
      '@/lib/supabase': { supabaseAdmin: queryDouble({ data: null, error: DB_ERROR }) },
    });
    const leadsResponse = await leads.GET(new Request('https://example.test/api/dashboard/leads'));
    assert.equal(leadsResponse.status, 500, 'a failed query is still a 500');
    bodies.push(await leadsResponse.json());

    // Case 2 — the same error thrown rather than returned, so it lands in the
    // route's catch-all instead of the `if (error)` branch.
    const runs = loadTs('src/app/api/agent-runs/route.ts', {
      '@/lib/auth-guard': authOk,
      '@/lib/supabase': {
        supabaseAdmin: { from() { throw Object.assign(new Error(DB_ERROR.message), DB_ERROR); } },
      },
    });
    const runsResponse = await runs.GET(new Request('https://example.test/api/agent-runs'));
    assert.equal(runsResponse.status, 500, 'a thrown database error is still a 500');
    bodies.push(await runsResponse.json());

    return lines;
  });

  // The response carries nothing but the generic sentence and a reference.
  for (const body of bodies) {
    assert.match(body.error, REFERENCE, `opaque message, got: ${body.error}`);
    assert.deepEqual(Object.keys(body), ['error'], 'no extra fields smuggle detail out');

    const serialised = JSON.stringify(body);
    for (const fragment of FORBIDDEN) {
      assert.ok(
        !serialised.includes(fragment),
        `500 body leaked database detail ${JSON.stringify(fragment)}: ${serialised}`,
      );
    }
  }

  // Each failure gets its own reference, so two users' reports never collide.
  assert.notEqual(bodies[0].error, bodies[1].error, 'references must be unique per failure');

  // ...and the detail is not simply discarded: it is in the server log, under
  // the reference the user was shown.
  const flat = logs.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');
  for (const body of bodies) {
    const reference = body.error.match(/Reference: ([0-9a-f]{8})$/)[1];
    assert.ok(flat.includes(reference), `reference ${reference} must appear in the server log`);
  }
  assert.ok(flat.includes(DB_ERROR.message), 'the full database message must still be logged server-side');
});

test('the helper logs in full while returning only a reference', () => {
  const { serverErrorPayload, serverErrorMessage } = loadTs('src/lib/server-error.ts');

  const logs = captureLogs((lines) => {
    const payload = serverErrorPayload(DB_ERROR, 'tests/context');
    assert.match(payload.error, REFERENCE);
    assert.ok(!payload.error.includes('bos_lead_score'));

    // The string-only form used by the streaming and batch paths behaves the same.
    const message = serverErrorMessage(new Error(DB_ERROR.message), 'tests/context');
    assert.match(message, REFERENCE);
    assert.ok(!message.includes('bos_lead_score'));
    return lines;
  });

  const flat = logs.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');
  assert.ok(flat.includes('tests/context'), 'the context must be logged so the route is identifiable');
  assert.ok(flat.includes(DB_ERROR.message), 'the raw message belongs in the log, not the response');
});

test('deliberate user-facing messages are not swallowed by the helper', async () => {
  // A 503 "not configured" message names the missing variable on purpose: it is
  // the only way an operator learns what to set. It must survive.
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const route = loadTs('src/app/api/agents/brand-scout/route.ts', {
      '@/lib/auth-guard': authOk,
      '@/lib/supabase': { supabaseAdmin: queryDouble({ data: null, error: null }), getClientContext: async () => ({ client: null, brand: null }) },
      '@/lib/ai': { callAI: async () => { throw new Error('must not be called'); }, MODELS: { SONNET: 'x', HAIKU: 'y' }, parseJSON: () => ({}) },
      '@/lib/log': { logAgentRun: async () => true },
      '@/lib/scraper': { readWebsite: async () => '', normalizeUrl: (u) => u },
    });

    const response = await route.POST(new Request('https://example.test/api/agents/brand-scout', {
      method: 'POST', body: JSON.stringify({ url: 'https://example.com' }),
    }));

    assert.equal(response.status, 503, 'a configuration problem is not a 500');
    const body = await response.json();
    assert.match(body.error, /OPENROUTER_API_KEY/, 'the operator must still be told which key is missing');
    assert.doesNotMatch(body.error, /Reference:/, 'a deliberate message must not be replaced by a reference');
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  }
});
