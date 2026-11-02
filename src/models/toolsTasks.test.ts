import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { addStep, addTask, askProblem, checkedWords, describeTask, endingWords, moveStep, normalizeTask, removeStep, removeTask, setOutcome, setStep, stepSay, stepState, taskPreviewBody } from './toolsTasks';

const verify = {
  id: 'verify_customer',
  kind: 'verification',
  steps: [
    { id: 'account', ask: 'Ask for the account number.', skip_if: { state: 'customer', not_equals: null }, validate: { type: 'tool', tool: 'lookup_account' } },
    { id: 'surname', ask: 'Ask for the surname on the account.', validate: { type: 'tool', tool: 'check_surname' } },
  ],
  max_attempts: 3,
  on_success: { set_state: { verified: true }, resume: 'caller', silent: true },
  on_failure: { outcome: 'failed', resume: 'caller', silent: false },
  on_decline: { outcome: 'declined', resume: 'caller', silent: false },
};
const config = (): AgentConfig => ({ tasks: [JSON.parse(JSON.stringify(verify))] });

describe('a task read step by step', () => {
  it('reads top to bottom: what is asked, how it is checked, when it is skipped, and how it ends', () => {
    const task = describeTask(verify);
    expect(task.summary).toBe('Checks who the caller is in 2 steps.');
    expect(task.steps.map((s) => [s.number, s.id])).toEqual([
      [1, 'account'],
      [2, 'surname'],
    ]);
    expect(task.steps[0].notes).toEqual(['skipped when “customer” is already known', 'checked by the tool “lookup_account”', 'up to 3 tries']);
    expect(task.steps[1].ask).toBe('Ask for the surname on the account.');
    expect(task.outcomes.map((o) => [o.label, o.text])).toEqual([
      ['When it works', 'remembers verified = true, goes back to the agent that started it, says nothing'],
      ['If it fails', 'result “failed”, goes back to the agent that started it'],
      ['If the caller declines', 'result “declined”, goes back to the agent that started it'],
    ]);
    expect(describeTask(null)).toEqual({ summary: '', steps: [], outcomes: [] });
  });

  it('names a keypad answer, a pattern check, a say step and a chained task', () => {
    const task = describeTask({
      kind: 'custom',
      steps: [{ id: 'pin', ask: 'Ask for the PIN.', input: 'dtmf', validate: { type: 'regex', pattern: '^\\d{4}$' }, max_attempts: 1 }, { id: 'thanks', type: 'say', do: [{ type: 'say', text: 'Thanks' }] }],
      on_success: { next: 'set_pin' },
    });
    expect(task.summary).toBe('A task of its own in 2 steps.');
    expect(task.steps[0].notes).toEqual(['checked by the pattern /^\\d{4}$/', 'answered on the keypad', 'up to 1 try']);
    expect(task.steps[1].ask).toBe('Says a line');
    expect(task.outcomes[0].text).toBe('starts the task “set_pin”');
  });
});

describe('editing a task', () => {
  it('adds a task with a first step and a free id, and takes it away again', () => {
    const { config: c, index } = addTask(config());
    expect(index).toBe(1);
    expect(c.tasks?.[1].id).toBe('verify_caller');
    expect(c.tasks?.[1].steps).toHaveLength(1);
    expect(removeTask(removeTask(c, 1), 0).tasks).toBeUndefined();
  });

  it('adds, moves and removes steps; the last step stays', () => {
    let c = addStep(config(), 0, 'say');
    expect(c.tasks?.[0].steps[2]).toEqual({ id: 'say', type: 'say', do: [{ type: 'say', text: 'One moment, please.' }] });
    c = moveStep(c, 0, 2, 0);
    expect(c.tasks?.[0].steps.map((s: { id: string }) => s.id)).toEqual(['say', 'account', 'surname']);
    expect(moveStep(c, 0, 0, -1)).toEqual(c);
    c = removeStep(removeStep(c, 0, 0), 0, 0);
    expect(removeStep(c, 0, 0).tasks?.[0].steps).toHaveLength(1);
  });

  it('changing a step’s kind keeps only what applies', () => {
    const c = setStep(config(), 0, 1, { type: 'say' });
    const step = c.tasks?.[0].steps[1];
    expect(step.ask).toBeUndefined();
    expect(step.validate).toBeUndefined();
    expect(stepSay(step)).toBe('One moment, please.');
    const back = setStep(c, 0, 1, { type: 'collect' });
    expect(back.tasks?.[0].steps[1]).toEqual({ id: 'surname', ask: '' });
    const keypad = setStep(config(), 0, 0, { input: 'dtmf', dtmf: { num_digits: 4 } });
    expect(keypad.tasks?.[0].steps[0].dtmf).toEqual({ num_digits: 4 });
    expect(setStep(keypad, 0, 0, { input: 'speech' }).tasks?.[0].steps[0].dtmf).toBeUndefined();
  });

  it('an ending changed keeps silent: false, and goes when nothing is left', () => {
    const c = setOutcome(config(), 0, 'on_decline', { outcome: undefined, resume: undefined });
    expect(c.tasks?.[0].on_decline).toEqual({ silent: false });
    const gone = setOutcome({ tasks: [{ id: 't', on_failure: { resume: 'caller' } }] }, 0, 'on_failure', { resume: undefined });
    expect(gone.tasks?.[0].on_failure).toBeUndefined();
  });
});

describe('the server’s preview of a task', () => {
  it('reads every step, what is skipped or held back, and the endings', () => {
    const view = normalizeTask({
      steps: [
        { id: 'a', type: 'collect', skipped_now: true, instructions: 'Ask.', answer_mode: 'tool_arguments', checked_by: { tool: 'check', args: {} }, attempts: 3 },
        { id: 'b', type: 'collect', held_back_now: true, answer_mode: 'keypad', keypad: { num_digits: 4, timeout_s: 10, terminator: '#' }, problems: ['only a phone call'] },
        { id: 'c', type: 'say', actions: ['Says a line.'] },
      ],
      attempts: { limit: 3, counted: 'task' },
      skipped_now: false,
      keeps_history: false,
      endings: {
        verified: { silent: true, tells_the_calling_agent: 'Carry on.', then_runs: [], resumes: 'caller' },
        failed: {},
        declined: { next_task: 'other' },
      },
      offered_by: ['verify_tool'],
    });
    expect(view.steps).toHaveLength(3);
    expect(stepState(view.steps[0]).tag).toBe('skipped');
    expect(stepState(view.steps[1]).tag).toBe('held');
    expect(stepState(view.steps[2]).tag).toBe('runs');
    expect(checkedWords(view.steps[0])).toBe('by the tool “check”');
    expect(checkedWords({ checkedBy: '^\\d+$' })).toBe('by the pattern /^\\d+$/');
    expect(checkedWords({ checkedBy: { pattern: '^\\d+$' } })).toBe('by the pattern /^\\d+$/');
    expect(checkedWords({ checkedBy: null })).toBe('');
    expect(view.steps[1].keypad?.numDigits).toBe(4);
    expect(view.endings.map((e) => e.name)).toEqual(['verified', 'failed', 'declined']);
    expect(view.endings[2].nextTask).toBe('other');
    expect(endingWords(view.endings[0])).toBe('It worked, then the agent that started it carries on without saying anything. The agent is told: “Carry on.”');
    expect(endingWords(view.endings[2])).toBe('The caller declined, then the task “other” starts.');
    expect(normalizeTask({}).steps).toEqual([]);
    expect(normalizeTask(null).endings).toEqual([]);
  });

  it('a failed ask is explained without technical words', () => {
    expect(askProblem({ kind: 'not_found', status: 404, message: 'There is no task nope.' })).toBe('There is no task nope.');
    expect(askProblem({ status: 404, message: 'Request failed (404).' })).toMatch(/cannot try this setting yet/);
    expect(askProblem({ status: 405, message: 'x' })).toMatch(/cannot try this setting yet/);
    expect(askProblem({ kind: 'client_bug', status: 422, message: 'The app sent a malformed request (body.text: x).' })).not.toMatch(/malformed/);
    expect(askProblem({ message: 'boom' })).toMatch(/boom/);
    expect(askProblem(null)).toBe('');
  });

  it('builds the request body, with what is remembered only when it is a JSON object', () => {
    const c = config();
    expect(taskPreviewBody(c, 'verify_customer', '', '')).toEqual({ body: { config: c, task: 'verify_customer' } });
    expect(taskPreviewBody(c, 'verify_customer', '{"verified": true}', 'phone')).toEqual({ body: { config: c, task: 'verify_customer', state: { verified: true }, channel: 'phone' } });
    expect('error' in taskPreviewBody(c, 'v', '[1]', '')).toBe(true);
    expect('error' in taskPreviewBody(c, 'v', '{nope', '')).toBe(true);
  });
});
