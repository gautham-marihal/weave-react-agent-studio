// Tailwind classes shared by the agent workspace (tailwind.config.js: classes start "tw-"; colours are app tokens).

// Joins class names, leaving out empty ones: cx('a', on && 'b') -> 'a b' or 'a'.
export const cx = (...names) => names.filter(Boolean).join(' ');

// Text-like buttons drop the browser's border, since Tailwind's reset is off in this app. Each sets its own background.
const bare = 'tw-cursor-pointer tw-border-0';
const focusRing = 'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-accent';

// A stage tab: underlined while open, with an inset line so nothing spills out of the row.
export const stageTab = (on) =>
  cx(
    bare,
    focusRing,
    'tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-whitespace-nowrap tw-bg-transparent tw-px-3 tw-py-2.5 tw-text-md tw-font-medium',
    on ? 'tw-text-ink tw-shadow-[inset_0_-2px_0_var(--accent)]' : 'tw-text-muted hover:tw-text-ink',
  );

// An item in Build's side list: filled while open.
export const sideItem = (on) =>
  cx(
    bare,
    focusRing,
    'tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-control tw-px-2.5 tw-py-1.5 tw-text-left tw-text-md tw-font-medium',
    on ? 'tw-bg-accent-soft tw-text-ink' : 'tw-bg-transparent tw-text-ink-soft hover:tw-bg-subtle hover:tw-text-ink',
  );

export const sideHeading = 'tw-m-0 tw-mb-1 tw-mt-5 tw-px-2.5 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wider tw-text-muted';

// Each stage and part has its own colour so it is found at a glance; HueIcon draws it (colours in agent.css .hueIcon).
export const HUES = {
  overview: 'slate',
  build: 'violet',
  test: 'green',
  release: 'blue',
  monitor: 'amber',
  agent: 'violet',
  knowledge: 'blue',
  tools: 'amber',
  workflow: 'teal',
  channels: 'green',
  guardrails: 'rose',
  aftercall: 'indigo',
  settings: 'slate',
};
