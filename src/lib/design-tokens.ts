// Business OS design system — flat, dark, high-contrast.
//
// The canonical values live as CSS variables in globals.css and as semantic
// names in tailwind.config.ts. This module is the TypeScript mirror, for the
// places that need a raw hex (SVG strokes, Recharts fills) or a ready-made
// class string.
//
// Import as a namespace to avoid the `import { type }` parsing ambiguity in
// TypeScript (`type` is a contextual keyword in import clauses):
//   import * as tokens from '@/lib/design-tokens'
//   <p className={tokens.type.metric}>

export const colors = {
  // Backgrounds
  bg: {
    base: '#0A0A0B',        // page canvas
    card: '#111113',        // card surface
    cardHover: '#17171A',   // card on hover
    border: '#1F1F23',      // every 1px border
    borderStrong: '#2A2A30',// hover / focus border
    input: '#17171A',       // input fields
  },
  // Brand — purple, professional
  primary: '#7C3AED',
  primaryHover: '#6D28D9',
  // Status
  running: '#F59E0B',       // amber   — in flight
  success: '#10B981',       // emerald — completed
  danger:  '#EF4444',       // red     — failed
  idle:    '#52525B',       // grey    — never run
  // Retained aliases used by existing charts.
  warning: '#F59E0B',
  // Text
  text: {
    primary: '#F4F4F5',
    secondary: '#A1A1AA',
    muted: '#71717A',
    faint: '#52525B',
  },
}

// Typography scale: 12 labels / 14 body / 16 subhead / 24 section / 32 page.
export const type = {
  pageTitle:   'text-[32px] leading-10 font-semibold tracking-tight text-[#F4F4F5]',
  sectionTitle:'text-2xl leading-8 font-semibold tracking-tight text-[#F4F4F5]',
  subhead:     'text-base leading-6 font-semibold text-[#F4F4F5]',
  body:        'text-sm leading-5 text-[#A1A1AA]',
  label:       'text-xs font-medium uppercase tracking-wider text-[#71717A]',
  // Metric readouts.
  metric:      'text-[32px] leading-10 font-semibold tracking-tight',
  metricLabel: 'text-xs font-medium uppercase tracking-wider text-[#71717A]',
  cardTitle:   'text-base leading-6 font-semibold text-[#F4F4F5]',
}

// Tailwind v3 JIT only generates classes it finds as complete literal strings
// in scanned source, so class names can never be built from `colors` at
// runtime. These are the same palette pre-written as usable classes.
export const tw = {
  bg: {
    base: 'bg-[#0A0A0B]',
    card: 'bg-[#111113]',
    cardHover: 'hover:bg-[#17171A]',
    input: 'bg-[#17171A]',
  },
  border: 'border-[#1F1F23]',
  borderHover: 'hover:border-[#2A2A30]',
  // Flat cards: 1px border, 8px radius, no shadow.
  card: 'rounded-lg border border-[#1F1F23] bg-[#111113]',
  text: {
    primary: 'text-[#F4F4F5]',
    secondary: 'text-[#A1A1AA]',
    muted: 'text-[#71717A]',
    faint: 'text-[#52525B]',
    primaryBrand: 'text-[#7C3AED]',
    success: 'text-[#10B981]',
    warning: 'text-[#F59E0B]',
    running: 'text-[#F59E0B]',
    danger: 'text-[#EF4444]',
  },
  btn: {
    // Primary CTA is the one place a gradient is allowed.
    primary:
      'inline-flex items-center justify-center gap-2 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 disabled:opacity-50 disabled:cursor-not-allowed',
    cta:
      'btn-accent-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'inline-flex items-center justify-center gap-2 rounded-lg border border-[#1F1F23] bg-transparent px-4 py-2 text-sm font-medium text-[#A1A1AA] transition-colors hover:border-[#2A2A30] hover:text-[#F4F4F5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 disabled:opacity-50 disabled:cursor-not-allowed',
  },
}
