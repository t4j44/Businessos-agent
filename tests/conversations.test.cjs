const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
class AgentRuntimeError extends Error { constructor(message,status) { super(message); this.status=status; } }

function handoff({ unavailable=false, quota=false }={}) {
  const calls=[], logs=[];
  const route=loadTs('src/app/api/widget/handoff/route.ts', {
    '@/lib/supabase':{supabaseAdmin:{rpc:async(name,args)=>{calls.push({name,args}); return {data: unavailable?null:{outcome:'requested',id,status:'requested'},error:unavailable?{code:'DB_DOWN'}:null};}}},
    '@/lib/agent-runtime':{AgentRuntimeError,beginAgentRun:async args=>{calls.push({runtime:args}); if(quota) throw new AgentRuntimeError('Limit reached',429); return {finish:async(status,summary,usage)=>logs.push({status,usage})};}},
  });
  return {calls,logs,send:body=>route.POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({client_id:tenant,session_id:'a'.repeat(48),request_key:key,email:'visitor@example.test',reason:'Need human help',...body})}))};
}

test('human help saves a hashed session under its business without spending AI tokens or claiming notification',async()=>{
  const f=handoff(); const response=await f.send({});
  assert.equal(response.status,200); const data=await response.json();
  assert.equal(data.notification_sent,false); assert.equal(data.saved,true);
  assert.equal(f.calls[0].runtime.reserveTokens,0);
  assert.equal(f.calls[1].args.p_client_id,tenant); assert.equal(f.calls[1].args.p_session_key.length,64);
  assert.notEqual(f.calls[1].args.p_session_key,'a'.repeat(48));
  assert.equal(f.logs[0].status,'completed');
  assert.doesNotMatch(JSON.stringify(f.logs),/visitor@example|Need human|session_id/);
});

test('handoff validation, quota and storage failures cannot claim a saved request',async()=>{
  const invalid=handoff(); assert.equal((await invalid.send({email:'not-an-email'})).status,400); assert.equal(invalid.calls.length,0);
  const quota=handoff({quota:true}); assert.equal((await quota.send({})).status,429); assert.equal(quota.calls.length,1);
  const failed=handoff({unavailable:true}); const response=await failed.send({});
  assert.equal(response.status,503); assert.equal((await response.json()).saved,undefined); assert.equal(failed.logs[0].status,'error');
});

function owner({exists=true}={}) {
  const reads=[], filters=[], rpc=[];
  const row={id,session_key:'d'.repeat(64),handoff_request_key:key,message_count:51,handoff_status:'requested'};
  const db={from(table){reads.push(table); const result={data:table==='widget_conversations'?(exists?row:null):Array.from({length:51},(_,i)=>({id:51-i,role:'user',content:'Saved message'})),error:null};
    const query={select(){return this;},eq(k,v){filters.push([table,k,v]);return this;},lt(k,v){filters.push([table,k,v]);return this;},order(){return this;},limit(){return this;},maybeSingle:async()=>result,then(resolve){return Promise.resolve(result).then(resolve);}};return query;},
    rpc:async(name,args)=>{rpc.push({name,args});return{data:{outcome:'resolved'},error:null};}};
  const route=loadTs('src/app/api/conversations/[id]/route.ts',{
    '@/lib/auth-guard':{requireSession:async()=>({clientId:tenant,userId:'owner-user'}),authErrorResponse:()=>null},
    '@/lib/supabase':{supabaseAdmin:db},
  });
  return{route,reads,filters,rpc};
}

test('an inaccessible conversation cannot expose messages; history is paginated under the session tenant',async()=>{
  const context={params:Promise.resolve({id})};
  const foreign=owner({exists:false}); assert.equal((await foreign.route.GET(new Request('https://example.test'),context)).status,404);
  assert.deepEqual(foreign.reads,['widget_conversations']);
  const own=owner(); const response=await own.route.GET(new Request('https://example.test?before=100&client_id=forged'),context); const body=await response.json();
  assert.equal(body.messages.length,50); assert.equal(body.has_older,true); assert.equal(body.messages[0].id,2);
  assert.equal(body.conversation.session_key,undefined);
  assert.ok(own.filters.some(([table,k,v])=>table==='widget_messages'&&k==='client_id'&&v===tenant));
  assert.ok(own.filters.some(([table,k,v])=>table==='widget_messages'&&k==='session_key'&&v==='d'.repeat(64)));
  assert.ok(own.filters.some(([table,k,v])=>table==='widget_messages'&&k==='id'&&v==='100'));
});

test('handoff resolution uses the logged-in owner and the reviewed request version',async()=>{
  const f=owner(); const response=await f.route.PATCH(new Request('https://example.test',{method:'PATCH',body:JSON.stringify({action:'resolve',request_key:key,client_id:'forged',user_id:'forged'})}),{params:Promise.resolve({id})});
  assert.equal(response.status,200);
  assert.deepEqual(f.rpc[0].args,{p_client_id:tenant,p_id:id,p_request_key:key,p_user_id:'owner-user'});
  assert.equal((await response.json()).notification_sent,false);
});
