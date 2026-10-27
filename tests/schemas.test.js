import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/api/schemas.ts';
import { ApiError, checked } from '../src/api/client.ts';
import { createDemoApi, memoryStorage } from '../src/demo/demoApi.js';

// The client checks every answer it reads against what the studio expects of it (src/api/schemas.ts): an answer of another shape is a clear error that
// names the field, never a blank tile further on; and what the server sends today (and the demo's imitation of it) always passes.

test('every read of the demo passes the checks the client makes on the real API', async () => {
  const api = createDemoApi({ storage: memoryStorage() });
  const read = async (schema, path) => {
    const { status, body } = await api.handle('GET', path);
    assert.ok(status < 400, `${path} answered ${status}`);
    const result = schema.safeParse(body);
    assert.ok(result.success, `${path}: ${result.success ? '' : JSON.stringify(result.error.issues.slice(0, 2))}`);
    return body;
  };
  await read(S.Health, '/health');
  await read(S.Environments, '/environments');
  await read(S.ProvidersAnswer, '/providers');
  const bots = await read(S.BotList, '/bots');
  assert.ok(bots.length > 0);
  for (const bot of bots) {
    const id = encodeURIComponent(bot.id);
    await read(S.BotSummary, `/bots/${id}`);
    const draft = await read(S.Draft, `/bots/${id}/draft`);
    const versions = await read(S.VersionList, `/bots/${id}/versions`);
    if (versions[0]) {
      await read(S.Version, `/bots/${id}/versions/${encodeURIComponent(versions[0].version)}`);
      await read(S.Diff, `/bots/${id}/diff?a=${encodeURIComponent(versions[0].version)}&b=draft`);
    }
    await read(S.Deployments, `/bots/${id}/deployments`);
    const page = await read(S.CallPage, `/bots/${id}/calls?limit=10`);
    for (const call of page.calls.slice(0, 3)) await read(S.CallRecords, `/bots/${id}/calls/${encodeURIComponent(call.id)}?limit=50`);
    const { body: report } = await api.handle('POST', '/validate', draft.config);
    assert.ok(S.ValidationReport.safeParse(report).success, 'POST /validate');
  }
});

test('the answers as the server sends them pass: fields it adds are kept, and the nulls and pages it uses are expected', () => {
  const records = {
    call: { id: 'c1', bot: 'a', started_at: '2026-10-20T10:00:00Z', status: 'ended', duration_s: 42, caller: null, dialled: null, size: 1200 },
    events: [{ t: '2026-10-20T10:00:00Z', seq: 1, elapsed_s: 0, event: 'call_started', room: 'r' }],
    next_after: 1,
    more: false,
    complete: true,
    counts: { call_started: 1 },
  };
  assert.equal(checked(S.CallRecords, records, 'GET /x'), records, 'given back as it came');
  const deployments = {
    current: { staging: { id: 'd1', version: '0.1.0', deployed_at: '2026-10-20T10:00:00Z', deployed_by: 'sam' } },
    history: [
      {
        id: 'd1',
        status: 'active',
        environment: 'staging',
        version: '0.1.0',
        previous_version: null,
        deployed_at: '2026-10-20T10:00:00Z',
        deployed_by: 'sam',
        note: null,
      },
    ],
  };
  assert.ok(S.Deployments.safeParse(deployments).success, 'a deployment without a note');
  assert.ok(S.ValidationReport.safeParse({ valid: true, errors: [], warnings: [] }).success, 'an older server: no unsupported, no secrets');
});

test('an answer of another shape is an error that says which field, and is not asked again', () => {
  const wrong = (schema, data) => {
    try {
      checked(schema, data, 'GET /bots');
    } catch (error) {
      return error;
    }
    return null;
  };
  const error = wrong(S.BotList, [{ id: 'a', name: 'A', draft_revision: '3', draft_saved_at: null, latest_version: null, deployed: {} }]);
  assert.ok(error instanceof ApiError);
  assert.equal(error.kind, 'unexpected');
  assert.equal(error.message, 'The server sent something unexpected (GET /bots: [0].draft_revision should be a number).');
  assert.match(wrong(S.BotList, { bots: [] }).message, /the answer should be an array/);
  assert.match(wrong(S.CallPage, { next: null }).message, /calls is missing|calls should be an array/);
  assert.match(
    wrong(S.Deployments, { current: {}, history: [{ id: 'd', status: 'sideways' }] }).message,
    /history\[0\]\.status has a value the studio doesn’t know/,
  );
});
