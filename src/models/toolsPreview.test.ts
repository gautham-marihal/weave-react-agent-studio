import { describe, expect, it } from 'vitest';
import { normalizeResultPreview, readJson, resultPreviewBody, sampleArgs, taskWords } from './toolsPreview';

describe('a tool’s “Try it”', () => {
  it('reads the answer from `result` or from the top, and a question with no sample answer has no answer part', () => {
    const nested = normalizeResultPreview({
      request: { method: 'GET', url: 'https://x/orders/1', query: { a: '1' }, auth: { type: 'bearer', secrets: ['KEY'] } },
      preconditions: { holds: false, message: 'Verify first' },
      args_problems: ['order_id is required', { message: 'extra' }],
      result: {
        model_sees: { found: true },
        model_sees_text: "{'found': True}",
        stored_in_state: { ticket: 'T1' },
        kept_from_the_model: ['link'],
        effects: ['says a line', { text: 'sets verified' }],
      },
    });
    expect(nested.request?.url).toBe('https://x/orders/1');
    expect(nested.request?.auth).toEqual({ type: 'bearer', secrets: ['KEY'] });
    expect(nested.preconditions).toEqual({ holds: false, message: 'Verify first' });
    expect(nested.argsProblems).toEqual(['order_id is required', 'extra']);
    expect(nested.hasAnswer).toBe(true);
    expect(nested.modelSeesText).toBe("{'found': True}");
    expect(nested.storedInState).toEqual({ ticket: 'T1' });
    expect(nested.effects).toEqual(['says a line', 'sets verified']);
    const top = normalizeResultPreview({ model_sees_text: 'x', stored_in_state: { a: 1 } });
    expect(top.hasAnswer).toBe(true);
    expect(top.storedInState).toEqual({ a: 1 });
    const onlyRequest = normalizeResultPreview({ request: { method: 'POST', url: 'u' } });
    expect(onlyRequest.hasAnswer).toBe(false);
    expect(onlyRequest.modelSeesText).toBe('');
    expect(normalizeResultPreview(null).request).toBeNull();
  });

  it('says which task a task tool starts, and whether it would run', () => {
    const runs = normalizeResultPreview({ task: { id: 'verify_identity', steps: [{ id: 'ask_dob' }, { id: 'check' }], would_run: true } });
    expect(taskWords(runs.task)).toBe('Starts the task “verify_identity” (2 steps: ask_dob, check). It would run now.');
    const done = normalizeResultPreview({ task: { id: 'verify_identity', step_ids: ['ask_dob'], skipped_now: true } });
    expect(taskWords(done.task)).toBe('Starts the task “verify_identity” (1 step: ask_dob). It would not run now, because it is already done.');
    expect(normalizeResultPreview({ request: { method: 'GET' } }).task).toBeNull();
    expect(taskWords(null)).toBe('');
  });

  it('starts from arguments made from the parameters: an example, a default, the first choice, or by kind', () => {
    expect(
      sampleArgs({
        properties: {
          order_id: { type: 'string', examples: ['NB-1003'] },
          qty: { type: 'integer' },
          express: { type: 'boolean' },
          size: { enum: ['s', 'm'] },
          note: { type: 'string' },
          tags: { type: 'array' },
          mode: { type: 'string', default: 'fast' },
        },
      })
    ).toEqual({ order_id: 'NB-1003', qty: 1, express: true, size: 's', note: 'a note', tags: [], mode: 'fast' });
    expect(sampleArgs(undefined)).toEqual({});
  });

  it('reads typed JSON, and asks the server with the editor’s config', () => {
    expect(readJson('{"a":1}', { object: true })).toEqual({ value: { a: 1 } });
    expect(readJson('[1]', { object: true }).error).toMatch(/JSON object/);
    expect(readJson('{', { object: true }).error).toMatch(/Not valid JSON/);
    expect(readJson('', { object: true })).toEqual({ value: {} });
    expect(readJson('')).toEqual({});
    expect(resultPreviewBody({ x: 1 }, 't', { a: 1 })).toEqual({ config: { x: 1 }, tool: 't', args: { a: 1 } });
    expect(resultPreviewBody({}, 't', {}, { ok: true }).response).toEqual({ ok: true });
  });
});
