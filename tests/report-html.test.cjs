const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { sanitizeReportHtml } = loadTs('src/lib/report-html.ts');
test('generated reports preserve content while stripping executable markup and tracking',()=>{
  const result=sanitizeReportHtml('<h2>Money</h2><p onclick="evil()">$42</p><script>evil()</script><img src="https://tracker.test/x"><a href="javascript:evil()">link</a><iframe src="https://evil.test"></iframe><div style="background:url(https://tracker.test)">safe</div>');
  assert.match(result,/<h2>Money<\/h2>/);
  assert.match(result,/\$42/);
  assert.doesNotMatch(result,/evil|onclick|img|iframe|style=|tracker/);
});
