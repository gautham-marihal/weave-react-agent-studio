// Demo mode: the whole app runs on a small fake of the Agent Builder API that lives in the browser (src/demo/demoApi.js), so it can be
// browsed, and agents created, edited, "published" and "deployed", with no backend at all. Nothing is sent anywhere and nothing is
// really live: every screen that could be mistaken for the real thing says so.
//
// It is on when the app is built or served in demo mode (`npm run dev:demo`, VITE_DEMO_MODE=true) or when switched on from the app
// (Settings, or the DEMO badge), which is remembered in this browser.

const KEY = 'weave_demo';

const fromEnv = () => {
  try { return typeof import.meta !== 'undefined' && import.meta.env && String(import.meta.env.VITE_DEMO_MODE) === 'true'; } catch { return false; }
};

// Can the user switch it? Not when the build itself is a demo build.
export const demoIsForced = () => fromEnv();

export function isDemoMode() {
  if (fromEnv()) return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch { return false; }
}

// Switches the choice and reloads, so every screen starts again from the right data source.
export function setDemoMode(on, { reload = true } = {}) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  if (reload && typeof window !== 'undefined') window.location.reload();
}

export const DEMO_NOTE = 'Demo mode: agents here are kept in this browser only. Saving, publishing and deploying are simulated, nothing is live anywhere, and replies in the preview are made up.';
