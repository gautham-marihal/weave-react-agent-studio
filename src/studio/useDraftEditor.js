import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { prettyJson } from './format.js';
import { describeDuplicates, findDuplicateKeys } from './jsonDuplicates.js';
import { lineOf } from './jsonPath.js';
import { shareStructure } from './shareStructure.js';

const canon = (value) => JSON.stringify(value);

// Editing one agent's draft: text, live validation, saving with revision locking and the 409 "someone else saved" case.
// Lives above the tabs so edits survive tab changes. The JSON text is the source of truth; the form uses setValue().
export function useDraftEditor(botId) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [text, setText] = useState('');
  const [revision, setRevision] = useState(null);
  const [meta, setMeta] = useState({ savedAt: null, savedBy: null });
  const [savedCanon, setSavedCanon] = useState('');
  const [report, setReport] = useState(null);
  const [validating, setValidating] = useState(false);
  const [checkError, setCheckError] = useState(null); // why the last check couldn't run (then there is no report)
  const [checkRound, setCheckRound] = useState(0); // recheck(): the same draft checked again
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [savedName, setSavedName] = useState('');
  const revisionRef = useRef(null);
  revisionRef.current = revision;
  const textRef = useRef('');
  textRef.current = text;
  const lastValue = useRef(undefined); // previous parse, so unchanged parts keep identity (shareStructure)
  const dirtyRef = useRef(false); // unsaved edits, for reloadQuietly (which must never drop them)

  const applyDraft = useCallback((draft) => {
    setText(prettyJson(draft.config));
    setSavedCanon(canon(draft.config));
    setRevision(draft.revision);
    setMeta({ savedAt: draft.saved_at, savedBy: draft.saved_by });
    setSavedName(draft.config?.meta?.name || '');
    setConflict(false);
    setSaveError(null);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    try {
      applyDraft(await api.getDraft(botId));
      setStatus('ready');
    } catch (error) {
      setLoadError(error);
      setStatus('error');
    }
  }, [botId, applyDraft]);

  // The draft as the server has it now, without the loading state (pages stay as they are): for after a publish, which
  // moves the draft on to the next version number. Only when nothing is unsaved; a failed read changes nothing.
  const reloadQuietly = useCallback(async () => {
    if (dirtyRef.current) return;
    const before = textRef.current;
    try {
      const draft = await api.getDraft(botId);
      // typed while the read was on its way: keep it (the next save says the draft moved on, and offers both)
      if (dirtyRef.current || textRef.current !== before) return;
      applyDraft(draft);
    } catch {
      /* the next save says if the revision is behind */
    }
  }, [botId, applyDraft]);

  useEffect(() => {
    setReport(null);
    setCheckError(null);
    load();
  }, [load]);

  const parsed = useMemo(() => {
    if (status !== 'ready') return { value: undefined, error: null, duplicates: [] };
    try {
      const value = shareStructure(lastValue.current, JSON.parse(text));
      // JSON.parse keeps only the last of two equal keys. Treat a repeat as a syntax error so nothing downstream works
      // from a copy that has silently lost a setting.
      const duplicates = findDuplicateKeys(text);
      if (duplicates.length) return { value: undefined, error: describeDuplicates(duplicates, (offset) => lineOf(text, offset)), duplicates };
      lastValue.current = value;
      return { value, error: null, duplicates: [] };
    } catch (error) {
      return { value: undefined, error: error.message, duplicates: [] };
    }
  }, [text, status]);

  // the configuration as last saved, to compare with the edits
  const savedConfig = useMemo(() => {
    try {
      return savedCanon ? JSON.parse(savedCanon) : undefined;
    } catch {
      return undefined;
    }
  }, [savedCanon]);

  const isObject = !!parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value);
  const dirty = status === 'ready' && (parsed.error ? true : canon(parsed.value) !== savedCanon);
  dirtyRef.current = dirty;

  // Validate 500 ms after the last edit. A check that can't run leaves no report rather than the previous one, which
  // was for other contents: what reads the report (Publish, the problems) then waits, and the pages say why.
  useEffect(() => {
    if (status !== 'ready' || parsed.error || !isObject) {
      // nothing to check (loading, or the JSON doesn't read): an earlier failure to check no longer applies
      setValidating(false);
      setCheckError(null);
      return undefined;
    }
    const controller = new AbortController();
    setValidating(true);
    const timer = window.setTimeout(() => {
      api.validate(parsed.value, { signal: controller.signal }).then(
        (result) => {
          setReport(result);
          setCheckError(null);
          setValidating(false);
        },
        (error) => {
          if (error?.name === 'AbortError' || controller.signal.aborted) return;
          setReport(null);
          setCheckError(error);
          setValidating(false);
        },
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, isObject, status, checkRound]);

  const save = useCallback(
    async ({ overwrite = false } = {}) => {
      if (parsed.error || !isObject) return null;
      setSaving(true);
      setSaveError(null);
      const textAtStart = textRef.current;
      try {
        const result = await api.saveDraft(botId, parsed.value, overwrite ? undefined : revisionRef.current);
        const saved = result.draft;
        setRevision(saved.revision);
        setMeta({ savedAt: saved.saved_at, savedBy: saved.saved_by });
        setSavedCanon(canon(saved.config));
        setSavedName(saved.config?.meta?.name || '');
        // The server may hand back a normalized copy. Show it, unless more was typed while the save was running.
        if (canon(saved.config) !== canon(parsed.value) && textRef.current === textAtStart) setText(prettyJson(saved.config));
        // the save's own check is of what was saved: kept only if nothing was typed meanwhile (else the check of the
        // newer contents, already done or under way, is the one that counts)
        if (result.validation && textRef.current === textAtStart) {
          setReport(result.validation);
          setCheckError(null);
        }
        setConflict(false);
        setSavedTick((n) => n + 1);
        return saved;
      } catch (error) {
        if (error.kind === 'conflict') setConflict(true);
        else setSaveError(error);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [botId, parsed, isObject],
  );

  const setValue = useCallback((value) => setText(prettyJson(value)), []);

  return {
    botId,
    status,
    loadError,
    text,
    setText,
    setValue,
    savedConfig,
    revision,
    meta,
    savedName,
    report,
    validating,
    checkError,
    recheck: () => setCheckRound((n) => n + 1),
    parsed,
    isObject,
    dirty,
    saving,
    saveError,
    conflict,
    savedTick,
    save,
    reload: load,
    reloadQuietly,
    dismissSaveError: () => setSaveError(null),
  };
}
