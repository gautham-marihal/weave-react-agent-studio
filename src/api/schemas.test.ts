import { afterEach, describe, expect, it, vi } from 'vitest';
import * as S from './schemas';
import { api, ApiError, checked } from './client';
import { createDemoApi, memoryStorage } from '../sandbox/agentBuilderSandbox.js';

// The client checks every answer it reads against what the studio expects of it (schemas.ts): an answer of another
// shape is a clear error that names the field, never a blank tile further on; and what the server sends today (and
// the Sandbox's imitation of it, which is also the browser tests' stand-in API) always passes.
// Ported from Weave React's tests/schemas.test.js.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the answers the studio knows pass', () => {
  it('every read of the Sandbox (and the browser tests’ stand-in API) passes the checks the client makes on the real API', async () => {
    const sandbox = createDemoApi({ storage: memoryStorage() });
    const read = async <T>(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }, path: string): Promise<T> => {
      const { status, body } = await sandbox.handle('GET', path);
      expect(status, `${path} answered ${status}`).toBeLessThan(400);
      const result = schema.safeParse(body);
      expect(result.success, `${path}: ${result.success ? '' : JSON.stringify(result.error?.issues.slice(0, 2))}`).toBe(true);
      return body as T;
    };
    await read(S.Health, '/health');
    await read(S.Environments, '/environments');
    await read(S.ProvidersAnswer, '/providers');
    await read(S.JsonSchema, '/schema');
    const bots = await read<Array<{ id: string }>>(S.BotList, '/bots');
    expect(bots.length).toBeGreaterThan(0);
    for (const bot of bots) {
      const id = encodeURIComponent(bot.id);
      await read(S.BotSummary, `/bots/${id}`);
      const draft = await read<{ config: unknown }>(S.Draft, `/bots/${id}/draft`);
      const versions = await read<Array<{ version: string }>>(S.VersionList, `/bots/${id}/versions`);
      if (versions[0]) {
        await read(S.Version, `/bots/${id}/versions/${encodeURIComponent(versions[0].version)}`);
        await read(S.Diff, `/bots/${id}/diff?a=${encodeURIComponent(versions[0].version)}&b=draft`);
      }
      const deployments = await read<{ history: Array<{ id: string }> }>(S.Deployments, `/bots/${id}/deployments`);
      for (const d of deployments.history.slice(-2)) await read(S.DeploymentAnswer, `/bots/${id}/deployments/${encodeURIComponent(d.id)}`);
      const page = await read<{ calls: Array<{ id: string }> }>(S.CallPage, `/bots/${id}/calls?limit=10`);
      for (const call of page.calls.slice(0, 3)) await read(S.CallRecords, `/bots/${id}/calls/${encodeURIComponent(call.id)}?limit=50`);
      const { body: report } = await sandbox.handle('POST', '/validate', draft.config);
      expect(S.ValidationReport.safeParse(report).success, 'POST /validate').toBe(true);
    }
  });

  it('the answers as the server sends them pass: fields it adds are kept, and the nulls and pages it uses are expected', () => {
    const records = {
      call: { id: 'c1', bot: 'a', started_at: '2026-10-20T10:00:00Z', status: 'ended', duration_s: 42, caller: null, dialled: null, size: 1200 },
      events: [{ t: '2026-10-20T10:00:00Z', seq: 1, elapsed_s: 0, event: 'call_started', room: 'r' }],
      next_after: 1,
      more: false,
      complete: true,
      counts: { call_started: 1 },
    };
    expect(checked(S.CallRecords, records, 'GET /x')).toBe(records);
    const deployments = {
      current: { staging: { id: 'd1', version: '0.1.0', deployed_at: '2026-10-20T10:00:00Z', deployed_by: 'sam' } },
      history: [
        { id: 'd1', status: 'active', environment: 'staging', version: '0.1.0', previous_version: null, deployed_at: '2026-10-20T10:00:00Z', deployed_by: 'sam', note: null },
      ],
    };
    expect(S.Deployments.safeParse(deployments).success).toBe(true);
    expect(S.ValidationReport.safeParse({ valid: true, errors: [], warnings: [] }).success, 'an older server: no unsupported, no secrets').toBe(true);
    const page = { calls: [{ id: 'c', started_at: '2026-10-20T10:00:00Z', status: 'ended', channel: 'web_chat' }], next: null };
    expect(S.CallPage.safeParse(page).success, 'a channel given by its id alone, as Studio’s types allow').toBe(true);
  });
});

describe('an answer of another shape', () => {
  const wrong = (schema: Parameters<typeof checked>[0], data: unknown): ApiError => {
    try {
      checked(schema, data, 'GET /bots');
    } catch (error) {
      return error as ApiError;
    }
    throw new Error('it passed');
  };

  it('is an error that says which field', () => {
    const error = wrong(S.BotList, [{ id: 'a', name: 'A', draft_revision: '3', draft_saved_at: null, latest_version: null, deployed: {} }]);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('unexpected');
    expect(error.message).toBe('The server sent something unexpected (GET /bots: [0].draft_revision should be a number).');
    expect(wrong(S.BotList, { bots: [] }).message).toMatch(/the answer should be an array/);
    expect(wrong(S.CallPage, { next: null }).message).toMatch(/calls is missing|calls should be an array/);
    expect(wrong(S.Deployments, { current: {}, history: [{ id: 'd', status: 'sideways' }] }).message).toMatch(
      /history\[0\]\.status has a value the studio doesn’t know/
    );
  });

  it('reaches the page as an ApiError from the read itself, and is not asked again', async () => {
    let asked = 0;
    vi.stubGlobal('fetch', async () => {
      asked += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ bots: [] }) } as Response;
    });
    const error = await api.listBots().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('unexpected');
    expect((error as ApiError).message).toBe('The server sent something unexpected (GET /bots: the answer should be an array).');
    expect(asked).toBe(1);
  });

  it('a write is not checked, so one that went through is never reported as failed', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ surprise: true }) }) as Response);
    await expect(api.publish('a')).resolves.toEqual({ surprise: true });
  });
});
