// Business OS design system — clean, minimal, high-contrast dark theme.
//
// Import as a namespace to avoid the `import { type }` parsing ambiguity in
// TypeScript (`type` is a contextual keyword in import clauses):
//   import * as tokens from '@/lib/design-tokens'
//   <p className={tokens.type.metric}>

export const colors = {
  // Backgrounds
  bg: {
    base: '#09090B',        // near-black canvas
    card: '#111113',        // card surface
    cardHover: '#18181B',   // card on hover
    border: '#27272A',      // subtle borders
    input: '#18181B',       // input fields
  },
  // Brand colors
  primary: '#6366F1',       // indigo — main actions
  primaryHover: '#4F46E5',
  // Status
  success: '#10B981',       // green — good metrics
  warning: '#F59E0B',       // amber — needs attention
  danger: '#EF4444',        // red — critical/negative
  // Text
  text: {
    primary: '#FAFAFA',
    secondary: '#A1A1AA',
    muted: '#71717A',
  }
}

// Typography scale
export const type = {
  metric: 'text-4xl font-bold tracking-tight',
  metricLabel: 'text-xs font-medium uppercase tracking-widest text-zinc-500',
  cardTitle: 'text-sm font-semibold text-zinc-100',
  body: 'text-sm text-zinc-400 leading-relaxed',
}

// Tailwind v3 JIT only generates classes it finds as complete literal strings
// in scanned source, so class names can never be built from `colors` at
// runtime. These are the same palette pre-written as usable classes.
export const tw = {
  bg: {
    base: 'bg-[#09090B]',
    card: 'bg-[#111113]',
    cardHover: 'hover:bg-[#18181B]',
    input: 'bg-[#18181B]',
  },
  border: 'border-[#27272A]',
  text: {
    primary: 'text-[#FAFAFA]',
    secondary: 'text-[#A1A1AA]',
    muted: 'text-[#71717A]',
    primaryBrand: 'text-[#6366F1]',
    success: 'text-[#10B981]',
    warning: 'text-[#F59E0B]',
    danger: 'text-[#EF4444]',
  },
}
