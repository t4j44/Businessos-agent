const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

// Sentry is the one place where this app hands data to a third party, and the
// data it handles belongs to other people's customers. The scrubber is pure, so
// there is no excuse for not pinning it: a regression here would publish chat
// transcripts or customer addresses to an external service, silently.

const sentry = loadTs('src/lib/sentry.ts');

// Everything that must never appear in an outgoing event.
const SECRETS = [
  'visitor@example.test', 'owner@business.test', '+1 (555) 234-5678',
  'Bearer eyJhbGciOiJIUzI1NiJ9.secret', 'sb-access-token=abc123',
  'Can you fix my boiler on Tuesday?', 'super-secret-token',
];

function fullEvent() {
  return {
    message: 'Failed for owner@business.test on +1 (555) 234-5678',
    user: { id: 'u-1', email: 'owner@business.test', ip_address: '203.0.113.9' },
    extra: { note: 'super-secret-token' },
    request: {
      url: 'https://app.test/api/widget/chat?client_id=aaaa-bbbb&email=visitor@example.test',
      method: 'POST',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret', cookie: 'sb-access-token=abc123' },
      cookies: { 'sb-access-token': 'abc123' },
      query_string: 'client_id=aaaa-bbbb&email=visitor@example.test',
      data: { message: 'Can you fix my boiler on Tuesday?', email: 'visitor@example.test' },
    },
    exception: {
      values: [{ type: 'Error', value: 'no customer matching visitor@example.test / +1 (555) 234-5678' }],
    },
    breadcrumbs: [
      {
        category: 'fetch',
        message: 'POST /api/widget/chat for visitor@example.test',
        data: {
          method: 'POST', status_code: 500,
          url: 'https://app.test/api/widget/chat?email=visitor@example.test',
          body: 'Can you fix my boiler on Tuesday?',
          headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret' },
        },
      },
    ],
  };
}

test('no customer data survives the scrubber', () => {
  const scrubbed = sentry.scrubEvent(fullEvent());
  const serialised = JSON.stringify(scrubbed);

  for (const secret of SECRETS) {
    assert.ok(!serialised.includes(secret), `event leaked ${JSON.stringify(secret)}: ${serialised}`);
  }

  // Identity and arbitrary attachments go entirely.
  assert.equal(scrubbed.user, undefined);
  assert.equal(scrubbed.extra, undefined);

  // Auth material, cookies, the request body and the query string all go.
  assert.equal(scrubbed.request.headers, undefined, 'Authorization and Cookie must not be sent');
  assert.equal(scrubbed.request.cookies, undefined);
  assert.equal(scrubbed.request.data, undefined, 'a widget chat body must never reach Sentry');
  assert.equal(scrubbed.request.query_string, undefined);

  // The path is kept — it is what makes the report useful — without its query.
  assert.equal(scrubbed.request.url, 'https://app.test/api/widget/chat');
  assert.equal(scrubbed.request.method, 'POST', 'the method is safe and worth keeping');
});

test('addresses and phone numbers are redacted from free text', () => {
  const scrubbed = sentry.scrubEvent(fullEvent());
  assert.equal(scrubbed.message, 'Failed for [email] on [phone]');
  assert.equal(scrubbed.exception.values[0].value, 'no customer matching [email] / [phone]');
  assert.equal(scrubbed.breadcrumbs[0].message, 'POST /api/widget/chat for [email]');

  // The exception type is diagnostic, not personal.
  assert.equal(scrubbed.exception.values[0].type, 'Error');
});

test('breadcrumb data keeps only the diagnostic fields', () => {
  const crumb = sentry.scrubEvent(fullEvent()).breadcrumbs[0];
  assert.deepEqual(Object.keys(crumb.data).sort(), ['method', 'status_code', 'url']);
  assert.equal(crumb.data.status_code, 500, 'the status is why the breadcrumb is useful');
  assert.equal(crumb.data.url, 'https://app.test/api/widget/chat', 'query stripped');
});

test('redaction does not destroy the diagnostic parts of a message', () => {
  const r = sentry.redact;
  // Dates and short numbers must survive — redacting them would make a lot of
  // real errors unreadable.
  assert.equal(r('invalid date 2026-02-31'), 'invalid date 2026-02-31');
  assert.equal(r('expected 5 got 12'), 'expected 5 got 12');
  assert.equal(r('column leads.bos_lead_score does not exist'), 'column leads.bos_lead_score does not exist');
  assert.equal(r('SQLSTATE 42703'), 'SQLSTATE 42703');
  // A UUID is not a phone number.
  assert.equal(r('client aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'client aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  // Real numbers in several shapes do get redacted.
  for (const phone of ['+15552345678', '555-234-5678', '(555) 234 5678', '+44 20 7946 0958']) {
    assert.equal(r(`call ${phone} now`), 'call [phone] now', `missed ${phone}`);
  }
  for (const email of ['a@b.test', 'first.last+tag@sub.example.co.uk']) {
    assert.equal(r(`mail ${email}`), 'mail [email]', `missed ${email}`);
  }
});

test('a serverError reference id survives redaction', () => {
  // serverError() shows the user an 8-character hex reference and tags the
  // Sentry event with it. If redaction mangled an all-digit reference the two
  // could never be matched up.
  const { serverErrorPayload } = loadTs('src/lib/server-error.ts');
  for (let i = 0; i < 40; i++) {
    const reference = serverErrorPayload(new Error('x'), 'tests/reference').error.match(/Reference: ([0-9a-f]{8})/)[1];
    assert.equal(sentry.redact(reference), reference, `reference ${reference} was altered`);
  }
  // And an all-digit one specifically, since that is the risky case.
  assert.equal(sentry.redact('12345678'), '12345678');
});

test('with no DSN Sentry is off and reporting is a silent no-op', () => {
  const savedServer = process.env.SENTRY_DSN;
  const savedBrowser = process.env.NEXT_PUBLIC_SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  try {
    assert.equal(sentry.serverDsn(), undefined);
    assert.equal(sentry.browserDsn(), undefined);
    // Must not throw, must not need a network, must not need an account. This
    // is what lets the test suite and CI run with no Sentry config at all.
    assert.equal(sentry.reportError(new Error('boom'), { scope: 'tests', reference: 'abcd1234' }), undefined);

    // A blank or whitespace DSN counts as unset rather than as a bad DSN.
    process.env.SENTRY_DSN = '   ';
    assert.equal(sentry.serverDsn(), undefined);
  } finally {
    if (savedServer === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = savedServer;
    if (savedBrowser === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN; else process.env.NEXT_PUBLIC_SENTRY_DSN = savedBrowser;
  }
});

test('the shared options are private and cheap by construction', () => {
  const options = sentry.baseSentryOptions('https://examplePublicKey@o0.ingest.test/0');

  assert.equal(options.sendDefaultPii, false, 'PII must never be attached by default');
  assert.ok(options.tracesSampleRate <= 0.1, `trace sampling must stay at or below 0.1, got ${options.tracesSampleRate}`);
  assert.equal(options.replaysSessionSampleRate, 0, 'session replay records the DOM');
  assert.equal(options.replaysOnErrorSampleRate, 0);

  // The scrubber is actually wired into both callbacks, not just exported.
  const leaky = { message: 'owner@business.test', user: { email: 'owner@business.test' } };
  assert.equal(options.beforeSend({ ...leaky }).message, '[email]');
  assert.equal(options.beforeSend({ ...leaky }).user, undefined);
  assert.equal(options.beforeSendTransaction({ ...leaky }).user, undefined);
});
