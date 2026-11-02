// The draft's save state with explicit Save: edits stay in the editor ("dirty") until the person saves. Nothing here
// writes anything; useDraftEditor runs the save and reports what happened. Pure: no React, no network.
//
//   idle --edit--> dirty --save--> saving --ok---> saved (or dirty, when there were edits during the save)
//                                         --409--> conflict (the edits stay; ConflictDialog decides)
//                                         --fail-> error (the edits stay; Save again)

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export interface SaveMachine {
  state: SaveState;
  /** The config the server has, as JSON text: what "dirty" is measured against. */
  savedJson: string;
  /** The editor's config as JSON text. */
  currentJson: string;
  /** The server's reason when the last save failed. */
  error: string | null;
  /** A save has worked since the draft was loaded: a clean editor is then "saved" rather than "idle". */
  savedHere: boolean;
}

export type SaveEvent =
  | { type: 'loaded'; json: string }
  | { type: 'edited'; json: string }
  | { type: 'save_started' }
  | { type: 'save_succeeded'; savedJson: string }
  | { type: 'save_conflicted' }
  | { type: 'save_failed'; message: string }
  | { type: 'discarded' };

export const initialSave = (json: string): SaveMachine => ({ state: 'idle', savedJson: json, currentJson: json, error: null, savedHere: false });

const settled = (m: SaveMachine): SaveState => (m.currentJson !== m.savedJson ? 'dirty' : m.savedHere ? 'saved' : 'idle');

export function saveReducer(m: SaveMachine, e: SaveEvent): SaveMachine {
  switch (e.type) {
    case 'loaded':
      // The server's draft replaces the editor's (opening the agent, "Load theirs", a publish moving the draft on).
      return initialSave(e.json);
    case 'edited': {
      const next = { ...m, currentJson: e.json };
      // While saving, or with a conflict or a failure open, the state stays: those are settled by the person, not by typing.
      if (m.state === 'saving' || m.state === 'conflict' || m.state === 'error') return next;
      return { ...next, state: settled(next) };
    }
    case 'save_started':
      return { ...m, state: 'saving', error: null };
    case 'save_succeeded': {
      const next = { ...m, savedJson: e.savedJson, error: null, savedHere: true };
      return { ...next, state: settled(next) };
    }
    case 'save_conflicted':
      return { ...m, state: 'conflict', error: null };
    case 'save_failed':
      return { ...m, state: 'error', error: e.message };
    case 'discarded':
      return { ...m, currentJson: m.savedJson, state: m.savedHere ? 'saved' : 'idle', error: null };
    default:
      return m;
  }
}

/** Unsaved edits: the editor has something the server does not. */
export const isDirty = (m: SaveMachine): boolean => m.currentJson !== m.savedJson;

/** Whether Save can be pressed: there are edits, the JSON view's text parses, no save is running, the person may edit. */
export function canSave(m: SaveMachine, { parseError = null, canEdit = true }: { parseError?: string | null; canEdit?: boolean } = {}): boolean {
  return canEdit && !parseError && m.state !== 'saving' && (isDirty(m) || m.state === 'error' || m.state === 'conflict');
}

/** The header's words for the state. */
export function saveLabel(m: SaveMachine): string {
  if (m.state === 'saving') return 'Saving…';
  if (m.state === 'error') return 'Could not save';
  if (m.state === 'conflict') return 'Not saved: someone else saved first';
  return isDirty(m) ? 'Unsaved changes' : 'Saved';
}
