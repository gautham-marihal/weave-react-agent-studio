import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Fold from '../../ui/Fold.jsx';
import { groupIssues } from '../../api/client.ts';
import { ErrorState, Notice, Spinner } from '../ui.jsx';
import { FormCtx, OwnerCtx, createConfigStore, isUnder, keyOf, omit, orderedSet, useStableCallback, useStableValue } from './ctx.js';
import { collectRefOptions, collectSecretNames, createEngine, humanize, isObj } from './engine.js';
import { DeleteDialog, RenameDialog } from './IdTools.jsx';
import { COLLECTIONS, collectionAt, deleteItem, findUsage, removePointers, renameEverywhere } from './references.js';
import { getAtPath, removeAtPath, schemaAtPath, setAtPath } from '../agent/schemaPath.js';
import Node, { ObjectBody } from './Node.jsx';
import { FIRST_GROUP, SKIPPED_SECTIONS, VIEW_NOTES, layoutFor, viewById, viewForPath } from './layout.js';
import { SETTINGS, describeSetting } from './plainLanguage.js';
import { useTechnicalNames } from '../usePref.js';
import { describeIssue } from '../validation/issues.js';
import AgentMap from '../relations/AgentMap.jsx';
import ToolGrid from '../relations/ToolGrid.jsx';
import '../relations/relations.css';
import { useSchema } from './useSchema.js';
import { useChannelTypes } from './useChannelTypes.js';
import { DEMO_VALIDATOR_NOTE } from '../../demo/demoValidate.js';
import './form.css';
import './formLook.css';
import Icon from '../../ui/Icon.jsx';
import { hiddenParts } from './hiddenParts.js';

// Sections whose content depends on something not built yet, said
// where the author is working (the API's "what is not there yet").
export const SECTION_NOTES = {
  tests:
    'Scenarios are conversations with what must be true afterwards. Tests › Scenarios writes and runs them, so use that for everyday work; this is the same list in its raw fields.',
  tasks:
    'A task asks the caller a series of questions, checks each answer, and ends as verified, failed or declined. Open a task and use “Try this task” to see it step by step. A step that takes keypad digits works on a phone call only.',
  telephony:
    'Transfers defined here are used by tools. Phone numbers are set up under Telephony in the side menu, where the platform checks that a number is free.',
  wrapups:
    'Said when a task is done and the caller goes quiet. A closing message does nothing until a tool starts it: choose it on the Tools page, in what the tool does when it finishes.',
};
// The server owns these: the id is permanent and the rest are set when a version is published.
const READ_ONLY = new Set(['meta.id', 'meta.status', 'meta.created_at', 'meta.updated_at']);

// What a panel shows when its item has been deleted (also by
// "delete everywhere"): it says so and tells the panel to close.
function ItemGone({ word, onGone }) {
  useEffect(() => {
    onGone?.();
  }, [onGone]);
  return <p className="stFEmpty">This {word} is no longer here.</p>;
}

// The whole configuration form, or a part of it:
//   only, embedded: just these top-level sections, without the group tabs (for the agent's own pages)
//   itemPath: one item of a list (['tools', 2]) without the screens around it, for the panel of a list page
//   itemWord: names the item ("tool") for its Delete button; onItemGone: called once it has been deleted
//   fold: { label, open } folds the item's settings under that label; its Delete button stays outside the fold
export default function FormEditor({
  editor,
  focusRequest,
  onShowJson,
  onShowModels,
  onOpenJson,
  only,
  skipViews = null,
  hide = null,
  embedded = false,
  itemPath = null,
  itemWord = 'item',
  onItemGone,
  fold = null,
}) {
  const { schema, error, loading, reload } = useSchema();
  const config = editor.parsed.value;
  // The config lives in a store the parts read from (useConfigSelect), so the context never changes per keystroke. The
  // store is set while rendering (so parts in this pass read the new config) and told after the commit.
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createConfigStore(config);
  storeRef.current.set(config);
  useLayoutEffect(() => {
    storeRef.current.notify();
  }, [config]);
  const configRef = useRef(config);
  configRef.current = config;
  const contentRef = useRef(null);
  const itemMode = Array.isArray(itemPath) && itemPath.length >= 2;
  const [viewId, setViewId] = useState(null); // null: the first screen of the first group
  const [technical] = useTechnicalNames();
  const [focus, setFocus] = useState(null);
  // Deleting is always undoable: the deleter names it (markDelete), the next config change keeps the previous one for
  // the Undo bar, and any other edit dismisses the bar.
  const deleteLabelRef = useRef(null);
  const [toast, setToast] = useState(null); // { label | message, previous }
  const [dialog, setDialog] = useState(null); // { type: 'rename' | 'delete', collection, id, proceed? }
  // Where focus was when something was deleted: the delete button goes
  // with the thing, so focus is put back near it (see focusNear).
  const focusPathRef = useRef(null);
  const markDelete = useCallback((label) => {
    deleteLabelRef.current = label;
    const active = document.activeElement;
    focusPathRef.current = active && active !== document.body ? active.closest?.('[data-path]')?.getAttribute('data-path') || null : null;
  }, []);
  // Keeps focus in the form when its holder is gone (a deleted card, the Undo button): on the same place if it is back,
  // else the nearest that exists, else the section heading. Sensible focus is left alone.
  const focusNear = useCallback((pathKey) => {
    window.requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const active = document.activeElement;
      if (active && active !== document.body && (root.contains(active) || active.closest?.('.stFSheet'))) return;
      // a sheet open over the screen comes first: what was deleted was in it
      const nodes = [...document.querySelectorAll('.stFSheet [data-path]'), ...root.querySelectorAll('[data-path]')];
      let key = pathKey || '';
      while (key) {
        const node = nodes.find((item) => item.getAttribute('data-path') === key);
        if (node) {
          const target = node.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
          if (target) {
            target.focus();
            return;
          }
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
    const all = Object.keys(schema.properties).filter((k) => !SKIPPED_SECTIONS.has(k));
    return only ? only.filter((k) => all.includes(k)) : all;
  }, [schema, only]);
  // The screens of "All settings", grouped by task (layout.js). A screen is a whole section or part of one.
  const groups = useMemo(
    () =>
      layoutFor(sectionKeys, (key) => (engine && schema?.properties?.[key] ? Object.keys(engine.flatten(schema.properties[key]).properties || {}) : []))
        // a screen the page leaves out because the same settings are asked for on another page
        .map((g) => (skipViews ? { ...g, views: g.views.filter((v) => !skipViews.includes(v.id)) } : g))
        .filter((g) => g.views.length),
    [sectionKeys, engine, schema, skipViews],
  );
  const allViews = useMemo(() => groups.flatMap((g) => g.views), [groups]);
  // fields asked for on another page (hidden here so nobody is asked twice), as 'a.b.c'. Keyed by content, not by the
  // array, so a page passing a new list each render doesn't redraw the whole form
  const hideKey = (hide || []).map((p) => (Array.isArray(p) ? p.join('.') : String(p))).join('\n');
  const hidden = useMemo(() => new Set(hideKey ? hideKey.split('\n') : []), [hideKey]);
  const view =
    (viewId && viewById(groups, viewId)) ||
    (embedded ? allViews[0] : viewById(groups, groups.find((g) => g.id === FIRST_GROUP)?.views[0]?.id)) ||
    allViews[0] ||
    null;
  const section = view?.key || '';
  const activeGroup = view ? view.group : '';

  // Rebuilt on every change, but only a different list of ids is
  // a different value, so they keep one identity while typing.
  const refOptions = useStableValue(useMemo(() => collectRefOptions(config), [config]));
  const { types: channelTypes } = useChannelTypes();
  const secretNames = useStableValue(
    useMemo(() => [...new Set([...collectSecretNames(config), ...(editor.report?.secrets_required || [])])].sort(), [config, editor.report]),
  );
  const issues = useMemo(() => groupIssues(editor.report), [editor.report]);
  // problems about the whole configuration; on an agent's page the demo's
  // "simple checks" note is left to the problems panel and the DEMO tag
  const general = useMemo(() => issues.filter((issue) => !issue.path && !(embedded && issue.message === DEMO_VALIDATOR_NOTE)), [issues, embedded]);

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
  const countUnder = useCallback(
    (key) => {
      let errors = 0;
      let warnings = 0;
      exact.forEach((list, k) => {
        if (isUnder(k, key))
          list.forEach((issue) => {
            if (issue.severity === 'error') errors += 1;
            else warnings += 1;
          });
      });
      return { errors, warnings };
    },
    [exact],
  );
  const issuesUnder = useCallback(
    (key) => {
      const out = [];
      exact.forEach((list, k) => {
        if (isUnder(k, key)) out.push(...list);
      });
      return out;
    },
    [exact],
  );

  // `target` is a section's name ('tools') or a path (['defaults', 'conversation']): the screen that holds it is shown.
  const goTo = useCallback(
    (target) => {
      const found = viewForPath(groups, Array.isArray(target) ? target : [target]);
      if (found) setViewId(found.id);
      contentRef.current?.scrollIntoView({ block: 'nearest' });
    },
    [groups],
  );

  // Goes to a place in the form: shows its screen, opens what is collapsed around it, then scrolls to, flashes and
  // focuses it. Used by "Show me" on a problem, "Used by" chips and the agent map.
  const reveal = useCallback(
    (path) => {
      if (!Array.isArray(path) || !path.length) return undefined;
      if (sectionKeys.includes(path[0])) goTo(path);
      setFocus({ key: keyOf(path), nonce: Date.now() });
      let timer;
      const attempt = (n) => {
        const root = contentRef.current;
        if (root) {
          // what is inside a sheet (a group deeper in the screen) is found there once the sheet is open
          const nodes = [...document.querySelectorAll('.stFSheet [data-path]'), ...root.querySelectorAll('[data-path]')];
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
    },
    [sectionKeys, goTo],
  );
  // "Show me" or a search result. A request cleared at once (an agent's page clears it as this form appears) still
  // finishes; only a newer one or leaving stops it, and one made before the schema loads waits.
  const revealing = useRef(null);
  const toReveal = useRef(null);
  useEffect(() => {
    if (focusRequest) toReveal.current = focusRequest;
  }, [focusRequest]);
  useEffect(() => {
    const request = toReveal.current;
    if (!request || !schema) return;
    toReveal.current = null;
    revealing.current?.();
    revealing.current = reveal(request.path);
  }, [focusRequest, schema, reveal]);
  useEffect(() => () => revealing.current?.(), []);

  // The ids and keys other parts of the config point at: renaming one rewrites every pointer, deleting one warns first.
  const requestRename = useCallback((collection, id) => setDialog({ type: 'rename', collection, id }), []);
  const requestDelete = useCallback(
    (collection, id, proceed) => {
      const now = configRef.current;
      if (!engine || !isObj(now) || findUsage(engine, now, collection, id).length === 0) {
        proceed();
        return;
      }
      setDialog({ type: 'delete', collection, id, proceed });
    },
    [engine],
  );
  const applyConfig = useCallback((next, message) => {
    editor.setValue(next);
    setToast(message ? { message, previous: configRef.current } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A config that uses a 1.2 feature must say 1.2. The version isn't a
  // field in the form, so the fix is offered where the problem shows.
  const canRaise = !!schema && isObj(config) && (schema.properties?.schema_version?.enum || []).includes('1.2') && config.schema_version !== '1.2';
  const raiseVersion = useCallback(() => applyConfig({ ...configRef.current, schema_version: '1.2' }, 'Raised schema_version to 1.2.'), [applyConfig]);
  // Renames straight away (a key typed in a map): the pointers are rewritten and the toast says how many.
  const renameDirect = useCallback(
    (collection, from, to) => {
      const now = configRef.current;
      const word = COLLECTIONS[collection]?.word || 'item';
      const count = engine && isObj(now) ? findUsage(engine, now, collection, from).length : 0;
      applyConfig(
        renameEverywhere(engine, now, collection, from, to),
        `Renamed ${word} “${from}” to “${to}”${count ? ` and updated ${count} place${count === 1 ? '' : 's'}` : ''}.`,
      );
    },
    [engine, applyConfig],
  );

  const store = storeRef.current;
  const openModels = useStableCallback((stage) => onShowModels?.(stage)); // parents often pass a new function each render; keep the context stable
  const openInJson = useStableCallback((path) => onOpenJson?.(path));
  // A problem, described for a person (plain words, and fixes where
  // one is certain), and a fix applied as an ordinary undoable edit.
  const describe = useCallback((issue) => describeIssue(issue, { config: store.get(), schema, engine }), [store, schema, engine]);
  const applyFix = useCallback(
    (fix) => {
      if (fix.open) {
        openModels(fix.open.stage);
        return;
      }
      if (!fix.apply) return;
      const next = fix.apply(configRef.current);
      if (next === configRef.current) return;
      applyConfig(next, `${fix.label}.`);
      if (fix.jumpTo) reveal(fix.jumpTo);
    },
    [applyConfig, openModels, reveal],
  );
  const expertHome = !!groups.find((g) => g.id === activeGroup)?.advanced;
  const hasOpenJson = !!onOpenJson; // a new function on every Config tab render; keep the context stable
  const ctx = useMemo(
    () => ({
      hidden,
      channelTypes,
      engine,
      store,
      refOptions,
      secretNames,
      exact,
      countUnder,
      issuesUnder,
      focus,
      goTo,
      markDelete,
      readOnly: READ_ONLY,
      requestRename,
      requestDelete,
      renameDirect,
      applyConfig,
      raiseVersion: canRaise ? raiseVersion : null,
      openModels,
      technical,
      expertHome,
      openInJson: hasOpenJson ? openInJson : null,
      showPath: reveal,
      describe,
      applyFix,
    }),
    [
      hidden,
      channelTypes,
      reveal,
      describe,
      applyFix,
      openModels,
      canRaise,
      raiseVersion,
      engine,
      store,
      refOptions,
      secretNames,
      exact,
      countUnder,
      issuesUnder,
      focus,
      goTo,
      markDelete,
      requestRename,
      requestDelete,
      renameDirect,
      applyConfig,
      technical,
      expertHome,
      openInJson,
      hasOpenJson,
    ],
  );

  if (loading && !schema) return <Spinner label="Loading the form" />;
  if (error && !schema) return <ErrorState error={error} onRetry={reload} what="the schema" />;
  if (!schema || !engine) return null;
  if (editor.parsed.error || !isObj(config)) {
    return (
      <Notice
        kind="warn"
        title="The JSON has a syntax error"
        actions={
          <button type="button" className="quietButton" onClick={onShowJson}>
            Open the JSON view
          </button>
        }
      >
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
  const undo = () => {
    if (toast) {
      editor.setValue(toast.previous);
      setToast(null);
      focusNear(toast.focusPath);
    }
  };
  const sectionSchema = schema.properties[section];
  const shape = sectionSchema ? engine.resolveShape(sectionSchema, config[section]) : null;
  const present = section in config;
  // A section the agent doesn't have yet is drawn with its defaults and the first change puts it in the draft, so there
  // is no "Add this section" step. Only a section with no plain shape keeps a button.
  const sectionKind = shape ? engine.kindOf(shape) : null;
  const drawable = present || ['object', 'array', 'map'].includes(sectionKind);
  const sectionValue = present ? config[section] : drawable && sectionSchema ? engine.defaultFor(sectionSchema) : undefined;
  const required = (schema.required || []).includes(section);
  const part = !!view?.only; // a screen that is only part of a section
  const visibleViews = embedded ? allViews : (groups.find((g) => g.id === activeGroup) || groups[0] || { views: [] }).views;
  // A section says what it is for in plain words; the schema's own
  // description is the technical one, shown when technical names are on.
  const lead =
    VIEW_NOTES[section] && !part
      ? VIEW_NOTES[section]
      : part
        ? describeSetting(view.only[0], { owner: section }).purpose
        : SETTINGS[section]?.purpose || shape?.description || '';

  return (
    <FormCtx.Provider value={ctx}>
      <div className={`stForm ${embedded ? 'embedded' : ''}`}>
        {!itemMode && (
          <nav className="stFNav" aria-label="Sections">
            {!embedded && (
              <div className="stFNavGroups" role="tablist">
                {groups.map((group) => {
                  const c = group.views.reduce((sum, v) => sum + countUnder(v.key).errors, 0);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      role="tab"
                      data-group={group.id}
                      aria-selected={group.id === activeGroup}
                      className={`${group.id === activeGroup ? 'on' : ''} ${group.advanced ? 'adv' : ''}`}
                      title={
                        group.advanced
                          ? 'Engine and operator settings: for the voice engine and the people who run it. Most agents never need to change these.'
                          : group.short
                            ? group.label
                            : undefined
                      }
                      aria-label={group.short ? `${group.label}${c > 0 ? `, ${c} error${c === 1 ? '' : 's'}` : ''}` : undefined}
                      onClick={() => {
                        if (group.id !== activeGroup) setViewId(group.views[0].id);
                      }}
                    >
                      {group.short || group.label}
                      {c > 0 && (
                        <b className="stFBadge" title={`${c} error${c === 1 ? '' : 's'}`}>
                          {c}
                        </b>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* a page that holds one screen needs no tab for it */}
            {!(embedded && visibleViews.length < 2) && (
              <div className="stFNavChips">
                {visibleViews.map((v) => {
                  const c = countUnder(v.key);
                  const isSet = v.key in config;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      data-section={v.id}
                      className={`stFChipBtn ${v.id === view?.id ? 'on' : ''} ${isSet ? '' : 'unset'}`}
                      aria-current={v.id === view?.id ? 'true' : undefined}
                      onClick={() => setViewId(v.id)}
                    >
                      {v.label}
                      {c.errors > 0 ? (
                        <b className="stFBadge" title={`${c.errors} error${c.errors === 1 ? '' : 's'}`}>
                          {c.errors}
                        </b>
                      ) : c.warnings > 0 ? (
                        <b className="stFBadge warn" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'}`}>
                          {c.warnings}
                        </b>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </nav>
        )}

        {(exact.get('schema_version') || []).length > 0 && (
          <div className="stFVersion" role="alert">
            {(exact.get('schema_version') || []).map((issue, i) => (
              <p key={i}>{issue.message}</p>
            ))}
            {canRaise && (exact.get('schema_version') || []).some((issue) => /schema_version 1\.2/.test(issue.message)) && (
              <button type="button" className="stAddBtn" onClick={raiseVersion}>
                Use schema version 1.2
              </button>
            )}
          </div>
        )}

        {/* whole-config problems: not in one item's panel (the top bar lists every problem) */}
        {general.length > 0 && !itemMode && (
          <ul
            className={`stFGeneral${general.some((issue) => issue.severity === 'error') ? '' : ' warnOnly'}`}
            aria-label="Problems that apply to the whole config"
          >
            {general.map((issue, i) => (
              <li key={i} className={issue.severity}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {itemMode &&
          (() => {
            const itemSchema = schemaAtPath(engine, schema, itemPath);
            const value = getAtPath(config, itemPath);
            const gone = value === undefined || !itemSchema;
            const remove = () => {
              const proceed = () => {
                editor.setValue(removeAtPath(configRef.current, itemPath));
                onItemGone?.();
              };
              const collection = collectionAt(itemPath);
              if (collection && COLLECTIONS[collection]?.kind === 'list' && isObj(value) && typeof value.id === 'string')
                requestDelete(collection, value.id, proceed);
              else proceed();
            };
            return (
              <div className="stFSection item" ref={contentRef} data-path={keyOf(itemPath)}>
                {/* settings are named by their list ("input" for a check on what the caller says), not its section */}
                <OwnerCtx.Provider value={[...itemPath].reverse().find((p) => typeof p === 'string')}>
                  {gone ? (
                    <ItemGone word={itemWord} onGone={onItemGone} />
                  ) : (
                    (() => {
                      const node = (
                        <Node
                          schema={itemSchema}
                          value={value}
                          path={itemPath}
                          // as a section's commit does: a part taken out (a list's items, settings that do nothing
                          // here) can be put back with Undo
                          onChange={(next) => {
                            const label = deleteLabelRef.current;
                            deleteLabelRef.current = null;
                            const previous = configRef.current;
                            editor.setValue(setAtPath(previous, itemPath, next));
                            setToast(label ? { label, previous, focusPath: null } : null);
                          }}
                        />
                      );
                      return fold ? (
                        <Fold className="stFFold" open={fold.open}>
                          <summary>{fold.label}</summary>
                          {node}
                        </Fold>
                      ) : (
                        node
                      );
                    })()
                  )}
                </OwnerCtx.Provider>
                {!gone && (
                  <div className="stFItemFoot">
                    <button type="button" className="dangerButton" onClick={remove}>
                      Delete this {itemWord}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

        {!itemMode && (
          <div className="stFSection" ref={contentRef} key={view?.id}>
            <header className="stFSectionHead">
              <div>
                <h2 tabIndex={-1}>{view?.label || humanize(section)}</h2>
                {SECTION_NOTES[section] && !part && (
                  <p className="stFSectionNote" role="note">
                    {SECTION_NOTES[section]}
                  </p>
                )}
                {lead && <p className="stFLead">{lead}</p>}
                {technical && !part && shape?.description && (
                  <p className="stFHelp stFMore">{shape.description.length > 260 ? `${shape.description.slice(0, 260)}…` : shape.description}</p>
                )}
              </div>
              {present && !required && !part && (
                // taking the section out leaves an empty list, or a group back on its defaults: the button says which
                <button
                  type="button"
                  className="stFDel"
                  title={sectionKind === 'object' ? 'Take these settings out: the agent uses the defaults again' : 'Take every item of this list out'}
                  onClick={() => {
                    markDelete(`the ${view.label} section`);
                    // what the page asks for elsewhere (hidden here: After the call's cards) stays; only what this form
                    // shows goes back to the defaults
                    const kept = hiddenParts(config[section], section, hidden);
                    commit(section, kept);
                  }}
                >
                  {sectionKind === 'object' ? 'Reset to defaults' : 'Remove all'}
                </button>
              )}
              {present && required && !part && !embedded && (
                <span className="stFTag" title="The agent needs this section, so it can’t be deleted">
                  needed
                </span>
              )}
            </header>
            {drawable ? (
              <div data-path={section}>
                <OwnerCtx.Provider value={section}>
                  {section === 'agents' && !part && (
                    <div className="stFPicture">
                      <AgentMap onOpenAgent={(index) => reveal(['agents', 'items', index])} />
                    </div>
                  )}
                  {section === 'tools' && !part && (
                    <div className="stFPicture">
                      <ToolGrid />
                    </div>
                  )}
                  {part ? (
                    <ObjectBody
                      shape={shape}
                      value={sectionValue}
                      path={[section]}
                      onChange={(v) => commit(section, v)}
                      onlyKeys={view.only}
                      showUnknown={view.id === allViews.filter((x) => x.key === section).slice(-1)[0]?.id}
                    />
                  ) : (
                    <Node schema={sectionSchema} value={sectionValue} path={[section]} onChange={(v) => commit(section, v)} />
                  )}
                </OwnerCtx.Provider>
              </div>
            ) : (
              <div className="stFNotSet">
                <p>This isn’t part of the agent yet.</p>
                <button type="button" className="primaryCta compactCta" onClick={() => commit(section, engine.defaultFor(sectionSchema))}>
                  <Icon name="plus" size={14} /> Add {(part ? humanize(section) : view?.label || humanize(section)).toLowerCase()}
                </button>
              </div>
            )}
          </div>
        )}

        {dialog?.type === 'rename' && (
          <RenameDialog
            engine={engine}
            config={config}
            collection={dialog.collection}
            id={dialog.id}
            takenIds={
              COLLECTIONS[dialog.collection].kind === 'list'
                ? [getAtPath(config, COLLECTIONS[dialog.collection].path)]
                    .flat()
                    .map((item) => item?.id)
                    .filter((x) => typeof x === 'string' && x !== dialog.id)
                : Object.keys(getAtPath(config, COLLECTIONS[dialog.collection].path) || {}).filter((x) => x !== dialog.id)
            }
            onClose={() => setDialog(null)}
            onApply={(name) => renameDirect(dialog.collection, dialog.id, name)}
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
            onDeleteOnly={() => {
              dialog.proceed();
            }}
            onDeleteAll={() => {
              const { config: cleaned, left } = removePointers(engine, config, dialog.collection, dialog.id);
              const word = COLLECTIONS[dialog.collection]?.word || 'item';
              applyConfig(
                deleteItem(cleaned, dialog.collection, dialog.id),
                `Deleted ${word} “${dialog.id}” and the references to it${left.length ? ` (${left.length} in required fields remain)` : ''}.`,
              );
            }}
          />
        )}

        {toast && (
          <div className="stFToast" role="status">
            <span>{toast.message || `Deleted ${toast.label}.`}</span>
            <button type="button" onClick={undo}>
              Undo
            </button>
            <button type="button" className="close" aria-label="Dismiss" onClick={() => setToast(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>
    </FormCtx.Provider>
  );
}
