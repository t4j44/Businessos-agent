const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { loadTs } = require('./helpers/load-ts.cjs');

// Importing the same CSV twice used to duplicate every lead. These tests drive
// the REAL route against the REAL migration on PostgreSQL, because the
// duplicate check now lives in import_csv_leads — stubbing the RPC would only
// test the stub.

const client = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db;
let route;

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
  await db.query("INSERT INTO clients(id,name,status) VALUES($1,'Business A','active'),($2,'Business B','active')", [client, other]);

  route = loadTs('src/app/api/agents/enrichment/csv-import/route.ts', {
    '@/lib/auth-guard': {
      requireSession: async () => ({ clientId: client, userId: 'u1' }),
      authErrorResponse: () => null,
    },
    '@/lib/supabase': {
      supabaseAdmin: {
        async rpc(name, args) {
          const keys = Object.keys(args);
          const named = keys
            .map((k, i) => `${k} => $${i + 1}${typeof args[k] === 'object' && args[k] !== null ? '::jsonb' : ''}`)
            .join(', ');
          const values = keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
          try {
            const result = await db.query(`SELECT ${name}(${named}) AS result`, values);
            return { data: result.rows[0].result, error: null };
          } catch (error) {
            return { data: null, error: { message: error.message, code: error.code ?? 'ERR' } };
          }
        },
      },
    },
  });
});
after(async () => { if (db) await db.close(); });

async function upload(csv, filename = 'leads.csv') {
  const form = new FormData();
  form.append('file', new File([csv], filename, { type: 'text/csv' }));
  const response = await route.POST(new Request('https://example.test/api/agents/enrichment/csv-import', {
    method: 'POST', body: form,
  }));
  return { status: response.status, body: await response.json() };
}

const leadsFor = async (clientId = client) =>
  (await db.query('SELECT name,email,company,website,domain,dedupe_key,source,imported_at,phone_consent FROM leads WHERE client_id=$1 ORDER BY email NULLS LAST, company', [clientId])).rows;

test('importing the same file twice imports nothing the second time', async () => {
  const csv = [
    'name,email,company',
    'Ada Lovelace,ada@analytical.test,Analytical Engines',
    'Alan Turing,alan@bletchley.test,Bletchley Ltd',
  ].join('\n');

  const first = await upload(csv);
  assert.equal(first.status, 200);
  assert.deepEqual(
    { imported: first.body.imported, dup: first.body.skipped_duplicate, bad: first.body.skipped_invalid },
    { imported: 2, dup: 0, bad: 0 },
  );

  const second = await upload(csv);
  assert.equal(second.status, 200);
  assert.deepEqual(
    { imported: second.body.imported, dup: second.body.skipped_duplicate, bad: second.body.skipped_invalid },
    { imported: 0, dup: 2, bad: 0 },
  );
  assert.equal(second.body.detail.duplicate_existing_lead, 2, 'reported as existing, not in-file');

  const rows = await leadsFor();
  assert.equal(rows.length, 2, 'still two leads, not four');
  // Required provenance on every imported lead.
  assert.ok(rows.every((r) => r.source === 'csv'), "source is 'csv'");
  assert.ok(rows.every((r) => r.imported_at instanceof Date), 'imported_at is stamped');
});

test('duplicates inside one file are collapsed to a single lead', async () => {
  const csv = [
    'name,email,company',
    'Grace Hopper,grace@navy.test,Navy',
    'Grace H,grace@navy.test,Navy Again',
    'Grace Hopper,grace@navy.test,Navy',
    'Katherine Johnson,katherine@nasa.test,NASA',
  ].join('\n');

  const result = await upload(csv);
  assert.equal(result.body.imported, 2);
  assert.equal(result.body.skipped_duplicate, 2);
  assert.equal(result.body.detail.duplicate_in_file, 2, 'reported as in-file, not existing');
  assert.equal(result.body.total_rows, 4);

  // The first occurrence wins.
  const grace = (await leadsFor()).find((r) => r.email === 'grace@navy.test');
  assert.equal(grace.company, 'Navy');
});

test('emails differing only in case or surrounding space are the same lead', async () => {
  const csv = [
    'name,email,company',
    'Margaret Hamilton,Margaret@Apollo.TEST,Apollo',
    'M Hamilton,  MARGARET@apollo.test  ,Apollo Guidance',
  ].join('\n');

  const first = await upload(csv);
  assert.equal(first.body.imported, 1, 'the two spellings are one lead');
  assert.equal(first.body.skipped_duplicate, 1);

  const stored = (await leadsFor()).find((r) => r.company === 'Apollo');
  assert.equal(stored.email, 'margaret@apollo.test', 'stored normalised');

  // A third spelling in a later file is still recognised.
  const second = await upload('name,email\nMH,MARGARET@APOLLO.TEST');
  assert.equal(second.body.imported, 0);
  assert.equal(second.body.skipped_duplicate, 1);
});

test('a quoted field containing commas and line breaks is parsed as one field', async () => {
  const csv =
    'name,email,company\n' +
    '"Doe, Jane",jane@multi.test,"Multi Line Co\nSecond Street, Suite 4\nLondon"\n' +
    'Last Row,last@multi.test,Simple Co\n';

  const result = await upload(csv);
  // The embedded newlines must not have become extra rows.
  assert.equal(result.body.total_rows, 2, 'two data rows, not four');
  assert.equal(result.body.imported, 2);
  assert.equal(result.body.skipped_invalid, 0);

  const rows = await leadsFor();
  const jane = rows.find((r) => r.email === 'jane@multi.test');
  assert.equal(jane.name, 'Doe, Jane', 'the comma inside quotes stayed in the field');
  assert.equal(jane.company, 'Multi Line Co\nSecond Street, Suite 4\nLondon', 'line breaks preserved');
  assert.ok(rows.some((r) => r.email === 'last@multi.test'), 'parsing continued after the multi-line row');
});

test('an oversized file and an over-long file are both refused before any insert', async () => {
  const before = (await leadsFor()).length;

  // Over the byte limit.
  const big = 'name,email\n' + 'x'.repeat(4 * 1024 * 1024);
  const oversized = await upload(big, 'big.csv');
  assert.equal(oversized.status, 413);
  assert.match(oversized.body.error, /limit is 4 MB/);

  // Under the byte limit but over the row limit.
  const manyRows = ['name,email']
    .concat(Array.from({ length: 10_001 }, (_, i) => `Person ${i},p${i}@rows.test`))
    .join('\n');
  const tooMany = await upload(manyRows, 'rows.csv');
  assert.equal(tooMany.status, 413);
  assert.match(tooMany.body.error, /10,001 rows/);
  assert.match(tooMany.body.error, /limit is 10,000/);

  assert.equal((await leadsFor()).length, before, 'nothing was written by either rejection');
});

test('rows with no name, company or email are invalid, and a malformed email is too', async () => {
  const csv = [
    'name,email,company,phone',
    ',,,+15555550100',
    'Valid Person,valid@ok.test,Ok Co,',
    ',not-an-email,,',
    'Name Only,,,',
    ',,Company Only,',
    '  ,  ,  ,  ',
  ].join('\n');

  const result = await upload(csv);
  assert.equal(result.body.total_rows, 5, 'the all-blank row is not a row at all');
  assert.equal(result.body.imported, 3, 'valid email, name-only and company-only all import');
  assert.equal(result.body.skipped_invalid, 2, 'phone-only and malformed-email are invalid');
  assert.equal(result.body.skipped_duplicate, 0);
});

test('without an email, the company domain decides, and www/scheme/case do not', async () => {
  const first = await upload([
    'company,website',
    'Acme Anvils,https://WWW.Acme.test/products?ref=1',
  ].join('\n'));
  assert.equal(first.body.imported, 1);

  const stored = (await leadsFor()).find((r) => r.company === 'Acme Anvils');
  assert.equal(stored.domain, 'acme.test', 'normalised to the bare host');
  assert.equal(stored.dedupe_key, 'domain:acme.test');

  // The same company written differently, in a later file and within one file.
  const second = await upload([
    'company,website',
    'Acme Anvils Ltd,http://acme.test',
    'ACME,acme.test/about',
    'Acme with port,https://www.acme.test:8443/',
  ].join('\n'));
  assert.equal(second.body.imported, 0, 'all four spellings are the one company');
  assert.equal(second.body.skipped_duplicate, 3);

  // A lead that has an email is matched on the email, not the domain, so a
  // different person at the same company still imports.
  const person = await upload('name,email,website\nBob,bob@acme.test,acme.test');
  assert.equal(person.body.imported, 1, 'an emailed contact is its own lead');
});

test('an existing non-CSV lead is recognised, and one tenant cannot block another', async () => {
  // A lead that arrived from Overture prospecting, not a CSV.
  await db.query(
    "INSERT INTO leads(client_id,name,email,company,website,domain,source,place_id) VALUES($1,'Prospected','PROSPECT@overture.test','Overture Co','https://overture.test','overture.test','overture','place-1')",
    [client],
  );

  const mine = await upload('name,email\nSame Person,prospect@overture.test');
  assert.equal(mine.body.imported, 0, 'duplicate of a lead from any source, not just CSV');
  assert.equal(mine.body.skipped_duplicate, 1);

  // The other business importing the same address is unaffected.
  const theirs = await db.query(
    'SELECT import_csv_leads(p_client_id => $1, p_rows => $2::jsonb) AS result',
    [other, JSON.stringify([{ name: 'Same Person', email: 'prospect@overture.test', dedupe_key: 'prospect@overture.test' }])],
  );
  assert.equal(theirs.rows[0].result.imported, 1, 'a different tenant imports it normally');
});

test('repeated imports of one row insert it once, and the key is unique at the database level', async () => {
  const rows = JSON.stringify([{ name: 'Race', email: 'race@concurrent.test', dedupe_key: 'race@concurrent.test' }]);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => db.query('SELECT import_csv_leads(p_client_id => $1, p_rows => $2::jsonb) AS result', [client, rows])),
  );
  const imported = results.reduce((total, r) => total + r.rows[0].result.imported, 0);
  assert.equal(imported, 1, `four calls may insert once in total, got ${imported}`);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM leads WHERE client_id=$1 AND email='race@concurrent.test'", [client])).rows[0].n,
    1,
  );

  // NOTE ON WHAT THE ABOVE DOES NOT PROVE: PGlite runs one connection, so those
  // four calls were serialised and each saw the previous insert. It shows the
  // function is idempotent, not that it is safe against two real connections.
  // The protection that covers that case is the unique index, so assert the
  // index itself exists and is unique rather than implying the test raced it.
  const index = await db.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_leads_client_dedupe_key'",
  );
  assert.equal(index.rows.length, 1, 'the dedupe index must exist');
  assert.match(index.rows[0].indexdef, /CREATE UNIQUE INDEX/, 'it must be UNIQUE, or two connections could both insert');
  assert.match(index.rows[0].indexdef, /client_id, dedupe_key/);

  // And prove the constraint actually bites, bypassing the function.
  await assert.rejects(
    db.query(
      "INSERT INTO leads(client_id,name,email,dedupe_key,source) VALUES($1,'Race Again','race@concurrent.test','race@concurrent.test','csv')",
      [client],
    ),
    /duplicate key value|unique constraint/,
  );

  // Historical rows carry a NULL key, which is why the index could be added to
  // a table already full of duplicates: NULLs do not collide.
  await db.query("INSERT INTO leads(client_id,email,source) VALUES($1,'legacy@dupe.test','apollo'),($1,'legacy@dupe.test','apollo')", [client]);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM leads WHERE client_id=$1 AND email='legacy@dupe.test'", [client])).rows[0].n,
    2,
    'two NULL-keyed duplicates are still allowed, so the index is safe on existing data',
  );
});

test('normalizeDomain in the route matches normalize_lead_domain in SQL', async () => {
  // The route computes a lead's domain and the migration backfills existing
  // rows. If the two drifted apart, a backfilled lead would stop matching an
  // imported one.
  const cases = [
    'https://WWW.Example.com/path?q=1#frag', 'http://example.com', 'www.example.com',
    'Example.COM', 'example.com:8443', 'https://sub.example.co.uk/a/b', '  spaced.test  ',
    'ftp://files.example.net', 'trailing.test.', '', 'not a url at all',
  ];
  for (const input of cases) {
    const fromSql = (await db.query('SELECT normalize_lead_domain($1) AS d', [input])).rows[0].d;
    assert.equal(route.normalizeDomain(input), fromSql, `disagreed on ${JSON.stringify(input)}`);
  }
});

test('the parser handles CRLF, a BOM, escaped quotes and no trailing newline', async () => {
  const parsed = route.parseCsv('﻿name,note\r\n"He said ""hi""","a,b"\r\nLast,row');
  assert.deepEqual(parsed, [['name', 'note'], ['He said "hi"', 'a,b'], ['Last', 'row']]);
  // A file that is only a header yields one row, which the route rejects.
  assert.deepEqual(route.parseCsv('name,email\n'), [['name', 'email']]);
  assert.deepEqual(route.parseCsv(''), []);
});
