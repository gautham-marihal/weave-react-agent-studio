import React from 'react';
import Icon from '../../ui/Icon.jsx';
import Menu from '../manage/Menu.jsx';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';
import { formatWhen } from '../format.js';
import { navigate, routeHref } from '../route.js';
import { SAVE_LABEL } from '../../pages/shared.jsx';

// The one bar across the top of an agent. On the left: which agent, where it stands, whether the draft is saved and how far it has moved from what is
// published. On the right, only what is reached for from any page: what the checks found (when they found something), describing a change in words, trying it,
// saving (when there is something to save) and publishing; everything else is in the "More" menu.
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
}) {
  const { dirty, saving, parsed } = editor;
  const canSave = dirty && !saving && !parsed.error && editor.isObject;
  const state = agentState({ deployed: summary?.deployed || {}, tests: 'unknown', problems });
  const go = (tab, params) => navigate(routeHref(botId, tab, params), { guard: false });
  const saveText = parsed.error
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
        <span className={`nlSaveState ${dirty || parsed.error ? 'warn' : ''}`} role="status">
          {!dirty && !parsed.error && <Icon name="check" size={13} />}
          {saveText}
        </span>
        {changes > 0 && !dirty && (
          <button type="button" className="nlChanges" onClick={onChanges} title="What this draft changes compared with the published version">
            {changes} change{changes === 1 ? '' : 's'} not published
          </button>
        )}
      </div>
      <div className="nlBarActions">
        {problems > 0 && (
          <button type="button" className="nlProblems" onClick={onProblems} title="What the checks found in the draft">
            <Icon name="alert" size={14} />
            {problems} problem{problems === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" className="quietButton nlBtn" onClick={onDescribe} title="Tell the assistant what you need in plain English">
          <Icon name="sparkle" size={16} />
          Describe
        </button>
        <button
          type="button"
          className={`quietButton nlBtn ${testOpen ? 'on' : ''}`}
          aria-pressed={testOpen}
          onClick={onTest}
          title={testOpen ? 'Close the test panel' : 'Talk to the agent while you edit it'}
        >
          <Icon name="test" size={16} />
          Test{live ? <i className="nlLive" title="A test conversation is running" /> : null}
        </button>
        {canSave || saving ? (
          <button type="button" className="primaryCta compactCta" onClick={() => editor.save()} disabled={!canSave} title={`Save the draft (${SAVE_LABEL})`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : null}
        <button
          type="button"
          className={dirty ? 'quietButton nlBtn' : 'primaryCta compactCta'}
          onClick={() => go('versions', { publish: '1' })}
          disabled={editor.status !== 'ready'}
          title={dirty ? 'Save first: a version is made from the saved draft' : 'Freeze the draft as a version you can put live'}
        >
          Publish
        </button>
        <Menu label="More" items={more} className="nlBarMenu" />
      </div>
    </header>
  );
}
