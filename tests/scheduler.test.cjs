const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const tenant = '11111111-1111-4111-8111-111111111111';
const appointmentId = '22222222-2222-4222-8222-222222222222';

function setup(row, rpcResult) {
  const effects = [];
  const filters = [];
  const query = {
    select() { return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    maybeSingle: async () => ({ data: filters.some(([k,v]) => k === 'client_id' && v !== row?.client_id) ? null : row, error: null }),
    update() { effects.push('unsafe update'); return this; },
    single: async () => ({ data: row, error: null }),
  };
  const route = loadTs('src/app/api/agents/scheduler/confirm/route.ts', {
    '@/lib/supabase': { supabaseAdmin: {
      from: () => query,
      rpc: async (name, params) => { effects.push({ name, params }); return rpcResult; },
    } },
    '@/lib/auth-guard': { requireSession: async () => ({ clientId: tenant }), authErrorResponse: () => null },
    '@/lib/log': { logAgentRun: async () => {} },
    '@/lib/appointments': { getSchedulerContext: async () => ({}), formatWhen: () => '', sendConfirmationEmail: async () => { effects.push('email'); return { sent: true }; } },
  });
  return { route, effects, filters };
}
function request(body = {}) {
  return new Request('https://example.test/api/agents/scheduler/confirm', { method: 'POST', body: JSON.stringify({ appointment_id: appointmentId, confirmed_time: '2:30pm', confirmed_date: '2026-10-01', ...body }) });
}
test('a different tenant cannot mutate an appointment or trigger an email', async () => {
  const { route, effects } = setup({ id: appointmentId, client_id: 'other', status: 'pending', customer_email: 'private@example.test' });
  assert.equal((await route.POST(request())).status, 404);
  assert.deepEqual(effects, []);
});
test('invalid calendar dates are rejected before accessing appointments', async () => {
  const { route, effects, filters } = setup(null);
  assert.equal((await route.POST(request({ confirmed_date: '2026-02-31' }))).status, 400);
  assert.deepEqual(effects, []);
  assert.deepEqual(filters, []);
});
test('confirmation conflicts cannot send an email', async () => {
  const { route, effects } = setup({ id: appointmentId, client_id: tenant, status: 'pending' }, { data: { outcome: 'conflict' }, error: null });
  assert.equal((await route.POST(request())).status, 409);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].params.p_client_id, tenant);
});
test('a retried confirmation does not repeat the notification', async () => {
  const row = { id: appointmentId, client_id: tenant, status: 'confirmed', customer_email: 'customer@example.test' };
  const { route, effects } = setup(row, { data: { outcome: 'unchanged', appointment: row }, error: null });
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(effects.length, 1);
});
