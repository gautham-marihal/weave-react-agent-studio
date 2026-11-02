const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  // `dark:` follows the app's own light/dark choice (ThemeContext puts `dark` on <html>), not the computer's
  darkMode: 'class',
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        canvas: c('canvas'),
        surface: c('surface'),
        subtle: c('subtle'),
        ink: { DEFAULT: c('ink'), soft: c('ink-soft') },
        muted: c('muted'),
        line: { DEFAULT: c('line'), strong: c('line-strong') },
        accent: {
          DEFAULT: c('accent'),
          strong: c('accent-strong'),
          soft: c('accent-soft'),
          ink: c('accent-ink'),
        },
        primary: {
          DEFAULT: c('primary'),
          strong: c('primary-strong'),
          soft: c('primary-soft'),
          ink: c('primary-ink'),
        },
        success: { DEFAULT: c('success'), soft: c('success-soft') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft') },
        danger: { DEFAULT: c('danger'), soft: c('danger-soft'), ink: c('danger-ink') },
        info: { DEFAULT: c('info'), soft: c('info-soft') },
      },
      // type, corners and card shadows follow the design style (src/index.css, src/styles/themes.css)
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        overlay: 'var(--shadow-overlay)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.04)' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
};
