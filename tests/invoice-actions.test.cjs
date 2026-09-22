const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function setup(status, changed = false) {
  const writes = [], filters = [];
  const route = loadTs('src/app/api/invoices/[id]/route.ts', {
    '@/lib/auth-guard': { requireSession: async () => ({ clientId: 'tenant' }), authErrorResponse: () => null },
    '@/lib/supabase': { supabaseAdmin: { from: () => {
      let updating = false;
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        update(patch) { updating = true; writes.push(patch); return this; },
        maybeSingle: async () => ({ data: !status || updating && changed ? null : { id, status: updating ? writes[0].status : status, paid_at: '2026-08-01' }, error: null }),
      };
    } } },
  });
  return { writes, filters, act: action => route.PATCH(new Request('https://example.test', { method: 'PATCH', body: JSON.stringify({ action }) }), { params: Promise.resolve({ id }) }) };
}

test('drafts cannot become sent through pause/resume and missing tenants cannot mutate invoices', async () => {
  for (const [status, action, expected] of [['draft','pause',409], ['draft','resume',409], ['paid','resume',409], [null,'mark_paid',404]]) {
    const f = setup(status);
    assert.equal((await f.act(action)).status, expected);
    assert.equal(f.writes.length, 0);
    assert.ok(f.filters.some(([key, value]) => key === 'client_id' && value === 'tenant'));
  }
});

test('repeated mark-paid preserves payment date; concurrent state changes reject stale writes', async () => {
  const paid = setup('paid');
  assert.equal((await (await paid.act('mark_paid')).json()).invoice.paid_at, '2026-08-01');
  assert.equal(paid.writes.length, 0);
  const stale = setup('sent', true);
  assert.equal((await stale.act('pause')).status, 409);
  assert.ok(stale.filters.some(([key, value]) => key === 'status' && value === 'sent'));
});
