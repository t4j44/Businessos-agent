const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
class AgentRuntimeError extends Error { constructor(message, status) { super(message); this.status = status; } }

function setup({ outcome = 'claimed', blocked = false, assessment, saved = true } = {}) {
  const effects = [], filters = [];
  const db = {
    rpc: async (name, args) => {
      effects.push({ name, args });
      return { data: name === 'claim_call_analysis' ? { outcome, token: 'lease-token', transcript: 'Please ask a person to call me back.', attempts: 1 } : saved, error: null };
    },
    from: () => ({ update(patch) {
      effects.push({ patch });
      return { eq(key, value) { filters.push([key, value]); return this; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); } };
    } }),
  };
  const lib = loadTs('src/lib/call-analysis.ts', {
    './supabase': { supabaseAdmin: db },
    './agent-runtime': { AgentRuntimeError, beginAgentRun: async () => {
      if (blocked) throw new AgentRuntimeError('Paused', 403);
      return { finish: async (status, summary, usage) => effects.push({ status, summary, usage }) };
    } },
    './ai': { MODELS: { SONNET: 'test' }, parseJSON: JSON.parse, callAI: async () => {
      effects.push({ provider: true });
      return { text: JSON.stringify(assessment ?? { summary: 'Human callback requested.', sentiment_score: null, outcome: 'escalated' }), usageKnown: true, inputTokens: 50, outputTokens: 20, cost: 0, costSource: 'provider' };
    } },
  });
  return { ...lib, effects, filters };
}

test('busy and completed calls do not spend tokens again', async () => {
  for (const outcome of ['busy', 'completed', 'not_found']) {
    const f = setup({ outcome });
    assert.equal((await f.analyzeStoredCall(tenant, id)).outcome, outcome);
    assert.equal(f.effects.length, 1);
  }
});

test('a paused call analysis releases only its own lease without consuming a provider attempt', async () => {
  const f = setup({ blocked: true });
  await assert.rejects(f.analyzeStoredCall(tenant, id), error => error.status === 403);
  assert.equal(f.effects.some(e => e.provider), false);
  assert.equal(f.effects.find(e => e.patch).patch.analysis_attempts, 0);
  assert.deepEqual(f.filters, [['client_id', tenant], ['id', id], ['analysis_token', 'lease-token'], ['analysis_status', 'processing']]);
});

test('malformed AI output and lost completion leases cannot be reported as successful', async () => {
  for (const options of [{ assessment: { summary: 'A claim', sentiment_score: 300, outcome: 'resolved' } }, { saved: false }]) {
    const f = setup(options);
    await assert.rejects(f.analyzeStoredCall(tenant, id), error => error.status === 503);
    assert.equal(f.effects.some(e => e.status === 'completed'), false);
    assert.equal(f.effects.some(e => e.status === 'error'), true);
    assert.equal(f.effects.find(e => e.patch).patch.analysis_attempts, undefined);
  }
});

test('successful analysis saves under its tenant and lease before logging; unknown sentiment stays null', async () => {
  const f = setup();
  assert.equal((await f.analyzeStoredCall(tenant, id)).assessment, 'escalated');
  const index = f.effects.findIndex(e => e.name === 'complete_call_analysis');
  assert.equal(f.effects[index].args.p_client_id, tenant);
  assert.equal(f.effects[index].args.p_sentiment, null);
  assert.equal(f.effects[index].args.p_token, 'lease-token');
  assert.equal(f.effects[index + 1].status, 'completed');
  assert.equal(f.effects[index + 1].usage.metadata.follow_up_sent, false);
});
