import { setPref, usePref } from '../usePref.js';

// Which layout an agent opens in: "new" (one page per concern, one menu down the side) or "classic" (the stages and tabs). It is a choice one person makes,
// kept in this browser, so the two can be tried side by side. Settings has the switch.
export const LAYOUT_KEY = 'weave_layout';
export const DEFAULT_LAYOUT = 'new';

export function getLayout() {
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY);
    if (stored === 'new' || stored === 'classic') return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LAYOUT;
}
export const isNewLayout = () => getLayout() === 'new';
export const setLayout = (value) => setPref(LAYOUT_KEY, value === 'new' ? 'new' : 'classic');

// [layout, setLayout] for a component that shows or changes it.
export function useLayout() {
  const [value, set] = usePref(LAYOUT_KEY, DEFAULT_LAYOUT);
  return [value === 'new' ? 'new' : 'classic', (next) => set(next === 'new' ? 'new' : 'classic')];
}
