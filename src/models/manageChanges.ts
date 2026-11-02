// The changes the Library and the Create dialog queue for an agent's draft (models/pendingChange.ts carries them):
// "use this voice", "add this connection", "start from this template". Pure.

import type { AgentConfig } from '../types/studio';
import type { PendingChange } from './pendingChange';
import { ttsProviders } from '../data/providers';

/** "Use this voice": the agent speaks with it. The provider's first model is used when the provider changes. */
export function voiceChange(voice: { name: string; provider: string; voiceId: string }): PendingChange {
  const provider = voice.provider.trim().toLowerCase();
  const model = ttsProviders.find((p) => p.id === provider)?.models[0]?.id;
  return {
    note: `The voice “${voice.name}” (${voice.provider}) is set on this draft.`,
    edits: [{ op: 'set_voice', provider, voiceId: voice.voiceId, ...(model ? { model } : {}) }],
    target: { stage: 'build', section: 'agent', focus: 'voice' },
  };
}

/** Connection ids are lowercase letters, digits, _ and -, starting with a letter (the schema's pattern). */
export function connectionId(name: string): string {
  const id = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 60);
  return id || 'connection';
}

export type ConnectionAuth = 'bearer' | 'api_key' | 'none';

interface ConnectionForm {
  name: string;
  url: string;
  auth: ConnectionAuth;
  secret: string;
  header?: string;
}

/** What still has to be filled in before a connection can be added ('' for each part that is fine). */
export function connectionProblems({ name, url, auth, secret, header = '' }: ConnectionForm) {
  const address = url.trim();
  let urlProblem = '';
  if (!address) urlProblem = 'give the system’s address.';
  else if (!/^https?:\/\/[^\s/]+/i.test(address)) urlProblem = 'the address starts with https:// (or http://).';
  return {
    url: urlProblem,
    name: /^[a-z][a-z0-9_-]{0,63}$/.test(name.trim()) ? '' : 'a connection name has lowercase letters, digits, _ and -, starting with a letter.',
    secret: auth === 'none' || /^[A-Z][A-Z0-9_]{0,127}$/.test(secret.trim()) ? '' : 'a secret name has capital letters, digits and _, like CRM_API_TOKEN.',
    header: auth !== 'api_key' || /^[A-Za-z0-9-]+$/.test(header.trim()) ? '' : 'a header name has letters, digits and -.',
  };
}

/**
 * "Add this connection": an HTTP connection on the draft that signs in with a secret the server holds. Only the
 * secret's NAME is written; the key itself is set on the server by an admin and never passes through the browser.
 */
export function connectionChange({ name, url, auth, secret, header = 'X-API-Key' }: ConnectionForm): PendingChange {
  const connection: Record<string, unknown> = { type: 'http', base_url: url.trim(), timeout_s: 10 };
  if (auth === 'bearer') connection.auth = { type: 'bearer', token: { secret: secret.trim() } };
  if (auth === 'api_key') connection.auth = { type: 'api_key', header: header.trim() || 'X-API-Key', key: { secret: secret.trim() } };
  const id = connectionId(name);
  const signIn = auth === 'none' ? '' : ` It signs in with the server secret ${secret.trim()}.`;
  return {
    note: `A connection to ${url.trim()} is added to this draft.${signIn} Tools can now use it.`,
    edits: [{ op: 'add_connection', id, connection }],
    target: { stage: 'build', section: 'tools' },
  };
}

/** A template that could not be saved when the agent was made: it lands in the new agent's draft instead. */
export const templateChange = (config: AgentConfig, name: string): PendingChange => ({
  note: `The template “${name}” is applied to this draft. It couldn’t be saved when the agent was created.`,
  edits: [{ op: 'use_template', config }],
});
