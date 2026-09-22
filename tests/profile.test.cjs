const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

test('all owner-edit routes use the durable correction transaction and session identity', async () => {
  for (const [file, method] of [['my-business', 'PATCH'], ['my-business/update', 'PATCH'], ['onboarding/update', 'POST']]) {
    const calls = [];
    const route = loadTs(`src/app/api/${file}/route.ts`, {
      '@/lib/auth-guard': { requireSession: async () => ({ clientId: 'session-tenant' }), authErrorResponse: () => null },
      '@/lib/supabase': { supabaseAdmin: { rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; }, from: () => { throw new Error('Direct profile writes must not be used'); } } },
    });
    const response = await route[method](new Request('https://example.test', { method, body: JSON.stringify({ client_id: 'forged-tenant', field: 'company_name', value: 'Owner correction' }) }));
    assert.equal(response.status, 200, file);
    assert.deepEqual(calls, [{ name: 'edit_brand_field', args: { p_client_id: 'session-tenant', p_field: 'company_name', p_value: 'Owner correction' } }]);
  }
});
