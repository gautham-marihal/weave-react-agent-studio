import { useEffect, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import FocusBox from '../ui/FocusBox.jsx';
import Button from '../ui/Button.tsx';

// The Integrations page: the services an agent can connect to, searchable and filtered by kind. Each opens a panel with
// its connection details (kept in this browser), and can be added to an agent's draft as a connection.

const INTEGRATION_LIBRARY = [
  {
    id: 'webhook',
    name: 'Webhooks',
    category: 'Developer tools',
    icon: 'webhook',
    description: 'Send agent events and receive data from your own services.',
    fields: ['Endpoint URL', 'Secret'],
  },
  {
    id: 'crm',
    name: 'CRM',
    category: 'Customer systems',
    icon: 'team',
    description: 'Connect customer records and account context to your agents.',
    fields: ['Base URL', 'API key'],
  },
  {
    id: 'ticketing',
    name: 'Ticketing',
    category: 'Customer systems',
    icon: 'flag',
    description: 'Let agents create, read and update support tickets.',
    fields: ['Workspace URL', 'API key'],
  },
  {
    id: 'knowledge',
    name: 'Knowledge source',
    category: 'Knowledge',
    icon: 'records',
    description: 'Connect a searchable knowledge endpoint for grounded answers.',
    fields: ['Source URL', 'Access token'],
  },
  {
    id: 'analytics',
    name: 'Analytics',
    category: 'Operations',
    icon: 'monitor',
    description: 'Send conversation events to your analytics destination.',
    fields: ['Collector URL', 'Write key'],
  },
  {
    id: 'custom',
    name: 'Custom integration',
    category: 'Developer tools',
    icon: 'tools',
    description: 'Define a connection for an internal API or service.',
    fields: ['Endpoint URL', 'API key'],
  },
];

export function IntegrationsWorkspace({ onAddToAgent }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [connections, setConnections] = useState(() => {
    try {
      // connection details by integration id; anything else saved under this name starts it empty
      const saved = JSON.parse(localStorage.getItem('weave_integrations') || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  });
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: '', first: '', second: '' });
  const categories = ['All', ...Array.from(new Set(INTEGRATION_LIBRARY.map((item) => item.category)))];
  useEffect(() => {
    if (!selected) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected]);
  const filtered = INTEGRATION_LIBRARY.filter(
    (item) =>
      `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (category === 'All' || item.category === category),
  );
  const openConnect = (item) => {
    const existing = connections[item.id] || {};
    setForm({ name: existing.name || item.name, first: existing.first || '', second: existing.second || '' });
    setSelected(item);
  };
  const saveConnection = () => {
    if (!selected || !form.first.trim()) return;
    const next = {
      ...connections,
      [selected.id]: { name: form.name.trim() || selected.name, first: form.first.trim(), second: form.second.trim(), connectedAt: new Date().toISOString() },
    };
    setConnections(next);
    try {
      localStorage.setItem('weave_integrations', JSON.stringify(next));
    } catch {}
    setSelected(null);
  };
  const disconnect = (id) => {
    const next = { ...connections };
    delete next[id];
    setConnections(next);
    try {
      localStorage.setItem('weave_integrations', JSON.stringify(next));
    } catch {}
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
      <section className="integrationGrid">
        {filtered.map((item) => {
          const connection = connections[item.id];
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
                <p>{item.description}</p>
              </div>
              <div className="integrationFooter">
                {connection ? (
                  <>
                    <span className="connectionHint">
                      Configured as <b>{connection.name}</b>
                    </span>
                    <Button type="button" onClick={() => openConnect(item)}>
                      Edit
                    </Button>
                    <Button type="button" onClick={() => onAddToAgent?.(connection, item)}>
                      Add to an agent
                    </Button>
                    <button type="button" className="dangerButton" onClick={() => disconnect(item.id)}>
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
      {selected && (
        <div
          className="featureModalOverlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <FocusBox className="featureModal" role="dialog" aria-modal="true" aria-labelledby="integration-dialog-title">
            <div className="featureModalHeader">
              <div>
                <div className="eyebrow cyan">Connection setup</div>
                <h2 id="integration-dialog-title">{selected.name}</h2>
                <p>{selected.description}</p>
              </div>
              <button type="button" className="iconButton" aria-label="Close" onClick={() => setSelected(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <label className="modalField">
              <span>Connection name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Production CRM" />
            </label>
            <label className="modalField">
              <span>{selected.fields[0]}</span>
              <input
                value={form.first}
                onChange={(event) => setForm({ ...form, first: event.target.value })}
                placeholder={`Enter ${selected.fields[0].toLowerCase()}`}
              />
            </label>
            <label className="modalField">
              <span>{selected.fields[1]}</span>
              <input
                type="password"
                value={form.second}
                onChange={(event) => setForm({ ...form, second: event.target.value })}
                placeholder={`Enter ${selected.fields[1].toLowerCase()}`}
              />
            </label>
            <div className="featureModalFooter">
              <Button type="button" onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" size="compact" disabled={!form.first.trim()} onClick={saveConnection}>
                Save connection
              </Button>
            </div>
          </FocusBox>
        </div>
      )}
    </div>
  );
}
