const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { loadTs } = require('./helpers/load-ts.cjs');

// The Monday Brief must be emailed at most once per client per week. These
// tests drive the REAL route against the REAL migration on PostgreSQL rather
// than stubbing the claim RPCs — the atomic claim IS the fix, so a mocked claim
// would only be testing the mock.

const client = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db;

before(async () => {
  db = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_user::text $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `);
  const folder = path.resolve(__dirname, '../supabase/migrations');
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(folder, file), 'utf8'));
  }
  await db.query(
    "INSERT INTO clients(id,name,status,contact_email) VALUES($1,'Business A','active','owner-a@example.test'),($2,'Business B','active','owner-b@example.test')",
    [client, other],
  );
});
after(async () => { if (db) await db.close(); });

// Forwards supabaseAdmin.rpc() straight to the SQL function, using Postgres
// named-argument notation so the declared parameter types apply.
function supabaseDouble() {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const result = await db.query(`SELECT ${name}(${named}) AS result`, keys.map((k) => args[k]));
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message, code: error.code ?? 'ERR' } };
      }
    },
    from(table) {
      const state = { table, filters: {} };
      const builder = {
        select: () => builder,
        eq: (column, value) => { state.filters[column] = value; return builder; },
        async maybeSingle() {
          const where = Object.keys(state.filters).map((c, i) => `${c}=$${i + 1}`).join(' AND ');
          const rows = await db.query(
            `SELECT * FROM ${state.table}${where ? ' WHERE ' + where : ''} LIMIT 1`,
            Object.values(state.filters),
          );
          return { data: rows.rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

// Loads the real generate route with a controllable brief generator and a
// recording email provider.
function setup(options = {}) {
  const sends = [];
  let generated = 0;
  const route = loadTs('src/app/api/agents/bi-reporter/generate/route.ts', {
    '@/lib/auth-guard': {
      requireCronOrSession: async () => ({ clientId: options.clientId || client, viaCron: true }),
      authErrorResponse: () => null,
    },
    '@/lib/supabase': { supabaseAdmin: supabaseDouble() },
    '../route': {
      runBiReporter: async () => {
        generated++;
        if (options.generationFails) return { status: 503, body: { success: false, error: 'Report could not be saved.' } };
        const row = await db.query(
          'INSERT INTO weekly_briefs(client_id,week_start,ware_score,brief_html) VALUES($1,$2,700,$3) RETURNING id',
          [options.clientId || client, options.weekStart, '<p>Your week</p>'],
        );
        return {
          status: 200,
          body: { success: true, brief_id: row.rows[0].id, ware_score: 700, brief_html: options.emptyBrief ? '' : '<p>Your week</p>' },
        };
      },
    },
    '@/lib/resend': {
      sendBrandedEmail: async (params) => {
        sends.push(params);
        if (options.sendFails) return { sent: false, error: 'Provider rejected the send.' };
        if (options.suppressed) return { sent: false, skipped: 'suppressed' };
        if (options.sendThrows) throw new Error('socket hang up');
        return { sent: true, email_id: `provider-${sends.length}` };
      },
    },
  });
  return { route, sends, generatedCount: () => generated };
}

const body = (weekStart, clientId) => ({ send_email: true, week_start_date: weekStart, client_id: clientId });
const request = (payload) => new Request('https://example.test/api/agents/bi-reporter/generate', {
  method: 'POST', body: JSON.stringify(payload),
});

async function sendRecord(weekStart, clientId = client) {
  const rows = await db.query(
    'SELECT status,attempts,provider_id,sent_at,brief_id,idempotency_key,last_error FROM weekly_brief_sends WHERE client_id=$1 AND week_start=$2',
    [clientId, weekStart],
  );
  return rows.rows[0] ?? null;
}

before(() => { process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-placeholder'; });

test('a second run for the same week does not email again', async () => {
  const weekStart = '2026-03-02';
  const first = setup({ weekStart });
  const firstResponse = await first.route.POST(request(body(weekStart, client)));
  assert.equal(firstResponse.status, 200);
  assert.equal((await firstResponse.json()).emailed, true);
  assert.equal(first.sends.length, 1, 'the first run emails');

  const record = await sendRecord(weekStart);
  assert.equal(record.status, 'sent');
  assert.equal(record.provider_id, 'provider-1');
  assert.equal(record.idempotency_key, `brief/${client}/${weekStart}`);
  // The owner-facing row agrees with the delivery record.
  const brief = await db.query('SELECT sent_at FROM weekly_briefs WHERE id=$1', [record.brief_id]);
  assert.ok(brief.rows[0].sent_at, 'weekly_briefs.sent_at is stamped');

  // Re-run, exactly as a Vercel retry or a second cron invocation would.
  const second = setup({ weekStart });
  const secondResponse = await second.route.POST(request(body(weekStart, client)));
  assert.equal(secondResponse.status, 200);
  const secondBody = await secondResponse.json();
  assert.equal(secondBody.emailed, false);
  assert.equal(secondBody.skipped, 'already_sent');
  assert.equal(second.sends.length, 0, 'the second run must not contact the provider');
  // And it must not pay for another brief either.
  assert.equal(second.generatedCount(), 0, 'no AI call for a week already delivered');

  // Still exactly one delivery record, one attempt.
  const after = await sendRecord(weekStart);
  assert.equal(after.attempts, 1);
  assert.equal((await db.query('SELECT count(*)::int n FROM weekly_brief_sends WHERE client_id=$1 AND week_start=$2', [client, weekStart])).rows[0].n, 1);
});

test('two runs at the same moment email once', async () => {
  const weekStart = '2026-03-09';
  const a = setup({ weekStart });
  const b = setup({ weekStart });

  const [first, second] = await Promise.all([
    a.route.POST(request(body(weekStart, client))),
    b.route.POST(request(body(weekStart, client))),
  ]);
  const bodies = [await first.json(), await second.json()];

  const totalSends = a.sends.length + b.sends.length;
  assert.equal(totalSends, 1, `exactly one email, got ${totalSends}`);
  assert.equal(bodies.filter((x) => x.emailed === true).length, 1, 'exactly one run reports a send');

  const loser = bodies.find((x) => x.emailed !== true);
  assert.ok(
    ['already_sent', 'in_progress'].includes(loser.skipped),
    `the loser must say why it stood down, got: ${loser.skipped}`,
  );

  // One row, and the unique constraint is what guarantees it.
  assert.equal((await db.query('SELECT count(*)::int n FROM weekly_brief_sends WHERE client_id=$1 AND week_start=$2', [client, weekStart])).rows[0].n, 1);
  assert.equal((await sendRecord(weekStart)).status, 'sent');
});

test('a failed send can be retried, and succeeds on the retry', async () => {
  const weekStart = '2026-03-16';

  // Provider rejects: nothing reached the inbox, so the week stays retryable.
  const failing = setup({ weekStart, sendFails: true });
  const failedResponse = await failing.route.POST(request(body(weekStart, client)));
  assert.equal(failedResponse.status, 200);
  const failedBody = await failedResponse.json();
  assert.equal(failedBody.emailed, false);
  assert.equal(failedBody.skipped, 'provider_rejected');
  assert.equal(failing.sends.length, 1);

  const failedRecord = await sendRecord(weekStart);
  assert.equal(failedRecord.status, 'failed', 'a definite non-send is retryable, not sent');
  assert.equal(failedRecord.sent_at, null);
  assert.equal(failedRecord.provider_id, null);

  // Retry.
  const retry = setup({ weekStart });
  const retryBody = await (await retry.route.POST(request(body(weekStart, client)))).json();
  assert.equal(retryBody.emailed, true, 'the retry is allowed through');
  assert.equal(retry.sends.length, 1);
  // Same key as the failed attempt, so the provider would collapse a duplicate.
  assert.equal(retry.sends[0].idempotencyKey, `brief/${client}/${weekStart}`);

  const sentRecord = await sendRecord(weekStart);
  assert.equal(sentRecord.status, 'sent');
  assert.equal(sentRecord.attempts, 2, 'the retry is counted');
  assert.ok(sentRecord.sent_at);

  // A third run is now refused, so a retry cannot become a second delivery.
  const third = setup({ weekStart });
  assert.equal((await (await third.route.POST(request(body(weekStart, client)))).json()).skipped, 'already_sent');
  assert.equal(third.sends.length, 0);
});

test('a suppressed recipient and a failed generation both leave the week retryable', async () => {
  const suppressedWeek = '2026-03-23';
  const suppressed = setup({ weekStart: suppressedWeek, suppressed: true });
  assert.equal((await (await suppressed.route.POST(request(body(suppressedWeek, client)))).json()).skipped, 'suppressed');
  assert.equal((await sendRecord(suppressedWeek)).status, 'failed');

  // Generation failing must not burn the week's one delivery.
  const brokenWeek = '2026-03-30';
  const broken = setup({ weekStart: brokenWeek, generationFails: true });
  const brokenResponse = await broken.route.POST(request(body(brokenWeek, client)));
  assert.equal(brokenResponse.status, 503);
  assert.equal(broken.sends.length, 0);
  assert.equal((await sendRecord(brokenWeek)).status, 'failed', 'released for the next run');

  const recovered = setup({ weekStart: brokenWeek });
  assert.equal((await (await recovered.route.POST(request(body(brokenWeek, client)))).json()).emailed, true);
});

test('an ambiguous send is held for review rather than silently resent', async () => {
  const weekStart = '2026-04-06';
  // The provider call throws: it may or may not have been accepted.
  const ambiguous = setup({ weekStart, sendThrows: true });
  const ambiguousBody = await (await ambiguous.route.POST(request(body(weekStart, client)))).json();
  assert.equal(ambiguousBody.emailed, false);
  assert.equal(ambiguousBody.skipped, 'delivery_attempt_failed');

  // Deliberately still 'sending': the lease governs it, not a release.
  const held = await sendRecord(weekStart);
  assert.equal(held.status, 'sending');

  // While the lease is live, nothing else may send.
  const blocked = setup({ weekStart });
  assert.equal((await (await blocked.route.POST(request(body(weekStart, client)))).json()).skipped, 'in_progress');
  assert.equal(blocked.sends.length, 0);

  // Past Resend's idempotency window the retry is no longer provably safe, so
  // it becomes an operator decision instead of another email.
  await db.query(
    "UPDATE weekly_brief_sends SET lease_until=now()-interval '1 minute', first_attempt_at=now()-interval '30 hours' WHERE client_id=$1 AND week_start=$2",
    [client, weekStart],
  );
  const stale = setup({ weekStart });
  assert.equal((await (await stale.route.POST(request(body(weekStart, client)))).json()).skipped, 'needs_review');
  assert.equal(stale.sends.length, 0);
  assert.equal((await sendRecord(weekStart)).status, 'review');
});

test('one tenant\'s delivery does not block another, and each week is separate', async () => {
  const weekStart = '2026-04-13';
  const mine = setup({ weekStart });
  assert.equal((await (await mine.route.POST(request(body(weekStart, client)))).json()).emailed, true);

  // A different business, same week.
  const theirs = setup({ weekStart, clientId: other });
  assert.equal((await (await theirs.route.POST(request(body(weekStart, other)))).json()).emailed, true);

  // The same business, the following week.
  const nextWeek = setup({ weekStart: '2026-04-20' });
  assert.equal((await (await nextWeek.route.POST(request(body('2026-04-20', client)))).json()).emailed, true);

  assert.equal((await db.query('SELECT count(*)::int n FROM weekly_brief_sends')).rows[0].n > 1, true);
});

test('the claim is atomic: concurrent SQL claims produce exactly one winner', async () => {
  const weekStart = '2026-05-04';
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () => db.query('SELECT claim_weekly_brief_send(p_client_id => $1, p_week_start => $2) AS result', [client, weekStart])),
  );
  const claimed = attempts.filter((r) => r.rows[0].result.claimed === true);
  assert.equal(claimed.length, 1, `exactly one claim may win, got ${claimed.length}`);
  assert.equal((await db.query('SELECT count(*)::int n FROM weekly_brief_sends WHERE client_id=$1 AND week_start=$2', [client, weekStart])).rows[0].n, 1);
});

test('sent is impossible without a provider receipt', async () => {
  const weekStart = '2026-05-11';
  await db.query('SELECT claim_weekly_brief_send(p_client_id => $1, p_week_start => $2)', [client, weekStart]);

  for (const receipt of [null, '', '   ']) {
    const result = await db.query(
      'SELECT finish_weekly_brief_send(p_client_id => $1, p_week_start => $2, p_brief_id => NULL, p_provider_id => $3) AS ok',
      [client, weekStart, receipt],
    );
    assert.equal(result.rows[0].ok, false, `a ${JSON.stringify(receipt)} receipt cannot close the claim`);
  }
  assert.equal((await sendRecord(weekStart)).status, 'sending');

  // With a receipt it closes, and closing twice with the same receipt is a
  // no-op success so a crashed caller can finish again.
  assert.equal((await db.query('SELECT finish_weekly_brief_send(p_client_id => $1, p_week_start => $2, p_brief_id => NULL, p_provider_id => $3) AS ok', [client, weekStart, 'receipt-1'])).rows[0].ok, true);
  assert.equal((await db.query('SELECT finish_weekly_brief_send(p_client_id => $1, p_week_start => $2, p_brief_id => NULL, p_provider_id => $3) AS ok', [client, weekStart, 'receipt-1'])).rows[0].ok, true);
  // A different receipt for an already-sent week is refused.
  assert.equal((await db.query('SELECT finish_weekly_brief_send(p_client_id => $1, p_week_start => $2, p_brief_id => NULL, p_provider_id => $3) AS ok', [client, weekStart, 'receipt-2'])).rows[0].ok, false);
});

test('Nightwatch and the BI Reporter still share the week\'s brief row', async () => {
  // The flow migration 015 protects: many brief rows per week, newest wins.
  // Nightwatch writes intelligence onto the newest row (or inserts a stub when
  // no brief exists yet) and the BI Reporter reads it back. The delivery claim
  // must not have changed any of that.
  const weekStart = '2026-06-01';

  // Nightwatch first, with no brief for the week: it inserts a stub.
  await db.query('INSERT INTO weekly_briefs(client_id,week_start,intelligence_report_json) VALUES($1,$2,$3)',
    [client, weekStart, JSON.stringify({ headline: 'overnight' })]);

  // The BI Reporter then inserts its own brief row for the same week. This is
  // the insert a UNIQUE (client_id, week_start) on weekly_briefs would have
  // broken.
  await db.query('INSERT INTO weekly_briefs(client_id,week_start,brief_html,ware_score) VALUES($1,$2,$3,700)',
    [client, weekStart, '<p>Monday</p>']);

  const rows = await db.query('SELECT count(*)::int n FROM weekly_briefs WHERE client_id=$1 AND week_start=$2', [client, weekStart]);
  assert.equal(rows.rows[0].n, 2, 'two rows for one week remain legal');

  // The newest-row lookup both agents use still resolves.
  const newest = await db.query(
    'SELECT intelligence_report_json, brief_html FROM weekly_briefs WHERE client_id=$1 AND week_start=$2 ORDER BY created_at DESC LIMIT 1',
    [client, weekStart],
  );
  assert.ok(newest.rows[0], 'the newest row for the week is still reachable');

  // And delivery is still capped at one for the week despite two brief rows.
  const first = setup({ weekStart });
  assert.equal((await (await first.route.POST(request(body(weekStart, client)))).json()).emailed, true);
  const second = setup({ weekStart });
  assert.equal((await (await second.route.POST(request(body(weekStart, client)))).json()).skipped, 'already_sent');
  assert.equal(second.sends.length, 0);
});
