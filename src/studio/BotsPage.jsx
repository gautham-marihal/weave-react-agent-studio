import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { assignBot, refreshBots, restoreBot, useBots, useWorkspaces } from './agents.js';
import { queueChange } from './pendingChange.js';
import AssistantPanel from './AssistantPanel.jsx';
import './preview/preview.css';
import { rememberNotes } from './assistantNotes.js';
import { generateDraft } from '../demo/draftAssistant.js';
import { setGreeting, setRole } from './simple/simpleModel.js';
import { applyStarter, STARTERS } from './starters.js';
import { botIdProblem, compareVersions, currentStage, formatWhen, slugify } from './format.js';
import Menu from './manage/Menu.jsx';
import { useManage } from './manage/useManage.jsx';
import { navigate, routeHref } from './route.js';
import { EnvSlots, ErrorState, Modal, Notice, Spinner } from './ui.jsx';

function CreateBotDialog({ existingIds, onClose }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [starter, setStarter] = useState('support');
  const [how, setHow] = useState('template'); // template | describe
  const [description, setDescription] = useState('');
  const [generated, setGenerated] = useState(null); // { result, for }
  const [edits, setEdits] = useState({ role: '', greeting: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { current: workspaceId, spaces } = useWorkspaces();
  const workspaceName = spaces.find((space) => space.id === workspaceId)?.name;

  const effectiveId = idTouched ? id : slugify(name);
  const idProblem = botIdProblem(effectiveId, existingIds);
  const described = how === 'describe';
  const canCreate = !!name.trim() && !!effectiveId && !idProblem && !busy && (!described || (generated?.result?.ok && generated.for === description));

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await api.createBot({ id: effectiveId, name: name.trim() });
      // The agent belongs to the workspace it is created in.
      if (workspaceId) assignBot(effectiveId, workspaceId);
      if (described) {
        // The draft is made from the real new draft (so its id and version are right), with what was changed in the review applied.
        const made = generateDraft(description, draft.config, { name: name.trim() });
        let config = made.config;
        config = setRole(config, edits.role);
        config = setGreeting(config, edits.greeting);
        rememberNotes(effectiveId, { source: made.source, assumptions: made.assumptions, questions: made.questions, description });
        try { await api.saveDraft(effectiveId, config, draft.revision); } catch { queueChange(effectiveId, { kind: 'assistant', config }); }
      } else if (starter !== 'blank') {
        // Every new agent starts from the same minimal draft; the starter is what makes it its own. If saving it
        // fails the agent still exists, and the starter is put into its draft unsaved for the person to review.
        try { await api.saveDraft(effectiveId, applyStarter(draft.config, starter), draft.revision); } catch { queueChange(effectiveId, { kind: 'starter', starter }); }
      }
      refreshBots();
      onClose();
      navigate(routeHref(effectiveId), { guard: false });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="NEW AGENT"
      title="Create an agent"
      subtitle={workspaceName ? `It is created in ${workspaceName}. Pick what it starts from, or describe it; everything can be edited afterwards.` : 'Pick what it starts from, or describe it; everything can be edited afterwards.'}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="modalCreate" onClick={create} disabled={!canCreate}>{busy ? 'Creating…' : described ? 'Create the draft' : 'Create agent'}</button>
        </>
      )}
    >
      <div className="stFormStack">
        <label className="workspaceField">
          <span>Name</span>
          <small>What people will see in the list.</small>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') create(); }} placeholder="e.g. Acme Support" maxLength={80} />
        </label>
        <label className={`workspaceField ${idProblem ? 'bad' : ''}`}>
          <span>Id</span>
          <small>Permanent. Used in links and when a call asks for this agent. It can’t be changed later.</small>
          <input value={effectiveId} onChange={(event) => { setIdTouched(true); setId(event.target.value.toLowerCase()); }} onKeyDown={(event) => { if (event.key === 'Enter') create(); }} placeholder="acme-support" spellCheck={false} aria-invalid={!!idProblem} />
          {idProblem && <small className="stFieldError">{idProblem}</small>}
        </label>
        <div className="pvModes asHow" role="group" aria-label="How to start">
          <button type="button" className={!described ? 'on' : ''} aria-pressed={!described} onClick={() => setHow('template')} disabled={busy}>Start from a template</button>
          <button type="button" className={described ? 'on' : ''} aria-pressed={described} onClick={() => setHow('describe')} disabled={busy}>Describe it</button>
        </div>
        {!described ? (
          <fieldset className="stBump stStarters">
            <legend>Starting point</legend>
            {[...STARTERS.filter((item) => item.id !== 'blank'), STARTERS[0]].map((item) => (
              <label key={item.id} className={starter === item.id ? 'on' : ''}>
                <input type="radio" name="starter" value={item.id} checked={starter === item.id} onChange={() => setStarter(item.id)} disabled={busy} />
                <span><strong>{item.label}</strong><small>{item.blurb}</small></span>
              </label>
            ))}
          </fieldset>
        ) : (
          <AssistantPanel description={description} onDescription={setDescription} name={name} id={effectiveId} generated={generated} onGenerated={setGenerated} edits={edits} onEdits={setEdits} disabled={busy} />
        )}
        {error && <Notice kind="error" title={error.kind === 'conflict' ? 'That id is taken' : 'Couldn’t create the agent'}>{error.message}</Notice>}
      </div>
    </Modal>
  );
}

// One agent in a list: name and id, where it runs (one slot per environment), its latest published version and when
// the draft was last saved. `menuItems` adds the "⋯" menu (Rename, Export, Remove). Also used on the Overview.
export function BotRow({ bot, menuItems, onOpen }) {
  // Another page (the Overview) passes onOpen so it can switch to the Agents area too; a hash change alone wouldn't.
  const open = () => (onOpen ? onOpen(bot) : navigate(routeHref(bot.id), { guard: false }));
  const name = bot.name || bot.id;
  return (
    <div className={`agentRow stAgentRow ${menuItems ? 'withMenu' : ''}`}>
      <button type="button" className="agentRowMain" onClick={open} aria-label={`Open ${name}`}>
        <span className="agentRowAvatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="agentRowCopy">
          <strong>{name}</strong>
          <small><code>{bot.id}</code></small>
        </span>
        <EnvSlots deployed={bot.deployed} compact />
        <span className="stRowFacts">
          <span className={bot.latest_version ? 'stRowVersion' : 'stRowVersion none'}>{bot.latest_version ? `v${bot.latest_version}` : 'Not published'}</span>
          <small title={bot.draft_saved_at ? new Date(bot.draft_saved_at).toLocaleString() : ''}>Draft saved {formatWhen(bot.draft_saved_at) || 'never'}</small>
        </span>
      </button>
      <button type="button" className="quietButton agentRowAction" onClick={open}>Open</button>
      {menuItems && <Menu label={`Actions for ${name}`} items={menuItems(bot)} className="agentRowMenu" />}
    </div>
  );
}

const STAGE_RANK = { production: 4, staging: 3, development: 2 };
const stageRank = (bot) => {
  const stage = currentStage(bot);
  return stage.kind === 'env' ? STAGE_RANK[stage.env] || 1 : stage.kind === 'published' ? 1 : 0;
};
const SORTS = {
  recent: { label: 'Recently saved', compare: (a, b) => String(b.draft_saved_at || '').localeCompare(String(a.draft_saved_at || '')) },
  name: { label: 'Name', compare: (a, b) => (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }) },
  stage: { label: 'Furthest along', compare: (a, b) => stageRank(b) - stageRank(a) || compareVersions(b.latest_version || '0.0.0', a.latest_version || '0.0.0') },
};

export default function BotsPage({ route }) {
  const { bots, removed, all, error, loading, refresh } = useBots();
  const manage = useManage();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const wantsNew = route.params?.new === '1';
  const [creating, setCreating] = useState(wantsNew);
  // #/bots?new=1 (the "Create agent" buttons elsewhere in the app) opens the dialog.
  useEffect(() => { if (wantsNew) setCreating(true); }, [wantsNew]);
  // Opening the page always asks for a fresh list.
  useEffect(() => { refresh(); }, [refresh]);

  const list = useMemo(() => bots || [], [bots]);
  const visible = useMemo(() => {
    // The search box only exists with more than one agent; without it a leftover search must not hide anything.
    const q = list.length > 1 ? filter.trim().toLowerCase() : '';
    const matched = q ? list.filter((bot) => `${bot.name} ${bot.id}`.toLowerCase().includes(q)) : list;
    return [...matched].sort(SORTS[sort].compare);
  }, [list, filter, sort]);
  const counts = useMemo(() => ({
    total: list.length,
    published: list.filter((bot) => bot.latest_version).length,
    production: list.filter((bot) => bot.deployed?.production).length,
    draftOnly: list.filter((bot) => !bot.latest_version).length,
  }), [list]);

  const closeCreate = () => { setCreating(false); if (wantsNew) navigate(routeHref(), { guard: false }); };

  return (
    <>
      <section className="welcomeBlock pageHeaderBlock">
        <div>
          <h1>Agents</h1>
          <p>{list.length ? 'Open an agent to edit its draft, publish versions, deploy them and try them out.' : 'Agents you create appear here.'}</p>
        </div>
        <div className="pageHeaderActions"><button className="primaryCta createButton" type="button" onClick={() => setCreating(true)}>＋ Create agent</button></div>
      </section>

      {bots === null && loading && <Spinner label="Loading agents" />}
      {error && <ErrorState error={error} onRetry={refresh} what="the agents" />}

      {bots && list.length === 0 && (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">✦</div>
          <h2>{removed.length ? 'No agents in your list' : 'No agents yet'}</h2>
          <p>{removed.length ? `${removed.length} removed from your list. You can restore ${removed.length === 1 ? 'it' : 'them'} below, or create a new one.` : 'Create one to get a valid starting draft. You can edit everything afterwards.'}</p>
          <button className="primaryCta compactCta" type="button" onClick={() => setCreating(true)}>Create {removed.length ? 'an' : 'your first'} agent</button>
        </section>
      )}

      {list.length > 0 && (
        <>
          <section className="stAgentSummary" aria-label="Agents at a glance">
            <div><span>Agents</span><strong>{counts.total}</strong></div>
            <div><span>Published</span><strong>{counts.published}</strong></div>
            <div><span>Live in production</span><strong>{counts.production}</strong></div>
            <div><span>Not published yet</span><strong>{counts.draftOnly}</strong></div>
          </section>
          {list.length > 1 && (
            <div className="stListTools">
              <label className="inlineSearch">
                <span aria-hidden="true">⌕</span>
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by name or id" aria-label="Search agents" />
              </label>
              <label className="stSort">
                <span>Sort by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort agents">
                  {Object.entries(SORTS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="stAgentHead" aria-hidden="true">
            <span>Agent</span><span>Deployed to</span><span>Latest version</span><span />
          </div>
          <div className="agentRowList">
            {visible.map((bot) => <BotRow key={bot.id} bot={bot} menuItems={manage.menuItems} />)}
            {visible.length === 0 && <div className="agentRowEmpty">No agents match “{filter.trim()}”.</div>}
          </div>
        </>
      )}

      {removed.length > 0 && (
        <details className="stRemoved">
          <summary>Removed from your list ({removed.length})</summary>
          <p className="stMuted">These are hidden on this browser only. They still exist on the server{removed.some((b) => Object.keys(b.deployed || {}).length) ? ', and the ones that are deployed keep running' : ''}.</p>
          <ul>
            {removed.map((bot) => (
              <li key={bot.id}>
                <span><strong>{bot.name || bot.id}</strong> <code>{bot.id}</code></span>
                <button type="button" className="quietButton" onClick={() => restoreBot(bot.id)}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {creating && <CreateBotDialog existingIds={(all || []).map((bot) => bot.id)} onClose={closeCreate} />}
      {manage.element}
    </>
  );
}
