import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import FocusBox from '../ui/FocusBox.jsx';
import Button from '../ui/Button.tsx';
import { exitThen, useFadeOnChange, useRiseInOnce } from '../ui/motion.ts';
import { testConnection, testSaved } from '../studio/integrations/apiTest.js';
import { useBots, workspaceBotIds } from '../studio/agents.js';
import { askConfirm } from '../ui/dialogs.js';
import IntegrationAgents from './IntegrationAgents.jsx';
import ConnectionHeaders from './ConnectionHeaders.jsx';
import { cleanHeaders, connectionParts, headerProblems } from '../studio/connectionParts.js';
import {
  applyToAgents,
  hasIntegration,
  reachable,
  readDrafts,
  readIntegrations,
  reportWords,
  withIntegration,
  withoutIntegration,
  writeIntegrations,
} from '../studio/workspaceIntegrations.js';
import '../studio/integrations/integrations.css';

// The Integrations page: the services an agent can connect to, searchable and filtered by kind. Each opens a panel with
// the same connection details for every one (its address, the headers sent with every call, one of them perhaps a
// secret's name: studio/connectionParts.js; a test request) and a description in the user's own words, kept in this
// browser. Whatever is connected is saved into every agent of the open workspace, and taken off them again when it is
// disconnected (studio/workspaceIntegrations.js). "Choose agents" turns it on or off for each agent; the card says how
// many use it, read from their drafts. "Test connection" calls its test request (studio/integrations/apiTest.js).

const INTEGRATION_LIBRARY = [
  {
    id: 'webhook',
    name: 'Webhooks',
    category: 'Developer tools',
    icon: 'webhook',
    description: 'Send agent events and receive data from your own services.',
    address: 'Endpoint URL',
  },
  {
    // kept as 'crm' (its first name) so a connection saved earlier is still found, and the agents' tools that call it
    id: 'crm',
    name: 'REST API',
    category: 'Developer tools',
    icon: 'code',
    description: 'Connect any HTTP API, so your agents can look up and send data while they talk.',
    dialogTitle: 'Connect an API',
    dialogLead: 'Any HTTP API your agents should call: orders, bookings, accounts, tickets or your own service.',
    address: 'Base URL',
    addressHint: 'Each tool’s path is added to it, e.g. /orders/{id}. It must be reachable from the agents’ server.',
  },
  {
    id: 'ticketing',
    name: 'Ticketing',
    category: 'Customer systems',
    icon: 'flag',
    description: 'Let agents create, read and update support tickets.',
    address: 'Workspace URL',
  },
  {
    id: 'knowledge',
    name: 'Knowledge source',
    category: 'Knowledge',
    icon: 'records',
    description: 'Connect a searchable knowledge endpoint for grounded answers.',
    address: 'Source URL',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    category: 'Operations',
    icon: 'monitor',
    description: 'Send conversation events to your analytics destination.',
    address: 'Collector URL',
  },
  {
    id: 'custom',
    name: 'Custom integration',
    category: 'Developer tools',
    icon: 'tools',
    description: 'Define a connection for an internal API or service.',
    address: 'Endpoint URL',
  },
];

// A line that says how something went. It stays the same element (a screen reader follows it as it changes) and fades
// in again whenever its words change.
function StatusLine({ className, text }) {
  const line = useRef(null);
  useFadeOnChange(line, text);
  return (
    <p ref={line} className={className} role="status">
      {text}
    </p>
  );
}

// How many of the workspace's agents use a connection, from their drafts, and a way to see which.
function UsageLine({ uses, onSee }) {
  const states = Object.values(uses);
  if (!states.length) return <p className="integrationUsage">No agents in this workspace yet; new ones start with it.</p>;
  const read = states.filter((state) => state !== undefined);
  const on = read.filter(Boolean).length;
  return (
    <p className="integrationUsage">
      <span>
        {read.length < states.length ? 'Reading which agents use it…' : `Used by ${on} of ${states.length} ${states.length === 1 ? 'agent' : 'agents'}`}
      </span>
      <button type="button" className="stLink" onClick={onSee}>
        See which
      </button>
    </p>
  );
}

export function IntegrationsWorkspace() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  // connection details by integration id; anything else saved under this name starts it empty
  const [connections, setConnections] = useState(readIntegrations);
  // the open workspace's agents, which every connection is saved into
  const { bots } = useBots();
  const botIds = useMemo(() => (bots || []).map((bot) => bot.id), [bots]);
  // what applying a connection to the agents did, by integration id ({ state: 'working' | 'good' | 'bad', text })
  const [applied, setApplied] = useState({});
  // each agent's draft, by id, to know which agents use which connection; read again whenever the workspace's agents
  // change (one created, removed or moved) and after anything here changes a draft
  const [drafts, setDrafts] = useState({});
  const refreshDrafts = useCallback(async (ids) => {
    if (!ids.length) return;
    const got = await readDrafts(ids);
    setDrafts((now) => ({ ...now, ...got }));
  }, []);
  const agentsKey = botIds.join('|');
  useEffect(() => {
    refreshDrafts(botIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsKey, refreshDrafts]);
  // id -> whether that agent uses the integration (undefined while its draft is being read)
  const usesOf = (id) => Object.fromEntries((bots || []).map((bot) => [bot.id, bot.id in drafts ? hasIntegration(drafts[bot.id], id) : undefined]));
  const applyAll = async (id, change, mode = 'add') => {
    const working = { add: 'Adding it to the agents…', remove: 'Taking it off the agents…', update: 'Updating it in the agents that use it…' }[mode];
    setApplied((now) => ({ ...now, [id]: { state: 'working', text: working } }));
    // read when it runs, not from this render: the agent list may still have been loading when the button was pressed
    const ids = await workspaceBotIds();
    const report = await applyToAgents(ids, change);
    setApplied((now) => ({ ...now, [id]: { state: report.failed.length ? 'bad' : 'good', text: reportWords(report, mode) } }));
    refreshDrafts(ids);
  };
  // "Choose agents": the integration whose agents are open, which agents are being saved, and why one didn't save
  const [choosing, setChoosing] = useState(null);
  const [saving, setSaving] = useState(() => new Set());
  const [rowProblems, setRowProblems] = useState({});
  const openChooser = (id) => {
    setRowProblems({});
    setChoosing(id);
  };
  // every agent at once, from the chooser: on is "Add to all agents", off takes it off every agent but keeps it connected
  const setAllAgents = (id, on) => {
    if (on) addToAgents(id, connections[id]);
    else applyAll(id, (config) => withoutIntegration(config, id), 'remove');
  };
  const toggleAgent = async (id, botId, on) => {
    const connection = connections[id];
    if (on && !reachable(connection)) {
      setRowProblems((now) => ({ ...now, [botId]: 'It needs a web address first: add one with Edit.' }));
      return;
    }
    setSaving((now) => new Set(now).add(botId));
    setRowProblems((now) => {
      const next = { ...now };
      delete next[botId];
      return next;
    });
    const report = await applyToAgents([botId], (config) => (on ? withIntegration(config, id, connection) : withoutIntegration(config, id)));
    if (report.failed.length) setRowProblems((now) => ({ ...now, [botId]: `Not saved (${report.failed[0].message}). Try again.` }));
    await refreshDrafts([botId]);
    setSaving((now) => {
      const next = new Set(now);
      next.delete(botId);
      return next;
    });
  };
  const [selected, setSelected] = useState(null);
  // each connection's last test, by integration id ({ state: 'checking' | 'good' | 'bad', text })
  const [tests, setTests] = useState({});
  const runTest = async (id, saved) => {
    setTests((now) => ({ ...now, [id]: { state: 'checking', text: 'Testing the connection…' } }));
    const result = await testSaved(saved, id);
    setTests((now) => ({ ...now, [id]: { state: result.ok ? 'good' : 'bad', text: result.text } }));
  };
  // the dialog's own test, of what is typed before it is saved
  const [dialogTest, setDialogTest] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', url: '', headers: [], testPath: '' });
  const testForm = async () => {
    setDialogTest({ state: 'checking', text: 'Testing the connection…' });
    const parts = { url: form.url.trim(), headers: cleanHeaders(form.headers) };
    const result = await testConnection({
      url: parts.url,
      path: form.testPath,
      headers: Object.fromEntries(parts.headers.filter((h) => !h.secret && h.name).map((h) => [h.name, h.value])),
      secret: parts.headers.find((h) => h.secret)?.name || '',
    });
    setDialogTest({ state: result.ok ? 'good' : 'bad', text: result.text });
  };
  const formProblems = useMemo(() => headerProblems(form.headers), [form.headers]);
  const canSave = !!form.url.trim() && Object.keys(formProblems).length === 0;
  const categories = ['All', ...Array.from(new Set(INTEGRATION_LIBRARY.map((item) => item.category)))];
  // the connection dialog sinks away as it closes, the way the studio's other dialogs do
  const dialogShade = useRef(null);
  // the cards settle in the first time the page shows them
  const grid = useRef(null);
  const closeDialog = useCallback(
    () => exitThen({ panel: dialogShade.current?.firstElementChild, shade: dialogShade.current, from: 'below' }, () => setSelected(null)),
    [],
  );
  useEffect(() => {
    if (!selected) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected, closeDialog]);
  const filtered = INTEGRATION_LIBRARY.filter(
    (item) =>
      `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (category === 'All' || item.category === category),
  );
  useRiseInOnce(grid, filtered.length > 0);
  const openConnect = (item) => {
    const existing = connections[item.id];
    const parts = existing ? connectionParts(existing, item.id) : { url: '', headers: [] };
    setForm({
      name: existing?.name || item.name,
      description: existing?.description || '',
      url: parts.url,
      headers: parts.headers,
      testPath: existing?.testPath || '',
    });
    setDialogTest(null);
    setSelected(item);
  };
  const saveConnection = () => {
    if (!selected || !canSave) return;
    const next = {
      ...connections,
      [selected.id]: {
        name: form.name.trim() || selected.name,
        // the user's own words for the card; none keeps the integration's
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        url: form.url.trim(),
        headers: cleanHeaders(form.headers),
        // what Test connection calls (kept in this browser; agents don't get it)
        ...(form.testPath.trim() ? { testPath: form.testPath.trim() } : {}),
        connectedAt: new Date().toISOString(),
      },
    };
    const id = selected.id;
    const wasConnected = !!connections[id];
    setConnections(next);
    writeIntegrations(next);
    runTest(id, next[id]);
    // the first time, every agent gets it; after that only the agents that use it are updated, so the ones switched off
    // under "Choose agents" stay off
    if (!wasConnected) addToAgents(id, next[id]);
    else if (reachable(next[id])) applyAll(id, (config) => (hasIntegration(config, id) ? withIntegration(config, id, next[id]) : config), 'update');
    closeDialog();
  };
  // saved into every agent of the workspace: when it is saved, and again from the card's own button (an agent made
  // elsewhere, or one that couldn't be changed the first time); agents that already have it are left as they are
  const addToAgents = (id, connection) => {
    if (reachable(connection)) applyAll(id, (config) => withIntegration(config, id, connection));
    else setApplied((now) => ({ ...now, [id]: { state: 'bad', text: 'Agents can only use a web address (http:// or https://): add one with Edit.' } }));
  };
  const disconnect = async (item) => {
    const id = item.id;
    const confirmed = await askConfirm({
      title: `Disconnect ${connections[id]?.name || item.name}?`,
      body: botIds.length
        ? `It is taken off the drafts of the ${botIds.length === 1 ? 'agent' : `${botIds.length} agents`} in this workspace, with any tools that use it. Their live versions change when you publish them.`
        : 'Its connection details are removed from this browser.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!confirmed) return;
    const next = { ...connections };
    delete next[id];
    setTests((now) => {
      const left = { ...now };
      delete left[id];
      return left;
    });
    setConnections(next);
    writeIntegrations(next);
    applyAll(id, (config) => withoutIntegration(config, id), 'remove');
  };

  return (
    <div className="workspaceFeaturePage">
      <section className="welcomeBlock pageHeaderBlock featureHero">
        <div>
          <h1>Integrations</h1>
          <p>Connect the systems your agents rely on and keep connection details in one place.</p>
        </div>
        <div className="featureHealth">
          {/* green only when something is connected; none yet is not a problem, so it is grey, not red */}
          <span className={`healthSignal ${Object.keys(connections).length ? '' : 'idle'}`} aria-hidden="true" />
          <div>
            <small>Workspace connections</small>
            <strong>{Object.keys(connections).length ? `${Object.keys(connections).length} connected` : 'None connected yet'}</strong>
          </div>
        </div>
      </section>
      <section className="featureToolbar">
        <label className="featureSearch">
          <Icon name="search" size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search integrations" aria-label="Search integrations" />
        </label>
        <div className="filterPills" role="group" aria-label="Filter integrations">
          {categories.map((item) => (
            <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>
      </section>
      <div className="featureSummary">
        <span>
          <b>{filtered.length}</b> integrations
        </span>
        <span>Connection details are kept in this browser, for every workspace</span>
      </div>
      <section className="integrationGrid" ref={grid}>
        {filtered.map((item) => {
          const connection = connections[item.id];
          const parts = connection ? connectionParts(connection, item.id) : null;
          const secrets = parts ? parts.headers.filter((h) => h.secret).length : 0;
          return (
            <article className={`integrationCard ${connection ? 'connected' : ''}`} key={item.id}>
              <div className="integrationTop">
                <div className="integrationIcon">
                  <Icon name={item.icon} size={18} />
                </div>
                <span className={`statusPill ${connection ? 'connected' : ''}`}>{connection ? 'Connected' : 'Not connected'}</span>
              </div>
              <div className="integrationCopy">
                <div className="integrationCategory">{item.category}</div>
                <h2>{item.name}</h2>
                <p>{connection?.description || item.description}</p>
              </div>
              {/* how the connection is doing, in one box: its last test, what the last change did, what it is, and how many agents use it */}
              {connection && (
                <div className="integrationStatus">
                  {tests[item.id] && <StatusLine className={`integrationCheck ${tests[item.id].state}`} text={tests[item.id].text} />}
                  {applied[item.id] && (
                    <StatusLine
                      className={`integrationCheck ${applied[item.id].state === 'working' ? 'checking' : applied[item.id].state}`}
                      text={applied[item.id].text}
                    />
                  )}
                  <p className="integrationSummary">
                    {[parts.url, `${parts.headers.length} ${parts.headers.length === 1 ? 'header' : 'headers'}`, secrets ? `${secrets} secret` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <UsageLine uses={usesOf(item.id)} onSee={() => openChooser(item.id)} />
                </div>
              )}
              {/* what can be done with a connection, in a row of its own so the card's usual buttons keep their room */}
              {connection && (
                <div className="integrationActions">
                  <Button type="button" onClick={() => runTest(item.id, connection)} disabled={tests[item.id]?.state === 'checking'}>
                    Test connection
                  </Button>
                  <Button type="button" onClick={() => addToAgents(item.id, connection)} disabled={applied[item.id]?.state === 'working'}>
                    <Icon name="plus" size={14} /> Add to all agents
                  </Button>
                  <Button type="button" onClick={() => openChooser(item.id)}>
                    <Icon name="agent" size={14} /> Choose agents
                  </Button>
                </div>
              )}
              <div className="integrationFooter">
                {connection ? (
                  <>
                    <span className="connectionHint">
                      Configured as <b>{connection.name}</b>
                    </span>
                    <Button type="button" onClick={() => openConnect(item)}>
                      Edit
                    </Button>
                    <button type="button" className="dangerButton" onClick={() => disconnect(item)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => openConnect(item)}>
                    Connect
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </section>
      {choosing && connections[choosing] && (
        <IntegrationAgents
          item={INTEGRATION_LIBRARY.find((i) => i.id === choosing)}
          connection={connections[choosing]}
          bots={bots || []}
          uses={usesOf(choosing)}
          busy={saving}
          problems={rowProblems}
          onToggle={(botId, on) => toggleAgent(choosing, botId, on)}
          allBusy={applied[choosing]?.state === 'working'}
          onAll={(on) => setAllAgents(choosing, on)}
          onClose={() => setChoosing(null)}
        />
      )}
      {selected && (
        <div
          ref={dialogShade}
          className="featureModalOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <FocusBox className="featureModal connectModal" data-scroll-edges role="dialog" aria-modal="true" aria-labelledby="integration-dialog-title">
            <div className="featureModalHeader">
              <div>
                <div className="eyebrow cyan">{selected.dialogTitle ? selected.name : 'Connection setup'}</div>
                <h2 id="integration-dialog-title">{selected.dialogTitle || selected.name}</h2>
                <p>{selected.dialogLead || selected.description}</p>
              </div>
              <button type="button" className="iconButton" aria-label="Close" onClick={closeDialog}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <label className="modalField">
              <span>Connection name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Orders API" />
            </label>
            <label className="modalField">
              <span>Description</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="What it is for, e.g. Looks up orders, delivery status and returns."
              />
              <small>Shown on the card. Left empty, the card keeps its own line.</small>
            </label>
            <label className="modalField">
              <span>{selected.address}</span>
              <input
                value={form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                placeholder="e.g. https://api.example.com"
                autoComplete="off"
                spellCheck={false}
              />
              {selected.addressHint && <small>{selected.addressHint}</small>}
            </label>
            <ConnectionHeaders rows={form.headers} onChange={(headers) => setForm({ ...form, headers })} problems={formProblems} />
            <fieldset className="modalField testRequest">
              <legend>
                Test request <span>(optional)</span>
              </legend>
              <span className="trRow">
                <span className="trMethod">GET</span>
                <input
                  value={form.testPath}
                  onChange={(event) => setForm({ ...form, testPath: event.target.value })}
                  placeholder="e.g. /health"
                  aria-label="Test path"
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
              <small>What Test connection calls, after the address. A GET reads only; nothing is changed.</small>
            </fieldset>
            <div className="modalNoteBox">
              <Icon name="agent" size={18} />
              {connections[selected.id] ? (
                <p>
                  <strong>Updates the agents that use it</strong>
                  The ones switched off under Choose agents stay off.
                </p>
              ) : botIds.length ? (
                <p>
                  <strong>Goes to {botIds.length === 1 ? 'the agent' : `all ${botIds.length} agents`} in this workspace</strong>
                  Saving adds it to every agent’s draft, and to every new agent. Choose agents turns it off for any of them afterwards.
                </p>
              ) : (
                <p>
                  <strong>Goes to every agent you create</strong>
                  There are no agents in this workspace yet; each new one starts with it.
                </p>
              )}
            </div>
            {dialogTest && <StatusLine className={`integrationCheck dialogTest ${dialogTest.state}`} text={dialogTest.text} />}
            <div className="featureModalFooter">
              <Button type="button" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="button" onClick={testForm} disabled={!form.url.trim() || dialogTest?.state === 'checking'}>
                Test connection
              </Button>
              <Button type="button" variant="primary" size="compact" disabled={!canSave} onClick={saveConnection}>
                Save connection
              </Button>
            </div>
          </FocusBox>
        </div>
      )}
    </div>
  );
}
