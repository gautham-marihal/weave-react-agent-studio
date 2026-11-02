import { describe, expect, it, vi } from 'vitest';
import { createDemoApi, memoryStorage } from './agentBuilderSandbox.js';
import { createBrowserGateway } from './banking/gatewayInBrowser.js';
import { BANKING_SAMPLE_ID, BANKING_SAMPLE_NAME, makeBankingSample } from './bankingSample';
import { isBankingAgent } from '../models/bankingAgent';
import { reachOf } from '../models/setup';
import type { AgentConfig } from '../types/studio';

// The gateway's own generated config, from the gateway built for the browser (as Sandbox gets it with no server).
vi.mock('../api/gateway', () => ({
  gateway: {
    agentConfig: async () => JSON.parse((await createBrowserGateway().request({ method: 'GET', path: '/v1/agent-config' })).body),
  },
}));

describe('the sample banking agent', () => {
  it('is made in the Sandbox API as a banking agent on web chat and web voice, once', async () => {
    const api = createDemoApi({ storage: memoryStorage(), quietNewAgents: true });
    await makeBankingSample(api);
    const bot = await api.handle('GET', `/bots/${BANKING_SAMPLE_ID}`);
    expect(bot.status).toBe(200);
    expect((bot.body as { name: string }).name).toBe(BANKING_SAMPLE_NAME);
    const draft = (await api.handle('GET', `/bots/${BANKING_SAMPLE_ID}/draft`)).body as { config: AgentConfig; revision: number };
    expect(isBankingAgent(draft.config)).toBe(true);
    expect(draft.config.agents?.entry).toBe('greeter');
    expect(reachOf(draft.config)).toMatchObject({ web_chat: true, web_voice: true });
    await makeBankingSample(api);
    expect(((await api.handle('GET', `/bots/${BANKING_SAMPLE_ID}/draft`)).body as { revision: number }).revision).toBe(draft.revision);
    // the sample agents Sandbox starts with are still there
    expect(((await api.handle('GET', '/bots')).body as Array<{ id: string }>).map((b) => b.id)).toEqual(['acme-support', 'front-desk', 'bookings', BANKING_SAMPLE_ID]);
  });
});
