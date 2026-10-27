// Demo mode: the app runs on an in-browser fake of the Agent Builder API (demoApi.js), with no backend, nothing live.
// On in a demo build (`npm run dev:demo`, VITE_DEMO_MODE=true) or when switched on in Settings or the DEMO badge.

const KEY = 'weave_demo';

const fromEnv = () => {
  try {
    return typeof import.meta !== 'undefined' && import.meta.env && String(import.meta.env.VITE_DEMO_MODE) === 'true';
  } catch {
    return false;
  }
};

// The sample agents demo mode starts with (demoApi.js seedState), marked "Sample" and hideable from Home
export const DEMO_SAMPLE_IDS = ['acme-support', 'front-desk', 'bookings'];
export const isDemoSample = (id) => isDemoMode() && DEMO_SAMPLE_IDS.includes(id);

// Can the user switch it? Not when the build itself is a demo build.
export const demoIsForced = () => fromEnv();

const stored = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
// Fixed at the first ask for the page's lifetime, so a save or deploy meant for demo data never reaches the real API.
// Switching reloads this tab (setDemoMode), and other tabs via the storage event below, so every open tab follows.
let decided = null;
export function isDemoMode() {
  if (fromEnv()) return true;
  if (decided === null) decided = stored();
  return decided;
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if ((event.key === KEY || event.key === null) && decided !== null && !fromEnv() && stored() !== decided) window.location.reload();
  });
}

// Switches the choice and reloads, so every screen starts again from the right data source.
export function setDemoMode(on, { reload = true } = {}) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  decided = !!on;
  if (reload && typeof window !== 'undefined') window.location.reload();
}

export const DEMO_NOTE =
  'Demo mode: agents here are kept in this browser only. Saving, publishing and deploying are simulated, nothing is live anywhere, and replies in the preview are made up.';
