const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { loadTs } = require('./helpers/load-ts.cjs');
const secret = 'test-only-signing-secret';
const { verifyBlandSignature } = loadTs('src/lib/bland.ts');
test('voice signatures authenticate the exact payload, and fail closed', () => {
  const body = '{"call_id":"call1"}';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyBlandSignature(body, signature, secret), true);
  assert.equal(verifyBlandSignature(body + ' ', signature, secret), false);
  assert.equal(verifyBlandSignature(body, 'bad', secret), false);
  assert.equal(verifyBlandSignature(body, signature, ''), false);
});
test('voice tenant comes from the verified number; minutes become seconds', async () => {
  process.env.BLAND_WEBHOOK_SECRET = secret;
  const calls = [];
  const query = { select(){return this}, eq(k,v){calls.push([k,v]);return this}, maybeSingle:async()=>({data:{id:'agent',client_id:'owner',verified_at:'2026-09-17'},error:null}) };
  const { handleVoiceWebhook } = loadTs('src/lib/voice-webhook.ts', {
    '@/lib/supabase':{supabaseAdmin:{from:()=>query,rpc:async(n,p)=>{calls.push(p);return {data:{created:false},error:null}}}},
    '@/lib/log':{logAgentRun:async()=>assert.fail('duplicate event must not be logged again')},
  });
  const body = JSON.stringify({call_id:'call1',from:'+12025550100',to:'+12025550101',call_length:1.5,metadata:{client_id:'attacker'}});
  const response = await handleVoiceWebhook(new Request('https://app.test/api/webhooks/bland', {method:'POST',body,headers:{'x-webhook-signature':createHmac('sha256',secret).update(body).digest('hex')}}));
  assert.equal(response.status,200);
  assert.equal(calls.at(-1).p_client_id,'owner');
  assert.equal(calls.at(-1).p_duration_sec,90);
});
