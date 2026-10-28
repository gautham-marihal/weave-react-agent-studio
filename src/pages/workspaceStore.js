import { normalizeTelephony } from './helpers.js';
import { randomTag } from '../studio/format.js';

// The workspace list kept in this browser's localStorage: loading, saving, and which workspace is open.

export const WORKSPACE_STORAGE_KEY = 'weave_workspaces';

const CURRENT_WORKSPACE_KEY = 'weave_current_workspace';

export function makeWorkspaceId() {
  return `ws_${Date.now().toString(36)}_${randomTag(5)}`;
}

// Records saved with each workspace: test sessions, check runs (stored as `simulations`, the old name), activity log.
export function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
}

export function loadWorkspaces(profile) {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || '[]');
  } catch {}

  if (Array.isArray(stored) && stored.length) {
    return stored.map((ws) => ({
      id: ws.id || makeWorkspaceId(),
      name: ws.name || 'My workspace',
      createdAt: ws.createdAt || new Date().toISOString(),
      telephony: normalizeTelephony(ws.telephony),
      sessions: normalizeList(ws.sessions),
      simulations: normalizeList(ws.simulations),
      activity: normalizeList(ws.activity),
      settings: ws.settings && typeof ws.settings === 'object' ? ws.settings : {},
    }));
  }

  const first = {
    id: makeWorkspaceId(),
    name: profile?.workspaceName || 'My workspace',
    createdAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([first]));
  } catch {}
  try {
    localStorage.setItem(CURRENT_WORKSPACE_KEY, first.id);
  } catch {}
  return [first];
}

// Opens the first-time setup's workspace by the new person's name (this browser may have had others), making it if none
// has that name. Run once as setup finishes (on every load it would come back after a rename).
export function openWorkspaceNamed(name) {
  const wanted = String(name || '').trim();
  if (!wanted) return;
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || '[]');
  } catch {}
  if (!Array.isArray(stored) || !stored.length) return; // the first load makes it, with this name
  let found = stored.find((ws) => ws && ws.name === wanted);
  try {
    if (!found) {
      found = { id: makeWorkspaceId(), name: wanted, createdAt: new Date().toISOString() };
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([...stored, found]));
    }
    localStorage.setItem(CURRENT_WORKSPACE_KEY, found.id);
  } catch {}
}

export function loadCurrentWorkspaceId(workspaces) {
  try {
    const current = localStorage.getItem(CURRENT_WORKSPACE_KEY);
    if (current && workspaces.some((ws) => ws.id === current)) return current;
  } catch {}
  return workspaces[0]?.id || null;
}

export function saveWorkspaceState(workspaces, currentId) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {}
  try {
    if (currentId) localStorage.setItem(CURRENT_WORKSPACE_KEY, currentId);
  } catch {}
}
