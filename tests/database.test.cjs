const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { vector } = require('@electric-sql/pglite-pgvector');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
let db;
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
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
  for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) {
    if (file.startsWith('035_')) {
      await db.exec("INSERT INTO clients(id,name,status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Legacy business','active');");
      await db.query("INSERT INTO widget_messages(client_id,session_key,role,content,created_at) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,'user','Earlier message','2026-08-01'),('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,'assistant','Latest legacy reply','2026-08-02')",['c'.repeat(64)]);
    }
    try { await db.exec(fs.readFileSync(path.join(folder,file),'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
  }
  await db.query('INSERT INTO clients(id,user_id,name,status) VALUES($1,$2,\'Business A\',\'active\'),($3,$4,\'Business B\',\'active\')',[a,userA,b,userB]);
});
after(async () => { if (db) await db.close(); });

test('all migrations apply to PostgreSQL with pgvector', async () => {
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('confirm_appointment','reserve_agent_quota','ingest_voice_call')")).rows[0].n,3);
});
test('RLS prevents tenant A reading tenant B appointments', async () => {
  await db.query("INSERT INTO appointments(client_id,customer_name,status) VALUES($1,'A person','pending'),($2,'B person','pending')",[a,b]);
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userA}';`);
  try {
    const rows = (await db.query('SELECT customer_name FROM appointments')).rows;
    assert.deepEqual(rows.map(r=>r.customer_name),['A person']);
    await assert.rejects(db.query("UPDATE appointments SET status='confirmed'"),/permission denied/);
    await assert.rejects(db.query('SELECT reserve_agent_quota($1,\'receptionist\',\'visitor\',200,20,100)',[a]),/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});
test('confirmation is tenant-safe, overlap-safe, and retry-safe in the database', async () => {
  const ids = (await db.query("INSERT INTO appointments(client_id,customer_name,status) VALUES($1,'One','pending'),($1,'Two','pending') RETURNING id",[a])).rows.map(r=>r.id);
  const confirm = async(client,id,time) => (await db.query('SELECT confirm_appointment($1,$2,\'2026-10-05\',$3,30) AS result',[client,id,time])).rows[0].result;
  assert.equal((await confirm(b,ids[0],'14:00')).outcome,'not_found');
  const results = await Promise.all([confirm(a,ids[0],'14:00'),confirm(a,ids[1],'14:15')]);
  assert.deepEqual(results.map(r=>r.outcome),['confirmed','conflict']);
  assert.equal((await confirm(a,ids[0],'14:00')).outcome,'unchanged');
  assert.equal((await confirm(a,ids[1],'14:30')).outcome,'confirmed');
});
test('public semantic search excludes private, unapproved, customer, and other-tenant memories', async () => {
  const embedding = JSON.stringify([1,...Array(1023).fill(0)]);
  for (const [client,content,type,visibility,approved] of [[a,'public fact','brand','public',true],[a,'private fact','brand','internal',true],[a,'unreviewed','brand','public',false],[a,'customer secret','contact','public',true],[b,'other business','brand','public',true]]) {
    await db.query('INSERT INTO rag_chunks(client_id,content,chunk_type,visibility,approved_at,embedding) VALUES($1,$2,$3,$4,$5,$6)',[client,content,type,visibility,approved?'2026-09-17T00:00:00Z':null,embedding]);
  }
  const rows = (await db.query('SELECT * FROM search_public_knowledge($1,$2,5)',[embedding,a])).rows;
  assert.deepEqual(rows.map(r=>r.content),['public fact']);
});
test('durable quota rejects excess sessions and token reservations', async () => {
  const reserve = async(subject,tokens=100)=> (await db.query("SELECT reserve_agent_quota($1,'test',$2,3,2,$3) AS allowed",[a,subject,tokens])).rows[0].allowed;
  assert.equal(await reserve('v1'),true);
  assert.equal(await reserve('v1'),true);
  assert.equal(await reserve('v1'),false);
  assert.equal(await reserve('v2',100000),false);
  assert.equal(await reserve('v2'),true);
  assert.equal(await reserve('v3'),false);
  assert.equal((await db.query('SELECT tokens_used FROM api_usage WHERE client_id=$1',[a])).rows[0].tokens_used,300);
});
test('webhook retries create exactly one transcript and one customer interaction', async () => {
  const voice = (await db.query("INSERT INTO voice_agents(client_id,phone_number,verified_at) VALUES($1,'+12025550101',now()) RETURNING id",[a])).rows[0].id;
  const ingest = async()=> (await db.query("SELECT ingest_voice_call($1,$2,'provider-call-1','+12025550100',90,'Please request an appointment') AS result",[a,voice])).rows[0].result;
  const results=await Promise.all([ingest(),ingest()]);
  assert.deepEqual(results.map(r=>r.created),[true,false]);
  assert.equal((await db.query("SELECT count(*)::int n FROM call_transcripts WHERE bland_call_id='provider-call-1'")).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM contact_interactions WHERE metadata->>'call_id'='provider-call-1'")).rows[0].n,1);
  await assert.rejects(db.query("SELECT ingest_voice_call($1,$2,'forged-call',null,1,'forged')",[b,voice]),/Invalid voice mapping/);
});

test('customer identity cannot merge conflicting people or cross tenants', async () => {
  const resolve = async (client,email,phone) => (await db.query('SELECT resolve_contact($1,$2,$3,\'Customer\',\'test\') AS result',[client,email,phone])).rows[0].result;
  const one = await resolve(a,'one@example.test','+12025550201');
  const two = await resolve(a,'two@example.test','+12025550202');
  assert.equal((await resolve(a,'ONE@example.test','+12025550201')).id,one.id);
  assert.equal(await resolve(a,'one@example.test','+12025550202'),null);
  assert.notEqual((await resolve(b,'one@example.test','+12025550201')).id,one.id);
  await db.query('SELECT adjust_contact_score($1,$2,15)',[b,one.id]);
  assert.equal((await db.query('SELECT score FROM contacts WHERE id=$1',[one.id])).rows[0].score,0);
  await Promise.all([db.query('SELECT adjust_contact_score($1,$2,15)',[a,one.id]),db.query('SELECT adjust_contact_score($1,$2,20)',[a,one.id])]);
  assert.equal((await db.query('SELECT score FROM contacts WHERE id=$1',[one.id])).rows[0].score,35);
  await assert.rejects(db.query("INSERT INTO contact_interactions(client_id,contact_id,agent_name,interaction_type,summary) VALUES($1,$2,'test','test','wrong tenant')",[b,two.id]),/foreign key/);
});

test('website refresh preserves manual knowledge and owner corrections; failed replacement rolls back', async () => {
  await db.query("INSERT INTO brand_profiles(client_id,company_name) VALUES($1,'Extracted name')",[a]);
  assert.equal((await db.query("SELECT edit_brand_field($1,'company_name','\"Owner name\"'::jsonb) AS edited",[a])).rows[0].edited,true);
  await db.query("UPDATE brand_profiles SET company_name='Rescan name',tagline='Fresh tagline' WHERE client_id=$1",[a]);
  assert.deepEqual((await db.query('SELECT company_name,tagline FROM brand_profiles WHERE client_id=$1',[a])).rows[0],{company_name:'Owner name',tagline:'Fresh tagline'});
  const vector = [1,...Array(1023).fill(0)];
  const refresh = chunks => db.query("SELECT replace_brand_chunks($1,'https://example.com',$2::jsonb)",[a,JSON.stringify(chunks)]);
  const chunk = {content:'A sourced website fact.',chunk_type:'brand',embedding:vector};
  await refresh([chunk]);
  await db.query("UPDATE rag_chunks SET visibility='public',approved_at=now() WHERE client_id=$1 AND source_agent='brand_scout'",[a]);
  await db.query("INSERT INTO rag_chunks(client_id,content,chunk_type) VALUES($1,'Keep my uploaded policy','knowledge')",[a]);
  await refresh([chunk]);
  assert.equal((await db.query("SELECT count(*)::int n FROM rag_chunks WHERE client_id=$1 AND source_agent='brand_scout' AND is_active AND approved_at IS NOT NULL",[a])).rows[0].n,1);
  await assert.rejects(refresh([{...chunk,content:'First new row'}, {...chunk,embedding:[1]}]),/Invalid chunk/);
  assert.equal((await db.query("SELECT count(*)::int n FROM rag_chunks WHERE client_id=$1 AND content='First new row'",[a])).rows[0].n,0);
  await refresh([{...chunk,content:'Changed fact requires review'}]);
  assert.equal((await db.query("SELECT visibility FROM rag_chunks WHERE client_id=$1 AND source_agent='brand_scout' AND is_active",[a])).rows[0].visibility,'internal');
  assert.equal((await db.query("SELECT is_active FROM rag_chunks WHERE client_id=$1 AND content='Keep my uploaded policy'",[a])).rows[0].is_active,true);
});

test('approval decisions are scoped, expire, and never claim execution', async () => {
  const id = (await db.query("INSERT INTO approvals_queue(client_id,action_type) VALUES($1,'review_response') RETURNING id",[a])).rows[0].id;
  const decide = async(client,action) => (await db.query('SELECT resolve_approval($1,$2,$3,$4) result',[client,id,userA,action])).rows[0].result;
  assert.equal((await decide(b,'approved')).outcome,'not_found');
  assert.equal((await decide(a,'approved')).execution_status,'awaiting_execution');
  assert.equal((await decide(a,'approved')).outcome,'unchanged');
  assert.equal((await decide(a,'rejected')).outcome,'conflict');
  const expired = (await db.query("INSERT INTO approvals_queue(client_id,expires_at) VALUES($1,now()-interval '1 hour') RETURNING id",[a])).rows[0].id;
  assert.equal((await db.query("SELECT resolve_approval($1,$2,$3,'approved') result",[a,expired,userA])).rows[0].result.outcome,'expired');
});

test('invoice drafts use stored facts, exclude settled invoices, and do not advance delivery', async () => {
  const id = (await db.query("INSERT INTO invoices(client_id,amount_cents,status,due_date,chase_step) VALUES($1,4200,'sent',current_date-10,0) RETURNING id",[a])).rows[0].id;
  const claim = async(client=a) => (await db.query('SELECT claim_invoice_draft($1,$2) result',[client,id])).rows[0].result;
  assert.equal((await claim(b)).outcome,'not_found');
  const first = await claim();
  assert.equal(first.invoice.amount_cents,4200);
  assert.equal(first.chase_step,1);
  assert.equal((await claim()).outcome,'exists');
  await db.query("UPDATE invoice_chase_drafts SET status='draft',message='A draft' WHERE id=$1",[first.draft_id]);
  assert.equal((await claim()).outcome,'exists');
  assert.equal((await db.query('SELECT chase_step,last_chase_at FROM invoices WHERE id=$1',[id])).rows[0].chase_step,0);
  assert.equal((await db.query('SELECT last_chase_at FROM invoices WHERE id=$1',[id])).rows[0].last_chase_at,null);
  await db.query("UPDATE invoices SET status='paid' WHERE id=$1",[id]);
  assert.equal((await claim()).outcome,'ineligible');
});

test('receptionist control preserves other settings and is not browser writable', async () => {
  await db.query("UPDATE clients SET settings_json='{\"notifications\":{\"weeklyBrief\":true},\"agents\":{\"receptionist\":{\"instruction\":\"keep\"}}}' WHERE id=$1",[a]);
  await db.query('SELECT set_receptionist_enabled($1,false)',[a]);
  const settings = (await db.query('SELECT settings_json FROM clients WHERE id=$1',[a])).rows[0].settings_json;
  assert.equal(settings.notifications.weeklyBrief,true);
  assert.deepEqual(settings.agents.receptionist,{instruction:'keep',enabled:false});
  await db.exec('SET ROLE authenticated');
  try { await assert.rejects(db.query('SELECT set_receptionist_enabled($1,true)',[a]),/permission denied/); }
  finally { await db.exec('RESET ROLE'); }
});

test('billing receipts are atomic, idempotent, and older events cannot restore an obsolete plan', async () => {
  await db.query("UPDATE clients SET stripe_customer_id='cus_test_a' WHERE id=$1",[a]);
  const apply = async(id,time,state,tier) => (await db.query("SELECT apply_billing_event($1,'cus_test_a',$2,'customer.subscription.updated',$3,$4,'{}') outcome",[id,time,state,tier])).rows[0].outcome;
  assert.equal(await apply('evt_new',200,'active','growth'),'applied');
  assert.equal(await apply('evt_new',200,'cancelled','starter'),'duplicate');
  assert.equal(await apply('evt_old',100,'cancelled','starter'),'recorded_stale');
  assert.deepEqual((await db.query('SELECT status,plan_tier FROM clients WHERE id=$1',[a])).rows[0],{status:'active',plan_tier:'growth'});
  await assert.rejects(apply('evt_bad',300,'made_up','scale'),/Invalid billing state/);
  assert.equal((await db.query("SELECT count(*)::int n FROM billing_events WHERE event_id='evt_bad'")).rows[0].n,0);
});

test('metrics preserve unknown values, count above API limits, and use payment dates', async () => {
  await db.query("INSERT INTO call_transcripts(client_id,created_at,analysis_status) SELECT $1,'2026-08-03T00:00:00Z','pending' FROM generate_series(1,1100)",[b]);
  await db.query("INSERT INTO call_transcripts(client_id,created_at,resolved,sentiment_score) VALUES($1,'2026-08-03T00:00:00Z',true,80)",[b]);
  await db.query("INSERT INTO invoices(client_id,amount_cents,status,created_at,due_date,paid_at) VALUES($1,9000,'paid','2026-07-01','2026-07-15','2026-08-04'),($1,2000,'sent','2026-08-01','2026-08-03',null),($1,8000,'cancelled','2026-08-01','2026-08-03',null)",[b]);
  const m=(await db.query("SELECT business_metrics($1,'2026-08-01','2026-08-08') result",[b])).rows[0].result;
  assert.equal(m.calls.total,1101); assert.equal(m.calls.resolved,1); assert.equal(m.calls.avg_sentiment,80);
  assert.equal(m.reviews.avg_rating,null);
  assert.equal(m.invoices.collected_in_period,90); assert.equal(m.invoices.sum_amount_due,20);
  assert.equal(m.invoices.total,1); assert.equal(m.invoices.paid,0);
  assert.equal(m.contacts.at_risk,0);
  const empty=(await db.query("SELECT business_metrics($1,'2020-01-01','2020-01-08') result",[b])).rows[0].result;
  assert.equal(empty.calls.avg_sentiment,null); assert.equal(empty.calls.total,0);
});

test('call analysis leases and completion cannot duplicate a customer follow-up', async () => {
  const id = (await db.query("SELECT id FROM call_transcripts WHERE bland_call_id='provider-call-1'")).rows[0].id;
  const claim = async(client=a) => (await db.query('SELECT claim_call_analysis($1,$2) result',[client,id])).rows[0].result;
  assert.equal((await claim(b)).outcome,'not_found');
  const lease = await claim(); assert.equal(lease.outcome,'claimed');
  assert.equal((await claim()).outcome,'busy');
  await assert.rejects(db.query("SELECT complete_call_analysis($1,$2,$3,null,null,'resolved')",[a,id,lease.token]),/Invalid analysis/);
  await assert.rejects(db.query("SELECT complete_call_analysis($1,$2,$3,'Summary',null,null)",[a,id,lease.token]),/Invalid analysis/);
  const complete = async(client=a,token=lease.token) => (await db.query("SELECT complete_call_analysis($1,$2,$3,'Customer requested a human.',40,'escalated') result",[client,id,token])).rows[0].result;
  assert.equal(await complete(b),false);
  assert.equal(await complete(),true); assert.equal(await complete(),false);
  assert.equal((await claim()).outcome,'completed');
  assert.equal((await db.query("SELECT count(*)::int n FROM approvals_queue WHERE payload_json->>'transcript_id'=$1",[id])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM contact_interactions WHERE metadata->>'transcript_id'=$1",[id])).rows[0].n,1);
});

test('booking intake retries preserve one appointment and one customer interaction', async () => {
  const key='99999999-9999-4999-8999-999999999999';
  const payload={customer_name:'Booking customer',customer_email:'booking@example.test',requested_date:'2026-10-05',requested_time:'afternoon'};
  const request = async(client=a,fingerprint='a'.repeat(64)) => (await db.query('SELECT request_appointment($1,$2,$3,$4) result',[client,key,fingerprint,JSON.stringify(payload)])).rows[0].result;
  const first=await request(); assert.equal(first.outcome,'created');
  const second=await request(); assert.equal(second.outcome,'unchanged'); assert.equal(second.appointment.id,first.appointment.id);
  assert.equal((await request(a,'b'.repeat(64))).outcome,'conflict');
  assert.notEqual((await request(b)).appointment.id,first.appointment.id);
  assert.equal((await db.query("SELECT count(*)::int n FROM contact_interactions WHERE metadata->>'appointment_id'=$1",[first.appointment.id])).rows[0].n,1);
});

test('public retrieval and brand replacement support vector installed in the extensions schema', async () => {
  await db.exec('CREATE SCHEMA IF NOT EXISTS extensions; ALTER EXTENSION vector SET SCHEMA extensions;');
  try {
    const embedding = [1,...Array(1023).fill(0)];
    const result = await db.query('SELECT * FROM search_public_knowledge($1,$2,5)',[JSON.stringify(embedding),a]);
    assert.ok(result.rows.length > 0);
    const chunks = [{ content: 'Verified vector schema compatibility.', embedding, chunk_type: 'brand' }];
    assert.equal((await db.query('SELECT replace_brand_chunks($1,$2,$3) n',[a,'https://example.test',JSON.stringify(chunks)])).rows[0].n,1);
  } finally { await db.exec('ALTER EXTENSION vector SET SCHEMA public;'); }
});

test('conversation inbox backfills history, tracks messages and isolates owner reads', async () => {
  const legacy=(await db.query("SELECT message_count,last_message_preview FROM widget_conversations WHERE client_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'")).rows[0];
  assert.deepEqual(legacy,{message_count:2,last_message_preview:'Latest legacy reply'});
  await db.exec('SET ROLE service_role');
  try { await db.query("INSERT INTO widget_messages(client_id,session_key,role,content) VALUES($1,$3,'user','Question'),($1,$3,'assistant','Answer'),($2,$3,'user','Other tenant secret')",[a,b,'d'.repeat(64)]); }
  finally { await db.exec('RESET ROLE'); }
  const own=(await db.query('SELECT message_count,last_message_preview FROM widget_conversations WHERE client_id=$1',[a])).rows[0];
  assert.deepEqual(own,{message_count:2,last_message_preview:'Answer'});
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${userA}';`);
  try {
    assert.deepEqual((await db.query('SELECT client_id FROM widget_conversations')).rows.map(r=>r.client_id),[a]);
    await assert.rejects(db.query("UPDATE widget_conversations SET handoff_status='resolved'"),/permission denied/);
    await assert.rejects(db.query('SELECT resolve_widget_handoff($1,$2,$3,$4)',[a,a,a,userA]),/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

test('human handoff is retry-safe, keeps identity unverified and atomically stops later AI messages', async () => {
  const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const contactsBefore=(await db.query('SELECT count(*)::int n FROM contacts')).rows[0].n;
  const request=async(client=a,requestKey=key,fingerprint='f'.repeat(64))=>(await db.query("SELECT request_widget_handoff($1,$2,$3,$4,'Visitor','visitor@example.test','','Need a human') result",[client,'d'.repeat(64),requestKey,fingerprint])).rows[0].result;
  const first=await request(); assert.equal(first.outcome,'requested');
  assert.equal((await request()).outcome,'unchanged');
  assert.equal((await request(a,key,'a'.repeat(64))).outcome,'conflict');
  assert.equal((await request(a,'ffffffff-ffff-4fff-8fff-ffffffffffff')).outcome,'pending');
  assert.notEqual((await request(b)).id,first.id);
  assert.equal((await db.query('SELECT count(*)::int n FROM contacts')).rows[0].n,contactsBefore);
  await assert.rejects(db.query("INSERT INTO widget_messages(client_id,session_key,role,content) VALUES($1,$2,'user','In-flight turn'),($1,$2,'assistant','Late AI reply')",[a,'d'.repeat(64)]),/awaiting human/);
  assert.equal((await db.query('SELECT message_count FROM widget_conversations WHERE id=$1',[first.id])).rows[0].message_count,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM widget_messages WHERE client_id=$1 AND session_key=$2',[a,'d'.repeat(64)])).rows[0].n,2);
  const resolve=async(client=a,user=userA,requestKey=key)=>(await db.query('SELECT resolve_widget_handoff($1,$2,$3,$4) result',[client,first.id,requestKey,user])).rows[0].result;
  assert.equal((await resolve(b,userB)).outcome,'not_found');
  assert.equal((await resolve(a,userB)).outcome,'not_found');
  assert.equal((await resolve()).outcome,'resolved');
  assert.equal((await resolve()).outcome,'unchanged');
  await db.query("INSERT INTO widget_messages(client_id,session_key,role,content) VALUES($1,$2,'user','Follow-up')",[a,'d'.repeat(64)]);
  assert.equal((await request(a,'ffffffff-ffff-4fff-8fff-ffffffffffff')).outcome,'requested');
  assert.equal((await resolve()).outcome,'conflict');
});

test('booking and notification jobs commit together, isolate tenants, and reclaim only expired leases', async () => {
  const create=async()=> (await db.query("SELECT request_appointment($1,'10101010-1010-4010-8010-101010101010',$2,$3) result",[a,'f'.repeat(64),JSON.stringify({customer_name:'Outbox test',customer_email:'outbox@example.test',requested_date:'2026-11-05'})])).rows[0].result;
  const first=await create();await create();
  let jobs=(await db.query('SELECT * FROM scheduler_outbox WHERE appointment_id=$1 ORDER BY kind',[first.appointment.id])).rows;
  assert.equal(jobs.length,2);
  const claim=async(client,id)=>(await db.query('SELECT claim_scheduler_delivery($1,$2) item',[client,id])).rows[0].item;
  assert.equal(await claim(b,jobs[0].id),null);
  const lease=await claim(a,jobs[0].id);assert.ok(lease.lease_id);
  assert.equal(await claim(a,jobs[0].id),null);
  await db.query("UPDATE scheduler_outbox SET lease_until=now()-interval '1 minute' WHERE id=$1",[jobs[0].id]);
  const reclaimed=await claim(a,jobs[0].id);assert.notEqual(reclaimed.lease_id,lease.lease_id);
  const prepare=async(token,payload)=>(await db.query('SELECT prepare_scheduler_delivery($1,$2,$3,$4) email',[a,jobs[0].id,token,JSON.stringify(payload)])).rows[0].email;
  assert.equal(await prepare(lease.lease_id,{to:'wrong@example.test'}),null);
  assert.deepEqual(await prepare(reclaimed.lease_id,{to:'right@example.test'}),{to:'right@example.test'});
  assert.deepEqual(await prepare(reclaimed.lease_id,{to:'changed@example.test'}),{to:'right@example.test'});
  assert.equal((await db.query('SELECT begin_scheduler_send($1,$2,$3) ok',[a,jobs[0].id,reclaimed.lease_id])).rows[0].ok,true);
  await assert.rejects(db.query("SELECT finish_scheduler_delivery($1,$2,$3,'accepted',NULL,NULL)",[a,jobs[0].id,reclaimed.lease_id]),/Invalid delivery result/);
  assert.equal((await db.query("SELECT finish_scheduler_delivery($1,$2,$3,'accepted','receipt-one',NULL) ok",[a,jobs[0].id,lease.lease_id])).rows[0].ok,false);
  assert.equal((await db.query("SELECT finish_scheduler_delivery($1,$2,$3,'accepted','receipt-one',NULL) ok",[a,jobs[0].id,reclaimed.lease_id])).rows[0].ok,true);
  assert.equal((await db.query('SELECT retry_scheduler_delivery($1,$2) ok',[a,jobs[0].id])).rows[0].ok,false);
  await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${userA}';`);
  try {
    await assert.rejects(db.query('SELECT * FROM scheduler_outbox'),/permission denied/);
    await assert.rejects(db.query('SELECT claim_scheduler_delivery($1,$2)',[a,jobs[0].id]),/permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

test('expired provider protection and obsolete booking versions stop automatic delivery',async()=>{
  const appointment=(await db.query("INSERT INTO appointments(client_id,customer_name,customer_email,status) VALUES($1,'Expired job','expiry@example.test','pending') RETURNING id",[a])).rows[0].id;
  const job=(await db.query("SELECT id FROM scheduler_outbox WHERE appointment_id=$1 AND kind='request_received'",[appointment])).rows[0].id;
  await db.query("UPDATE scheduler_outbox SET first_attempt_at=now()-interval '24 hours' WHERE id=$1",[job]);
  assert.equal((await db.query('SELECT claim_scheduler_delivery($1,$2) item',[a,job])).rows[0].item,null);
  assert.equal((await db.query('SELECT status FROM scheduler_outbox WHERE id=$1',[job])).rows[0].status,'review');
  assert.equal((await db.query('SELECT retry_scheduler_delivery($1,$2) ok',[a,job])).rows[0].ok,false);
  await db.query("SELECT confirm_appointment($1,$2,'2026-11-06','09:00',30)",[a,appointment]);
  const confirmation=(await db.query("SELECT * FROM scheduler_outbox WHERE appointment_id=$1 AND kind='confirmation'",[appointment])).rows[0];
  const lease=(await db.query('SELECT claim_scheduler_delivery($1,$2) item',[a,confirmation.id])).rows[0].item;
  await db.query('SELECT prepare_scheduler_delivery($1,$2,$3,$4)',[a,confirmation.id,lease.lease_id,JSON.stringify({to:'expiry@example.test'})]);
  await db.query("SELECT confirm_appointment($1,$2,'2026-11-06','10:00',30)",[a,appointment]);
  assert.equal((await db.query('SELECT begin_scheduler_send($1,$2,$3) ok',[a,confirmation.id,lease.lease_id])).rows[0].ok,false);
  assert.equal((await db.query("SELECT count(*)::int n FROM scheduler_outbox WHERE appointment_id=$1 AND kind='confirmation'",[appointment])).rows[0].n,2);
});

test('reminders use each business timezone, enqueue once, and mark sent only after a receipt',async()=>{
  await db.query("UPDATE clients SET timezone='Pacific/Kiritimati' WHERE id=$1",[a]);
  const date=(await db.query("SELECT ((now() AT TIME ZONE 'Pacific/Kiritimati')::date+1)::text AS due_date")).rows[0].due_date;
  const row=(await db.query("INSERT INTO appointments(client_id,customer_email,status,confirmed_date,confirmed_time) VALUES($1,'reminder@example.test','confirmed',$2,'10:00') RETURNING id",[a,date])).rows[0];
  await db.query('SELECT queue_scheduler_reminders()');await db.query('SELECT queue_scheduler_reminders()');
  const jobs=(await db.query("SELECT * FROM scheduler_outbox WHERE appointment_id=$1 AND kind='reminder'",[row.id])).rows;
  assert.equal(jobs.length,1);assert.equal(jobs[0].snapshot.timezone,'Pacific/Kiritimati');
  assert.equal((await db.query('SELECT reminder_sent FROM appointments WHERE id=$1',[row.id])).rows[0].reminder_sent,false);
  const lease=(await db.query('SELECT claim_scheduler_delivery($1,$2) item',[a,jobs[0].id])).rows[0].item;
  await db.query('SELECT prepare_scheduler_delivery($1,$2,$3,$4)',[a,jobs[0].id,lease.lease_id,JSON.stringify({to:'reminder@example.test'})]);
  await db.query('SELECT begin_scheduler_send($1,$2,$3)',[a,jobs[0].id,lease.lease_id]);
  await db.query("SELECT finish_scheduler_delivery($1,$2,$3,'accepted','reminder-receipt',NULL)",[a,jobs[0].id,lease.lease_id]);
  assert.equal((await db.query('SELECT reminder_sent FROM appointments WHERE id=$1',[row.id])).rows[0].reminder_sent,true);
  await db.query("UPDATE clients SET timezone='UTC' WHERE id=$1",[a]);
});

test('delivery dispatch gives a second tenant a turn despite the first tenant backlog',async()=>{
  const candidates=(await db.query('SELECT * FROM scheduler_delivery_candidates(2)')).rows;
  assert.equal(candidates.length,2);
  assert.equal(new Set(candidates.map(row=>row.client_id)).size,2);
});
