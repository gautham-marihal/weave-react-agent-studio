import React from 'react';
import Icon from '../../ui/Icon.jsx';
import Menu from '../manage/Menu.jsx';
import StatePill from '../StatePill.jsx';
import { agentState } from '../status.js';
import { formatWhen } from '../format.js';
import { navigate, routeHref } from '../route.js';

// The one bar across the top of an agent: who it is and where it stands on the left, and on the right the things you reach for from any page: describe it to
// the assistant, see what is wrong, see what you changed, try it, save, publish.
export default function AgentTopBar({ botId, name, summary, editor, manageMenu, problems, changes, live, onDescribe, onProblems, onChanges, onTest, onShare }) {
  const { dirty, saving, parsed } = editor;
  const canSave = dirty && !saving && !parsed.error && editor.isObject;
  const state = agentState({ deployed: summary?.deployed || {}, tests: 'unknown', problems });
  const go = (tab, params) => navigate(routeHref(botId, tab, params), { guard: false });
  const releaseItems = [
    { label: 'Publish a new version…', onClick: () => go('versions', { publish: '1' }) },
    { label: 'Deploy a version…', onClick: () => go('deploy') },
    { label: 'Roll back…', onClick: () => go('deploy') },
    { divider: true },
    { label: 'See all versions', onClick: () => go('versions') },
  ];
  return (
    <header className="nlBar">
      <div className="nlBarId">
        <span className="agentRowAvatar" aria-hidden="true">
          {String(name || botId)
            .slice(0, 1)
            .toUpperCase()}
        </span>
        <h1 title={name}>{name}</h1>
        <StatePill state={state} />
        <Menu label="Agent actions" items={manageMenu} className="nlBarMenu" />
        <span className={`nlSaveState ${dirty ? 'warn' : ''}`} role="status">
          {parsed.error ? 'Fix the JSON to save' : dirty ? 'Unsaved changes' : editor.meta?.savedAt ? `Saved ${formatWhen(editor.meta.savedAt)}` : 'Saved'}
        </span>
      </div>
      <div className="nlBarActions">
        <button type="button" className="quietButton nlBtn" onClick={onDescribe} title="Tell the assistant what you need in plain English">
          <Icon name="sparkle" size={16} />
          Describe
        </button>
        <button type="button" className={`quietButton nlBtn ${problems ? 'bad' : ''}`} onClick={onProblems} title="What the checks found in the draft">
          {problems ? `Problems (${problems})` : 'Checks'}
        </button>
        {changes !== null && (
          <button type="button" className="quietButton nlBtn" onClick={onChanges} title="What this draft changes compared with the published version">
            {changes ? `Changes (${changes})` : 'Changes'}
          </button>
        )}
        {onShare && (
          <button type="button" className="quietButton nlBtn" onClick={onShare} title="Choose who can open this agent">
            <Icon name="team" size={16} />
            Share
          </button>
        )}
        <button type="button" className="quietButton nlBtn" onClick={onTest} title="Talk to the agent while you edit it">
          <Icon name="test" size={16} />
          Test{live ? <i className="nlLive" title="A test conversation is running" /> : null}
        </button>
        <button type="button" className="quietButton nlBtn" onClick={() => editor.save()} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className="primaryCta compactCta" onClick={() => go('versions', { publish: '1' })} disabled={editor.status !== 'ready'}>
          Publish
        </button>
        <Menu label="Release actions" items={releaseItems} className="nlBarMenu" />
      </div>
    </header>
  );
}
