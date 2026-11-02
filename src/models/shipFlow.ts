// "Where am I on the way to live?": the five things between a draft and callers, in order (saved, valid, tested,
// published, deployed), each done, to do, blocked or optional, with the one thing to do next. It informs; nothing here
// stops a publish or a deploy (when "tests must pass before publishing" is on, the Tested step says why the publish
// panel holds). Pure: no React, no network.
import type { ValidationReport } from '../types/studio';
import type { PageTarget } from './agentPages';
import { runWords, type GateAnswer, type LatestRun, type StepState } from './readiness';

export type ShipAction =
  | { kind: 'save'; label: string }
  | { kind: 'publish'; label: string }
  | { kind: 'go'; label: string; target: PageTarget };

export interface ShipStep {
  id: 'save' | 'valid' | 'tested' | 'published' | 'deployed';
  label: string;
  state: StepState;
  text: string;
  action?: ShipAction;
}

export interface ShipFlow {
  steps: ShipStep[];
  done: number;
  total: number;
  next: ShipStep | null;
  ready: boolean;
}

export interface ShipInput {
  /** Unsaved edits in the editor (lists, which have no editor, pass false). */
  dirty?: boolean;
  /** The JSON view's text is not valid JSON. */
  parseError?: string | null;
  /** The server's checks; null while not known. */
  report?: ValidationReport | null;
  scenarioCount?: number;
  /** The newest finished run on the draft: null = never run, undefined = not known. */
  latestRun?: LatestRun | null;
  /** The newest version and how many changes the draft has since it (null = could not be counted). */
  published?: { version: string; changes: number | null } | null;
  /** Environment -> version running there. */
  deployed?: Partial<Record<string, string>>;
  /** The tests gate's answer; null when it is off. */
  gate?: GateAnswer | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function shipSteps({ dirty = false, parseError = null, report = null, scenarioCount = 0, latestRun, published = null, deployed = {}, gate = null }: ShipInput = {}): ShipFlow {
  const steps: ShipStep[] = [];

  // 1. saved
  if (parseError) steps.push({ id: 'save', label: 'Saved', state: 'blocked', text: 'The JSON cannot be read yet.', action: { kind: 'go', label: 'Edit as JSON', target: { stage: 'build', focus: 'json' } } });
  else if (dirty) steps.push({ id: 'save', label: 'Saved', state: 'todo', text: 'You have unsaved edits.', action: { kind: 'save', label: 'Save' } });
  else steps.push({ id: 'save', label: 'Saved', state: 'done', text: 'The draft is saved.' });

  // 2. valid (the server's checks)
  if (!report) steps.push({ id: 'valid', label: 'Valid', state: 'todo', text: 'Not checked yet.' });
  else if (report.errors.length)
    steps.push({ id: 'valid', label: 'Valid', state: 'blocked', text: `${plural(report.errors.length, 'error')} to fix first.`, action: { kind: 'go', label: 'See what to fix', target: { stage: 'build', focus: 'problems' } } });
  else steps.push({ id: 'valid', label: 'Valid', state: 'done', text: 'The draft passes the server’s checks.' });

  // 3. tested: optional without scenarios (unless the gate is on), blocked when the gate holds or the run failed
  const tests: PageTarget = { stage: 'test', focus: 'scenarios' };
  if (gate && !gate.ok)
    steps.push({ id: 'tested', label: 'Tested', state: 'blocked', text: gate.why, action: gate.action === 'scenarios' ? { kind: 'go', label: 'Add tests', target: { stage: 'build', focus: 'tests' } } : { kind: 'go', label: 'Run the tests', target: tests } });
  else if (scenarioCount === 0)
    steps.push({ id: 'tested', label: 'Tested', state: 'optional', text: 'No test scenarios written, so nothing has checked its behaviour.', action: { kind: 'go', label: 'Write scenarios', target: { stage: 'build', focus: 'tests' } } });
  else if (latestRun === undefined) steps.push({ id: 'tested', label: 'Tested', state: 'todo', text: 'The latest run is not known yet.', action: { kind: 'go', label: 'See the tests', target: tests } });
  else if (latestRun === null) steps.push({ id: 'tested', label: 'Tested', state: 'todo', text: 'The scenarios have not been run.', action: { kind: 'go', label: 'Run the scenarios', target: tests } });
  else if (latestRun.status === 'passed') steps.push({ id: 'tested', label: 'Tested', state: 'done', text: `The latest run passed (${latestRun.passed ?? 0} of ${latestRun.total ?? 0}).` });
  else steps.push({ id: 'tested', label: 'Tested', state: 'blocked', text: `The latest run ${runWords(latestRun)}.`, action: { kind: 'go', label: 'See the results', target: tests } });

  // 4. published: the newest version is the draft as it stands
  if (!published) steps.push({ id: 'published', label: 'Published', state: 'todo', text: 'Nothing is published yet.', action: { kind: 'publish', label: 'Publish' } });
  else if (published.changes === 0) steps.push({ id: 'published', label: 'Published', state: 'done', text: `v${published.version} is the draft as it stands.` });
  else if (published.changes === null) steps.push({ id: 'published', label: 'Published', state: 'done', text: `v${published.version} is published. Changes since could not be counted.` });
  else steps.push({ id: 'published', label: 'Published', state: 'todo', text: `The draft has ${plural(published.changes, 'change')} since v${published.version}.`, action: { kind: 'publish', label: 'Publish' } });

  // 5. deployed: somewhere runs the newest version; says which version runs where
  const live = Object.entries(deployed).filter((e): e is [string, string] => !!e[1]);
  const deploy: ShipAction = { kind: 'go', label: 'Deploy', target: { stage: 'release', focus: 'deploy' } };
  if (!published) steps.push({ id: 'deployed', label: 'Deployed', state: 'todo', text: 'Publish first, then choose where it runs.' });
  else if (live.some(([, v]) => v === published.version)) {
    const here = live.filter(([, v]) => v === published.version).map(([env]) => env);
    const older = live.filter(([, v]) => v !== published.version).map(([env, v]) => `${env} runs v${v}`);
    steps.push({ id: 'deployed', label: 'Deployed', state: 'done', text: `v${published.version} runs in ${here.join(' and ')}.${older.length ? ` ${older.join('; ')}.` : ''}` });
  } else
    steps.push({
      id: 'deployed',
      label: 'Deployed',
      state: 'todo',
      text: live.length ? `Callers get an older version (${live.map(([env, v]) => `${env}: v${v}`).join(', ')}). v${published.version} is not deployed.` : 'Not deployed anywhere.',
      action: deploy,
    });

  const required = steps.filter((s) => s.state !== 'optional');
  const done = required.filter((s) => s.state === 'done').length;
  const next = steps.find((s) => s.state === 'blocked') ?? steps.find((s) => s.state === 'todo') ?? null;
  return { steps, done, total: required.length, next, ready: done === required.length };
}
