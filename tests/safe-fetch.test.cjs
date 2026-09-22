const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { isPublicAddress, parsePublicUrl } = loadTs('src/lib/safe-fetch.ts');
test('scraping rejects private, encoded private, metadata, and special-address URLs', () => {
  for (const url of ['http://localhost','http://127.0.0.1','http://2130706433','http://0x7f000001','http://169.254.169.254/latest','http://[::1]','http://[::ffff:127.0.0.1]','http://10.2.3.4','ftp://example.com','http://user:pass@example.com','http://example.com:3000']) {
    assert.throws(() => parsePublicUrl(url), undefined, url);
  }
  assert.equal(parsePublicUrl('https://example.com/about').pathname,'/about');
  assert.equal(isPublicAddress('8.8.8.8'),true);
  assert.equal(isPublicAddress('100.64.0.1'),false);
  assert.equal(isPublicAddress('2001:db8::1'),false);
});
test('DNS resolution fails closed if any answer is private', async () => {
  const { resolvePublicUrl } = loadTs('src/lib/safe-fetch.ts', {
    'node:dns/promises':{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]},
  });
  await assert.rejects(resolvePublicUrl('https://example.com'),/private/);
});
