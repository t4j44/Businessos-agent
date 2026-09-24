const { test, after } = require('node:test');
const originalFetch=global.fetch, originalKey=process.env.RESEND_API_KEY;
after(()=>{global.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;});
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const client='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const email={from:'Business <test@example.test>',to:'visitor@example.test',subject:'Booking',html:'<p>Confirmed</p>',text:'Confirmed',headers:{}};

function setup(options={}) {
 const calls=[], sends=[];
 const job={id,client_id:client,lease_id:'lease-one',kind:'confirmation',snapshot:{customer_email:email.to},prepared_email:options.unprepared?null:email};
 const lib=loadTs('src/lib/scheduler-outbox.ts',{
  './supabase':{supabaseAdmin:{rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='claim_scheduler_delivery')return {data:options.unclaimed?null:job};
   if(name==='prepare_scheduler_delivery')return options.storageError?{error:{message:'Unavailable'}}:{data:args.p_email};
   if(name==='begin_scheduler_send')return {data:!options.stale};
   if(name==='finish_scheduler_delivery')return {data:!options.finishFailure};
   throw Error('Unexpected RPC');
  }}},
  './appointments':{getSchedulerContext:async()=>({}),sendConfirmationEmail:async(params,deliver)=>deliver({}),formatWhen:()=>''},
  './resend':{prepareBrandedEmail:async()=>email},
  './compliance':{isSuppressed:async()=>!!options.suppressed},
 });
 global.fetch=async(url,params)=>{sends.push({url,...params});if(options.timeout)throw Error('timeout');return new Response(JSON.stringify(options.noReceipt?{}:{id:'provider-one'}),{status:200});};
 return {lib,calls,sends};
}

test('outbox sends only after freezing the body and winning the current lease; records provider receipt',async()=>{
 process.env.RESEND_API_KEY='test-placeholder';
 const {lib,calls,sends}=setup({unprepared:true});
 assert.equal((await lib.processSchedulerDelivery(client,id)).status,'accepted');
 assert.deepEqual(calls.map(x=>x.name),['claim_scheduler_delivery','prepare_scheduler_delivery','begin_scheduler_send','finish_scheduler_delivery']);
 assert.equal(sends[0].headers['Idempotency-Key'],`scheduler/${id}`);
 assert.deepEqual(JSON.parse(sends[0].body),{...email,html:email.html+`\n<!-- businessos-delivery:${id} -->`});
 assert.equal(calls.at(-1).args.p_provider_id,'provider-one');
 assert.ok(calls.every(x=>x.args.p_client_id===client));
});

test('busy, stale, suppressed and failed persistence cannot contact the email provider',async()=>{
 for(const options of [{unclaimed:true},{stale:true},{suppressed:true},{unprepared:true,storageError:true}]) {
  const {lib,sends}=setup(options);await lib.processSchedulerDelivery(client,id);assert.equal(sends.length,0);
 }
});

test('ambiguous delivery retries use the identical persisted body and key, without claiming acceptance',async()=>{
 for(const options of [{timeout:true},{noReceipt:true},{finishFailure:true}]) {
  const {lib,calls,sends}=setup(options);
  const result=await lib.processSchedulerDelivery(client,id);
  assert.notEqual(result.status,'accepted');
  assert.deepEqual(JSON.parse(sends[0].body),email);
  assert.equal(sends[0].headers['Idempotency-Key'],`scheduler/${id}`);
  assert.equal(calls.some(x=>x.name==='prepare_scheduler_delivery'),false);
 }
});

test('missing provider configuration blocks a claimed delivery without sending',async()=>{
 delete process.env.RESEND_API_KEY;
 const {lib,sends}=setup();
 assert.equal((await lib.processSchedulerDelivery(client,id)).status,'blocked');assert.equal(sends.length,0);
});

test('receipt reconciliation rejects another message and records only a provider-matched receipt for its tenant',async()=>{
 process.env.RESEND_API_KEY='test-placeholder';
 const prepared={...email,html:email.html+`\n<!-- businessos-delivery:${id} -->`};
 let receipt={id:'provider-one',...prepared,to:[prepared.to]}, writes=[];
 const filters=[];
 const query={select(){return this},eq(k,v){filters.push([k,v]);return this},async maybeSingle(){return {data:{prepared_email:prepared,first_attempt_at:'2026-09-22',status:'review'}}}};
 const lib=loadTs('src/lib/scheduler-outbox.ts',{
  './supabase':{supabaseAdmin:{from:()=>query,rpc:async(name,args)=>{writes.push({name,args});return {data:true}}}},
  './appointments':{},'./resend':{},'./compliance':{},
 });
 global.fetch=async()=>new Response(JSON.stringify(receipt));
 receipt.html='Unrelated message';
 assert.equal(await lib.reconcileSchedulerDelivery(client,'owner',id,'provider-one'),false);
 assert.equal(writes.length,0);
 receipt.html=prepared.html;
 assert.equal(await lib.reconcileSchedulerDelivery(client,'owner',id,'provider-one'),true);
 assert.equal(writes[0].args.p_client_id,client);
 assert.equal(writes[0].args.p_user_id,'owner');
 assert.ok(filters.some(([key,value])=>key==='client_id'&&value===client));
});

test('delivery retry ignores caller tenant IDs and rejects inaccessible jobs before any send',async()=>{
 const calls=[];
 const route=loadTs('src/app/api/scheduler/deliveries/route.ts',{
  '@/lib/auth-guard':{requireSession:async()=>({clientId:client,userId:'owner'}),authErrorResponse:()=>null},
  '@/lib/supabase':{supabaseAdmin:{rpc:async(name,args)=>{calls.push({name,args});return {data:false}}}},
  '@/lib/scheduler-outbox':{processSchedulerDelivery:async()=>{throw Error('Must not send');}},
 });
 const response=await route.POST(new Request('https://example.test/api/scheduler/deliveries',{method:'POST',body:JSON.stringify({id,client_id:'other-tenant'})}));
 assert.equal(response.status,409);assert.equal(calls[0].args.p_client_id,client);
});
