const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const args = { clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', agent: 'receptionist', action: 'draft', subject: 'visitor', hourlyLimit: 200, subjectLimit: 20, reserveTokens: 50000 };
function runtime({ paused = false, unavailable = false } = {}) {
  const calls = [], logs = [];
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'active', settings_json: { agents: { receptionist: { enabled: !paused } } } }, error: null }) }) }) }),
    rpc: async (name,values) => { calls.push({name,values}); return { data: true, error: unavailable ? {code:'MISSING'} : null }; } };
  return { ...loadTs('src/lib/agent-runtime.ts', { './supabase': {supabaseAdmin: db}, './log': {logAgentRun: async data => logs.push(data)} }), calls, logs };
}
test('paused assistants and external actions are denied before reserving spend',async () => {
  const paused=runtime({paused:true}); await assert.rejects(paused.beginAgentRun(args),/paused/); assert.equal(paused.calls.length,0);
  const enabled=runtime(); await assert.rejects(enabled.beginAgentRun({...args,action:'send'}),/approved execution/); assert.equal(enabled.calls.length,0);
});
test('quota storage failures fail closed; completion settles once and errors keep reservations',async () => {
  await assert.rejects(runtime({unavailable:true}).beginAgentRun(args),/temporarily unavailable/);
  const f=runtime(); const run=await f.beginAgentRun(args);
  await run.finish('completed','Done',{inputTokens:100,outputTokens:30}); await run.finish('completed','Again');
  assert.equal(f.logs.length,1); assert.equal(f.calls.filter(c=>c.name==='settle_agent_quota').length,1);
  const g=runtime(); const failed=await g.beginAgentRun(args); await failed.finish('error','Failed');
  assert.equal(g.calls.filter(c=>c.name==='settle_agent_quota').length,0);
});
