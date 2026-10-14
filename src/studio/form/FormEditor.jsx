import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupIssues } from '../../api/client.js';
import { ErrorState, Notice, Spinner } from '../ui.jsx';
import { FormCtx, isUnder, keyOf, omit, orderedSet } from './ctx.js';
import { collectRefOptions, collectSecretNames, createEngine, humanize, isObj } from './engine.js';
import { DeleteDialog, RenameDialog } from './IdTools.jsx';
import { COLLECTIONS, deleteItem, findUsage, removePointers, renameEverywhere } from './references.js';
import Node from './Node.jsx';
import { useSchema } from './useSchema.js';
import './form.css';

// Left-to-right order of the top-level sections, in groups. Anything the schema adds later lands in "Other".
const GROUPS = [
  ['Basics', ['meta', 'runtime', 'persona', 'defaults']],
  ['Conversation', ['channels', 'agents', 'tasks', 'tools', 'messages', 'state', 'constants']],
  ['Connections', ['connections', 'knowledge', 'forms', 'notifications', 'wrapups', 'schedules', 'identity', 'telephony']],
  ['Rules and events', ['guardrails', 'events', 'post_call']],
  ['Operations', ['observability', 'tests', 'builder']],
];
const SKIP = new Set(['$schema', 'schema_version']);
// Sections whose content depends on something that isn't built yet, said where the author is working (see the API's "what is not there yet").
export const SECTION_NOTES = {
  tests: 'Scenarios written here are not run by anything yet: neither the studio nor the API can run them. To check an agent, try it in the Test tab.',
  tasks: 'The runtime does not run tasks (multi-stage flows) yet, so they are saved and checked but have no effect on a call. This is the ordinary form for them; a visual stage editor can follow when the runtime runs them.',
  telephony: 'Transfers defined here are used by tools. Phone numbers are not connected from the studio yet: they are set up with the platform’s SIP tool, and the channel’s entry fields are documentation only.',
};
const getAtPath = (root, path) => path.reduce((node, part) => (node == null ? node : node[part]), root);
// The server owns these: the id is permanent and the rest are set when a version is published.
const READ_ONLY = new Set(['meta.id', 'meta.status', 'meta.created_at', 'meta.updated_at']);

// `only` (a list of top-level keys) limits the form to those sections and `embedded` draws it without the group tabs, for a place that
// shows a part of the configuration (the Simple view's "More settings"). Without them it is the whole form.
export default function FormEditor({ editor, focusRequest, onShowJson, onShowModels, only, embedded = false }) {
  const { schema, error, loading, reload } = useSchema();
  const config = editor.parsed.value;
  const contentRef = useRef(null);
  const [section, setSection] = useState(() => (only && only.length ? only[0] : 'meta'));
  const [focus, setFocus] = useState(null);
  // Deleting is always undoable: whoever deletes says what it was (markDelete), the next change to the config
  // keeps the previous one for the Undo bar, and any other edit dismisses the bar.
  const deleteLabelRef = useRef(null);
  const [toast, setToast] = useState(null); // { label | message, previous }
  const [dialog, setDialog] = useState(null); // { type: 'rename' | 'delete', collection, id, proceed? }
  // Where focus was when something was deleted: the delete button goes with the thing, so focus is put back near it (see focusNear).
  const focusPathRef = useRef(null);
  const markDelete = useCallback((label) => {
    deleteLabelRef.current = label;
    const active = document.activeElement;
    focusPathRef.current = active && active !== document.body ? active.closest?.('[data-path]')?.getAttribute('data-path') || null : null;
  }, []);
  // Keeps keyboard focus in the form when what had it is gone (a deleted card, the Undo button): on the same place if it is back,
  // else the nearest place that still exists, else the section's heading. Focus that is somewhere sensible already is left alone.
  const focusNear = useCallback((pathKey) => {
    window.requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (active && active !== document.body && root.contains(active)) return;
      const nodes = [...root.querySelectorAll('[data-path]')];
      let key = pathKey || '';
      while (key) {
        const node = nodes.find((item) => item.getAttribute('data-path') === key);
        if (node) {
          const target = node.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
          if (target) { target.focus(); return; }
          node.setAttribute('tabindex', '-1');
          node.focus();
          return;
        }
        key = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '';
      }
      root.querySelector('h2')?.focus();
    });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const sectionKeys = useMemo(() => {
    if (!schema) return [];
    const all = Object.keys(schema.properties).filter((k) => !SKIP.has(k));
    return only ? only.filter((k) => all.includes(k)) : all;
  }, [schema, only]);
  const groups = useMemo(() => {
    const listed = new Set(GROUPS.flatMap(([, keys]) => keys));
    const known = GROUPS.map(([name, keys]) => [name, keys.filter((k) => sectionKeys.includes(k))]).filter(([, keys]) => keys.length);
    const other = sectionKeys.filter((k) => !listed.has(k));
    return other.length ? [...known, ['Other', other]] : known;
  }, [sectionKeys]);
  const [activeGroup, setActiveGroup] = useState('Basics');

  const refOptions = useMemo(() => collectRefOptions(config), [config]);
  const secretNames = useMemo(() => [...new Set([...collectSecretNames(config), ...(editor.report?.secrets_required || [])])].sort(), [config, editor.report]);
  const issues = useMemo(() => groupIssues(editor.report), [editor.report]);
  const general = useMemo(() => issues.filter((issue) => !issue.path), [issues]);

  const exact = useMemo(() => {
    const map = new Map();
    issues.forEach((issue) => {
      if (!issue.path) return;
      const k = keyOf(issue.path);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(issue);
    });
    return map;
  }, [issues]);
  const countUnder = useCallback((key) => {
    let errors = 0; let warnings = 0;
    exact.forEach((list, k) => { if (isUnder(k, key)) list.forEach((issue) => { if (issue.severity === 'error') errors += 1; else warnings += 1; }); });
    return { errors, warnings };
  }, [exact]);
  const issuesUnder = useCallback((key) => {
    const out = [];
    exact.forEach((list, k) => { if (isUnder(k, key)) out.push(...list); });
    return out;
  }, [exact]);

  const goTo = useCallback((key) => {
    setSection(key);
    const group = groups.find(([, keys]) => keys.includes(key));
    if (group) setActiveGroup(group[0]);
    contentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [groups]);

  // "Show me" from the validation panel: switch to the section, open what is collapsed, scroll, flash, focus.
  useEffect(() => {
    if (!focusRequest || !schema) return undefined;
    const { path } = focusRequest;
    if (!Array.isArray(path) || !path.length) return undefined;
    if (sectionKeys.includes(path[0])) goTo(path[0]);
    setFocus({ key: keyOf(path), nonce: focusRequest.nonce });
    let timer;
    const attempt = (n) => {
      const root = contentRef.current;
      if (root) {
        const nodes = [...root.querySelectorAll('[data-path]')];
        for (let i = path.length; i >= 1; i -= 1) {
          const wanted = keyOf(path.slice(0, i));
          const el = nodes.find((node) => node.dataset.path === wanted);
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.classList.add('stFFlash');
            window.setTimeout(() => el.classList.remove('stFFlash'), 1600);
            el.querySelector('input, select, textarea, button')?.focus({ preventScroll: true });
            return;
          }
        }
      }
      if (n < 4) timer = window.setTimeout(() => attempt(n + 1), 100);
    };
    timer = window.setTimeout(() => attempt(0), 100);
    return () => window.clearTimeout(timer);
  }, [focusRequest, schema, sectionKeys, goTo]);

  // The ids and keys other parts of the config point at: renaming one rewrites every pointer, deleting one warns first.
  const requestRename = useCallback((collection, id) => setDialog({ type: 'rename', collection, id }), []);
  const requestDelete = useCallback((collection, id, proceed) => {
    if (!engine || !isObj(config) || findUsage(engine, config, collection, id).length === 0) { proceed(); return; }
    setDialog({ type: 'delete', collection, id, proceed });
  }, [engine, config]);
  const applyConfig = useCallback((next, message) => {
    editor.setValue(next);
    setToast(message ? { message, previous: config } : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);
  // A config that uses a 1.2 feature must say 1.2. The version isn't a field in the form, so the fix is offered where the problem shows.
  const canRaise = !!schema && isObj(config) && (schema.properties?.schema_version?.enum || []).includes('1.2') && config.schema_version !== '1.2';
  const raiseVersion = useCallback(() => applyConfig({ ...config, schema_version: '1.2' }, 'Raised schema_version to 1.2.'), [config, applyConfig]);
  // Renames straight away (a key typed in a map): the pointers are rewritten and the toast says how many.
  const renameDirect = useCallback((collection, from, to) => {
    const word = COLLECTIONS[collection]?.word || 'item';
    const count = engine && isObj(config) ? findUsage(engine, config, collection, from).length : 0;
    applyConfig(renameEverywhere(engine, config, collection, from, to), `Renamed ${word} “${from}” to “${to}”${count ? ` and updated ${count} place${count === 1 ? '' : 's'}` : ''}.`);
  }, [engine, config, applyConfig]);

  const ctx = useMemo(() => ({ engine, config, refOptions, secretNames, exact, countUnder, issuesUnder, focus, goTo, markDelete, readOnly: READ_ONLY, requestRename, requestDelete, renameDirect, applyConfig, raiseVersion: canRaise ? raiseVersion : null, openModels: onShowModels }), [onShowModels, canRaise, raiseVersion, engine, config, refOptions, secretNames, exact, countUnder, issuesUnder, focus, goTo, markDelete, requestRename, requestDelete, renameDirect, applyConfig]);

  if (loading && !schema) return <Spinner label="Loading the form" />;
  if (error && !schema) return <ErrorState error={error} onRetry={reload} what="the schema" />;
  if (!schema || !engine) return null;
  if (editor.parsed.error || !isObj(config)) {
    return (
      <Notice kind="warn" title="The JSON has a syntax error" actions={<button type="button" className="quietButton" onClick={onShowJson}>Open the JSON view</button>}>
        The form can’t show a config that isn’t valid JSON. Fix it in the JSON view and the form comes back.
      </Notice>
    );
  }

  const order = Object.keys(schema.properties);
  const commit = (key, value) => {
    const label = deleteLabelRef.current;
    deleteLabelRef.current = null;
    editor.setValue(value === undefined ? omit(config, key) : orderedSet(config, key, value, order));
    const focusPath = focusPathRef.current;
    focusPathRef.current = null;
    setToast(label ? { label, previous: config, focusPath } : null);
    if (label) focusNear(focusPath);
  };
  const undo = () => { if (toast) { editor.setValue(toast.previous); setToast(null); focusNear(toast.focusPath); } };
  const sectionSchema = schema.properties[section];
  const shape = sectionSchema ? engine.resolveShape(sectionSchema, config[section]) : null;
  const present = section in config;
  const required = (schema.required || []).includes(section);
  const visibleKeys = embedded ? sectionKeys : (groups.find(([name]) => name === activeGroup) || groups[0] || ['', []])[1];

  return (
    <FormCtx.Provider value={ctx}>
      <div className={`stForm ${embedded ? 'embedded' : ''}`}>
        <nav className="stFNav" aria-label="Sections">
          {!embedded && <div className="stFNavGroups" role="tablist">
            {groups.map(([name, keys]) => {
              const c = keys.reduce((sum, k) => sum + countUnder(k).errors, 0);
              return (
                <button key={name} type="button" role="tab" aria-selected={name === activeGroup} className={name === activeGroup ? 'on' : ''} onClick={() => { setActiveGroup(name); if (!keys.includes(section)) setSection(keys[0]); }}>
                  {name}{c > 0 && <b className="stFBadge" title={`${c} error${c === 1 ? '' : 's'}`}>{c}</b>}
                </button>
              );
            })}
          </div>}
          <div className="stFNavChips">
            {visibleKeys.map((key) => {
              const c = countUnder(key);
              const isSet = key in config;
              return (
                <button key={key} type="button" className={`stFChipBtn ${key === section ? 'on' : ''} ${isSet ? '' : 'unset'}`} aria-current={key === section ? 'true' : undefined} onClick={() => setSection(key)}>
                  {humanize(key)}
                  {c.errors > 0 ? <b className="stFBadge" title={`${c.errors} error${c.errors === 1 ? '' : 's'}`}>{c.errors}</b> : c.warnings > 0 ? <b className="stFBadge warn" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'}`}>{c.warnings}</b> : null}
                </button>
              );
            })}
          </div>
        </nav>

        {(exact.get('schema_version') || []).length > 0 && (
          <div className="stFVersion" role="alert">
            {(exact.get('schema_version') || []).map((issue, i) => <p key={i}>{issue.message}</p>)}
            {canRaise && (exact.get('schema_version') || []).some((issue) => /schema_version 1\.2/.test(issue.message)) && <button type="button" className="stAddBtn" onClick={raiseVersion}>Use schema version 1.2</button>}
          </div>
        )}

        {general.length > 0 && (
          <ul className="stFGeneral" aria-label="Problems that apply to the whole config">
            {general.map((issue, i) => <li key={i} className={issue.severity}>{issue.message}</li>)}
          </ul>
        )}

        <div className="stFSection" ref={contentRef} key={section}>
          <header className="stFSectionHead">
            <div>
              <h2 tabIndex={-1}>{shape?.title || humanize(section)}</h2>
              {SECTION_NOTES[section] && <p className="stFSectionNote" role="note">{SECTION_NOTES[section]}</p>}
              {shape?.description && <p>{shape.description.length > 260 ? `${shape.description.slice(0, 260)}…` : shape.description}</p>}
            </div>
            {present && !required && <button type="button" className="stFDel" onClick={() => { markDelete(`the ${humanize(section)} section`); commit(section, undefined); }}>Delete section</button>}
            {present && required && <span className="stFTag" title="The schema requires this section, so it can’t be deleted">required section</span>}
          </header>
          {present ? (
            <div data-path={section}>
              <Node schema={sectionSchema} value={config[section]} path={[section]} onChange={(v) => commit(section, v)} />
            </div>
          ) : (
            <div className="stFNotSet">
              <p>This section isn’t part of the agent yet.</p>
              <button type="button" className="primaryCta compactCta" onClick={() => commit(section, engine.defaultFor(sectionSchema))}>＋ Add {humanize(section).toLowerCase()}</button>
            </div>
          )}
        </div>


        {dialog?.type === 'rename' && (
          <RenameDialog
            engine={engine}
            config={config}
            collection={dialog.collection}
            id={dialog.id}
            takenIds={COLLECTIONS[dialog.collection].kind === 'list' ? (getAtPath(config, COLLECTIONS[dialog.collection].path) || []).map((item) => item?.id).filter((x) => typeof x === 'string' && x !== dialog.id) : Object.keys(getAtPath(config, COLLECTIONS[dialog.collection].path) || {}).filter((x) => x !== dialog.id)}
            onClose={() => setDialog(null)}
            onApply={(name, count) => renameDirect(dialog.collection, dialog.id, name)}
          />
        )}
        {dialog?.type === 'delete' && (
          <DeleteDialog
            engine={engine}
            config={config}
            collection={dialog.collection}
            id={dialog.id}
            leftover={removePointers(engine, config, dialog.collection, dialog.id).left.length}
            onClose={() => setDialog(null)}
            onDeleteOnly={() => { dialog.proceed(); }}
            onDeleteAll={() => {
              const { config: cleaned, left } = removePointers(engine, config, dialog.collection, dialog.id);
              const word = COLLECTIONS[dialog.collection]?.word || 'item';
              applyConfig(deleteItem(cleaned, dialog.collection, dialog.id), `Deleted ${word} “${dialog.id}” and the references to it${left.length ? ` (${left.length} in required fields remain)` : ''}.`);
            }}
          />
        )}

        {toast && (
          <div className="stFToast" role="status">
            <span>{toast.message || `Deleted ${toast.label}.`}</span>
            <button type="button" onClick={undo}>Undo</button>
            <button type="button" className="close" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
          </div>
        )}
      </div>
    </FormCtx.Provider>
  );
}

