const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const args = { client_id: tenant, customer_email: 'customer@example.test', amount_cents: 12345, due_date: '2026-10-01' };

function setup(email = { sent: false, skipped: 'Not configured' }, { contact = false, updateFails = false } = {}) {
  const events = [];
  const db = { from(table) {
    const query = {
      insert(row) { events.push({ insert: row }); this.row = { ...row, id: 'invoice-id' }; return this; },
      update(row) { events.push({ update: row }); return this; },
      select() { return this; }, eq(key, value) { events.push({ filter: [key, value] }); return this; },
      single: async function () { return { data: this.row, error: null }; },
      maybeSingle: async () => table === 'contacts' ? { data: contact ? { id: 'customer' } : null, error: null } : { data: updateFails ? null : { status: 'sent' }, error: updateFails ? { code: 'DB_DOWN' } : null },
    }; return query;
  } };
  return { ...loadTs('src/lib/invoices.ts', { './supabase': { supabaseAdmin: db }, './resend': { sendInvoiceEmail: async () => { events.push({ send: true }); return email; } } }), events };
}

test('failed or skipped invoice email leaves a draft; provider receipt precedes sent status', async () => {
  const failed = setup();
  assert.equal((await failed.createInvoice(args)).invoice.status, 'draft');
  assert.equal(failed.events.some(e => e.update), false);
  const success = setup({ sent: true, email_id: 'provider-receipt' });
  assert.equal((await success.createInvoice(args)).invoice.status, 'sent');
  assert.equal(success.events[0].insert.status, 'draft');
  assert.ok(success.events.findIndex(e => e.send) < success.events.findIndex(e => e.update));
  assert.ok(success.events.some(e => e.filter?.[0] === 'client_id' && e.filter[1] === tenant));
});

test('invoice rejects foreign customers, invalid cents/dates and unsafe payment URLs before insert or send', async () => {
  for (const changed of [{ contact_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { amount_cents: 0.5 }, { due_date: '2026-02-31' }, { payment_url: 'javascript:alert(1)' }, { payment_url: 'http://127.0.0.1' }]) {
    const f = setup();
    await assert.rejects(f.createInvoice({ ...args, ...changed }));
    assert.equal(f.events.some(e => e.insert || e.send), false);
  }
});

test('accepted invoice email with failed state update returns a recovery warning without throwing', async () => {
  const f = setup({ sent: true, email_id: 'receipt' }, { updateFails: true });
  const result = await f.createInvoice(args);
  assert.equal(result.invoice.status, 'draft');
  assert.equal(result.email.email_id, 'receipt');
  assert.match(result.email.error, /Do not create it again/);
  assert.equal(f.events.filter(e => e.send).length, 1);
});

test('invoice email never invents a payment link or claims success without a provider receipt', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-placeholder';
  try {
    const messages = [], logs = [];
    const lib = loadTs('src/lib/resend.ts', {
      './supabase': { getClientContext: async () => ({ client: { name: 'Example' }, brand: {} }) },
      './compliance': { isSuppressed: async () => false, getUnsubscribeToken: async () => 'token', unsubscribeUrlFor: () => 'https://example.test/unsubscribe', transactionalFooter: () => ({ html: '', text: '' }), postalAddress: () => 'Test address' },
      './log': { logAgentRun: async data => logs.push(data) },
      resend: { Resend: class { emails = { send: async message => { messages.push(message); return { data: null, error: null }; } }; } },
    });
    const result = await lib.sendInvoiceEmail({ ...args, invoice_number: 'invoice-1' });
    assert.equal(result.sent, false);
    assert.match(result.error, /receipt/);
    assert.equal(logs.length, 0);
    assert.doesNotMatch(messages[0].html, /\/pay\/|Pay this invoice/);
    assert.match(messages[0].text, /Contact the business/);
  } finally { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; }
});
