import React, { useEffect, useMemo, useState } from 'react';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.js';
import { assignBot, dismissBot, refreshBots, restoreBot, undoDismissed, useBots, useWorkspaces } from './agents.js';
import { queueChange } from './pendingChange.js';
import AssistantPanel from './AssistantPanel.jsx';
import './preview/preview.css';
import { rememberNotes } from './assistantNotes.js';
import { generateDraft } from '../demo/draftAssistant.js';
import { setGreeting, setRole } from './simple/simpleModel.js';
import { applyStarter, STARTERS } from './starters.js';
import { botIdProblem, formatWhen, freeBotId } from './format.js';
import { applyTemplate, deleteTemplate, loadTemplates, parseTemplateFile, saveTemplate } from './savedTemplates.js';
import { PAGE_SIZE, SORTS, collectFacets, filterBots, paginate, sortBots } from './agentList.js';
import { knownMeta, useAgentHealth } from './health/useAgentHealth.js';
import { useAgentActivity } from './health/useAgentActivity.js';
import { useAlertsByAgent } from './insights/AlertBell.jsx';
import { BotRow } from './AgentTable.jsx';
import { useManage } from './manage/useManage.jsx';
import { navigate, routeHref } from './route.js';
import { startSetup } from './setup/setupProgress.js';
import { withMainLanguage } from './setup/setupModel.js';
import { ErrorState, Modal, Notice } from './ui.jsx';
import Icon from '../ui/Icon.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import { askConfirm } from '../ui/dialogs.js';

// a picture for each starting point in the create dialog
const STARTER_ICONS = { support: 'agent', receptionist: 'home', knowledge: 'records', lead: 'team', appointment: 'flag', feedback: 'quote', blank: 'plus' };

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

  // made from the name, and free: a name another agent has gets "-2" (the id is a technical key, tucked away under Advanced)
  const effectiveId = idTouched ? id : name.trim() ? freeBotId(name, existingIds) : '';
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
      // It also starts with a main language, the person's own (the browser's), whichever step of the setup they open first; the language step shows it
      // to change. A template or a description that names one keeps it.
      const languages = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language];
      const withLanguage = (config) => withMainLanguage(config, languages);
      if (described) {
        // The draft is made from the real new draft (so its id and version are right), with what was changed in the review applied.
        const made = generateDraft(description, draft.config, { name: name.trim() });
        let config = made.config;
        config = setRole(config, edits.role);
        config = withLanguage(setGreeting(config, edits.greeting));
        rememberNotes(effectiveId, { source: made.source, assumptions: made.assumptions, questions: made.questions, description });
        try {
          await api.saveDraft(effectiveId, config, draft.revision);
        } catch {
          queueChange(effectiveId, { kind: 'assistant', config });
        }
      } else if (starter.startsWith('tpl:')) {
        // one of your own templates: its contents on top of the new agent's own id, name and version
        const template = templates.find((t) => `tpl:${t.id}` === starter);
        if (template) {
          try {
            await api.saveDraft(effectiveId, withLanguage(applyTemplate(draft.config, template)), draft.revision);
          } catch {
            queueChange(effectiveId, { kind: 'assistant', config: applyTemplate(draft.config, template) });
          }
        }
      } else if (starter !== 'blank') {
        // Every new agent starts from the same minimal draft; the starter is what makes it its own. If saving it
        // fails the agent still exists, and the starter is put into its draft unsaved for the person to review.
        try {
          await api.saveDraft(effectiveId, withLanguage(applyStarter(draft.config, starter)), draft.revision);
        } catch {
          queueChange(effectiveId, { kind: 'starter', starter });
        }
      } else {
        // blank: nothing but the language, which the setup would otherwise ask for first
        await api.saveDraft(effectiveId, withLanguage(draft.config), draft.revision).catch(() => {});
      }
      refreshBots();
      onClose();
      // a new agent goes straight into the guided setup, at the step after this dialog
      startSetup(effectiveId);
      navigate(routeHref(effectiveId, 'setup'), { guard: false });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      eyebrow="NEW AGENT"
      title="Create an agent"
      subtitle={
        workspaceName
          ? `It is created in ${workspaceName}. Pick what it starts from, or describe it; everything can be edited afterwards.`
          : 'Pick what it starts from, or describe it; everything can be edited afterwards.'
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="modalCreate" onClick={create} disabled={!canCreate}>
            {busy ? 'Creating…' : described ? 'Create the draft' : 'Create agent'}
          </button>
        </>
      }
    >
      <div className="stFormStack">
        <label className="workspaceField">
          <span>Name</span>
          <small>What people will see in the list.</small>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
            placeholder="e.g. Acme Support"
            maxLength={80}
          />
        </label>
        {/* The id is a technical key (it is permanent and used in links), so it is made from the name and tucked away; it opens by itself when there is a problem with it */}
        <details className="stIdAdvanced" open={!!idProblem || idTouched || undefined}>
          <summary>
            Advanced: the id <code>{effectiveId || '…'}</code> <span className="stMuted">{idTouched ? '(set by you)' : '(made from the name)'}</span>
          </summary>
          <label className={`workspaceField ${idProblem ? 'bad' : ''}`}>
            <span>Id</span>
            <small>Permanent. Used in links and when a call asks for this agent. It can’t be changed later.</small>
            <input
              value={effectiveId}
              onChange={(event) => {
                setIdTouched(true);
                setId(event.target.value.toLowerCase());
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') create();
              }}
              placeholder="acme-support"
              spellCheck={false}
              aria-invalid={!!idProblem}
            />
            {idProblem && <small className="stFieldError">{idProblem}</small>}
          </label>
        </details>
        {/* one choice of how it starts: describe it in words (a draft is made to review), or a template; the name above is all else that is asked */}
        <fieldset className="stStartGrid" disabled={busy}>
          <legend>How it starts</legend>
          <label className={described ? 'on ai' : 'ai'}>
            <input type="radio" name="start" value="describe" checked={described} onChange={() => setHow('describe')} />
            <span className="stStartIcon" aria-hidden="true">
              <Icon name="sparkle" size={18} />
            </span>
            <span>
              <strong>Describe it</strong>
              <small>Say in your own words what it should do. A draft is made for you to check.</small>
            </span>
          </label>
          {[...STARTERS.filter((item) => item.id !== 'blank'), STARTERS[0]].map((item) => (
            <label key={item.id} className={!described && starter === item.id ? 'on' : ''}>
              <input
                type="radio"
                name="start"
                value={item.id}
                checked={!described && starter === item.id}
                onChange={() => {
                  setHow('template');
                  setStarter(item.id);
                }}
              />
              <span className="stStartIcon" aria-hidden="true">
                <Icon name={STARTER_ICONS[item.id] || 'agent'} size={18} />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.blurb}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {!described ? (
          <fieldset className="stBump stStarters stYourTemplates">
            <legend className="srOnly">Your templates</legend>
            <div className="stTemplatesHead">
              <strong>Your templates</strong>
              <label className="quietButton stImport">
                Import a file…
                <input
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Import a template file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    const parsed = parseTemplateFile(await file.text(), file.name);
                    if (parsed.error) {
                      setImportNote(parsed.error);
                      return;
                    }
                    const saved = saveTemplate(parsed.template);
                    setTemplates(saved.list);
                    setHow('template');
                    setStarter(`tpl:${saved.template.id}`);
                    setImportNote(`Imported “${saved.template.name}”.`);
                  }}
                />
              </label>
            </div>
            {importNote && (
              <small className="stMuted" role="status">
                {importNote}
              </small>
            )}
            {templates.length === 0 && (
              <small className="stMuted">None yet. Save any agent as a template from its “⋯” menu, or import a file a colleague shared.</small>
            )}
            {templates.map((item) => (
              <label key={item.id} className={starter === `tpl:${item.id}` ? 'on' : ''}>
                <input
                  type="radio"
                  name="starter"
                  value={`tpl:${item.id}`}
                  checked={starter === `tpl:${item.id}`}
                  onChange={() => {
                    setHow('template');
                    setStarter(`tpl:${item.id}`);
                  }}
                  disabled={busy}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description || `Saved ${formatWhen(item.createdAt)} from ${item.sourceName || 'an agent'}`}</small>
                </span>
                <button
                  type="button"
                  className="stFDel small"
                  aria-label={`Remove the template ${item.name}`}
                  disabled={busy}
                  onClick={async (event) => {
                    event.preventDefault();
                    const ok = await askConfirm({
                      title: `Remove the template “${item.name}”?`,
                      body: 'Agents already made from it are not affected.',
                      confirmLabel: 'Remove template',
                      tone: 'danger',
                    });
                    if (ok) {
                      setTemplates(deleteTemplate(item.id));
                      if (starter === `tpl:${item.id}`) setStarter('support');
                    }
                  }}
                >
                  Remove
                </button>
              </label>
            ))}
          </fieldset>
        ) : (
          <AssistantPanel
            description={description}
            onDescription={setDescription}
            name={name}
            id={effectiveId}
            generated={generated}
            onGenerated={setGenerated}
            edits={edits}
            onEdits={setEdits}
            disabled={busy}
          />
        )}
        {error && (
          <Notice kind="error" title={error.kind === 'conflict' ? 'That id is taken' : 'Couldn’t create the agent'}>
            {error.message}
          </Notice>
        )}
      </div>
    </Modal>
  );
}

// One agent in “Removed from your list”: bring it back, or delete it from the list for good. The API cannot delete an agent, so this only forgets it here
// (it stays on the server), and says so before it does; “Bring them back” undoes it.
function RemovedRow({ bot }) {
  const [asking, setAsking] = useState(false);
  const label = bot.name || bot.id;
  return (
    <li>
      <span>
        <strong>{label}</strong> <code>{bot.id}</code>
      </span>
      {asking ? (
        <span className="stRemovedAsk" role="group" aria-label={`Delete ${label} from this list?`}>
          <span className="stMuted">Delete from this list? It stays on the server.</span>
          <button type="button" className="quietButton danger" onClick={() => dismissBot(bot.id)}>
            Delete
          </button>
          <button type="button" className="quietButton" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="stRemovedActions">
          <button type="button" className="quietButton" onClick={() => restoreBot(bot.id)}>
            Restore
          </button>
          <button type="button" className="quietButton danger" aria-label={`Delete ${label} from this list`} onClick={() => setAsking(true)}>
            Delete
          </button>
        </span>
      )}
    </li>
  );
}

export default function BotsPage({ route }) {
  const { bots, removed, dismissedCount, dismissedIds, all, error, loading, refresh } = useBots();
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
  useEffect(() => {
    if (wantsNew) setCreating(true);
  }, [wantsNew]);
  // Opening the page always asks for a fresh list.
  useEffect(() => {
    refresh();
  }, [refresh]);

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
  const activity = useAgentActivity(visible);
  const alertsByAgent = useAlertsByAgent();
  const facets = collectFacets(list, known);
  const unread = list.filter((bot) => !known[bot.id]).length;
  // a new search, filter or sort starts again from the first page
  useEffect(() => {
    setPage(1);
  }, [filter, tag, owner, attention, sort]);
  const counts = useMemo(
    () => ({
      total: list.length,
      published: list.filter((bot) => bot.latest_version).length,
      production: list.filter((bot) => bot.deployed?.production).length,
      draftOnly: list.filter((bot) => !bot.latest_version).length,
    }),
    [list],
  );

  const closeCreate = () => {
    setCreating(false);
    if (wantsNew) navigate(routeHref(), { guard: false });
  };

  return (
    <>
      <section className="welcomeBlock pageHeaderBlock">
        <div>
          <h1>Agents</h1>
          <p>{list.length ? 'Open an agent to edit its draft, publish versions, deploy them and try them out.' : 'Agents you create appear here.'}</p>
        </div>
        <div className="pageHeaderActions">
          <button className="primaryCta createButton" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> Create agent
          </button>
        </div>
      </section>

      {bots === null && loading && (
        <div className="agentRowList agentTable">
          <SkeletonRows rows={3} label="Loading agents" />
        </div>
      )}
      {error && <ErrorState error={error} onRetry={refresh} what="the agents" />}

      {bots && list.length === 0 && (
        <section className="emptyPanel">
          <div className="emptyPanelIcon" aria-hidden="true">
            <Icon name="sparkle" size={24} />
          </div>
          <h2>{removed.length ? 'No agents in your list' : 'No agents yet'}</h2>
          <p>
            {removed.length
              ? `${removed.length} removed from your list. You can restore ${removed.length === 1 ? 'it' : 'them'} below, or create a new one.`
              : 'Create one to get a valid starting draft. You can edit everything afterwards.'}
          </p>
          <button className="primaryCta compactCta" type="button" onClick={() => setCreating(true)}>
            Create {removed.length ? 'an' : 'your first'} agent
          </button>
        </section>
      )}

      {list.length > 0 && (
        <>
          <section className="stAgentSummary" aria-label="Agents at a glance">
            <div>
              <span>Agents</span>
              <strong>{counts.total}</strong>
            </div>
            <div>
              <span>Published</span>
              <strong>{counts.published}</strong>
            </div>
            <div>
              <span>Live in production</span>
              <strong>{counts.production}</strong>
            </div>
            <div>
              <span>Not published yet</span>
              <strong>{counts.draftOnly}</strong>
            </div>
          </section>
          {list.length > 1 && (
            <div className="stListTools">
              <label className="inlineSearch">
                <Icon name="search" size={15} />
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by name or id" aria-label="Search agents" />
              </label>
              <label className="stSort">
                <span>Sort by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort agents">
                  {Object.entries(SORTS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {facets.tags.length > 0 && (
                <label className="stSort">
                  <span>Tag</span>
                  <SmartSelect
                    className=""
                    value={tag}
                    ariaLabel="Filter by tag"
                    placeholder="Any"
                    options={[{ value: '', label: 'Any' }, ...facets.tags.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` }))]}
                    onChange={setTag}
                  />
                </label>
              )}
              {facets.owners.length > 0 && (
                <label className="stSort">
                  <span>Owner</span>
                  <SmartSelect
                    className=""
                    value={owner}
                    ariaLabel="Filter by owner"
                    placeholder="Anyone"
                    options={[{ value: '', label: 'Anyone' }, ...facets.owners.map((o) => ({ value: o.value, label: `${o.value} (${o.count})` }))]}
                    onChange={setOwner}
                  />
                </label>
              )}
              <label className="stAttention">
                <input type="checkbox" checked={attention} onChange={(event) => setAttention(event.target.checked)} /> Needs attention
              </label>
            </div>
          )}
          {(unknown > 0 || (!everything && !wantAll && unread > 0) || health.pending > 0) && (
            <p className="stMuted stListNote" role="status">
              {unknown > 0 && (
                <>
                  {unknown} agent{unknown === 1 ? ' hasn’t' : 's haven’t'} been checked yet, so the tag, owner and attention filters don’t cover{' '}
                  {unknown === 1 ? 'it' : 'them'}.{' '}
                </>
              )}
              {!everything && !wantAll && unread > 0 && (
                <>
                  Tags, owners and health are read for the agents on this page ({list.length - unread} of {list.length} so far).{' '}
                  <button type="button" className="stLink" onClick={() => setWantAll(true)}>
                    Check all {list.length} agents
                  </button>{' '}
                  (a few requests each).{' '}
                </>
              )}
              {health.pending > 0 && <>Checking… {health.pending} left.</>}
            </p>
          )}
          <div className="agentRowList agentTable">
            <div className="stAgentHead" aria-hidden="true">
              <span>Agent</span>
              <span>Where it runs</span>
              <span>Calls · 7 days</span>
              <span>Latest version</span>
            </div>
            {visible.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                menuItems={manage.menuItems}
                health={known[bot.id]?.health}
                tags={known[bot.id]?.tags}
                activity={activity.byBot[bot.id]}
                alerts={alertsByAgent[bot.id]}
              />
            ))}
            {visible.length === 0 && (
              <div className="agentRowEmpty">{filter.trim() ? `No agents match “${filter.trim()}”.` : 'No agents match these filters.'}</div>
            )}
          </div>
          {paged.pages > 1 && (
            <nav className="stPager" aria-label="Pages of agents">
              <button type="button" className="quietButton" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>
                Previous
              </button>
              <span role="status">
                {paged.from}–{paged.to} of {paged.total}
              </span>
              <button type="button" className="quietButton" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      )}

      {(removed.length > 0 || dismissedCount > 0) && (
        <details className="stRemoved" open={removed.length === 0 || undefined}>
          <summary>Removed from your list ({removed.length})</summary>
          {removed.length === 0 && <p className="stMuted">Nothing is waiting here.</p>}
          <p className="stMuted">
            These are hidden on this browser only. They still exist on the server
            {removed.some((b) => Object.keys(b.deployed || {}).length) ? ', and the ones that are deployed keep running' : ''}.
          </p>
          <ul>
            {removed.map((bot) => (
              <RemovedRow key={bot.id} bot={bot} />
            ))}
          </ul>
          {dismissedCount > 0 && (
            <p className="stMuted stRemovedUndo">
              {dismissedCount} deleted from this list.{' '}
              <button type="button" className="linkButton" onClick={() => undoDismissed(dismissedIds)}>
                Bring {dismissedCount === 1 ? 'it' : 'them'} back
              </button>
            </p>
          )}
        </details>
      )}

      {creating && <CreateBotDialog existingIds={(all || []).map((bot) => bot.id)} onClose={closeCreate} />}
      {manage.element}
    </>
  );
}
