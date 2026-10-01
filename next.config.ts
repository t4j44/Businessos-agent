import type { NextConfig } from 'next';

// ── Security headers ────────────────────────────────────────────────────────
//
// HOW THE WIDGET EMBEDS (checked before writing these — it decides the scoping):
// public/widget/widget.js is a plain <script> tag embed. The customer drops
//   <script src="https://OUR_APP/widget/widget.js" data-client-id="…"></script>
// on their own site. The script reads document.currentScript, injects its DOM
// straight into the customer's page, and calls /api/widget/config and
// /api/widget/chat cross-origin with fetch(). There is NO iframe anywhere in
// this repo (grep -rni iframe src public → no matches), and the /api/widget/*
// routes set their own Access-Control-Allow-Origin: * in the route handlers,
// which these headers do not touch.
//
// So X-Frame-Options cannot break the embed — nothing of ours is ever framed.
// The two document-only headers are still scoped away from the widget surface
// below, because they do nothing for a cross-origin script or JSON response and
// X-Frame-Options on /widget/* is exactly what would break a future iframe-based
// embed. No real protection is given up by omitting them there.
//
// The baseline DOES apply to the widget paths, and nosniff is the one to be
// careful about: it makes the browser refuse to execute widget.js if the MIME
// type is wrong. Next serves public/*.js as application/javascript, so this is
// correct — and it is worth having, since widget.js runs on third-party sites.
const SECURE_BASELINE = [
  // Two years. 'preload' is deliberately omitted: submitting to the preload
  // list is effectively irreversible and should be a conscious decision once a
  // production domain is settled.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

// Only meaningful on a document response, so only sent for our own pages.
const DOCUMENT_ONLY = [
  { key: 'X-Frame-Options', value: 'DENY' },
  // The app uses none of these. Listed explicitly rather than with a wildcard
  // so adding a feature is a deliberate edit here.
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()',
      'geolocation=()', 'gyroscope=()', 'magnetometer=()', 'microphone=()',
      'payment=()', 'usb=()',
    ].join(', '),
  },
];

// ── NOT YET ADDED: Content-Security-Policy ──────────────────────────────────
//
// A CSP is deliberately left out of this change because it cannot be added
// safely without first resolving the following. Shipping a guessed policy would
// silently break the dashboard or the widget on customer sites.
//
// What a CSP here would need to account for:
//
//  1. Next.js inline bootstrap. The App Router emits inline <script> blocks for
//     hydration and inline <style> for critical CSS, so 'unsafe-inline' would be
//     required unless a per-request nonce is threaded through. A nonce means
//     generating it in middleware/proxy, passing it via a header, and attaching
//     it to every script — and it forces dynamic rendering, which would undo the
//     92 statically prerendered pages this app currently builds.
//  2. The widget's third-party context. widget.js executes inside the CUSTOMER's
//     page, so it is governed by the CUSTOMER's CSP, not ours. Our policy cannot
//     help it; what matters instead is documenting for customers that they must
//     allow our origin in their own script-src and connect-src.
//  3. connect-src. Must cover the app's own origin plus Supabase (the browser
//     client talks to NEXT_PUBLIC_SUPABASE_URL directly for auth) and Stripe.
//  4. img-src. Brand assets come from Supabase Storage and scraped logo URLs on
//     arbitrary customer domains, so a narrow img-src would break BrandDNACard.
//     Realistically needs 'self' data: https:.
//  5. font-src. Fonts are self-hosted from /public/fonts, so 'self' suffices —
//     this is the one directive that is already easy.
//  6. frame-ancestors 'none' to match X-Frame-Options, and form-action 'self'.
//  7. A Report-Only rollout first. The policy should ship as
//     Content-Security-Policy-Report-Only with a collector endpoint, run for a
//     week against real dashboard use, and only then be enforced.
//
// Sequence: pick nonce-vs-unsafe-inline (1), enumerate the real origins (3-5),
// ship Report-Only, then enforce.

const nextConfig: NextConfig = {
  // Hides the floating Next.js dev badge, which renders bottom-left in dev and
  // overlaps the sidebar footer. Build/runtime errors are still surfaced.
  devIndicators: false,

  // pdf-parse loads a pdfjs-dist worker from disk at runtime, which breaks when
  // Turbopack bundles it into the server chunk. Keep both as native requires.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],

  async headers() {
    return [
      {
        // Everything except the widget's public surface. The negative lookahead
        // keeps these rules non-overlapping, so no header is ever sent twice.
        source: '/((?!widget/|api/widget/).*)',
        headers: [...SECURE_BASELINE, ...DOCUMENT_ONLY],
      },
      {
        // Served from public/widget/ to third-party sites.
        source: '/widget/:path*',
        headers: SECURE_BASELINE,
      },
      {
        // Called cross-origin by the embedded widget.
        source: '/api/widget/:path*',
        headers: SECURE_BASELINE,
      },
    ];
  },
};

export default nextConfig;
