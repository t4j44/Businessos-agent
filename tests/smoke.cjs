const assert = require('node:assert/strict');

// Run against a local production build. No cookies, real customer IDs, tokens,
// provider actions, or database writes are supplied by this check.
const origin = new URL(process.env.SMOKE_ORIGIN || 'http://127.0.0.1:3187');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Smoke checks are local only');
const cases = [
  ['GET', '/api/health', 200],
  ['GET', '/login', 200],
  ['GET', '/widget/widget.js', 200],
  ['POST', '/api/widget/handoff', 400],
  ['OPTIONS', '/api/widget/handoff', 204],
  ['GET', '/dashboard/customers', 307],
  ['GET', '/api/customers', 401],
  ['GET', '/api/conversations', 401],
  ['GET', '/api/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 401],
  ['PATCH', '/api/conversations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 401],
  ['GET', '/api/dashboard/metrics', 401],
  ['POST', '/api/calls/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/analyze', 401],
  ['POST', '/api/agents/scheduler/request', 401],
  ['POST', '/api/agents/scheduler/confirm', 401],
  ['GET', '/api/scheduler/deliveries', 401],
  ['POST', '/api/scheduler/deliveries', 401],
  ['GET', '/api/cron/scheduler-delivery', 401],
  ['PATCH', '/api/my-business/update', 401],
  ['POST', '/api/invoices', 401],
  ['PATCH', '/api/invoices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 401],
  ['GET', '/api/cron/call-analysis', 401],
  ['GET', '/api/cron/invoice-chase', 401],
  ['GET', '/api/health/keys', 404],
  ['GET', '/api/agents/brand-scout/test', 404],
  ['GET', '/api/test/env-check', 404],
];
(async () => {
  for (const [method, path, status] of cases) {
    const response = await fetch(new URL(path, origin), {
      method, redirect: 'manual', signal: AbortSignal.timeout(10000),
      ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    if (status === 307) assert.equal(new URL(response.headers.get('location'), origin).pathname, '/login');
    await response.arrayBuffer();
    process.stdout.write(`${method} ${path}: ${response.status}\n`);
  }
  process.stdout.write(`${cases.length} local production smoke checks passed.\n`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
