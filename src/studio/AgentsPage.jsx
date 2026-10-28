import React, { useEffect, useMemo, useState } from 'react';
import Fold from '../ui/Fold.jsx';
import SmartSelect from './SmartSelect.jsx';
import { api } from '../api/client.ts';
import { assignBot, dismissBot, refreshBots, restoreBot, undoDismissed, useBots, useWorkspaces } from './agents.js';
import { queueChange } from './pendingChange.js';
import AssistantPanel from './AssistantPanel.jsx';
import Select from '../ui/Select.tsx';
import './preview/preview.css';
import { rememberNotes } from './assistantNotes.js';
import { MIN_DESCRIPTION, generateDraft } from '../demo/draftAssistant.js';
import { minimalConfig } from '../demo/minimalConfig.js';
import { readSimple } from './simple/simpleModel.js';
import { setGreeting, setRole } from './simple/simpleModel.js';
import { applyStarter, STARTERS } from './starters.ts';
import { botIdProblem, formatWhen, freeBotId } from './format.js';
import { applyTemplate, deleteTemplate, loadTemplates, parseTemplateFile, saveTemplate } from './savedTemplates.js';
import { PAGE_SIZE, SORTS, STATUSES, collectFacets, filterBots, paginate } from './agentList.js';
import { OWN_ORDER, arrange, moveInOrder, useAgentOrder } from './agentOrder.js';
import { SortableItem, SortableList } from '../ui/Sortable.jsx';
import { usePref } from './usePref.js';
import { knownMeta, useAgentHealth } from './health/useAgentHealth.js';
import { useAgentActivity } from './health/useAgentActivity.js';
import { useAlertsByAgent } from './insights/AlertBell.jsx';
import { BotRow } from './AgentTable.jsx';
import AgentCards from './AgentCards.jsx';
import { useManage } from './manage/useManage.jsx';
import { navigate, replaceRoute, routeHref } from './route.js';
import { startSetup } from './setup/setupProgress.js';
import { withMainLanguage } from './setup/setupModel.js';
import { ErrorState, Modal, Notice } from './ui.jsx';
import Icon from '../ui/Icon.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import { askConfirm } from '../ui/dialogs.js';
import Button from '../ui/Button.tsx';

// a picture for each starting point in the create dialog
const STARTER_ICONS = { support: 'agent', receptionist: 'home', knowledge: 'records', lead: 'team', appointment: 'flag', feedback: 'quote', blank: 'plus' };

// A new agent's business by default: the workspace name typed at first sign-in (e.g. Acme Inc.), if the agent is made
// in that workspace. The greeting then says "thank you for calling Acme Inc.".
function workspaceCompany(workspaceName) {
  try {
    const typed = JSON.parse(window.localStorage.getItem('weave_profile') || 'null')?.workspaceName?.trim();
    return typed && typed === workspaceName ? typed : undefined;
  } catch {
    return undefined;
  }
}
const withCompany = (config, company) => (company && !config.persona?.company ? { ...config, persona: { ...config.persona, company } } : config);

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
  const [tried, setTried] = useState(false);
  const [describeFocus, setDescribeFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { current: workspaceId, spaces } = useWorkspaces();
  const workspaceName = spaces.find((space) => space.id === workspaceId)?.name;
  const company = workspaceCompany(workspaceName);

  // made from the name; a name already taken gets "-2" (the id is a technical key, tucked away under Advanced)
  const effectiveId = idTouched ? id : name.trim() ? freeBotId(name, existingIds) : '';
  const idProblem = botIdProblem(effectiveId, existingIds);
  const described = how === 'describe';
  const tooShort = description.trim().length < MIN_DESCRIPTION;
  const draftReady = !!(generated?.result?.ok && generated.for === description);
  const canCreate = !!name.trim() && !!effectiveId && !idProblem && !busy && (!described || draftReady);
  // When described, the main button first writes the draft to review (again if the description changed), then creates
  const writes = described && !draftReady;
  const canWrite = !!name.trim() && !tooShort && !busy;
  const hint = !name.trim() ? 'Give it a name first.' : writes && tooShort ? 'Describe it in a sentence or two first.' : '';

  const generate = () => {
    setTried(true);
    if (!canWrite) return;
    const result = generateDraft(description, minimalConfig(effectiveId || 'new-agent', name.trim()), { name: name.trim(), company });
    setGenerated({ result, for: description });
    setEdits({ role: result.ok ? readSimple(result.config).role : '', greeting: result.ok ? readSimple(result.config).greeting : '' });
  };

  const create = async () => {
    if (writes) return generate();
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const draft = await api.createBot({ id: effectiveId, name: name.trim() });
      if (workspaceId) assignBot(effectiveId, workspaceId);
      // Every new agent starts with the browser's language as its main language, whichever setup step opens first.
      // A template or description that names a language keeps its own.
      const languages = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language];
      const withLanguage = (config) => withMainLanguage(config, languages);
      if (described) {
        // Built on the real new draft (so its id and version are right), with the review's edits applied.
        const made = generateDraft(description, draft.config, { name: name.trim(), company });
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
        // Every new agent starts from the same minimal draft. If saving the starter fails, the agent still exists and
        // the starter is queued into its draft, unsaved, for the person to review.
        try {
          await api.saveDraft(effectiveId, withLanguage(applyStarter(withCompany(draft.config, company), starter)), draft.revision);
        } catch {
          queueChange(effectiveId, { kind: 'starter', starter });
        }
      } else {
        // blank: only the language, which the setup would otherwise ask for first
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
          {hint && <small className="stCreateHint">{hint}</small>}
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="modalCreate" onClick={create} disabled={writes ? !canWrite : !canCreate}>
            {busy ? 'Creating…' : writes ? (generated ? 'Update the draft' : 'Write my draft') : described ? 'Create the draft' : 'Create agent'}
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
        {/* the id is permanent and used in links, so it is made from the name and tucked away; opens on a problem */}
        <Fold className="stIdAdvanced" open={!!idProblem || idTouched}>
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
        </Fold>
        {/* describe it (a draft is made to review) or pick a template; nothing else is asked besides the name */}
        <fieldset className="stStartGrid" disabled={busy}>
          <legend>How it starts</legend>
          {/* a click moves the cursor to the description box; arrowing through the choices keeps focus here */}
          <label className={described ? 'on ai' : 'ai'} onClick={(event) => event.detail > 0 && setDescribeFocus(true)}>
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
            tried={tried}
            tooShort={tooShort}
            generated={generated}
            edits={edits}
            onEdits={setEdits}
            disabled={busy}
            focusOnOpen={describeFocus}
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

// One agent in “Removed from your list”: bring it back, or delete it for good. The API cannot delete an agent, so this
// only forgets it here (it stays on the server) and says so first; “Bring them back” undoes it.
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
          <Button type="button" className="danger" onClick={() => dismissBot(bot.id)}>
            Delete
          </Button>
          <Button type="button" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span className="stRemovedActions">
          <Button type="button" onClick={() => restoreBot(bot.id)}>
            Restore
          </Button>
          <Button type="button" className="danger" aria-label={`Delete ${label} from this list`} onClick={() => setAsking(true)}>
            Delete
          </Button>
        </span>
      )}
    </li>
  );
}

export default function AgentsPage({ route }) {
  const { bots, removed, dismissedCount, dismissedIds, all, error, loading, refresh } = useBots();
  const manage = useManage();
  const [filter, setFilter] = useState('');
  // kept in this browser, so "Your order" stays the person's view of the list
  const [savedSort, setSort] = usePref('weave_agents_sort', 'recent');
  const sort = SORTS[savedSort] ? savedSort : 'recent';
  const [tag, setTag] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('all');
  // cards or table, kept in this browser
  const [savedView, setView] = usePref('weave_agents_view', 'cards');
  const view = savedView === 'table' ? 'table' : 'cards';
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
  // Tags, owner and health are read for the agents on the page; with few agents, for all of them.
  const everything = list.length <= 40;
  const [wantAll, setWantAll] = useState(false);
  const known = knownMeta(list);
  const filters = { query: list.length > 1 ? filter : '', tag, owner, status };
  const { matched, unknown } = useMemo(() => filterBots(list, filters, known), [list, filter, tag, owner, status, known]); // eslint-disable-line react-hooks/exhaustive-deps
  // pinned first, then the chosen sort; "Your order" is the person's own, moved by dragging or from a row's menu
  const { pinned, order, togglePin, setOrder } = useAgentOrder();
  const sorted = useMemo(() => arrange(matched, { sort, pinned, order }), [matched, sort, pinned, order]);
  const paged = paginate(sorted, page, PAGE_SIZE);
  const visible = paged.rows;
  const ownOrder = sort === OWN_ORDER;
  const inOwnOrder = useMemo(() => arrange(list, { sort: OWN_ORDER, pinned, order }), [list, pinned, order]);
  const move = (id, to) => {
    const next = to && moveInOrder(inOwnOrder, pinned, id, to);
    if (next) setOrder(next);
  };
  // a drop makes the list as shown the person's own order, with that one move made
  const dropOnto = (id, to) => {
    const next = moveInOrder(ownOrder ? inOwnOrder : arrange(list, { sort, pinned, order }), pinned, id, to);
    if (!next) return;
    setOrder(next);
    if (!ownOrder) setSort(OWN_ORDER);
  };
  // the agent just above (-1) or below (1), only within the same group (pinned or not)
  const neighbour = (id, step) => {
    const other = visible[visible.findIndex((bot) => bot.id === id) + step];
    return other && pinned.includes(other.id) === pinned.includes(id) ? other.id : null;
  };
  const rowMenu = (bot) => [
    ...(ownOrder
      ? [
          { label: 'Move up', disabled: !neighbour(bot.id, -1), onClick: () => move(bot.id, neighbour(bot.id, -1)) },
          { label: 'Move down', disabled: !neighbour(bot.id, 1), onClick: () => move(bot.id, neighbour(bot.id, 1)) },
          { divider: true },
        ]
      : []),
    ...manage.menuItems(bot),
  ];
  const health = useAgentHealth(everything || wantAll ? list : visible);
  const activity = useAgentActivity(visible);
  const alertsByAgent = useAlertsByAgent();
  const facets = collectFacets(list, known);
  const unread = list.filter((bot) => !known[bot.id]).length;
  // a new search, filter or sort starts again from the first page
  useEffect(() => {
    setPage(1);
  }, [filter, tag, owner, status, sort]);
  const counts = useMemo(
    () => ({
      total: list.length,
      published: list.filter((bot) => bot.latest_version).length,
      production: list.filter((bot) => bot.deployed?.production).length,
      draftOnly: list.filter((bot) => !bot.latest_version).length,
    }),
    [list],
  );
  // the count beside each status filter (needs attention: of the agents checked so far)
  const statusCounts = useMemo(
    () => Object.fromEntries(Object.keys(STATUSES).map((key) => [key, filterBots(list, { status: key }, known).matched.length])),
    [list, known],
  );

  const row = (bot, movable) => (
    <BotRow
      bot={bot}
      menuItems={rowMenu}
      health={known[bot.id]?.health}
      tags={known[bot.id]?.tags}
      activity={activity.byBot[bot.id]}
      alerts={alertsByAgent[bot.id]}
      pinned={pinned.includes(bot.id)}
      onPin={togglePin}
      movable={movable}
    />
  );

  // Replace #/bots?new=1 rather than push, so Back goes to the previous page, not into the dialog again.
  const closeCreate = () => {
    setCreating(false);
    if (!wantsNew) return;
    replaceRoute(routeHref());
  };

  return (
    <>
      <section className="welcomeBlock pageHeaderBlock">
        <div>
          <h1>Agents</h1>
          <p>{list.length ? 'Open an agent to edit its draft, publish versions, deploy them and try them out.' : 'Agents you create appear here.'}</p>
        </div>
        <div className="pageHeaderActions">
          <Button variant="primary" className="createButton" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> Create agent
          </Button>
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
          {/* quiet: the page's "Create agent" above is its one strong button, and does the same */}
          <Button size="compact" type="button" onClick={() => setCreating(true)}>
            Create {removed.length ? 'an' : 'your first'} agent
          </Button>
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
            <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
              <div className="segmented" role="group" aria-label="Show agents">
                {Object.entries(STATUSES).map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}>
                    {label} <span className="tw-ml-1 tw-text-muted">{statusCounts[key]}</span>
                  </button>
                ))}
              </div>
              <div className="segmented" role="group" aria-label="View">
                <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
                  <Icon name="list" size={14} /> Cards
                </button>
                <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                  <Icon name="table" size={14} /> Table
                </button>
              </div>
            </div>
          )}
          {list.length > 1 && (
            <div className="stListTools">
              <label className="inlineSearch">
                <Icon name="search" size={15} />
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by name or id" aria-label="Search agents" />
              </label>
              <label className="stSort">
                <span>Sort by</span>
                <Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort agents">
                  {Object.entries(SORTS).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </Select>
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
          {view === 'cards' && (
            <>
              <AgentCards bots={visible} known={known} pinned={pinned} onPin={togglePin} menuItems={rowMenu} onMove={dropOnto} />
              {visible.length === 0 && (
                <div className="agentRowEmpty">{filter.trim() ? `No agents match “${filter.trim()}”.` : 'No agents match these filters.'}</div>
              )}
            </>
          )}
          {view === 'table' && (
            <div className="agentRowList agentTable">
              <div className="stAgentHead" aria-hidden="true">
                <span>Agent</span>
                <span>Where it runs</span>
                <span>Calls · 7 days</span>
                <span>Latest version</span>
              </div>
              {ownOrder ? (
                <SortableList
                  ids={visible.map((bot) => bot.id)}
                  nameOf={(id) => visible.find((bot) => bot.id === id)?.name || id}
                  label="the agents"
                  onMove={(from, to) => move(visible[from].id, visible[to].id)}
                >
                  {visible.map((bot) => (
                    <SortableItem key={bot.id} id={bot.id}>
                      {row(bot, true)}
                    </SortableItem>
                  ))}
                </SortableList>
              ) : (
                visible.map((bot) => <React.Fragment key={bot.id}>{row(bot, false)}</React.Fragment>)
              )}
              {visible.length === 0 && (
                <div className="agentRowEmpty">{filter.trim() ? `No agents match “${filter.trim()}”.` : 'No agents match these filters.'}</div>
              )}
            </div>
          )}
          {paged.pages > 1 && (
            <nav className="stPager" aria-label="Pages of agents">
              <Button type="button" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>
                Previous
              </Button>
              <span role="status">
                {paged.from}–{paged.to} of {paged.total}
              </span>
              <Button type="button" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>
                Next
              </Button>
            </nav>
          )}
        </>
      )}

      {(removed.length > 0 || dismissedCount > 0) && (
        <Fold className="stRemoved" open={removed.length === 0}>
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
        </Fold>
      )}

      {creating && <CreateBotDialog existingIds={(all || []).map((bot) => bot.id)} onClose={closeCreate} />}
      {manage.element}
    </>
  );
}
