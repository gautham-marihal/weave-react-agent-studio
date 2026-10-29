import { GATEWAY_CONNECTION, usesGateway, type AgentConfig } from './gatewayConfig.ts';

// The Banking page's own settings, kept in the agent's draft like every other setting (saved, published and versioned
// with it): the bank's name, as the constant `banking_name` (the runtime can use it as {{const.banking_name}}). The
// voice is the agent's own voice (defaults.models.tts), chosen on the same page with the same picker as the Agent page.
// Pure: no React, no DOM.

export const BANKING_NAME_CONSTANT = 'banking_name';
export const BANKING_NAME_MAX = 60;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The bank's name as the owner set it ('' when not set). */
export const readBankingName = (config: AgentConfig | null | undefined): string => str(config?.constants?.[BANKING_NAME_CONSTANT]);

/** The draft with the bank's name set (spaces collapsed, at most 60 characters), or removed when empty. */
export function withBankingName(config: AgentConfig, name: string): AgentConfig {
  const clean = name.replace(/\s+/g, ' ').trimStart().slice(0, BANKING_NAME_MAX);
  const constants = { ...(config.constants ?? {}) };
  if (clean.trim()) constants[BANKING_NAME_CONSTANT] = clean;
  else delete constants[BANKING_NAME_CONSTANT];
  return { ...config, constants };
}

/** The name callers hear: the bank's name, else the agent's own name. */
export function bankDisplayName(config: AgentConfig | null | undefined): string {
  const meta = config?.meta as { name?: unknown } | undefined;
  const persona = config?.persona as { name?: unknown } | undefined;
  return readBankingName(config) || str(persona?.name) || str(meta?.name) || 'Business Banking';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where the Banking part stands, for Build's side list and the Overview. */
export function bankingPart(config: AgentConfig): { state: 'done' | 'todo' | 'optional'; status: string } {
  if (!usesGateway(config)) return { state: 'optional', status: 'Not a banking agent yet: add the banking gateway’s tools to make it one.' };
  const tools = (config.tools ?? []).filter((t) => t?.connection === GATEWAY_CONNECTION).length;
  const name = readBankingName(config);
  return name
    ? { state: 'done', status: `${name} · ${plural(tools, 'banking tool')}.` }
    : { state: 'todo', status: `Still to choose: the bank’s name · ${plural(tools, 'banking tool')}.` };
}
