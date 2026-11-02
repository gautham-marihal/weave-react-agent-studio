// Sandbox's sample banking agent, "Weave Bank assistant": made when Sandbox starts (and again after "Start the sample
// data again") exactly as the Create dialog's Banking assistant starter makes one (models/bankingAgent.ts), with the
// banking gateway's own generated config, so a person can open it and press Test straight away. Sandbox only.
import type { AgentConfig } from '../types/studio';
import type { ProvidersAnswer } from '../api/types';
import { starters } from '../data/starters';
import { newBankingAssistant } from '../models/bankingAgent';
import { applyStarter } from '../models/setup';
import type { SandboxApi } from './agentBuilderSandbox.js';

export const BANKING_SAMPLE_ID = 'weave-bank';
export const BANKING_SAMPLE_NAME = 'Weave Bank assistant';
/** Set once the sample was made, so an agent the person deleted is not made again (until the sample data restarts). */
export const BANKING_SAMPLE_KEY = 'weave_sandbox_banking_sample';

const marked = (): boolean => {
  try {
    return window.localStorage.getItem(BANKING_SAMPLE_KEY) === 'made';
  } catch {
    return false;
  }
};
const mark = (on: boolean) => {
  try {
    if (on) window.localStorage.setItem(BANKING_SAMPLE_KEY, 'made');
    else window.localStorage.removeItem(BANKING_SAMPLE_KEY);
  } catch {
    // storage unavailable: it is checked again next time
  }
};

/** Forgets that the sample was made (the sample data starts again). */
export const forgetBankingSample = (): void => mark(false);

/** Makes the sample banking agent in the Sandbox API, once. Never throws: without it, Sandbox works as before. */
export async function makeBankingSample(api: SandboxApi): Promise<void> {
  try {
    if (marked()) return;
    if ((await api.handle('GET', `/bots/${BANKING_SAMPLE_ID}`)).status === 200) {
      mark(true);
      return;
    }
    const starter = starters.find((s) => s.banking);
    if (!starter) return;
    const { gateway } = await import('../api/gateway');
    const generated = await gateway.agentConfig();
    const created = await api.handle('POST', '/bots', { id: BANKING_SAMPLE_ID, name: BANKING_SAMPLE_NAME });
    if (created.status !== 201) return;
    const draft = created.body as { config: AgentConfig; revision: number };
    const providers = (await api.handle('GET', '/providers')).body as ProvidersAnswer | undefined;
    const base = applyStarter(draft.config, { company: 'Weave Bank', starter });
    const made = newBankingAssistant(base, generated, { providers: providers ?? null, botId: BANKING_SAMPLE_ID });
    if (!made.ok) return;
    const saved = await api.handle('PUT', `/bots/${BANKING_SAMPLE_ID}/draft`, { config: made.config, base_revision: draft.revision });
    if (saved.status === 200) mark(true);
  } catch {
    // the banking gateway did not answer: no sample banking agent this time
  }
}
