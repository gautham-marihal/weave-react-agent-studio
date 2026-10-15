import React, { useEffect, useMemo, useState } from 'react';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.js';
import { assignBot, refreshBots, restoreBot, useBots, useWorkspaces } from './agents.js';
import { queueChange } from './pendingChange.js';
import AssistantPanel from './AssistantPanel.jsx';
import './preview/preview.css';
import { rememberNotes } from './assistantNotes.js';
import { generateDraft } from '../demo/draftAssistant.js';
import { setGreeting, setRole } from './simple/simpleModel.js';
import { applyStarter, STARTERS } from './starters.js';
import { botIdProblem, formatWhen, slugify } from './format.js';
import { applyTemplate, deleteTemplate, loadTemplates, parseTemplateFile, saveTemplate } from './savedTemplates.js';
import { PAGE_SIZE, SORTS, collectFacets, filterBots, paginate, sortBots } from './agentList.js';
import { healthTitle } from './health/health.js';
import { knownMeta, useAgentHealth } from './health/useAgentHealth.js';
import Menu from './manage/Menu.jsx';
import { useManage } from './manage/useManage.jsx';
import { navigate, routeHref } from './route.js';
import { EnvSlots, ErrorState, Modal, Notice, Spinner } from './ui.jsx';
import StatePill from './StatePill.jsx';
import { stateFromHealth } from './status.js';

function CreateBotDialog({ existingIds, onClose }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [starter, setStarter] = useState('support');
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [importNote, setImportNote] = useState('');
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
      } else if (starter.startsWith('tpl:')) {
        // one of your own templates: its contents on top of the new agent's own id, name and version
        const template = templates.find((t) => `tpl:${t.id}` === starter);
        if (template) { try { await api.saveDraft(effectiveId, applyTemplate(draft.config, template), draft.revision); } catch { queueChange(effectiveId, { kind: 'assistant', config: applyTemplate(draft.config, template) }); } }
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
        {/* The id is a technical key (it is permanent and used in links), so it is made from the name and tucked away; it opens by itself when there is a problem with it */}
        <details className="stIdAdvanced" open={!!idProblem || idTouched || undefined}>
          <summary>Advanced: the id <code>{effectiveId || '…'}</code> <span className="stMuted">{idTouched ? '(set by you)' : '(made from the name)'}</span></summary>
        <label className={`workspaceField ${idProblem ? 'bad' : ''}`}>
          <span>Id</span>
          <small>Permanent. Used in links and when a call asks for this agent. It can’t be changed later.</small>
          <input value={effectiveId} onChange={(event) => { setIdTouched(true); setId(event.target.value.toLowerCase()); }} onKeyDown={(event) => { if (event.key === 'Enter') create(); }} placeholder="acme-support" spellCheck={false} aria-invalid={!!idProblem} />
          {idProblem && <small className="stFieldError">{idProblem}</small>}
        </label>
        </details>
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
            <div className="stTemplatesHead">
              <strong>Your templates</strong>
              <label className="quietButton stImport">Import a file…<input type="file" accept=".json,application/json" hidden aria-label="Import a template file" onChange={async (event) => {
                const file = event.target.files?.[0]; event.target.value = '';
                if (!file) return;
                const parsed = parseTemplateFile(await file.text(), file.name);
                if (parsed.error) { setImportNote(parsed.error); return; }
                const saved = saveTemplate(parsed.template);
                setTemplates(saved.list); setStarter(`tpl:${saved.template.id}`); setImportNote(`Imported “${saved.template.name}”.`);
              }} /></label>
            </div>
            {importNote && <small className="stMuted" role="status">{importNote}</small>}
            {templates.length === 0 && <small className="stMuted">None yet. Save any agent as a template from its “⋯” menu, or import a file a colleague shared.</small>}
            {templates.map((item) => (
              <label key={item.id} className={starter === `tpl:${item.id}` ? 'on' : ''}>
                <input type="radio" name="starter" value={`tpl:${item.id}`} checked={starter === `tpl:${item.id}`} onChange={() => setStarter(`tpl:${item.id}`)} disabled={busy} />
                <span><strong>{item.name}</strong><small>{item.description || `Saved ${formatWhen(item.createdAt)} from ${item.sourceName || 'an agent'}`}</small></span>
                <button type="button" className="stFDel small" aria-label={`Remove the template ${item.name}`} disabled={busy} onClick={(event) => { event.preventDefault(); if (window.confirm(`Remove the template “${item.name}” from this browser? Agents already made from it are not affected.`)) { setTemplates(deleteTemplate(item.id)); if (starter === `tpl:${item.id}`) setStarter('support'); } }}>Remove</button>
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
export function BotRow({ bot, menuItems, onOpen, health, tags }) {
  const state = stateFromHealth(bot, health);
  // Another page (the Overview) passes onOpen so it can switch to the Agents area too; a hash change alone wouldn't.
  const open = () => (onOpen ? onOpen(bot) : navigate(routeHref(bot.id), { guard: false }));
  const name = bot.name || bot.id;
  return (
    <div className={`agentRow stAgentRow ${menuItems ? 'withMenu' : ''}`}>
      <button type="button" className="agentRowMain" onClick={open} aria-label={`Open ${name}`}>
        <span className="agentRowAvatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="agentRowCopy">
          <span className="stRowTitle"><strong>{name}</strong><StatePill state={state} /></span>
          <small><code>{bot.id}</code>{tags?.length > 0 && tags.slice(0, 3).map((tag) => <span key={tag} className="stAgentTag">{tag}</span>)}</small>
          {health && health.state !== 'unknown' && (
            <span className={`stHealth ${health.state}`} title={healthTitle(health)} data-health={health.state}>
              {health.parts.length === 0 ? <span className="stHealthOk">✓ no problems found</span> : health.parts.slice(0, 3).map((part) => <span key={part.id} className={`stHealthPart ${part.tone}`}>{part.text}</span>)}
            </span>
          )}
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

export default function BotsPage({ route }) {
  const { bots, removed, all, error, loading, refresh } = useBots();
  const manage = useManage();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('recent');
  const [tag, setTag] = useState('');
  const [owner, setOwner] = useState('');
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(1);
  const wantsNew = route.params?.new === '1';
  const [creating, setCreating] = useState(wantsNew);
  // #/bots?new=1 (the "Create agent" buttons elsewhere in the app) opens the dialog.
  useEffect(() => { if (wantsNew) setCreating(true); }, [wantsNew]);
  // Opening the page always asks for a fresh list.
  useEffect(() => { refresh(); }, [refresh]);

  const list = useMemo(() => bots || [], [bots]);
  // What is known beyond the list (tags, owner, health) is read for the agents on the page; with few agents, for all of them.
  const everything = list.length <= 40;
  const [wantAll, setWantAll] = useState(false);
  const known = knownMeta(list);
  const filters = { query: list.length > 1 ? filter : '', tag, owner, attention };
  const { matched, unknown } = useMemo(() => filterBots(list, filters, known), [list, filter, tag, owner, attention, known]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortBots(matched, sort), [matched, sort]);
  const paged = paginate(sorted, page, PAGE_SIZE);
  const visible = paged.rows;
  const health = useAgentHealth(everything || wantAll ? list : visible);
  const facets = collectFacets(list, known);
  const unread = list.filter((bot) => !known[bot.id]).length;
  // a new search, filter or sort starts again from the first page
  useEffect(() => { setPage(1); }, [filter, tag, owner, attention, sort]);
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
              {facets.tags.length > 0 && (
                <label className="stSort"><span>Tag</span>
                  <SmartSelect className="" value={tag} ariaLabel="Filter by tag" placeholder="Any" options={[{ value: '', label: 'Any' }, ...facets.tags.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))]} onChange={setTag} />
                </label>
              )}
              {facets.owners.length > 0 && (
                <label className="stSort"><span>Owner</span>
                  <SmartSelect className="" value={owner} ariaLabel="Filter by owner" placeholder="Anyone" options={[{ value: '', label: 'Anyone' }, ...facets.owners.map((o) => ({ value: o.value, label: `${o.value} (${o.count})` }))]} onChange={setOwner} />
                </label>
              )}
              <label className="stAttention"><input type="checkbox" checked={attention} onChange={(event) => setAttention(event.target.checked)} /> Needs attention</label>
            </div>
          )}
          {(unknown > 0 || (!everything && !wantAll && unread > 0) || health.pending > 0) && (
            <p className="stMuted stListNote" role="status">
              {unknown > 0 && <>{unknown} agent{unknown === 1 ? ' hasn’t' : 's haven’t'} been checked yet, so the tag, owner and attention filters don’t cover {unknown === 1 ? 'it' : 'them'}. </>}
              {!everything && !wantAll && unread > 0 && <>Tags, owners and health are read for the agents on this page ({list.length - unread} of {list.length} so far). <button type="button" className="stLink" onClick={() => setWantAll(true)}>Check all {list.length} agents</button> (a few requests each). </>}
              {health.pending > 0 && <>Checking… {health.pending} left.</>}
            </p>
          )}
          <div className="stAgentHead" aria-hidden="true">
            <span>Agent</span><span>Deployed to</span><span>Latest version</span><span />
          </div>
          <div className="agentRowList">
            {visible.map((bot) => <BotRow key={bot.id} bot={bot} menuItems={manage.menuItems} health={known[bot.id]?.health} tags={known[bot.id]?.tags} />)}
            {visible.length === 0 && <div className="agentRowEmpty">{filter.trim() ? `No agents match “${filter.trim()}”.` : 'No agents match these filters.'}</div>}
          </div>
          {paged.pages > 1 && (
            <nav className="stPager" aria-label="Pages of agents">
              <button type="button" className="quietButton" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>Previous</button>
              <span role="status">{paged.from}–{paged.to} of {paged.total}</span>
              <button type="button" className="quietButton" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>Next</button>
            </nav>
          )}
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
