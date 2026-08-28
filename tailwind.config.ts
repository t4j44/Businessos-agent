import type { Config } from 'tailwindcss'

// Semantic colour names mirror the CSS variables in globals.css. They are
// declared as literal hex here (not var(...)) so Tailwind can still generate
// opacity variants like `bg-accent/10` and `border-accent/25`.
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
        canvas:        '#0A0A0B',
        surface:       '#111113',
        'surface-hover':'#17171A',
        line:          '#1F1F23',
        'line-strong': '#2A2A30',

        ink:           '#F4F4F5',
        'ink-secondary':'#A1A1AA',
        'ink-muted':   '#71717A',
        'ink-faint':   '#52525B',

        accent:        '#7C3AED',
        'accent-hover':'#6D28D9',

        running:       '#F59E0B',
        success:       '#10B981',
        error:         '#EF4444',
        idle:          '#52525B',

        // Retained so existing pages keep compiling; remapped onto the
        // new dark system rather than the old navy/blue palette.
        navy:    '#111113',
        primary: '#7C3AED',
        muted:   '#71717A',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // The product type scale: 12 / 14 / 16 / 24 / 32.
        label:   ['12px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        body:    ['14px', { lineHeight: '20px' }],
        subhead: ['16px', { lineHeight: '24px' }],
        section: ['24px', { lineHeight: '32px', letterSpacing: '-0.01em' }],
        page:    ['32px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '8px',
        xl: '8px',
      },
      animation: {
        'in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
