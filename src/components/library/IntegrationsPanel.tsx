import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRoundIcon, PlugIcon, SearchIcon, SearchXIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Field } from '../ui/Field';
import { AgentPickerDialog } from '../manage/AgentPickerDialog';
import { INTEGRATIONS_CATALOG, INTEGRATION_CATEGORIES, type IntegrationItem } from '../../data/integrationsCatalog';
import type { Agent } from '../../types/studio';
import { useWorkspaceAgents } from '../../hooks/useWorkspaces';
import { queueChange } from '../../models/pendingChange';
import { connectionChange, connectionId, connectionProblems, type ConnectionAuth } from '../../models/manageChanges';
import { targetPath } from '../../models/agentPages';
import { secretState, type SecretState } from '../../utils/providerOptions';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

const secretNote = (state: SecretState) => (state === 'found' ? 'Set on the server' : state === 'missing' ? 'Not set on the server' : 'Checked when you deploy');
const secretTone = (state: SecretState) => (state === 'found' ? 'bg-success' : state === 'missing' ? 'bg-warning' : 'bg-line-strong');

// a problem as a field shows it: a sentence of its own
const sentence = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : undefined);

function Dot({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-soft">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone)} />
      {children}
    </span>);

}

/**
 * Systems an agent's tools can call. "Add to an agent" puts a connection on that agent's draft (unsaved, to review): its
 * address, and the NAME of the server secret it signs in with. No address or key is kept in the browser, and the key
 * itself is set on the server by an admin.
 */
export function IntegrationsPanel({ secretKeys }: { secretKeys: Record<string, boolean> }) {
  const [category, setCategory] = useState<string>('All');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<IntegrationItem | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return INTEGRATIONS_CATALOG.filter((item) => (category === 'All' || item.category === category) && (item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)));
  }, [category, query]);

  return (
    <div className="mt-6">
      <p className="max-w-3xl text-[13px] text-muted">
        Studio does not connect to these itself. “Add to an agent” puts a connection on the agent’s draft: the system’s address and the name of the secret it
        signs in with. An admin sets that secret on the server under the name shown; no address or key is kept in this browser.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" aria-label="Search integrations…" placeholder="Search integrations…" value={query} onChange={(e) => setQuery(e.target.value)} className={cn(inputClass, 'h-9 pl-9 text-[13px]')} />
        </div>
        <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <Segmented label="Category" size="sm" value={category} onChange={setCategory} options={INTEGRATION_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
          {filtered.length} of {INTEGRATIONS_CATALOG.length}
        </span>
      </div>

      {filtered.length === 0 ?
      <div className="mt-5 rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <SearchXIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">No integrations match</p>
          <button type="button" onClick={() => {setQuery('');setCategory('All');}} className="mt-1 text-xs font-medium text-accent hover:underline">
            Clear the filters
          </button>
        </div> :

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
          const state = secretState(item.defaultSecret, secretKeys);
          return (
            <div key={item.id} data-integration={item.id} className="flex flex-col rounded-xl border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-card">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <PlugIcon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-snug text-ink">{item.name}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">{item.category}</p>
                  </div>
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{item.description}</p>
                <div className="mt-3">
                  <p className="text-[11px] font-medium text-muted">What the tool needs</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.fields.map((f) => <span key={f} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-soft">{f}</span>)}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-4">
                  <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted" title={item.defaultSecret}>
                    <KeyRoundIcon className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{item.defaultSecret}</span>
                  </span>
                  <Dot tone={secretTone(state)}>{secretNote(state)}</Dot>
                </div>
                <Button size="sm" variant="secondary" className="mt-3 self-start" onClick={() => setAdding(item)}>
                  Add to an agent
                </Button>
              </div>);

        })}
        </div>
      }

      {adding && <AddConnection item={adding} secretKeys={secretKeys} onClose={() => setAdding(null)} />}
    </div>);

}

/** What the connection is, asked first; then the agent, whose draft it is added to. */
function AddConnection({ item, secretKeys, onClose }: { item: IntegrationItem; secretKeys: Record<string, boolean>; onClose: () => void }) {
  const navigate = useNavigate();
  const agents = useWorkspaceAgents();
  const [name, setName] = useState(connectionId(item.id.replace(/-/g, '_')));
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState<ConnectionAuth>(item.auth ?? 'bearer');
  const [header, setHeader] = useState(item.header ?? 'X-API-Key');
  const [secret, setSecret] = useState(item.defaultSecret);
  const problems = connectionProblems({ name, url, auth, secret, header });
  const blocked = problems.url || problems.name || problems.secret || problems.header;
  const state = secretState(secret.trim(), secretKeys);

  const pick = (agent: Agent) => {
    if (blocked) return;
    const change = connectionChange({ name, url, auth, secret, header });
    queueChange(agent.id, change);
    onClose();
    navigate(change.target ? targetPath(agent.id, change.target) : `/agents/${agent.id}`);
  };

  return (
    <AgentPickerDialog
      title={`Add ${item.name} to an agent`}
      description="It is added to the agent’s draft as a connection. You review it there and save."
      agents={agents}
      onPick={pick}
      onClose={onClose}
      blocked={blocked ? `First: ${blocked}` : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="connection-url" label="Address of the system" help="Where its API answers, starting https://. Tools add their own path to it." error={url ? sentence(problems.url) : undefined}>
          <input id="connection-url-input" className={cn(inputClass, 'font-mono text-[13px]', url && problems.url && inputErrorClass)} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" spellCheck={false} autoComplete="off" />
        </Field>
        <Field id="connection-name" label="Connection name" help="How tools refer to it. Made unique if the agent already has one." error={sentence(problems.name)}>
          <input id="connection-name-input" className={cn(inputClass, 'font-mono text-[13px]', problems.name && inputErrorClass)} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" />
        </Field>
        <Field id="connection-auth" label="How it signs in">
          <select id="connection-auth-input" className={inputClass} value={auth} onChange={(e) => setAuth(e.target.value as ConnectionAuth)}>
            <option value="bearer">A token (Authorization: Bearer)</option>
            <option value="api_key">A key in a header</option>
            <option value="none">No sign-in</option>
          </select>
        </Field>
        {auth === 'api_key' &&
        <Field id="connection-header" label="Header name" error={sentence(problems.header)}>
            <input id="connection-header-input" className={cn(inputClass, 'font-mono text-[13px]', problems.header && inputErrorClass)} value={header} onChange={(e) => setHeader(e.target.value)} spellCheck={false} />
          </Field>
        }
        {auth !== 'none' &&
        <Field id="connection-secret" label="Server secret name" help="Only the name goes in the draft. An admin sets the key on the server under this name." error={sentence(problems.secret)}>
            <input id="connection-secret-input" className={cn(inputClass, 'font-mono text-[13px]', problems.secret && inputErrorClass)} value={secret} onChange={(e) => setSecret(e.target.value.toUpperCase())} spellCheck={false} autoComplete="off" />
            {!problems.secret && <span className="mt-1.5 block"><Dot tone={secretTone(state)}>{secretNote(state)}</Dot></span>}
          </Field>
        }
      </div>
    </AgentPickerDialog>);

}
