const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');

// These pages publish a legal document, so the two things that must not break
// are (a) an unwritten policy never renders as if it were written, and (b)
// pasted text cannot inject script into the page.

const legal = loadTs('src/lib/legal.ts');

test('the placeholder keeps the page empty rather than publishing a blank policy', () => {
  // readLegalDocument reads the real files, which still hold the placeholder.
  for (const slug of ['privacy', 'terms', 'support']) {
    const doc = legal.readLegalDocument(slug);
    assert.equal(doc.isPlaceholder, true, `${slug} should still be a placeholder`);
    assert.equal(doc.html, '', `${slug} must render nothing, not an empty policy`);
  }
});

test('a missing file is treated as a placeholder, not as an empty policy', () => {
  const doc = legal.readLegalDocument('does-not-exist');
  assert.equal(doc.isPlaceholder, true);
  assert.equal(doc.html, '');
});

test('markdown renders the subset a policy needs', () => {
  const html = legal.markdownToHtml([
    '# Privacy Policy',
    '',
    'We collect **some** data and *process* it.',
    '',
    '## What we collect',
    '',
    '- Your name',
    '- Your email',
    '',
    '1. First',
    '2. Second',
    '',
    '---',
    '',
    'Questions? [Email us](mailto:support@example.test) or see [terms](/terms).',
  ].join('\n'));

  assert.match(html, /<h1>Privacy Policy<\/h1>/);
  assert.match(html, /<h2>What we collect<\/h2>/);
  assert.match(html, /<strong>some<\/strong>/);
  assert.match(html, /<em>process<\/em>/);
  assert.match(html, /<ul>\n<li>Your name<\/li>\n<li>Your email<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>First<\/li>\n<li>Second<\/li>\n<\/ol>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<a href="mailto:support@example.test">Email us<\/a>/);
  // Consecutive lines in one paragraph are joined, not turned into two.
  assert.equal((legal.markdownToHtml('one\ntwo').match(/<p>/g) || []).length, 1);
});

test('pasted HTML and dangerous links cannot reach the page', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(process.cwd(), 'content', 'legal', 'privacy.md');
  const original = fs.readFileSync(file, 'utf8');

  try {
    fs.writeFileSync(file, [
      '# Policy',
      '',
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      '<iframe src="https://evil.test"></iframe>',
      '',
      'A [bad link](javascript:alert(1)) and a [data link](data:text/html;base64,PHA+) and',
      'a [good link](https://example.test/page).',
      '',
      '<p onclick="alert(1)">styled</p>',
    ].join('\n'));

    const doc = legal.readLegalDocument('privacy');
    assert.equal(doc.isPlaceholder, false, 'real text must render');

    // Nothing EXECUTABLE. Raw HTML in the source is escaped to visible text
    // rather than stripped — this renderer supports Markdown only, and showing
    // stray markup as text is safe and does not silently delete an author's
    // content. So the test is that no live tag or handler survives, not that the
    // characters never appear.
    for (const bad of ['<script', '<iframe', '<img', 'javascript:', 'data:text/html']) {
      assert.ok(!doc.html.includes(bad), `rendered policy leaked live ${bad}: ${doc.html}`);
    }
    // No event handler can be an attribute: any that appear are inside escaped
    // text, so they are preceded by &lt; rather than by a real tag.
    assert.ok(!/<[a-z]+[^>]*\son[a-z]+=/i.test(doc.html), 'an inline event handler survived');
    // The dangerous markup is present only in escaped form.
    assert.match(doc.html, /&lt;script&gt;/, 'script tag should be shown as inert text');
    // A javascript:/data: link keeps its text but loses its href entirely.
    assert.match(doc.html, /<a rel="noopener noreferrer">bad link<\/a>/);
    // The legitimate parts survive, with rel hardened.
    assert.match(doc.html, /<h1>Policy<\/h1>/);
    assert.match(doc.html, /href="https:\/\/example\.test\/page"/);
    assert.match(doc.html, /rel="noopener noreferrer"/);
  } finally {
    fs.writeFileSync(file, original);
  }

  // And the placeholder is back, so the suite leaves nothing behind.
  assert.equal(legal.readLegalDocument('privacy').isPlaceholder, true);
});

test('SUPPORT_EMAIL is optional and trimmed', () => {
  const saved = process.env.SUPPORT_EMAIL;
  try {
    delete process.env.SUPPORT_EMAIL;
    assert.equal(legal.supportEmail(), null, 'absent means null, not an empty mailto link');
    process.env.SUPPORT_EMAIL = '   ';
    assert.equal(legal.supportEmail(), null, 'whitespace counts as unset');
    process.env.SUPPORT_EMAIL = '  help@example.test  ';
    assert.equal(legal.supportEmail(), 'help@example.test');
  } finally {
    if (saved === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = saved;
  }
});

test('every email footer links the privacy policy when an app URL is set', () => {
  const compliance = loadTs('src/lib/compliance.ts', {
    './supabase': { supabaseAdmin: {} },
    '@/lib/supabase': { supabaseAdmin: {} },
  });

  const saved = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test/';
    assert.equal(compliance.privacyUrl(), 'https://app.example.test/privacy', 'trailing slash handled');

    // Both footers: the commercial one and the transactional one that invoices,
    // confirmations and reminders use.
    for (const build of [compliance.complianceFooter, compliance.transactionalFooter]) {
      const footer = build('https://app.example.test/api/unsubscribe?token=t');
      assert.match(footer.html, /https:\/\/app\.example\.test\/privacy/, 'html footer must link privacy');
      assert.match(footer.text, /Privacy Policy: https:\/\/app\.example\.test\/privacy/, 'text footer too');
    }

    // With no app URL the line is omitted rather than shipped as a dead
    // relative link that a mail client cannot resolve.
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(compliance.privacyUrl(), null);
    const bare = compliance.complianceFooter('https://x.test/u');
    assert.ok(!bare.html.includes('Privacy Policy'));
    assert.ok(!bare.text.includes('Privacy Policy'));
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  }
});

test('the legal pages are reachable without a session', () => {
  const fs = require('node:fs');
  const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
  // Asserted against the source because middleware runs in the edge runtime and
  // this is a one-line allowlist that is easy to forget when adding a page.
  for (const route of ['/privacy', '/terms', '/support']) {
    assert.match(middleware, new RegExp(`'${route}'`), `${route} must be in PUBLIC_PATHS`);
  }
});
