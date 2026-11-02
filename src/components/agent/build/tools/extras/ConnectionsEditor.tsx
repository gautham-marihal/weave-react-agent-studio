import React, { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import {
  AUTH_SECRETS,
  AUTH_TYPES,
  CONNECTION_TYPES,
  addConnection,
  authFor,
  connectionsOf,
  hostOf,
  isObj,
  problemsUnder,
  removeConnection,
  renameConnection,
  secretRef,
  setConnection,
  usedBy,
  type AuthType,
  type ConnectionType,
  type Json,
} from '../../../../../models/toolsExtras';
import { StatusChip } from '../../../../ui/StatusChip';
import { Button } from '../../../../ui/Button';
import { cn, inputClass } from '../../../../../utils/styles';
import { EmptyNote, IdField, ItemCard, Labeled, NumberInput, PairsEditor, SecretInput, Select, TextInput, type ExtraEditorProps } from './shared';

const typeLabel = (t: unknown) => CONNECTION_TYPES.find((c) => c.type === t)?.label ?? String(t ?? 'A connection');

/**
 * Connections (connections{}): the web services its tools call, the senders of its texts and emails, and MCP servers.
 * Sign-in is always a secret's name: the server reads the value, the config never holds it.
 */
export function ConnectionsEditor({ config, disabled, errors, apply, remove }: ExtraEditorProps) {
  const all = connectionsOf(config);
  const [open, setOpen] = useState<string | null>(all.length === 1 ? all[0][0] : null);
  const set = (id: string, changes: Json) => apply(setConnection(config, id, changes));
  const add = (type: ConnectionType) => {
    const made = addConnection(config, type);
    apply(made.config);
    setOpen(made.id);
  };

  return (
    <div className="space-y-3">
      {all.length === 0 && <EmptyNote>No connections yet. A connection is a web service its tools call, such as your billing system, or the service that sends its texts and emails.</EmptyNote>}
      <ul className="space-y-2">
        {all.map(([id, c]) => {
          const auth = isObj(c.auth) ? c.auth : null;
          const authType = (c.type === 'notifier' ? 'none' : String(auth?.type ?? 'none')) as AuthType;
          const where = c.type === 'notifier' ? [c.kind === 'email' ? 'Sends emails' : 'Sends texts', c.provider ? `with ${String(c.provider)}` : ''].filter(Boolean).join(' ') : hostOf(c.base_url ?? c.url) || 'No address yet';
          return (
            <ItemCard
              key={id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <code className="font-mono text-[13px]">{id}</code>
                  <StatusChip>{typeLabel(c.type)}</StatusChip>
                  {c.type === 'mcp' && <StatusChip tone="warning">Not available yet</StatusChip>}
                </span>
              }
              summary={where}
              problems={problemsUnder(errors, 'connections', id)}
              open={open === id}
              onToggle={() => setOpen(open === id ? null : id)}
              onDelete={() => remove(`Connection “${id}” deleted.`, removeConnection(config, id))}
              deleteLabel={`Delete the connection ${id}`}
              disabled={disabled}>
              <IdField
                id={id}
                taken={all.map(([k]) => k)}
                users={usedBy(config, 'connections', id)}
                disabled={disabled}
                onRename={(v) => {
                  apply(renameConnection(config, id, v));
                  setOpen(v);
                }}
              />
              {c.type === 'http' && (
                <>
                  <Labeled label="Address" help="Its tools add their own path to this, such as /bills.">
                    <TextInput value={String(c.base_url ?? '')} onChange={(v) => set(id, { base_url: v })} disabled={disabled} placeholder="https://api.example.com" mono label="Address" />
                  </Labeled>
                  <AuthEditor id={id} auth={auth} authType={authType} disabled={disabled} onChange={(next) => set(id, { auth: next })} />
                  <PairsEditor label="Headers sent with every request" value={c.headers} onChange={(v) => set(id, { headers: v })} disabled={disabled} keyPlaceholder="X-Tenant" valuePlaceholder="acme" />
                  <Labeled label="Give up after (seconds)" help="Left empty: the runtime’s default.">
                    <NumberInput value={c.timeout_s} onChange={(v) => set(id, { timeout_s: v && v > 0 ? v : undefined })} disabled={disabled} min={0.1} step={0.5} label="Give up after" />
                  </Labeled>
                </>
              )}
              {c.type === 'mcp' && (
                <>
                  <p className="rounded-lg bg-warning-soft px-4 py-3 text-[13px] text-ink">The runtime can’t use MCP servers yet. It is kept with the agent and has no effect until it can.</p>
                  <Labeled label="Address">
                    <TextInput value={String(c.url ?? '')} onChange={(v) => set(id, { url: v })} disabled={disabled} placeholder="https://mcp.example.com/crm" mono label="Address" />
                  </Labeled>
                  <Labeled label="How it talks">
                    <Select
                      label="How it talks"
                      value={String(c.transport ?? '')}
                      disabled={disabled}
                      options={[
                        { value: '', label: 'The runtime’s default' },
                        { value: 'streamable_http', label: 'Streamable HTTP' },
                        { value: 'sse', label: 'Server-sent events' },
                      ]}
                      onChange={(v) => set(id, { transport: v })}
                      className="max-w-xs"
                    />
                  </Labeled>
                  <AuthEditor id={id} auth={auth} authType={authType} disabled={disabled} onChange={(next) => set(id, { auth: next })} />
                </>
              )}
              {c.type === 'notifier' && <NotifierFields id={id} c={c} disabled={disabled} set={(changes) => set(id, changes)} />}
            </ItemCard>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        {CONNECTION_TYPES.map((t) => (
          <Button key={t.type} size="sm" variant="secondary" disabled={disabled} onClick={() => add(t.type)} title={t.help}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function AuthEditor({ id, auth, authType, disabled, onChange }: { id: string; auth: Json | null; authType: AuthType; disabled: boolean; onChange: (next: Json | undefined) => void }) {
  return (
    <div className="space-y-3 rounded-lg bg-subtle px-4 py-3">
      <Labeled label="How it signs in">
        <Select label={`How ${id} signs in`} value={authType} disabled={disabled} options={AUTH_TYPES.map((a) => ({ value: a.type, label: a.label }))} onChange={(v) => onChange(authFor(v as AuthType, auth))} className="max-w-xs" />
      </Labeled>
      {authType === 'api_key' && (
        <Labeled label="Header the key goes in">
          <TextInput value={String(auth?.header ?? '')} onChange={(v) => onChange({ ...(auth ?? {}), header: v })} disabled={disabled} placeholder="X-Api-Key" mono label="Header the key goes in" />
        </Labeled>
      )}
      {AUTH_SECRETS[authType].map(({ key, label }) => (
        <SecretInput key={key} label={label} value={auth?.[key]} onChange={(ref) => onChange({ ...(auth ?? {}), [key]: ref })} disabled={disabled} />
      ))}
    </div>
  );
}

const PROVIDERS = ['twilio', 'sendgrid', 'microsoft_graph'];

/** A sender of texts or emails: which service, from what, and the secret names of its credentials. */
function NotifierFields({ id, c, disabled, set }: { id: string; c: Json; disabled: boolean; set: (changes: Json) => void }) {
  const creds: [string, string][] = Object.entries(isObj(c.auth) ? c.auth : {}).map(([k, v]) => [k, isObj(v) && typeof v.secret === 'string' ? v.secret : '']);
  const [adding, setAdding] = useState(false);
  const rows: [string, string][] = adding ? [...creds, ['', '']] : creds;
  const write = (next: [string, string][]) => {
    const auth: Json = {};
    next.forEach(([k, v]) => {
      if (k.trim()) auth[k.trim()] = secretRef(v);
    });
    set({ auth });
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Labeled label="It sends">
          <Select label="It sends" value={String(c.kind ?? '')} disabled={disabled} options={[{ value: 'sms', label: 'Texts' }, { value: 'email', label: 'Emails' }]} onChange={(v) => set({ kind: v })} />
        </Labeled>
        <Labeled label="Service">
          <input className={cn(inputClass, 'font-mono text-[13px]')} list={`providers-${id}`} value={String(c.provider ?? '')} disabled={disabled} aria-label="Service" placeholder="twilio" onChange={(e) => set({ provider: e.target.value })} />
          <datalist id={`providers-${id}`}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Labeled>
        <Labeled label="From">
          <TextInput value={String(c.from ?? '')} onChange={(v) => set({ from: v })} disabled={disabled} placeholder={c.kind === 'email' ? 'support@example.com' : '+15555550123'} label="From" />
        </Labeled>
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium text-ink-soft">Its credentials, as secret names</legend>
        <p className="text-xs text-muted">Each is the name of a secret kept on the server, such as TWILIO_AUTH_TOKEN. Never the value itself.</p>
        <div className="mt-1.5 space-y-1.5">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex gap-2">
              <input className={cn(inputClass, 'w-44 font-mono text-[13px]')} value={k} placeholder="auth_token" aria-label={`Credential ${i + 1}`} disabled={disabled} onChange={(e) => { if (i >= creds.length) setAdding(false); write(rows.map((r, n): [string, string] => (n === i ? [e.target.value, r[1]] : r))); }} />
              <input className={cn(inputClass, 'min-w-0 flex-1 font-mono text-[13px]')} value={v} placeholder="SECRET_NAME" autoComplete="off" aria-label={`Secret for ${k || `credential ${i + 1}`}`} disabled={disabled || !k} onChange={(e) => write(rows.map((r, n): [string, string] => (n === i ? [r[0], e.target.value] : r)))} />
              <Button size="sm" variant="ghost" aria-label={`Remove ${k || 'credential'}`} disabled={disabled} onClick={() => (i >= creds.length ? setAdding(false) : write(creds.filter((_, n) => n !== i)))}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="mt-1" disabled={disabled || adding} onClick={() => setAdding(true)}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a credential
        </Button>
      </fieldset>
    </>
  );
}
