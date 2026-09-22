import type { Config } from 'tailwindcss'

// Every colour resolves to a CSS custom property declared in
// src/app/globals.css. The variables hold space-separated RGB channels rather
// than hex, which is what lets `<alpha-value>` compose — so `bg-accent/10` and
// `border-line/50` still work while the palette itself lives in one file.
//
// Changing a colour means editing globals.css. Nothing here carries a literal.
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // design-tokens.ts holds literal Tailwind class strings — without this
    // glob they are purged and the type scale silently renders unstyled.
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas:        rgb('canvas'),
        surface:       rgb('surface'),
        raised:        rgb('raised'),
        line:          rgb('line'),
        'line-soft':   rgb('line-soft'),
        'line-strong': rgb('line-strong'),

        // Text
        text:  rgb('text'),
        muted: rgb('muted'),
        dim:   rgb('dim'),
        faint: rgb('faint'),

        // Brand. `copper` is a second voice for editorial accents and is never
        // applied to anything a pointer can act on.
        accent:          rgb('accent'),
        'accent-hover':  rgb('accent-hover'),
        'accent-bright': rgb('accent-bright'),
        copper:          rgb('copper'),

        // Semantic. Meaning only — never used decoratively, and the accent is
        // never used in their place.
        good: rgb('good'),
        warn: rgb('warn'),
        crit: rgb('crit'),
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Large metric figures and page headings only.
        display: ['var(--font-instrument-serif)', 'Instrument Serif', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: {
        // The product type scale: 10.5 / 12 / 14 / 16 / 24 / 32.
        eyebrow: ['0.66rem', { lineHeight: '1rem', letterSpacing: '0.14em' }],
        label:   ['12px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        body:    ['14px', { lineHeight: '20px' }],
        subhead: ['16px', { lineHeight: '24px' }],
        section: ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        page:    ['32px', { lineHeight: '40px', letterSpacing: '-0.01em' }],
        figure:  ['2.9rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '10px',
        xl: '12px',
      },
      transitionTimingFunction: {
        std: 'cubic-bezier(.2,.8,.2,1)',
      },
      transitionDuration: {
        std: '150ms',
      },
      boxShadow: {
        // The only elevation in the product. See globals.css .lightcatch.
        lightcatch: 'inset 0 1px 0 rgba(255,255,255,.045)',
      },
      animation: {
        in: 'fadeIn 150ms cubic-bezier(.2,.8,.2,1)',
        shimmer: 'shimmer 1.4s cubic-bezier(.2,.8,.2,1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
