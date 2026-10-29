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
        accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)', ink: 'var(--accent-text)', line: 'color-mix(in srgb, var(--accent) 45%, var(--line))' },
        // a tone's text colour, a soft background and a border, mixed from the same token (Tailwind's /opacity needs plain colours)
        success: {
          DEFAULT: 'var(--good-text)',
          soft: 'color-mix(in srgb, var(--good-text) 12%, var(--panel))',
          line: 'color-mix(in srgb, var(--good-text) 35%, var(--line))',
        },
        warning: {
          DEFAULT: 'var(--warn-text)',
          soft: 'color-mix(in srgb, var(--warn-text) 12%, var(--panel))',
          line: 'color-mix(in srgb, var(--warn-text) 35%, var(--line))',
        },
        danger: {
          DEFAULT: 'var(--danger-text)',
          soft: 'color-mix(in srgb, var(--danger-text) 12%, var(--panel))',
          line: 'color-mix(in srgb, var(--danger-text) 35%, var(--line))',
        },
      },
      borderRadius: {
        control: 'var(--r-control, 8px)',
        card: 'var(--r-card, 12px)',
      },
      // a new line of a conversation rises into place (the banking rehearsal's transcript)
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        // the banking voice call: bars that move while the assistant speaks, a ring that spreads while it listens
        'voice-bar': { '0%, 100%': { transform: 'scaleY(0.3)' }, '50%': { transform: 'scaleY(1)' } },
        'call-ring': { from: { opacity: '0.5', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(1.4)' } },
      },
      animation: {
        'fade-up': 'fade-up 200ms cubic-bezier(0.23, 1, 0.32, 1)',
        'voice-bar': 'voice-bar 900ms ease-in-out infinite',
        'call-ring': 'call-ring 1.8s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      fontSize: {
        xs: 'var(--fs-xs)',
        sm: 'var(--fs-sm)',
        md: 'var(--fs-md)',
        lg: 'var(--fs-lg)',
      },
    },
  },
};
