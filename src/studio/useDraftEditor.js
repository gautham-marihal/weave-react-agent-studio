import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { prettyJson } from './format.js';
import { describeDuplicates, findDuplicateKeys } from './jsonDuplicates.js';
import { lineOf } from './jsonPath.js';
import { shareStructure } from './shareStructure.js';

const canon = (value) => JSON.stringify(value);

// Everything about editing one bot's draft: the text, live validation, saving with revision
// locking, and the 409 "someone else saved" case. Lives above the tabs so edits survive tab changes.
// The JSON text is the single source of truth; the form editor writes into it with setValue().
export function useDraftEditor(botId) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [text, setText] = useState('');
  const [revision, setRevision] = useState(null);
  const [meta, setMeta] = useState({ savedAt: null, savedBy: null });
  const [savedCanon, setSavedCanon] = useState('');
  const [report, setReport] = useState(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [savedName, setSavedName] = useState('');
  const revisionRef = useRef(null);
  revisionRef.current = revision;
  const textRef = useRef('');
  textRef.current = text;
  const lastValue = useRef(undefined); // the previous parsed config, so unchanged parts keep their identity (see shareStructure)

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

  useEffect(() => {
    setReport(null);
    load();
  }, [load]);

  const parsed = useMemo(() => {
    if (status !== 'ready') return { value: undefined, error: null, duplicates: [] };
    try {
      const value = shareStructure(lastValue.current, JSON.parse(text));
      // JSON.parse keeps only the last of two equal keys. Treat a repeat like a syntax error, so nothing downstream
      // (save, validate, publish, the form) ever works from a copy that has silently lost a setting.
      const duplicates = findDuplicateKeys(text);
      if (duplicates.length) return { value: undefined, error: describeDuplicates(duplicates, (offset) => lineOf(text, offset)), duplicates };
      lastValue.current = value;
      return { value, error: null, duplicates: [] };
    } catch (error) {
      return { value: undefined, error: error.message, duplicates: [] };
    }
  }, [text, status]);

  // The configuration as last saved (for comparing with what is being edited).
  const savedConfig = useMemo(() => {
    try {
      return savedCanon ? JSON.parse(savedCanon) : undefined;
    } catch {
      return undefined;
    }
  }, [savedCanon]);

  const isObject = !!parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value);
  const dirty = status === 'ready' && (parsed.error ? true : canon(parsed.value) !== savedCanon);

  // Validate 500 ms after the last edit.
  useEffect(() => {
    if (status !== 'ready' || parsed.error || !isObject) {
      setValidating(false);
      return undefined;
    }
    const controller = new AbortController();
    setValidating(true);
    const timer = window.setTimeout(() => {
      api.validate(parsed.value, { signal: controller.signal }).then(
        (result) => {
          setReport(result);
          setValidating(false);
        },
        (error) => {
          if (error?.name !== 'AbortError') setValidating(false);
        },
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, isObject, status]);

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
        if (result.validation) setReport(result.validation);
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
    parsed,
    isObject,
    dirty,
    saving,
    saveError,
    conflict,
    savedTick,
    save,
    reload: load,
    dismissSaveError: () => setSaveError(null),
  };
}
