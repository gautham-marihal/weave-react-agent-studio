// Where the studio's data comes from: "Live" (the Agent Builder API, nothing made up) or "Sandbox" (sample agents and
// calls kept in this browser, answered by an imitation of the API, with simulated conversations). Chosen in the top
// bar or in Settings, or forced on by a sandbox build (VITE_SANDBOX=true).
//
// The choice is read once and kept for the page's lifetime, so an edit made on sample data can never be saved to the
// real API, nor the other way round. Switching reloads every open tab onto the new source.

export type DataSource = 'live' | 'sandbox';

const KEY = 'weave_data_source';

const forcedByBuild = (): boolean => {
  try {
    return String((import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_SANDBOX) === 'true';
  } catch {
    return false;
  }
};

const stored = (): DataSource => {
  try {
    return window.localStorage.getItem(KEY) === 'sandbox' ? 'sandbox' : 'live';
  } catch {
    return 'live';
  }
};

let decided: DataSource | null = null;

/** The data source this page runs on (fixed at the first ask until the page reloads). */
export function dataSource(): DataSource {
  if (forcedByBuild()) return 'sandbox';
  if (decided === null) decided = typeof window === 'undefined' ? 'live' : stored();
  return decided;
}

/** True while the studio runs on sample data in this browser. */
export const isSandbox = (): boolean => dataSource() === 'sandbox';

/** A sandbox build cannot be switched to the real API. */
export const sandboxIsForced = (): boolean => forcedByBuild();

/** Chooses the data source and reloads, so every screen starts again from it. */
export function setDataSource(next: DataSource, { reload = true }: { reload?: boolean } = {}): void {
  try {
    if (next === 'sandbox') window.localStorage.setItem(KEY, 'sandbox');
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
  decided = next;
  if (reload) window.location.reload();
}

// Another tab switched: follow it, so no two tabs work on different data without knowing.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if ((event.key === KEY || event.key === null) && decided !== null && !forcedByBuild() && stored() !== decided) window.location.reload();
  });
}

/** The sample agents Sandbox starts with (marked "Sample" in lists). */
export const SANDBOX_SAMPLE_IDS = ['acme-support', 'front-desk', 'bookings', 'weave-bank'];
export const isSandboxSample = (id: string): boolean => isSandbox() && SANDBOX_SAMPLE_IDS.includes(id);

export const SANDBOX_NOTE =
  'Sandbox: sample agents and calls kept in this browser only. Saving, publishing and deploying are simulated, nothing goes live anywhere, and the agent’s replies in a test conversation are made up by simple rules.';

export const LIVE_NOTE = 'Live: agents are read from and saved to the Agent Builder API. Nothing is made up.';
