import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon, PlusIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import type { AgentConfig, Path } from '../../../../types/studio';
import { useStudio } from '../../../../contexts/StudioContext';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { useSchema } from '../../../../hooks/useSchema';
import { useSettingFocus } from '../../../../hooks/useSettingFocus';
import { collectRefOptions, collectSecretNames, humanize, isObj, type Json } from '../../../../models/schemaForm/engine';
import { FIRST_GROUP, SKIPPED_SECTIONS, VIEW_NOTES, layoutFor, viewById, viewForPath, type FormGroup, type FormView } from '../../../../models/schemaForm/layout';
import { SETTINGS, describeSetting } from '../../../../models/schemaForm/plainLanguage';
import { COLLECTIONS, deleteItem, findUsage, removePointers, renameEverywhere } from '../../../../models/schemaForm/references';
import { hiddenParts } from '../../../../models/schemaForm/hiddenParts';
import { isUnder, keyOf } from '../../../../models/schemaForm/paths';
import { describeIssue, type IssueFix } from '../../../../models/validationIssues';
import { flashField } from '../../../../utils/flashField';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/styles';
import { FormContext, OwnerContext, type FormContextValue, type FormIssue } from './formContext';
import { Node, ObjectBody } from './FormNode';
import { DeleteDialog, RenameDialog } from './IdTools';

// Set by the server: the id is permanent and the rest change when a version is published.
const READ_ONLY = new Set(['meta.id', 'meta.status', 'meta.created_at', 'meta.updated_at']);

// What a section is for, where the work on it is better done on another page.
const SECTION_NOTES: Record<string, string> = {
  tests: 'Scenarios are conversations with what must be true afterwards. Test › Scenarios writes and runs them; this is the same list in its raw fields.',
  telephony: 'Transfers set here are used by tools. Phone numbers are added in Library › Phone numbers, where the platform checks that a number is free.',
  wrapups: 'Said when a task is done and the caller goes quiet. A closing message does nothing until a tool starts it.',
};

export interface SchemaFormProps {
  editor: DraftEditor;
  /** Only these top-level sections (a Build section's own part). Every section when left out. */
  sections?: string[] | null;
  /** On a Build section's page: no group menu, one row of screens. */
  embedded?: boolean;
  /** Settings asked elsewhere on the page ('a.b.c'), left out here. */
  hide?: string[];
  /** The screen to open first: a screen id ('defaults.models') or a section key. */
  initialView?: string | null;
  /** Opens the JSON view at a place (Technical names › In JSON). */
  onOpenJson?: (path: Path) => void;
}

interface Toast {
  message: string;
  /** The draft just after the change: the toast goes when anything else changes it. */
  after: unknown;
}

/**
 * The whole configuration as a form drawn from GET /schema, grouped by what each part is for. Every change goes through
 * the draft editor, so undo and redo, the unsaved state and "someone else saved" keep working.
 */
export function SchemaForm({ editor, sections, embedded = false, hide, initialView, onOpenJson }: SchemaFormProps) {
  const { schema, engine, error, loading, reload } = useSchema();
  const config = editor.config as Json | null;
  const agentId = editor.agent?.id ?? '';
  const configRef = useRef(config);
  configRef.current = config;
  const contentRef = useRef<HTMLDivElement>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dialog, setDialog] = useState<{ type: 'rename' | 'delete'; collection: string; id: string; proceed?: () => void } | null>(null);
  const deleteLabel = useRef<string | null>(null);
  const { technicalNames: technical } = useStudio();

  // ---- the screens ----
  const sectionKeys = useMemo(() => {
    if (!schema?.properties) return [];
    const all = Object.keys(schema.properties).filter((k) => !SKIPPED_SECTIONS.has(k));
    return sections ? sections.filter((k) => all.includes(k)) : all;
  }, [schema, sections]);
  const groups: FormGroup[] = useMemo(
    () => (engine && schema?.properties ? layoutFor(sectionKeys, (key) => Object.keys(engine.flatten(schema.properties?.[key]).properties || {})) : []),
    [sectionKeys, engine, schema],
  );
  // on a Build section, its screens come in the order the section names its parts (Channels first on Channels)
  const allViews = useMemo(() => {
    const views = groups.flatMap((g) => g.views);
    if (!sections) return views;
    const rank = (key: string) => (sections.includes(key) ? sections.indexOf(key) : sections.length);
    return views.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v.key) - rank(b.v.key) || a.i - b.i).map(({ v }) => v);
  }, [groups, sections]);
  const startView = initialView ? viewById(groups, initialView) || viewForPath(groups, [initialView]) : null;
  const view: FormView | null =
    viewById(groups, viewId) || startView || (embedded ? allViews[0] : viewById(groups, groups.find((g) => g.id === FIRST_GROUP)?.views[0]?.id)) || allViews[0] || null;
  const hidden = useMemo(() => new Set(hide ?? []), [hide]);

  // ---- problems by place ----
  const report = editor.validation;
  const issues: FormIssue[] = useMemo(
    () => [
      ...(report?.errors ?? []).map((i) => ({ ...i, severity: 'error' as const })),
      ...(report?.warnings ?? []).map((i) => ({ ...i, severity: 'warning' as const })),
    ],
    [report],
  );
  const exact = useMemo(() => {
    const map = new Map<string, FormIssue[]>();
    issues.forEach((issue) => {
      if (!issue.path) return;
      const k = keyOf(issue.path);
      map.set(k, [...(map.get(k) ?? []), issue]);
    });
    return map;
  }, [issues]);
  const countUnder = useCallback(
    (key: string) => {
      let errors = 0;
      let warnings = 0;
      exact.forEach((list, k) => {
        if (isUnder(k, key)) list.forEach((i) => (i.severity === 'error' ? (errors += 1) : (warnings += 1)));
      });
      return { errors, warnings };
    },
    [exact],
  );
  const issuesUnder = useCallback(
    (key: string) => {
      const out: FormIssue[] = [];
      exact.forEach((list, k) => {
        if (isUnder(k, key)) out.push(...list);
      });
      return out;
    },
    [exact],
  );

  // ---- going to a place ----
  const goTo = useCallback(
    (target: Path) => {
      const found = viewForPath(groups, target);
      if (found) setViewId(found.id);
    },
    [groups],
  );
  const reveal = useCallback(
    (path: Path) => {
      if (!path.length) return;
      goTo(path);
      setFocus({ key: keyOf(path), nonce: Date.now() });
      // the groups around it open on the next render; then the nearest drawn place is flashed
      let tries = 0;
      const attempt = () => {
        const root = contentRef.current;
        if (root) {
          for (let i = path.length; i >= 1; i -= 1) {
            const el = root.querySelector<HTMLElement>(`[data-path="${CSS.escape(keyOf(path.slice(0, i)))}"]`);
            if (el) {
              flashField(el);
              return;
            }
          }
        }
        tries += 1;
        if (tries < 6) window.setTimeout(attempt, 100);
      };
      window.setTimeout(attempt, 80);
    },
    [goTo],
  );
  // a deep link, the search or "Show me": shown here when it is one of this form's sections (a request made before the
  // schema arrived waits for it)
  const waiting = useRef<Path | null>(null);
  useSettingFocus(agentId, (path) => {
    const top = String(path[0] ?? '');
    if (sections && !sections.includes(top)) return false;
    if (!engine || !groups.length) {
      waiting.current = path;
      return true;
    }
    reveal(path);
    return true;
  });
  useEffect(() => {
    if (waiting.current && groups.length) {
      const path = waiting.current;
      waiting.current = null;
      reveal(path);
    }
  }, [groups, reveal]);

  // ---- changing the draft ----
  const showToast = useCallback((message: string) => setToast({ message, after: null }), []);
  useEffect(() => {
    setToast((t) => (!t ? t : t.after === null ? { ...t, after: config } : t.after === config ? t : null));
  }, [config]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 9000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const markDelete = useCallback((label: string) => {
    deleteLabel.current = label;
  }, []);
  const applyConfig = useCallback(
    (next: Json, message: string) => {
      editor.replaceConfig(next as unknown as AgentConfig);
      showToast(message);
    },
    [editor, showToast],
  );
  const renameDirect = useCallback(
    (collection: string, from: string, to: string) => {
      const now = configRef.current;
      if (!engine || !now) return;
      const word = COLLECTIONS[collection]?.word || 'item';
      const count = findUsage(engine, now, collection, from).length;
      applyConfig(renameEverywhere(engine, now, collection, from, to), `Renamed ${word} “${from}” to “${to}”${count ? ` and updated ${count} place${count === 1 ? '' : 's'}` : ''}.`);
    },
    [engine, applyConfig],
  );
  const requestRename = useCallback((collection: string, id: string) => setDialog({ type: 'rename', collection, id }), []);
  const requestDelete = useCallback(
    (collection: string, id: string, proceed: () => void) => {
      const now = configRef.current;
      if (!engine || !now || findUsage(engine, now, collection, id).length === 0) {
        proceed();
        return;
      }
      setDialog({ type: 'delete', collection, id, proceed });
    },
    [engine],
  );
  const describe = useCallback((issue: FormIssue) => describeIssue(issue, { config: configRef.current, schema, engine }), [schema, engine]);
  const applyFix = useCallback(
    (fix: IssueFix) => {
      if (fix.open) {
        reveal(fix.open);
        return;
      }
      const now = configRef.current;
      if (!fix.apply || !now) return;
      const next = fix.apply(now);
      if (next === now) return;
      applyConfig(next, `${fix.label}.`);
      if (fix.jumpTo) reveal(fix.jumpTo);
    },
    [applyConfig, reveal],
  );
  const commit = (section: string, value: unknown) => {
    const label = deleteLabel.current;
    deleteLabel.current = null;
    editor.update([section], value);
    if (label) showToast(`Deleted ${label}.`);
  };

  const refOptions = useMemo(() => collectRefOptions(config), [config]);
  const secretNames = useMemo(() => [...new Set([...collectSecretNames(config), ...(report?.secrets_required ?? [])])].sort(), [config, report]);
  const expertHome = !!groups.find((g) => g.id === view?.group)?.advanced;
  const ctx: FormContextValue | null = useMemo(
    () =>
      engine && schema && config
        ? {
            engine,
            schema,
            config,
            refOptions,
            secretNames,
            exact,
            countUnder,
            issuesUnder,
            describe,
            applyFix,
            technical,
            readOnly: READ_ONLY,
            hidden,
            focus,
            goTo,
            reveal,
            markDelete,
            requestRename,
            requestDelete,
            renameDirect,
            applyConfig,
            openInJson: onOpenJson ?? null,
            disabled: !editor.canEdit,
            expertHome,
          }
        : null,
    [engine, schema, config, refOptions, secretNames, exact, countUnder, issuesUnder, describe, applyFix, technical, hidden, focus, goTo, reveal, markDelete, requestRename, requestDelete, renameDirect, applyConfig, onOpenJson, editor.canEdit, expertHome],
  );

  if (loading && !schema)
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted" aria-live="polite">
        <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
        Loading the settings…
      </p>
    );
  if (error && !schema)
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft/40 p-4">
        <p className="text-sm font-medium text-ink">The list of settings could not be loaded from the server.</p>
        <p className="mt-1 text-[13px] text-muted">{error}</p>
        <Button size="sm" className="mt-3" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  if (!ctx || !config || !schema || !engine || !view) return null;

  const section = view.key;
  const sectionSchema = schema.properties?.[section];
  const shape = sectionSchema ? engine.resolveShape(sectionSchema, config[section]) : null;
  const present = section in config;
  // a section the agent doesn't have yet is drawn with its defaults; the first change puts it in the draft
  const sectionKind = shape ? engine.kindOf(shape) : null;
  const drawable = present || (sectionKind !== null && ['object', 'array', 'map'].includes(sectionKind));
  const sectionValue = present ? config[section] : drawable && sectionSchema ? engine.defaultFor(sectionSchema) : undefined;
  const required = (schema.required ?? []).includes(section);
  const part = !!view.only;
  const lead = VIEW_NOTES[section] && !part ? VIEW_NOTES[section] : part ? describeSetting(view.only?.[0], { owner: section }).purpose : SETTINGS[section]?.purpose || shape?.description || '';
  const activeGroup = groups.find((g) => g.id === view.group);
  const screens = embedded ? allViews : activeGroup?.views ?? [];

  const screenButton = (v: FormView) => {
    const c = countUnder(v.key);
    const on = v.id === view.id;
    return (
      <button
        key={v.id}
        type="button"
        data-screen={v.id}
        aria-current={on ? 'true' : undefined}
        onClick={() => setViewId(v.id)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          on ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink',
          !(v.key in config) && !on && 'text-muted',
        )}>
        {v.label}
        {c.errors > 0 ? <span className="rounded-full bg-danger-soft px-1.5 text-xs text-danger">{c.errors}</span> : c.warnings > 0 ? <span className="rounded-full bg-warning-soft px-1.5 text-xs text-warning">{c.warnings}</span> : null}
      </button>
    );
  };

  return (
    <FormContext.Provider value={ctx}>
      <div className="space-y-4" data-settings-form>
        {!embedded && (
          <nav aria-label="Setting groups">
            <ul className="flex flex-wrap gap-1.5">
              {groups.map((g) => {
                const errors = g.views.reduce((n, v) => n + countUnder(v.key).errors, 0);
                const on = g.id === view.group;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      data-group={g.id}
                      aria-current={on ? 'true' : undefined}
                      onClick={() => !on && setViewId(g.views[0].id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-3 py-1 text-left text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-soft hover:bg-subtle hover:text-ink',
                      )}>
                      <span>
                        {g.label}
                        {g.advanced && <span className="ml-1.5 rounded bg-subtle px-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Expert</span>}
                      </span>
                      {errors > 0 && <span className="rounded-full bg-danger-soft px-1.5 text-xs text-danger">{errors}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <div className="min-w-0" ref={contentRef}>
          {screens.length > 1 && (
            <div role="group" aria-label="Screens" className="mb-4 flex flex-wrap gap-1 border-b border-line pb-3">
              {screens.map(screenButton)}
            </div>
          )}

          <section aria-labelledby={`screen-${view.id}`} data-screen-id={view.id}>
            <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`screen-${view.id}`} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
                  {view.label}
                </h3>
                {SECTION_NOTES[section] && !part && <p className="mt-1 rounded-md bg-info-soft/60 px-2.5 py-1.5 text-[13px] text-ink-soft">{SECTION_NOTES[section]}</p>}
                {lead && <p className="mt-0.5 text-[13px] text-muted">{lead}</p>}
              </div>
              {present && !required && !part && editor.canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  title={sectionKind === 'object' ? 'Take these settings out: the agent uses the defaults again' : 'Take every item of this list out'}
                  onClick={() => {
                    markDelete(`the ${view.label} settings`);
                    commit(section, hiddenParts(config[section], section, hidden));
                  }}>
                  <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
                  {sectionKind === 'object' ? 'Reset to defaults' : 'Remove all'}
                </Button>
              )}
            </header>
            {drawable ? (
              <div data-path={section} id={`field-${section}`} className="rounded-xl border border-line bg-surface px-4 py-1">
                <OwnerContext.Provider value={section}>
                  {part && shape ? (
                    <ObjectBody
                      shape={shape}
                      value={sectionValue}
                      path={[section]}
                      onChange={(v) => commit(section, v)}
                      disabled={!editor.canEdit}
                      onlyKeys={view.only}
                      showUnknown={view.id === allViews.filter((x) => x.key === section).slice(-1)[0]?.id}
                    />
                  ) : (
                    <div className="py-3">
                      <Node schema={sectionSchema} value={sectionValue} path={[section]} onChange={(v) => commit(section, v)} disabled={!editor.canEdit} />
                    </div>
                  )}
                </OwnerContext.Provider>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong p-6 text-center">
                <p className="text-sm text-muted">This isn’t part of the agent yet.</p>
                {editor.canEdit && (
                  <Button size="sm" className="mt-3" onClick={() => commit(section, engine.defaultFor(sectionSchema))}>
                    <PlusIcon className="h-3.5 w-3.5" aria-hidden />
                    Add {(view.label || humanize(section)).toLowerCase()}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {dialog?.type === 'rename' && (
        <RenameDialog
          engine={engine}
          config={config}
          collection={dialog.collection}
          id={dialog.id}
          takenIds={takenIdsOf(config, dialog.collection).filter((x) => x !== dialog.id)}
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
          onDeleteOnly={() => dialog.proceed?.()}
          onDeleteAll={() => {
            const { config: cleaned, left } = removePointers(engine, config, dialog.collection, dialog.id);
            const word = COLLECTIONS[dialog.collection]?.word || 'item';
            applyConfig(
              deleteItem(cleaned, dialog.collection, dialog.id),
              `Deleted ${word} “${dialog.id}” and the references to it${left.length ? ` (${left.length} in required settings stay)` : ''}.`,
            );
          }}
        />
      )}

      {toast && (
        <div role="status" className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] text-ink shadow-overlay">
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => {
              editor.undo();
              setToast(null);
            }}
            className="rounded px-1.5 py-0.5 font-semibold text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Undo
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="rounded p-0.5 text-muted hover:text-ink">
            <XIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </FormContext.Provider>
  );
}

/** The ids already used in a collection, so a rename can't take one. */
function takenIdsOf(config: Json, collection: string): string[] {
  const info = COLLECTIONS[collection];
  if (!info) return [];
  const holder = info.path.reduce<unknown>((node, key) => (isObj(node) ? node[key] : undefined), config);
  if (info.kind === 'list') return Array.isArray(holder) ? holder.map((item) => (isObj(item) ? item.id : undefined)).filter((id): id is string => typeof id === 'string') : [];
  return isObj(holder) ? Object.keys(holder) : [];
}
