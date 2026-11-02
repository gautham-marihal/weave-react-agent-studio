import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AgentConfig, Draft, Path } from '../types/studio';
import { useStudio } from '../contexts/StudioContext';
import { useAuth } from '../contexts/AuthContext';
import { putAt } from '../utils/path';
import { canSave as canSaveNow, initialSave, isDirty, saveLabel, saveReducer } from '../utils/saveState';
import { api } from '../api/client';
import { putValidation } from '../utils/serverValidation';
import { draftKey, useServerValidation } from './useServerValidation';

/** How often the editor asks the server whether someone else saved a newer draft. */
const REMOTE_CHECK_MS = 15_000;

const toJson = (config: AgentConfig | null | undefined): string => (config ? JSON.stringify(config) : '');

/** A request to save before doing something that uses the saved draft (Test, Publish). */
export interface PendingSave {
  action: string;
  resolve: (saved: boolean) => void;
}

/**
 * The draft being edited. Edits stay here until the person presses Save (or Ctrl/⌘+S): typing never writes to the
 * server. Save sends the revision it started from; a 409 keeps the edits and opens ConflictDialog.
 */
export function useDraftEditor(agentId: string) {
  const { getAgent, saveDraft } = useStudio();
  const { can } = useAuth();
  const agent = getAgent(agentId);
  const canEdit = can('edit');

  const [config, setConfig] = useState<AgentConfig | null>(agent?.draft.config ?? null);
  const [machine, dispatch] = useReducer(saveReducer, toJson(agent?.draft.config), initialSave);
  const [baseRevision, setBaseRevision] = useState(agent?.draft.revision ?? 0);
  const [savedAt, setSavedAt] = useState(agent?.draft.saved_at ?? '');
  const [conflict, setConflict] = useState<Draft | null>(null);
  // A newer draft someone else saved, found by checking the server (not by saving).
  const [remoteDraft, setRemoteDraft] = useState<Draft | null>(null);
  // The JSON view's text when it is not valid JSON: nothing can be saved until it is fixed.
  const [parseError, setParseError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [history, setHistory] = useState<AgentConfig[]>([]);
  const [future, setFuture] = useState<AgentConfig[]>([]);

  const configRef = useRef(config);
  configRef.current = config;
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const baseRef = useRef(baseRevision);
  baseRef.current = baseRevision;
  const parseErrorRef = useRef(parseError);
  parseErrorRef.current = parseError;

  /** Replace the editor's contents with a draft the server has; nothing is unsaved afterwards. */
  const loadServerDraft = useCallback((draft: Pick<Draft, 'config' | 'revision' | 'saved_at'>) => {
    configRef.current = draft.config;
    baseRef.current = draft.revision;
    setConfig(draft.config);
    dispatch({ type: 'loaded', json: toJson(draft.config) });
    setBaseRevision(draft.revision);
    setSavedAt(draft.saved_at);
    setConflict(null);
    setRemoteDraft(null);
    setParseError(null);
  }, []);

  // Load when the agent changes, when it first arrives (a deep link opened before the list loaded), or once a draft
  // that failed to load has been read.
  const loadError = agent?.loadError;
  const present = !!agent;
  useEffect(() => {
    const a = getAgent(agentId);
    if (!a) return;
    loadServerDraft(a.draft);
    setHistory([]);
    setFuture([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, loadError, present]);

  // Pick up server-side draft changes (a publish moves meta.version on, a restore) when nothing is unsaved.
  const serverRevision = agent?.draft.revision;
  useEffect(() => {
    if (!agent) return;
    const m = machineRef.current;
    if (!isDirty(m) && m.state !== 'saving' && agent.draft.revision !== baseRef.current) loadServerDraft(agent.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRevision]);

  // Every change to the editor's config is measured against what the server has.
  const currentJson = useMemo(() => toJson(config), [config]);
  useEffect(() => {
    dispatch({ type: 'edited', json: currentJson });
  }, [currentJson]);

  // The server's checks on the editor's contents (POST /validate, 500 ms after the last change, and on opening). The
  // server is the authority; nothing is refused on a list of the studio's own.
  const editorKey = `editor:${agentId}`;
  const validationView = useServerValidation(editorKey, config);
  // The report for exactly what is in the editor, or the last one while the new one is coming.
  const validation = validationView.report ?? validationView.previous;

  // Saves run one at a time, so each one sends the revision the previous one got back.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveNow = useCallback(
    async (overwrite: boolean): Promise<boolean> => {
      const current = configRef.current;
      if (!current) return false;
      const m = machineRef.current;
      if (!overwrite && !canSaveNow(m, { parseError: parseErrorRef.current, canEdit })) {
        return !isDirty(m) && m.state !== 'error' && m.state !== 'conflict' && !parseErrorRef.current;
      }
      if (!canEdit) return false;
      const json = toJson(current);
      dispatch({ type: 'save_started' });
      try {
        const res = await saveDraft(agentId, current, overwrite ? null : baseRef.current);
        if (res.ok) {
          baseRef.current = res.draft.revision;
          setBaseRevision(res.draft.revision);
          setSavedAt(res.draft.saved_at);
          setConflict(null);
          setRemoteDraft(null);
          putValidation(editorKey, current, res.validation);
          putValidation(draftKey(agentId), current, res.validation);
          dispatch({ type: 'save_succeeded', savedJson: json });
          return true;
        }
        setConflict(res.conflict);
        dispatch({ type: 'save_conflicted' });
        return false;
      } catch (err: unknown) {
        dispatch({ type: 'save_failed', message: err instanceof Error ? err.message : 'The draft could not be saved.' });
        return false;
      }
    },
    [agentId, saveDraft, canEdit, editorKey]
  );
  const performSave = useCallback(
    (overwrite = false): Promise<boolean> => {
      const run = queueRef.current.then(() => saveNow(overwrite));
      queueRef.current = run.catch(() => undefined);
      return run;
    },
    [saveNow]
  );

  /** Save the edits now. Resolves true when the server has everything. */
  const save = useCallback(() => performSave(false), [performSave]);

  /** Drop the unsaved edits and go back to what the server has. */
  const discard = useCallback(() => {
    const m = machineRef.current;
    const saved = m.savedJson ? (JSON.parse(m.savedJson) as AgentConfig) : null;
    configRef.current = saved;
    setConfig(saved);
    setParseError(null);
    dispatch({ type: 'discarded' });
  }, []);

  /**
   * Before something that uses the saved draft (a test, a publish): true at once when nothing is unsaved, otherwise
   * asks "Save first?" and resolves with whether the save worked. A conflict has to be settled first.
   */
  const ensureSaved = useCallback((action: string): Promise<boolean> => {
    const m = machineRef.current;
    if (m.state === 'conflict') return Promise.resolve(false);
    if (!isDirty(m) && m.state !== 'error' && !parseErrorRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPendingSave({ action, resolve }));
  }, []);

  const answerPendingSave = useCallback(
    async (choice: 'save' | 'cancel') => {
      const pending = pendingSave;
      if (!pending) return;
      if (choice === 'cancel') {
        setPendingSave(null);
        pending.resolve(false);
        return;
      }
      const ok = await save();
      setPendingSave(null);
      pending.resolve(ok);
    },
    [pendingSave, save]
  );

  // Has someone else saved a newer draft? Checked every 15 s while the tab is visible and on returning to it.
  useEffect(() => {
    let controller: AbortController | null = null;
    const check = () => {
      if (document.visibilityState !== 'visible' || machineRef.current.state === 'saving') return;
      controller?.abort();
      controller = new AbortController();
      api
        .getDraft(agentId, { signal: controller.signal })
        .then((latest) => {
          if (machineRef.current.state === 'saving' || latest.revision <= baseRef.current) return;
          setRemoteDraft({
            bot_id: agentId,
            revision: latest.revision,
            saved_at: latest.saved_at,
            saved_by: latest.saved_by,
            config: latest.config as AgentConfig,
          });
        })
        .catch(() => undefined); // the health indicator reports an unreachable API
    };
    const interval = window.setInterval(check, REMOTE_CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, [agentId]);

  // Warn before closing or reloading the tab with unsaved changes. (Moving inside the app asks in LeaveGuard.)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty(machineRef.current)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const undo = useCallback(() => {
    if (!canEdit || history.length === 0 || !config) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [config, ...f]);
    setConfig(prev);
  }, [canEdit, history, config]);

  const redo = useCallback(() => {
    if (!canEdit || future.length === 0 || !config) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, config]);
    setConfig(next);
  }, [canEdit, future, config]);

  // Ctrl/⌘+S saves from any page of the agent (and never opens the browser's save dialog). Ctrl/⌘+Z/Y undo and redo
  // outside text fields, where the field's own undo applies.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const update = useCallback(
    (path: Path, value: unknown) => {
      if (!canEdit) return;
      setConfig((prev) => {
        if (!prev) return prev;
        setHistory((h) => [...h.slice(-25), prev]);
        setFuture([]);
        return putAt(prev, path, value);
      });
    },
    [canEdit]
  );

  const replaceConfig = useCallback(
    (next: AgentConfig) => {
      if (!canEdit) return;
      setConfig((prev) => {
        if (prev) {
          setHistory((h) => [...h.slice(-25), prev]);
          setFuture([]);
        }
        return next;
      });
    },
    [canEdit]
  );

  /** Replace the editor contents with the newer draft found on the server. */
  const loadRemoteDraft = useCallback(() => {
    if (remoteDraft) loadServerDraft(remoteDraft);
  }, [remoteDraft, loadServerDraft]);

  /** Keep the editor contents and save them over the newer server draft. */
  const overwriteRemoteDraft = useCallback(() => void performSave(true), [performSave]);

  const resolveConflict = useCallback(
    (choice: 'mine' | 'theirs') => {
      if (!conflict) return;
      if (choice === 'mine') {
        void performSave(true);
        return;
      }
      loadServerDraft(conflict);
    },
    [conflict, performSave, loadServerDraft]
  );

  const dirty = isDirty(machine);

  return {
    agent,
    config,
    /** The server's report (null until it has answered once); see validationView for whether it is current. */
    validation,
    validationView,
    validating: validationView.status === 'checking' || validationView.status === 'unknown',
    /** The save state machine's state (idle, dirty, saving, saved, conflict, error). */
    saveState: machine.state,
    saveLabel: saveLabel(machine),
    saveError: machine.error,
    dirty,
    canSave: canSaveNow(machine, { parseError, canEdit }),
    parseError,
    setParseError,
    savedAt,
    conflict,
    remoteDraft,
    canEdit,
    baseRevision,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    update,
    replaceConfig,
    save,
    discard,
    ensureSaved,
    pendingSave,
    answerPendingSave,
    loadRemoteDraft,
    overwriteRemoteDraft,
    resolveConflict
  };
}

export type DraftEditor = ReturnType<typeof useDraftEditor>;
