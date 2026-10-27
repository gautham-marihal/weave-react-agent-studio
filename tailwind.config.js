// Tailwind, for the agent workspace's layout (src/studio/agent/workspace/). Kept apart from the rest of the styles:
//   - every class starts with "tw-", so none can clash with the app's own class names;
//   - its reset (preflight) is off, so pages written in plain CSS look exactly as before;
//   - its colours are the app's own tokens, so the six styles and light/dark mode still apply.

/** @type {import('tailwindcss').Config} */
export default {
  prefix: 'tw-',
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg)',
        surface: 'var(--panel)',
        subtle: 'var(--panel2)',
        ink: { DEFAULT: 'var(--textStrong)', soft: 'var(--text)' },
        muted: 'var(--muted)',
        line: { DEFAULT: 'var(--line)', strong: 'var(--line2)' },
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)', ink: 'var(--accent-text)' },
        success: 'var(--good-text)',
        warning: 'var(--warn-text)',
        danger: 'var(--danger-text)',
      },
      borderRadius: {
        control: 'var(--r-control, 8px)',
        card: 'var(--r-card, 12px)',
      },
      fontSize: {
        sm: 'var(--fs-sm)',
        md: 'var(--fs-md)',
      },
    },
  },
};
