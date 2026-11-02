// Multi-step tasks (`tasks`): a task read top to bottom (what each step asks, how the answer is checked, when a step is
// skipped, how it ends), the edits the task editor makes, and the server's POST /preview/task answer read tolerantly
// into plain words. Pure: no React, no network.
import type { AgentConfig } from '../types/studio';
import { freeId, isObj, list, moveItem, patch, type Json } from './toolsExtras';

const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? {})) as T;

export const TASK_KINDS: { kind: string; label: string }[] = [
  { kind: 'verification', label: 'Checks who the caller is' },
  { kind: 'collect_fields', label: 'Collects details' },
  { kind: 'confirmation', label: 'Asks the caller to confirm' },
  { kind: 'custom', label: 'A task of its own' },
];
const KIND_WORDS: Record<string, string> = Object.fromEntries(TASK_KINDS.map((k) => [k.kind, k.label]));

/** A condition such as { state: 'customer', not_equals: null } in words. */
export function conditionText(condition: unknown): string {
  if (!isObj(condition)) return '';
  const entries = Object.entries(condition);
  const subject = condition.state ? `“${text(condition.state)}”` : condition.arg ? `“${text(condition.arg)}”` : condition.result ? 'the result' : condition.channel ? 'the channel' : '';
  if ('equals' in condition) return `${subject || 'it'} is ${JSON.stringify(condition.equals)}`;
  if ('not_equals' in condition) return condition.not_equals === null ? `${subject || 'it'} is already known` : `${subject || 'it'} isn’t ${JSON.stringify(condition.not_equals)}`;
  if (condition.all) return list(condition.all).map(conditionText).filter(Boolean).join(' and ');
  if (condition.any) return list(condition.any).map(conditionText).filter(Boolean).join(' or ');
  return entries.length ? 'a condition holds' : '';
}

export interface TaskReading {
  summary: string;
  steps: { number: number; id: string; ask: string; notes: string[] }[];
  outcomes: { key: string; label: string; text: string }[];
}

/** A task as a readable list: what each step asks, how the answer is checked, when it is skipped, and how it ends. */
export function describeTask(task: unknown): TaskReading {
  if (!isObj(task)) return { summary: '', steps: [], outcomes: [] };
  const max = Number.isInteger(task.max_attempts) ? (task.max_attempts as number) : null;
  const steps = list<Json>(task.steps)
    .filter(isObj)
    .map((step, index) => {
      const parts: string[] = [];
      if (step.skip_if) {
        const t = conditionText(step.skip_if);
        parts.push(t ? `skipped when ${t}` : 'sometimes skipped');
      }
      if (step.requires) {
        const t = conditionText(step.requires);
        if (t) parts.push(`only when ${t}`);
      }
      if (isObj(step.validate) && step.validate.tool) parts.push(`checked by the tool “${text(step.validate.tool)}”`);
      if (isObj(step.validate) && step.validate.type === 'regex' && step.validate.pattern) parts.push(`checked by the pattern /${text(step.validate.pattern)}/`);
      if (step.input === 'dtmf') parts.push('answered on the keypad');
      const tries = Number.isInteger(step.max_attempts) ? (step.max_attempts as number) : max;
      if (tries) parts.push(`up to ${tries} ${tries === 1 ? 'try' : 'tries'}`);
      const kind = text(step.type) || 'collect';
      const ask = typeof step.ask === 'string' ? step.ask : kind === 'say' ? 'Says a line' : kind === 'call' ? 'Runs its actions' : '';
      return { number: index + 1, id: text(step.id) || `step ${index + 1}`, ask, notes: parts };
    });
  const outcome = (key: string, label: string) => {
    const o = task[key];
    if (!isObj(o)) return null;
    const bits: string[] = [];
    if (o.outcome) bits.push(`result “${text(o.outcome)}”`);
    if (isObj(o.set_state) && Object.keys(o.set_state).length)
      bits.push(
        `remembers ${Object.entries(o.set_state)
          .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
          .join(', ')}`
      );
    if (o.next) bits.push(`starts the task “${text(o.next)}”`);
    if (o.resume) bits.push(`goes back to ${o.resume === 'caller' ? 'the agent that started it' : o.resume === 'entry' ? 'the first agent' : text(o.resume)}`);
    if (o.silent === true) bits.push('says nothing');
    return { key, label, text: bits.join(', ') || 'nothing in particular' };
  };
  return {
    summary: `${KIND_WORDS[text(task.kind)] || 'A task'}${steps.length ? ` in ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}.`,
    steps,
    outcomes: [outcome('on_success', 'When it works'), outcome('on_failure', 'If it fails'), outcome('on_decline', 'If the caller declines')].filter((o): o is NonNullable<typeof o> => !!o),
  };
}

// ---- editing ------------------------------------------------------------------------------------------------------------------------------------
function withTasks(config: AgentConfig, change: (items: Json[]) => Json[]): AgentConfig {
  const next = clone(config);
  const items = change(list<Json>(next.tasks).map((t) => (isObj(t) ? { ...t } : t)) as Json[]);
  if (items.length) next.tasks = items;
  else delete next.tasks;
  return next;
}

export function addTask(config: AgentConfig, kind = 'verification'): { config: AgentConfig; index: number } {
  const tasks = list<Json>(config?.tasks);
  const id = freeId(tasks.map((t) => text(t?.id)), kind === 'verification' ? 'verify_caller' : 'task');
  const task: Json = {
    id,
    kind,
    steps: [{ id: 'first', ask: kind === 'verification' ? 'Ask for the account number.' : 'Ask for the first detail.' }],
    max_attempts: 3,
    on_success: { resume: 'caller', silent: true },
    on_failure: { outcome: 'failed', resume: 'caller', silent: false },
  };
  return { config: withTasks(config, (items) => [...items, task]), index: tasks.length };
}
export const setTask = (config: AgentConfig, index: number, changes: Json) => withTasks(config, (items) => items.map((t, i) => (i === index ? patch(t, changes) : t)));
export const removeTask = (config: AgentConfig, index: number) => withTasks(config, (items) => items.filter((_, i) => i !== index));

export type StepKind = 'collect' | 'call' | 'say';
export const STEP_KINDS: { kind: StepKind; label: string; help: string }[] = [
  { kind: 'collect', label: 'Ask the caller', help: 'Asks for one value and checks it.' },
  { kind: 'say', label: 'Say something', help: 'Says a fixed line.' },
  { kind: 'call', label: 'Call a tool', help: 'Runs actions (an API call) without asking anything.' },
];

const stepsOf = (task: Json) => list<Json>(task.steps).map((s) => (isObj(s) ? { ...s } : s)) as Json[];

export function addStep(config: AgentConfig, index: number, kind: StepKind = 'collect'): AgentConfig {
  return withTasks(config, (items) =>
    items.map((t, i) => {
      if (i !== index) return t;
      const steps = stepsOf(t);
      const id = freeId(steps.map((s) => text(s?.id)), kind === 'collect' ? 'ask' : kind);
      const step: Json = kind === 'collect' ? { id, ask: '' } : kind === 'say' ? { id, type: 'say', do: [{ type: 'say', text: 'One moment, please.' }] } : { id, type: 'call', do: [{ type: 'log', message: 'step reached' }] };
      return { ...t, steps: [...steps, step] };
    })
  );
}

/**
 * A step changed. Changing its kind keeps what still applies: a collect step asks (`ask`), a call or say step runs
 * actions (`do`); keypad settings stay only with a keypad answer.
 */
export function setStep(config: AgentConfig, index: number, step: number, changes: Json): AgentConfig {
  return withTasks(config, (items) =>
    items.map((t, i) => {
      if (i !== index) return t;
      const steps = stepsOf(t).map((s, n) => {
        if (n !== step) return s;
        const out = patch(s, changes);
        if ('ask' in changes && changes.ask === '') out.ask = '';
        if ('id' in changes && changes.id === '') out.id = '';
        const kind = text(out.type) || 'collect';
        if (kind === 'collect') {
          if (out.type === 'collect') delete out.type;
          if (typeof out.ask !== 'string') out.ask = '';
          delete out.do;
          if (out.input !== 'dtmf') delete out.dtmf;
          if (out.input === 'speech') delete out.input;
        } else {
          delete out.ask;
          delete out.input;
          delete out.dtmf;
          delete out.validate;
          delete out.store_in;
          if (!list(out.do).length) out.do = kind === 'say' ? [{ type: 'say', text: 'One moment, please.' }] : [{ type: 'log', message: 'step reached' }];
        }
        return out;
      });
      return { ...t, steps };
    })
  );
}
/** The last step stays (a task needs one). */
export const removeStep = (config: AgentConfig, index: number, step: number) =>
  withTasks(config, (items) => items.map((t, i) => (i === index && list(t.steps).length > 1 ? { ...t, steps: list(t.steps).filter((_, n) => n !== step) } : t)));
export const moveStep = (config: AgentConfig, index: number, from: number, to: number) => withTasks(config, (items) => items.map((t, i) => (i === index ? { ...t, steps: moveItem(list(t.steps), from, to) } : t)));

/** One ending (on_success, on_failure, on_decline) changed; an ending with nothing left goes. */
export function setOutcome(config: AgentConfig, index: number, key: 'on_success' | 'on_failure' | 'on_decline', changes: Json): AgentConfig {
  return withTasks(config, (items) =>
    items.map((t, i) => {
      if (i !== index) return t;
      const was = isObj(t[key]) ? (t[key] as Json) : {};
      const out = patch(was, changes);
      if ('silent' in changes && changes.silent === false) out.silent = false;
      const next = { ...t };
      if (Object.keys(out).length) next[key] = out;
      else delete next[key];
      return next;
    })
  );
}

/** The say text of a say step (its first say action), or null when its actions are something else. */
export function stepSay(step: unknown): string | null {
  if (!isObj(step)) return null;
  const actions = list<Json>(step.do);
  if (actions.length !== 1 || !isObj(actions[0]) || actions[0].type !== 'say' || typeof actions[0].text !== 'string') return null;
  return actions[0].text;
}

// ---- the server's preview --------------------------------------------------------------------------------------------------------------------------
export const STEP_WORDS: Record<string, string> = { collect: 'Ask the caller', call: 'Call a tool', say: 'Say something' };

export interface TaskPreviewStep {
  index: number;
  id: string;
  type: string;
  skippedNow: boolean;
  heldBackNow: boolean;
  skipIf: unknown;
  requires: unknown;
  attempts: number | undefined;
  instructions: string;
  modelTools: string[];
  answerMode: string;
  checkedBy: unknown;
  passWhen: unknown;
  storeIn: string;
  actions: string[];
  keypad: { numDigits: number | undefined; timeoutS: number | undefined; terminator: string } | null;
  problems: string[];
}
export interface TaskPreview {
  steps: TaskPreviewStep[];
  attempts: { limit: number | undefined; counted: string } | null;
  skippedNow: boolean;
  keepsHistory: boolean;
  endings: { name: string; sets: Json; thenRuns: string[]; nextTask: string; resumes: string; silent: boolean; tells: string }[];
  offeredBy: string[];
  problems: string[];
}

/** The server's POST /preview/task answer, read tolerantly (a missing part is left out, never an error). */
export function normalizeTask(raw: unknown): TaskPreview {
  const r = isObj(raw) ? raw : {};
  const endings = isObj(r.endings) ? r.endings : {};
  return {
    steps: list<Json>(r.steps).map((s, index) => {
      const step = isObj(s) ? s : {};
      const keypad = isObj(step.keypad) ? step.keypad : null;
      return {
        index: index + 1,
        id: text(step.id),
        type: text(step.type),
        skippedNow: step.skipped_now === true,
        heldBackNow: step.held_back_now === true,
        skipIf: step.skip_if ?? null,
        requires: step.requires ?? null,
        attempts: num(step.attempts),
        instructions: text(step.instructions),
        modelTools: list(step.model_tools).map((t) => (isObj(t) ? text(t.name || t.tool || JSON.stringify(t)) : text(t))),
        answerMode: text(step.answer_mode),
        checkedBy: step.checked_by ?? null,
        passWhen: step.pass_when ?? null,
        storeIn: text(step.store_in),
        actions: list(step.actions).map(text),
        keypad: keypad ? { numDigits: num(keypad.num_digits), timeoutS: num(keypad.timeout_s), terminator: text(keypad.terminator) } : null,
        problems: list(step.problems).map(text),
      };
    }),
    attempts: isObj(r.attempts) ? { limit: num(r.attempts.limit), counted: text(r.attempts.counted) } : null,
    skippedNow: r.skipped_now === true,
    keepsHistory: r.keeps_history === true,
    endings: ['verified', 'failed', 'declined']
      .filter((k) => isObj(endings[k]))
      .map((k) => {
        const e = endings[k] as Json;
        return {
          name: k,
          sets: isObj(e.sets) ? e.sets : {},
          thenRuns: list(e.then_runs).map(text),
          nextTask: text(e.next_task),
          resumes: text(e.resumes),
          silent: e.silent === true,
          tells: text(e.tells_the_calling_agent),
        };
      }),
    offeredBy: list(r.offered_by).map(text),
    problems: list(r.problems).map(text),
  };
}

/** The words for how a step's answer is checked: '' when nothing checks it. */
export function checkedWords(step: { checkedBy?: unknown; passWhen?: unknown }): string {
  const by = step.checkedBy;
  if (isObj(by) && by.tool) return `by the tool “${text(by.tool)}”`;
  if (typeof by === 'string' && by) return `by the pattern /${by}/`;
  if (isObj(by) && (by.regex || by.pattern)) return `by the pattern /${text(by.regex || by.pattern)}/`;
  if (step.passWhen) return 'by a condition you wrote on what it returns';
  return '';
}

export function stepState(step: { skippedNow: boolean; heldBackNow: boolean }): { tag: 'skipped' | 'held' | 'runs'; words: string } {
  if (step.skippedNow) return { tag: 'skipped', words: 'Skipped for this caller, because it is already known.' };
  if (step.heldBackNow) return { tag: 'held', words: 'Held back for now: the steps before it have to finish first.' };
  return { tag: 'runs', words: '' };
}

/** How an ending carries on, in words. */
export function endingWords(e: TaskPreview['endings'][number]): string {
  const name = e.name === 'verified' ? 'It worked' : e.name === 'failed' ? 'It failed' : 'The caller declined';
  const then = e.nextTask ? `, then the task “${e.nextTask}” starts` : e.resumes === 'entry' ? ', then the first agent takes over' : ', then the agent that started it carries on';
  const sets = Object.keys(e.sets);
  return `${name}${then}${e.silent ? ' without saying anything' : ''}.${sets.length ? ` It remembers ${sets.join(', ')}.` : ''}${e.thenRuns.length ? ` It also: ${e.thenRuns.join(', ')}.` : ''}${e.tells ? ` The agent is told: “${e.tells}”` : ''}`;
}

/** What went wrong asking, in a customer's words. */
export function askProblem(error: { kind?: string; status?: number; message?: string } | null | undefined): string {
  if (!error) return '';
  const said = String(error.message || '');
  const own = said && !/^Request failed/.test(said);
  if (error.kind === 'client_bug') return 'Something went wrong asking the server. Try again, and tell us if it keeps happening.';
  if (error.status === 404 || error.status === 405) return own && error.status === 404 ? said : 'This server cannot try this setting yet.';
  return `The server could not answer: ${said || 'unknown problem'}`;
}

/** The body of POST /preview/task, or why it can't be sent (the remembered values must be a JSON object). */
export function taskPreviewBody(config: AgentConfig, task: string, stateText: string, channel: string): { body: Json } | { error: string } {
  let state: Json | undefined;
  if (stateText.trim()) {
    try {
      const v: unknown = JSON.parse(stateText);
      if (!isObj(v)) return { error: 'Write the remembered values as an object, such as {"verified": true}.' };
      state = v;
    } catch {
      return { error: 'This is not valid JSON yet. For example: {"verified": true}.' };
    }
  }
  return { body: { config, task, ...(state ? { state } : {}), ...(channel ? { channel } : {}) } };
}
