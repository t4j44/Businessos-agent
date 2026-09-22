// Business OS design system — the TypeScript mirror.
//
// THE PALETTE LIVES IN src/app/globals.css. This module exists only for the
// places that cannot use a Tailwind class: SVG stroke/fill attributes, Recharts
// props, canvas drawing. Keep the hex values here in step with the RGB channels
// declared there — they are the same colours written two ways because two
// different consumers need two different formats.
//
// Import as a namespace to avoid the `import { type }` parsing ambiguity in
// TypeScript (`type` is a contextual keyword in import clauses):
//   import * as tokens from '@/lib/design-tokens'
//   <p className={tokens.type.metric}>

export const colors = {
  // Surfaces. The greys carry a faint violet bias — pure neutral grey reads as
  // an unmade decision.
  bg: {
    base: '#08070C',        // page ground
    card: '#100E16',        // card surface
    cardHover: '#17151F',   // card on hover
    border: '#262233',      // every 1px border
    borderSoft: '#1B1826',  // internal dividers
    borderStrong: '#332E42',// hover / focus border
    input: '#17151F',       // input fields
  },
  // Brand. `copper` is a second voice for editorial accents and never appears
  // on anything a pointer can act on.
  primary: '#7C5CFF',
  primaryHover: '#6B4AE6',
  primaryBright: '#A896FF',
  copper: '#C98B5E',
  // Semantic. Meaning only, and never interchangeable with the accent: no
  // success state in primary, no button or link in success/warning/danger.
  success: '#4FBF8B',
  warning: '#D9A441',
  running: '#D9A441',
  danger:  '#D96A6A',
  idle:    '#4A4658',
  // Text
  text: {
    primary: '#F2F0F7',
    secondary: '#8B87A0',
    muted: '#615D75',
    faint: '#4A4658',
  },
}

// Typography scale: 10.5 eyebrow / 12 label / 14 body / 16 subhead / 24 section
// / 32 page / 46 figure.
//
// font-display (Instrument Serif) appears on `metric` and `pageTitle` only.
// Everywhere else is font-sans (Archivo). A serif in UI chrome reads as a
// rendering fault rather than as taste.
export const type = {
  pageTitle:   'font-display text-page font-normal text-text',
  sectionTitle:'text-section font-semibold text-text',
  subhead:     'text-subhead font-semibold text-text',
  body:        'text-body text-muted',
  label:       'eyebrow text-dim',
  // Metric readouts.
  metric:      'font-display text-figure tabular',
  metricLabel: 'eyebrow text-dim',
  cardTitle:   'text-subhead font-semibold text-text',
}

// Tailwind v3 JIT only generates classes it finds as complete literal strings
// in scanned source, so class names can never be built from `colors` at
// runtime. These are the same palette pre-written as usable classes.
export const tw = {
  bg: {
    base: 'bg-canvas',
    card: 'bg-surface',
    cardHover: 'hover:bg-raised',
    input: 'bg-raised',
  },
  border: 'border-line',
  borderHover: 'hover:border-line-strong',
  // The product card: 1px border, 10px radius, top light-catch, no drop shadow.
  card: 'rounded-lg border border-line bg-surface shadow-lightcatch',
  // A supporting block: no border, no elevation. See the note in Skeleton.tsx
  // about uniform treatment destroying hierarchy.
  panel: 'rounded-lg bg-surface/60',
  text: {
    primary: 'text-text',
    secondary: 'text-muted',
    muted: 'text-dim',
    faint: 'text-faint',
    primaryBrand: 'text-accent',
    success: 'text-good',
    warning: 'text-warn',
    running: 'text-warn',
    danger: 'text-crit',
  },
  btn: {
    primary:
      'inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed',
    // Primary CTA is the one place a gradient is allowed.
    cta:
      'btn-accent-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed',
    secondary:
      'inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-transparent px-4 py-2 text-sm font-medium text-muted hover:border-line-strong hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed',
  },
}
