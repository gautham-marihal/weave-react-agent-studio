import React from 'react';
import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import Menu from '../manage/Menu.tsx';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';
import { formatWhen } from '../format.js';
import { navigate, routeHref } from '../route.js';
import { SAVE_LABEL } from '../../pages/shared.jsx';
import Button from '../../ui/Button.tsx';

// The bar across the top of an agent: name, state, save state and changes since publish on the left; on the right only
// what any page needs (checks, describe, test, save, publish). Everything else is in the "More" menu.
export default function AgentTopBar({
  botId,
  name,
  summary,
  editor,
  manageMenu,
  problems,
  changes,
  live,
  testOpen = false,
  onDescribe,
  onProblems,
  onChanges,
  onTest,
  onShare,
  onPreview,
}) {
  const { dirty, saving, parsed } = editor;
  const canSave = dirty && !saving && !parsed.error && editor.isObject;
  const state = agentState({ deployed: summary?.deployed || {}, tests: 'unknown', problems });
  const go = (tab, params) => navigate(routeHref(botId, tab, params), { guard: false });
  // say nothing about saving until the draft has loaded (not "Saved" while loading, nor broken if it failed)
  const loaded = editor.status === 'ready';
  const saveText = !loaded
    ? editor.status === 'error'
      ? 'Couldn’t load the draft'
      : 'Loading…'
    : parsed.error
      ? 'Fix the JSON to save'
      : dirty
        ? 'Unsaved changes'
        : editor.meta?.savedAt
          ? `Saved ${formatWhen(editor.meta.savedAt)}`
          : 'Saved';
  const more = [
    ...(problems ? [] : [{ label: 'Run the checks', onClick: onProblems }]),
    ...(changes !== null ? [{ label: changes ? `What changed since publishing (${changes})` : 'What changed since publishing', onClick: onChanges }] : []),
    ...(onShare ? [{ label: 'Share…', onClick: onShare }] : []),
    { divider: true },
    { label: 'Publish a new version…', onClick: () => go('versions', { publish: '1' }) },
    { label: 'Deploy a version…', onClick: () => go('deploy') },
    { label: 'Roll back…', onClick: () => go('deploy') },
    { label: 'All versions', onClick: () => go('versions') },
    ...(manageMenu?.length ? [{ divider: true }, ...manageMenu.filter((item, i, all) => !(item.divider && (i === 0 || i === all.length - 1)))] : []),
  ];
  return (
    <header className="nlBar">
      <div className="nlBarId">
        <h1 title={name}>{name}</h1>
        <StatePill state={state} />
        <span className={`nlSaveState ${dirty || parsed.error || editor.status === 'error' ? 'warn' : ''}`} role="status">
          {loaded && !dirty && !parsed.error && <Icon name="check" size={13} />}
          {saveText}
        </span>
        {changes > 0 && !dirty && (
          <Tip label="What this draft changes compared with the published version">
            <button type="button" className="nlChanges" onClick={onChanges}>
              {changes} change{changes === 1 ? '' : 's'} not published
            </button>
          </Tip>
        )}
      </div>
      <div className="nlBarActions">
        {problems > 0 && (
          <Tip label="What the checks found in the draft">
            <button type="button" className="nlProblems" onClick={onProblems}>
              <Icon name="alert" size={14} />
              {problems} problem{problems === 1 ? '' : 's'}
            </button>
          </Tip>
        )}
        <Tip label="Tell the assistant what you need in plain English">
          <Button type="button" className="nlBtn" onClick={onDescribe}>
            <Icon name="sparkle" size={16} />
            Describe
          </Button>
        </Tip>
        <Tip label={testOpen ? 'Close the test panel' : live ? 'A test conversation is running' : 'Talk to the agent while you edit it'}>
          <Button type="button" className={`nlBtn ${testOpen ? 'on' : ''}`} aria-pressed={testOpen} onClick={onTest}>
            <Icon name="test" size={16} />
            Test{live ? <i className="nlLive" aria-label="A test conversation is running" /> : null}
          </Button>
        </Tip>
        {onPreview && (
          <Tip label="See the exact instructions the model is given, as the runtime puts them together">
            <Button type="button" className="nlBtn" onClick={onPreview}>
              <Icon name="eye" size={16} />
              Preview prompt
            </Button>
          </Tip>
        )}
        {canSave || saving ? (
          // a disabled button gets no pointer events, so it keeps the browser's own tip
          <Tip label={`Save the draft (${SAVE_LABEL})`}>
            <Button
              type="button"
              variant="primary"
              size="compact"
              onClick={() => editor.save()}
              disabled={!canSave}
              title={!canSave ? `Save the draft (${SAVE_LABEL})` : undefined}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Tip>
        ) : null}
        <Tip label={dirty ? 'Save first: a version is made from the saved draft' : 'Freeze the draft as a version you can put live'}>
          <button
            type="button"
            className={dirty ? 'quietButton nlBtn' : 'primaryCta compactCta'}
            onClick={() => go('versions', { publish: '1' })}
            disabled={editor.status !== 'ready'}
            title={
              editor.status !== 'ready'
                ? dirty
                  ? 'Save first: a version is made from the saved draft'
                  : 'Freeze the draft as a version you can put live'
                : undefined
            }
          >
            Publish
          </button>
        </Tip>
        <Menu label="More" items={more} className="nlBarMenu" />
      </div>
    </header>
  );
}
