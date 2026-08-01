import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Hides the floating Next.js dev badge, which renders bottom-left in dev and
  // overlaps the sidebar footer. Build/runtime errors are still surfaced.
  devIndicators: false,

  // pdf-parse loads a pdfjs-dist worker from disk at runtime, which breaks when
  // Turbopack bundles it into the server chunk. Keep both as native requires.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default nextConfig;
