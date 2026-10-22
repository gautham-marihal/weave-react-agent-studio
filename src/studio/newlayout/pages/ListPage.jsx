import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Spinner } from '../../ui.jsx';
import { createEngine } from '../../form/engine.js';
import AddPicker from '../../form/AddPicker.jsx';
import { summarize } from '../../form/cardLogic.js';
import { agentsUsingTool, kindOfTool, unusedTools } from '../../form/toolInfo.js';
import { pickerFor, WHAT } from '../../form/pickerOptions.js';
import { plainToolKind } from '../../form/plainKinds.js';
import { uniqueId } from '../../form/ctx.js';
import { useSchema } from '../../form/useSchema.js';
import { useChannelTypes } from '../../form/useChannelTypes.js';
import { groupIssues } from '../../../api/client.js';
import PageShell, { EmptyState, Section, SettingRow } from '../PageShell.jsx';
import { StagedDrawer } from '../Drawer.jsx';
import { getAtPath, schemaAtPath, setAtPath } from '../schemaPath.js';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));
const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sizeOf = (v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);

// The picture beside a row: what kind of thing it is.
function iconFor(kind, item) {
  if (kind === 'tools') {
    const k = kindOfTool(item);
    if (item?.builtin === 'end_call') return 'endCall';
    if (item?.builtin === 'transfer_or_callback') return 'phoneTransfer';
    if (k === 'http') return 'plug';
    if (k === 'knowledge') return 'records';
    return 'tools';
  }
  if (kind === 'channels') return ['sip_voice', 'web_voice'].includes(item?.type) ? 'phone' : 'quote';
  return 'shield';
}

// A page that lists the things of one kind the agent has (its tools, its channels, its checks on what is said), one row each, with one place to add another.
// A row, and the adding, open a panel with just that item's settings, which works on a copy until Done. The rest of what belongs on the page (connections,
// forms, transfers...) is a row too, opening the settings form for just that section.
//   lists:  [{ id, path, kind, word, title?, lead?, pickerKey, empty }]
//   extras: [{ key, title, value (a sentence), icon }]
export default function ListPage({
  title,
  lead,
  editor,
  lists,
  extras = [],
  extrasTitle = 'More settings',
  footer = null,
  notice = null,
  onShowJson,
  onOpenJson,
  openRequest = null,
}) {
  const config = editor.parsed.value;
  const { schema } = useSchema();
  const { types: channelTypes } = useChannelTypes();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const [panel, setPanel] = useState(null); // { list, index, made?, extra? }
  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path), [editor.report]);
  const unusedSet = useMemo(() => new Set(unusedTools(config)), [config]);

  // "show me" on a problem opens the item or the section that holds it
  React.useEffect(() => {
    const path = openRequest?.path;
    if (!path) return;
    const found = lists.find((l) => l.path.every((p, i) => path[i] === p));
    if (found && typeof path[found.path.length] === 'number') setPanel({ list: found, index: path[found.path.length] });
    else {
      const extra = extras.find((e) => e.key === path[0]);
      if (extra) setPanel({ extra });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const problemsIn = (path) => issues.filter((i) => path.every((p, n) => i.path[n] === p)).length;

  const pickerOf = (l) => {
    if (!engine) return null;
    const listSchema = schemaAtPath(engine, schema, l.path);
    const shape = listSchema ? engine.resolveShape(listSchema, getAtPath(config, l.path)) : null;
    const rawItems = shape?.items || null;
    const items = rawItems ? engine.flatten(rawItems) : null;
    const isUnion = !!items && engine.kindOf(items) === 'union';
    const takenIds = list(getAtPath(config, l.path))
      .filter(isObj)
      .map((x) => x.id)
      .filter((id) => typeof id === 'string');
    return (
      pickerFor(l.pickerKey, { engine, branches: isUnion ? engine.branchesOf(items) : null, takenIds, botId: config?.meta?.id || '', channelTypes }) ||
      (rawItems
        ? [
            {
              id: 'plain',
              group: 'Add',
              label: `A new ${l.word}`,
              help: '',
              make: () => {
                const made = engine.defaultFor(rawItems);
                if (isObj(made) && 'id' in made && !made.id) made.id = uniqueId(takenIds, l.word.replace(/\s+/g, '_'));
                return made;
              },
            },
          ]
        : null)
    );
  };

  const renderPanel = () => {
    if (!panel) return null;
    if (panel.extra) {
      const e = panel.extra;
      return (
        <StagedDrawer key={e.key} editor={editor} title={e.title} icon={e.icon} width="wide" onClose={() => setPanel(null)}>
          {(c, s, staged) => (
            <Suspense fallback={<Spinner label="Loading the settings" />}>
              <FormEditor editor={staged} only={[e.key]} embedded onShowJson={onShowJson} onOpenJson={onOpenJson} />
            </Suspense>
          )}
        </StagedDrawer>
      );
    }
    const { list: l, index, made } = panel;
    const itemPath = [...l.path, index];
    const initial = made ? (c) => setAtPath(c, l.path, [...list(getAtPath(c, l.path)), made]) : undefined;
    const item = made || list(getAtPath(config, l.path))[index];
    const name = isObj(item) ? summarize(item, index).title : `${l.word}`;
    return (
      <StagedDrawer
        key={`${l.id}-${index}-${made ? 'new' : 'old'}`}
        editor={editor}
        title={made ? `New ${l.word}` : `${l.word[0].toUpperCase()}${l.word.slice(1)} “${name}”`}
        icon={iconFor(l.kind, item)}
        width="wide"
        initial={initial}
        onClose={() => setPanel(null)}
      >
        {(c, s, staged, { done }) => (
          <Suspense fallback={<Spinner label="Loading the settings" />}>
            <FormEditor editor={staged} itemPath={itemPath} itemWord={l.word} onItemGone={done} onShowJson={onShowJson} onOpenJson={onOpenJson} />
          </Suspense>
        )}
      </StagedDrawer>
    );
  };

  const addAction =
    lists.length === 1
      ? (() => {
          const l = lists[0];
          const opts = pickerOf(l);
          return opts ? (
            <AddPicker
              what={WHAT[l.pickerKey] || `a ${l.word}`}
              options={opts}
              onPick={(option, made) => setPanel({ list: l, index: list(getAtPath(config, l.path)).length, made })}
              className="nlAddPicker"
            />
          ) : null;
        })()
      : null;

  return (
    <PageShell title={title} lead={lead} actions={addAction}>
      {notice}
      {lists.map((l) => {
        const items = list(getAtPath(config, l.path));
        const opts = lists.length > 1 ? pickerOf(l) : null;
        return (
          <Section
            key={l.id}
            title={l.title || null}
            lead={l.lead}
            action={
              opts ? (
                // one of several lists on the page: a quieter button, its heading says what it adds
                <AddPicker
                  what={WHAT[l.pickerKey] || `a ${l.word}`}
                  label={`Add a ${l.word}`}
                  options={opts}
                  onPick={(option, made) => setPanel({ list: l, index: items.length, made })}
                  className="nlAddPicker quiet"
                />
              ) : null
            }
          >
            {items.length === 0 ? (
              <EmptyState icon={iconFor(l.kind, null)} title={l.empty.title} text={l.empty.text} />
            ) : (
              <div className="nlRows">
                {items.map((item, index) => {
                  const { title: t, hint } = summarize(item, index);
                  const used = l.kind === 'tools' && isObj(item) && item.id ? agentsUsingTool(config, item.id) : null;
                  const problems = problemsIn([...l.path, index]);
                  const kindWord = l.kind === 'tools' && isObj(item) ? plainToolKind(item) : '';
                  const status = problems
                    ? { tone: 'bad', text: `${problems} to fix` }
                    : l.kind === 'tools' && isObj(item) && unusedSet.has(item.id)
                      ? { tone: '', text: 'Not used' }
                      : l.kind === 'channels' && isObj(item) && item.enabled === false
                        ? { tone: '', text: 'Off' }
                        : null;
                  const sub = [kindWord, hint && hint !== kindWord ? hint : '', used && used.length ? `used by ${used.join(', ')}` : '']
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <SettingRow
                      key={index}
                      icon={iconFor(l.kind, item)}
                      title={t}
                      value={sub}
                      hint=""
                      status={status}
                      onOpen={() => setPanel({ list: l, index })}
                    />
                  );
                })}
              </div>
            )}
          </Section>
        );
      })}
      {extras.length > 0 && (
        <Section title={extrasTitle}>
          <div className="nlRows">
            {extras.map((e) => {
              const n = sizeOf(config?.[e.key]);
              const problems = problemsIn([e.key]);
              return (
                <SettingRow
                  key={e.key}
                  icon={e.icon}
                  title={e.title}
                  value={e.value(config, n)}
                  status={problems ? { tone: 'bad', text: `${problems} to fix` } : null}
                  onOpen={() => setPanel({ extra: e })}
                />
              );
            })}
          </div>
        </Section>
      )}
      {footer}
      {renderPanel()}
    </PageShell>
  );
}
