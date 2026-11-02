import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { Button } from '../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';
import {
  EXPECT_KINDS,
  GUARDRAIL_ACTION_CHOICES,
  HTTP_METHODS,
  LIMIT_CHOICES,
  agentIdsOf,
  channelIdsOf,
  channelTypeOf,
  hasProblems,
  httpConnectionsOf,
  inputRuleIdsOf,
  isKeysTurn,
  isObj,
  isScripted,
  isUnknownExpectation,
  kindOfExpectation,
  newExpectation,
  outcomeNamesOf,
  problemList,
  regexProblem,
  scenarioProblems,
  stateNamesOf,
  taskIdsOf,
  toolChoices,
  type Choice,
  type Expectation,
  type HttpMock,
  type Obj,
  type ScenarioDef,
  type ScriptItem,
  type Turn,
} from '../../../../models/scenario';
import { FieldError, IconButton, JsonBox, ModeChip, Section, Select, ValueBox } from './parts';
import { monoInput, smallInput } from './inputStyles';

// The editor for one scenario: every part the schema has (turns, thirteen kinds of expectation, clock, starting
// state, API mocks, model script) plus "Edit as JSON". Unknown parts are kept as they are and never block Save; only
// what is positively wrong (a missing id, a missing channel, a bad pattern) is a problem, shown where it is.

interface ScenarioFormProps {
  initial: ScenarioDef;
  config: AgentConfig;
  /** The other scenarios, for unique ids. */
  others: ScenarioDef[];
  isNew: boolean;
  onSave: (scenario: ScenarioDef) => void;
  onCancel: () => void;
}

const channelChoice = (config: AgentConfig, id: string): Choice => {
  const type = channelTypeOf(config, id);
  const words: Record<string, string> = { web_chat: 'web chat', web_voice: 'web voice', sip_voice: 'phone line' };
  return { value: id, label: words[type] ? `${id} (${words[type]})` : id };
};

const clean = <T extends Obj>(o: T): T => {
  const out = { ...o };
  Object.keys(out).forEach((k) => {
    if (out[k] === undefined || out[k] === '') delete out[k];
  });
  return out;
};

function ExpectRow({
  value,
  index,
  config,
  onChange,
  onRemove,
  reportBox,
}: {
  value: Expectation;
  index: number;
  config: AgentConfig;
  onChange: (next: Expectation) => void;
  onRemove: () => void;
  reportBox: (id: string, ok: boolean) => void;
}) {
  const kind = kindOfExpectation(value);
  const label = (what: string) => `Expectation ${index + 1}: ${what}`;
  const remove = <IconButton label={`Delete expectation ${index + 1}`} onClick={onRemove} />;

  if (isUnknownExpectation(value) || !isObj(value)) {
    return (
      <li className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-subtle/40 p-2.5" data-kind="unknown">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">This check isn’t one the form can edit, so it is kept exactly as it is. Use “Edit as JSON” to change it.</p>
          <code className="mt-1 block break-all font-mono text-xs text-ink-soft">{JSON.stringify(value)}</code>
        </div>
        {remove}
      </li>
    );
  }

  const part = (isObj(value[kind]) ? value[kind] : {}) as Obj;
  const setPart = (patch: Obj) => onChange({ [kind]: clean({ ...part, ...patch }) });
  const tools = toolChoices(config);
  const hint = EXPECT_KINDS.find((k) => k.key === kind)?.hint;
  const pattern = typeof value.said_matches === 'string' ? value.said_matches : '';

  return (
    <li className="rounded-lg border border-line bg-surface p-2.5" data-kind={kind}>
      <div className="flex flex-wrap items-start gap-2">
        <Select
          className="w-full sm:w-64"
          label={label('what to check')}
          value={kind}
          options={EXPECT_KINDS.map((k) => ({ value: k.key, label: k.label }))}
          onChange={(next) => next !== kind && onChange(newExpectation(next, config))}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
          {(kind === 'tool_called' || kind === 'tool_not_called') && (
            <Select
              className="sm:w-56"
              label={label('tool')}
              placeholder="Choose a tool…"
              value={String(value[kind] ?? '')}
              options={tools}
              onChange={(v) => onChange({ [kind]: v })}
            />
          )}
          {kind === 'tool_called_with' && (
            <>
              <Select
                className="sm:w-56"
                label={label('tool')}
                placeholder="Choose a tool…"
                value={String(part.tool ?? '')}
                options={tools}
                onChange={(v) => setPart({ tool: v })}
              />
              <JsonBox
                rows={2}
                onValid={reportBox}
                value={part.args ?? {}}
                label={label('arguments it must include')}
                placeholder='{ "order_id": "NB-1003" }'
                onChange={(args) => onChange({ tool_called_with: { ...part, args: args ?? {} } })}
              />
            </>
          )}
          {kind === 'state_equals' && (
            <>
              <Select
                className="sm:w-48"
                label={label('state variable')}
                placeholder="Choose a variable…"
                value={String(part.state ?? '')}
                options={stateNamesOf(config)}
                onChange={(v) => setPart({ state: v })}
              />
              <ValueBox
                label={label('value')}
                placeholder="value, e.g. true, 3 or paid"
                value={part.value}
                onChange={(v) => onChange({ state_equals: { ...part, value: v } })}
              />
            </>
          )}
          {kind === 'said_matches' && (
            <span className="min-w-0 flex-1">
              <input
                type="text"
                className={cn(monoInput, regexProblem(pattern) && inputErrorClass)}
                value={pattern}
                placeholder="a pattern, e.g. refund|money back"
                aria-label={label('pattern')}
                aria-invalid={!!regexProblem(pattern) || undefined}
                onChange={(e) => onChange({ said_matches: e.target.value })}
              />
              {regexProblem(pattern) && <FieldError>Not a valid pattern: {regexProblem(pattern)}</FieldError>}
            </span>
          )}
          {kind === 'agent_is' && (
            <Select
              className="sm:w-56"
              label={label('agent')}
              placeholder="Choose an agent…"
              value={String(value.agent_is ?? '')}
              options={agentIdsOf(config)}
              onChange={(v) => onChange({ agent_is: v })}
            />
          )}
          {(kind === 'http_called' || kind === 'http_not_called') && (
            <>
              <Select
                className="w-32"
                label={label('method')}
                placeholder="Any method"
                value={String(part.method ?? '')}
                options={HTTP_METHODS}
                onChange={(v) => setPart({ method: v })}
              />
              <input
                type="text"
                className={cn(monoInput, 'min-w-[10rem] flex-1')}
                value={String(part.path ?? '')}
                placeholder="/orders/* (a * matches anything)"
                aria-label={label('path')}
                onChange={(e) => setPart({ path: e.target.value })}
              />
              {kind === 'http_called' && (
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={cn(smallInput, 'w-44')}
                  value={typeof part.times === 'number' ? part.times : ''}
                  placeholder="times (empty: at least once)"
                  aria-label={label('how many times')}
                  onChange={(e) => setPart({ times: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              )}
            </>
          )}
          {kind === 'task_outcome' && (
            <>
              <Select
                className="sm:w-48"
                label={label('task')}
                placeholder="Choose a task…"
                value={String(part.task ?? '')}
                options={taskIdsOf(config)}
                onChange={(v) => setPart({ task: v })}
              />
              <Select
                className="sm:w-48"
                label={label('how it ended')}
                placeholder="Any way it ends"
                value={String(part.outcome ?? '')}
                options={[...new Set([...outcomeNamesOf(config, String(part.task ?? '')), ...(part.outcome ? [String(part.outcome)] : [])])]}
                onChange={(v) => setPart({ outcome: v || undefined })}
              />
            </>
          )}
          {kind === 'guardrail_triggered' && (
            <>
              <Select
                className="sm:w-48"
                label={label('safety rule')}
                placeholder="Choose a safety rule…"
                value={String(part.rule ?? '')}
                options={inputRuleIdsOf(config)}
                onChange={(v) => setPart({ rule: v })}
              />
              <Select
                className="sm:w-64"
                label={label('what the rule did')}
                placeholder="Whatever it did"
                value={String(part.action ?? '')}
                options={GUARDRAIL_ACTION_CHOICES}
                onChange={(v) => setPart({ action: v || undefined })}
              />
            </>
          )}
          {kind === 'guardrail_not_triggered' && (
            <Select
              className="sm:w-56"
              label={label('safety rule')}
              placeholder="Choose a safety rule…"
              value={String(value.guardrail_not_triggered ?? '')}
              options={inputRuleIdsOf(config)}
              onChange={(v) => onChange({ guardrail_not_triggered: v })}
            />
          )}
          {kind === 'limit_reached' && (
            <Select
              className="sm:w-64"
              label={label('which limit')}
              value={String(value.limit_reached ?? '')}
              options={LIMIT_CHOICES}
              onChange={(v) => onChange({ limit_reached: v })}
            />
          )}
          {kind === 'judge' && (
            <textarea
              rows={2}
              className={cn(inputClass, 'min-w-0 flex-1 px-2.5 py-1.5 text-[13px]')}
              value={String(value.judge ?? '')}
              placeholder="e.g. the agent stays polite and does not promise a refund"
              aria-label={label('criterion')}
              onChange={(e) => onChange({ judge: e.target.value })}
            />
          )}
        </div>
        {remove}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </li>
  );
}

/** The pretend answers for the agent's API requests. */
function MocksEditor({
  mocks,
  connections,
  onChange,
  reportBox,
}: {
  mocks: HttpMock[];
  connections: string[];
  onChange: (next: HttpMock[] | undefined) => void;
  reportBox: (id: string, ok: boolean) => void;
}) {
  const set = (i: number, patch: Obj) => onChange(mocks.map((m, k) => (k === i ? clean({ ...m, ...patch }) : m)));
  const field = 'flex min-w-0 flex-col gap-1 text-xs text-muted';
  return (
    <div className="space-y-3">
      {mocks.length === 0 && (
        <p className="text-xs text-muted">
          No mocks. A scenario never calls a real API: a request nothing answers gets a 404 and is listed in the result, with a button to add the mock.
        </p>
      )}
      {mocks.map((mock, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-2.5" aria-label={`Mock ${i + 1}`} role="group">
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_7rem_8rem]">
            <label className={field}>
              Method
              <Select
                label={`Mock ${i + 1}: method`}
                placeholder="Any"
                value={mock.method ?? ''}
                options={HTTP_METHODS}
                onChange={(v) => set(i, { method: v })}
              />
            </label>
            <label className={field}>
              Path
              <input
                type="text"
                className={monoInput}
                value={mock.path ?? ''}
                placeholder="/orders/*"
                aria-label={`Mock ${i + 1}: path`}
                onChange={(e) => set(i, { path: e.target.value })}
              />
            </label>
            <label className={field}>
              Status
              <input
                type="number"
                min={100}
                max={599}
                className={smallInput}
                value={mock.status ?? ''}
                placeholder="200"
                aria-label={`Mock ${i + 1}: status`}
                onChange={(e) => set(i, { status: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </label>
            <label className={field}>
              Only this many times
              <input
                type="number"
                min={1}
                className={smallInput}
                value={mock.times ?? ''}
                placeholder="every time"
                aria-label={`Mock ${i + 1}: times`}
                onChange={(e) => set(i, { times: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </label>
          </div>
          {connections.length > 0 && (
            <label className={cn(field, 'mt-2 sm:w-64')}>
              Only for the connection
              <Select
                label={`Mock ${i + 1}: connection`}
                placeholder="Any"
                value={mock.connection ?? ''}
                options={connections}
                onChange={(v) => set(i, { connection: v })}
              />
            </label>
          )}
          <label className={cn(field, 'mt-2')}>
            The JSON it answers with
            <JsonBox
              onValid={reportBox}
              value={mock.json}
              objectOnly={false}
              rows={3}
              label={`Mock ${i + 1}: the JSON it answers with`}
              placeholder='{ "found": true }'
              onChange={(json) => set(i, { json })}
            />
          </label>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-soft">More: a plain-text answer, query, body</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className={field}>
                Or a plain-text answer
                <input
                  type="text"
                  className={smallInput}
                  value={mock.text ?? ''}
                  aria-label={`Mock ${i + 1}: text answer`}
                  onChange={(e) => set(i, { text: e.target.value })}
                />
              </label>
              <label className={field}>
                The request must have these query values
                <JsonBox
                  onValid={reportBox}
                  value={mock.query}
                  rows={2}
                  label={`Mock ${i + 1}: query`}
                  placeholder='{ "status": "open" }'
                  onChange={(query) => set(i, { query })}
                />
              </label>
              <label className={field}>
                The JSON body must contain
                <JsonBox
                  onValid={reportBox}
                  value={mock.body_contains}
                  rows={2}
                  label={`Mock ${i + 1}: body contains`}
                  placeholder='{ "reason": "late" }'
                  onChange={(body_contains) => set(i, { body_contains })}
                />
              </label>
            </div>
          </details>
          <Button size="sm" variant="ghost" className="mt-2 text-danger" onClick={() => onChange(mocks.filter((_, k) => k !== i))}>
            Delete mock {i + 1}
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange([...mocks, { method: 'GET', path: '', status: 200, json: {} }])}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a mock
      </Button>
    </div>
  );
}

/** The model's replies, one per item: what it says, or the tool it uses. */
function ScriptEditor({
  script,
  tools,
  onChange,
  reportBox,
}: {
  script: ScriptItem[];
  tools: Choice[];
  onChange: (next: ScriptItem[] | undefined) => void;
  reportBox: (id: string, ok: boolean) => void;
}) {
  const set = (i: number, item: ScriptItem) => onChange(script.map((x, k) => (k === i ? item : x)));
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {script.map((item, i) => {
          const uses = typeof item === 'object' && item !== null;
          return (
            <li key={i} className="flex flex-wrap items-start gap-2">
              <Select
                className="w-36"
                label={`Model reply ${i + 1}: what it does`}
                value={uses ? 'tool' : 'say'}
                options={[
                  { value: 'say', label: 'Says' },
                  { value: 'tool', label: 'Uses a tool' },
                ]}
                onChange={(v) => set(i, v === 'tool' ? { tool: tools[0]?.value ?? '' } : '')}
              />
              {uses ? (
                <>
                  <Select
                    className="sm:w-56"
                    label={`Model reply ${i + 1}: tool`}
                    placeholder="Choose a tool…"
                    value={String(item.tool ?? '')}
                    options={tools}
                    onChange={(v) => set(i, { ...item, tool: v })}
                  />
                  <JsonBox
                    rows={1}
                    onValid={reportBox}
                    value={item.args}
                    label={`Model reply ${i + 1}: arguments`}
                    placeholder='arguments, e.g. { "order_id": "NB-1003" }'
                    onChange={(args) => {
                      const next = { ...item };
                      if (args === undefined) delete next.args;
                      else next.args = args as Obj;
                      set(i, next);
                    }}
                  />
                </>
              ) : (
                <input
                  type="text"
                  className={cn(smallInput, 'min-w-0 flex-1')}
                  value={item}
                  placeholder="What the model says"
                  aria-label={`Model reply ${i + 1}: what it says`}
                  onChange={(e) => set(i, e.target.value)}
                />
              )}
              <IconButton label={`Delete model reply ${i + 1}`} onClick={() => onChange(script.filter((_, k) => k !== i))} />
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => onChange([...script, ''])}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a reply
        </Button>
        {script.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            Remove the script (make it live)
          </Button>
        )}
      </div>
    </div>
  );
}

const Problems = ({ items }: { items?: string[] }) =>
  items && items.length ? (
    <ul className="mt-2 space-y-1">
      {items.map((p) => (
        <li key={p}>
          <FieldError>{p}</FieldError>
        </li>
      ))}
    </ul>
  ) : null;

export function ScenarioForm({ initial, config, others, isNew, onSave, onCancel }: ScenarioFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [scenario, setScenario] = useState<ScenarioDef>(initial);
  const [tried, setTried] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [badBoxes, setBadBoxes] = useState<string[]>([]);
  const [blocked, setBlocked] = useState(false);
  // "More" stays as the author left it: open when the scenario uses it.
  const [moreOpen, setMoreOpen] = useState(() => !!(initial.model_script || initial.http_mocks || initial.now || initial.state));
  const reportBox = useCallback(
    (id: string, ok: boolean) => setBadBoxes((old) => (ok ? (old.includes(id) ? old.filter((n) => n !== id) : old) : old.includes(id) ? old : [...old, id])),
    [],
  );
  const problems = useMemo(() => scenarioProblems(scenario, config, others), [scenario, config, others]);
  const tools = toolChoices(config);
  const channels = channelIdsOf(config);
  const phoneLine = channelTypeOf(config, scenario.channel) === 'sip_voice';
  const show = <K extends keyof typeof problems>(key: K) => (tried ? problems[key] : undefined);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, []);

  const set = (patch: Partial<ScenarioDef>) =>
    setScenario((old) => {
      const next: ScenarioDef = { ...old, ...patch };
      Object.keys(next).forEach((k) => {
        const v = next[k];
        if (v === undefined || (Array.isArray(v) && !v.length && (k === 'http_mocks' || k === 'model_script'))) delete next[k];
      });
      return next;
    });
  const turns: Turn[] = Array.isArray(scenario.turns) ? scenario.turns : [];
  const expectations: Expectation[] = Array.isArray(scenario.expect) ? scenario.expect : [];
  const setTurn = (i: number, text: string) => set({ turns: turns.map((t, k) => (k !== i ? t : isKeysTurn(t) ? { keys: text } : { say: text })) });
  const setTurnKind = (i: number, keys: boolean) =>
    set({ turns: turns.map((t, k) => (k !== i || isKeysTurn(t) === keys ? t : keys ? { keys: '' } : { say: '' })) });
  const setPersona = (persona: string) => {
    const caller = clean({ ...(isObj(scenario.caller) ? scenario.caller : {}), persona });
    set({ caller: Object.keys(caller).length ? caller : undefined });
  };

  const readJson = (): ScenarioDef | null => {
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (!isObj(parsed)) throw new Error('a scenario is an object');
      return parsed as ScenarioDef;
    } catch (e) {
      setJsonError(`Not valid JSON (${e instanceof Error ? e.message : String(e)}).`);
      return null;
    }
  };
  const toggleJson = () => {
    if (!jsonMode) {
      setJsonText(JSON.stringify(scenario, null, 2));
      setJsonError('');
      setJsonMode(true);
      return;
    }
    const parsed = readJson();
    if (!parsed) return;
    setScenario(parsed);
    setJsonMode(false);
    setJsonError('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let value = scenario;
    if (jsonMode) {
      const parsed = readJson();
      if (!parsed) return;
      value = parsed;
      setScenario(parsed);
    }
    const found = scenarioProblems(value, config, others);
    setTried(true);
    if (jsonMode && hasProblems(found)) {
      // The form's fields say what is wrong beside each one; here they are not shown, so it is said under the box.
      setJsonError(`It can’t be saved yet. ${problemList(found).join(' ')}`);
      return;
    }
    if (badBoxes.length || hasProblems(found)) {
      // Folded parts with a problem open and the first problem gets focus, so Save is never silent.
      setBlocked(true);
      window.requestAnimationFrame(() => {
        const form = formRef.current;
        if (!form) return;
        form.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
          for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
        });
        if (problems.mocks || problems.script || problems.now || problems.state) setMoreOpen(true);
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    onSave(value);
  };

  return (
    <form ref={formRef} noValidate aria-label={isNew ? 'New scenario' : `Edit ${initial.id}`} onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{isNew ? 'New scenario' : `Edit “${initial.id}”`}</h3>
          <ModeChip mode={isScripted(scenario) ? 'scripted' : 'live'} />
        </div>
        <Button size="sm" variant="ghost" onClick={toggleJson}>
          {jsonMode ? 'Back to the form' : 'Edit as JSON'}
        </Button>
      </div>

      {jsonMode ? (
        <label className="block text-xs font-medium text-muted">
          The scenario as JSON
          <textarea
            className={cn(inputClass, 'mt-1 font-mono text-xs', jsonError && inputErrorClass)}
            rows={16}
            value={jsonText}
            spellCheck={false}
            aria-label="The scenario as JSON"
            aria-invalid={!!jsonError || undefined}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError('');
            }}
          />
          {jsonError && <FieldError>{jsonError}</FieldError>}
        </label>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Id
              <input
                type="text"
                aria-label="Id"
                className={cn(monoInput, show('id') && inputErrorClass)}
                value={scenario.id}
                aria-invalid={!!show('id') || undefined}
                onChange={(e) => set({ id: e.target.value })}
              />
              {show('id') && <FieldError>{problems.id}</FieldError>}
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Channel
              <Select
                label="Channel"
                placeholder="Choose a channel…"
                invalid={!!show('channel')}
                value={scenario.channel ?? ''}
                options={channels.map((id) => channelChoice(config, id))}
                onChange={(v) => set({ channel: v })}
              />
              {show('channel') && <FieldError>{problems.channel}</FieldError>}
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-2">
              What this scenario shows (optional)
              <input
                type="text"
                className={smallInput}
                value={scenario.description ?? ''}
                placeholder="e.g. A billing question reaches billing and a ticket is raised."
                onChange={(e) => set({ description: e.target.value || undefined })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted sm:col-span-2">
              Who is calling (optional)
              <input
                type="text"
                className={smallInput}
                value={isObj(scenario.caller) ? String(scenario.caller.persona ?? '') : ''}
                placeholder="e.g. an impatient customer who was charged twice"
                onChange={(e) => setPersona(e.target.value)}
              />
            </label>
          </div>

          <Section title="What the caller says, in order">
            <ol className="space-y-2">
              {turns.map((turn, i) => {
                const keys = isKeysTurn(turn);
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-5 shrink-0 text-right text-xs text-muted">{i + 1}.</span>
                    {(phoneLine || keys) && (
                      <Select
                        className="w-36"
                        label={`Turn ${i + 1}: kind`}
                        value={keys ? 'keys' : 'say'}
                        options={[
                          { value: 'say', label: 'Says' },
                          { value: 'keys', label: 'Presses keys' },
                        ]}
                        onChange={(v) => setTurnKind(i, v === 'keys')}
                      />
                    )}
                    <input
                      type="text"
                      className={cn(keys ? monoInput : smallInput, 'min-w-0 flex-1')}
                      value={String((keys ? turn.keys : turn.say) ?? '')}
                      placeholder={keys ? 'Keys, e.g. 4821#' : 'What they say'}
                      aria-label={keys ? `Turn ${i + 1}: the keys the caller presses` : `Turn ${i + 1}: what the caller says`}
                      onChange={(e) => setTurn(i, e.target.value)}
                    />
                    <IconButton label={`Delete turn ${i + 1}`} onClick={() => set({ turns: turns.filter((_, k) => k !== i) })} />
                  </li>
                );
              })}
            </ol>
            {show('turns') && <FieldError>{problems.turns}</FieldError>}
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => set({ turns: [...turns, { say: '' }] })}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Add a turn
            </Button>
          </Section>

          <Section title="What must be true afterwards">
            <ul className="space-y-2">
              {expectations.map((value, i) => (
                <ExpectRow
                  key={i}
                  index={i}
                  value={value}
                  config={config}
                  reportBox={reportBox}
                  onChange={(next) => set({ expect: expectations.map((e, k) => (k === i ? next : e)) })}
                  onRemove={() => set({ expect: expectations.filter((_, k) => k !== i) })}
                />
              ))}
            </ul>
            <Problems items={show('expect')} />
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => set({ expect: [...expectations, newExpectation('said_matches', config)] })}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Add an expectation
            </Button>
          </Section>

          <details open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)} className="rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink">Model script, API answers, clock and starting state</summary>
            <div className="space-y-3 border-t border-line p-3">
              <Section
                title="The model’s replies"
                hint={
                  <>
                    With a script, the language model is replaced: each item is one reply. It runs the real runtime (prompts, tools, effects, hand-overs)
                    without a model, so it is free and the same every time. Without a script the scenario is <strong className="text-ink">live</strong>: it uses
                    a real model, costs money, and can differ from run to run.
                  </>
                }
              >
                <ScriptEditor
                  reportBox={reportBox}
                  tools={tools}
                  script={Array.isArray(scenario.model_script) ? scenario.model_script : []}
                  onChange={(model_script) => set({ model_script })}
                />
                <Problems items={show('script')} />
              </Section>
              <Section title="Answers for the agent’s API requests">
                <MocksEditor
                  reportBox={reportBox}
                  connections={httpConnectionsOf(config)}
                  mocks={Array.isArray(scenario.http_mocks) ? scenario.http_mocks : []}
                  onChange={(http_mocks) => set({ http_mocks })}
                />
                <Problems items={show('mocks')} />
              </Section>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Pretend it is (a date and time with a time zone)
                  <input
                    type="text"
                    className={cn(monoInput, show('now') && inputErrorClass)}
                    value={scenario.now ?? ''}
                    placeholder="2026-10-14T03:00:00+08:00"
                    aria-label="Pretend it is"
                    aria-invalid={!!show('now') || undefined}
                    onChange={(e) => set({ now: e.target.value || undefined })}
                  />
                  {show('now') ? (
                    <FieldError>{problems.now}</FieldError>
                  ) : (
                    <span className="font-normal">
                      Makes a schedule such as business hours open or closed, as the scenario needs. Without it the real clock is used.
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Starting state (values set before the conversation starts)
                  <JsonBox
                    onValid={reportBox}
                    value={scenario.state}
                    rows={2}
                    label="Starting state"
                    placeholder='{ "verified": true }'
                    onChange={(state) => set({ state: state as Obj | undefined })}
                  />
                  {show('state') && <FieldError>{problems.state}</FieldError>}
                </label>
              </div>
            </div>
          </details>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button type="submit" variant="primary" size="sm">
          {isNew ? 'Add the scenario' : 'Save the scenario'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        {blocked && !jsonMode && (badBoxes.length > 0 || hasProblems(problems)) && (
          <p role="alert" className="text-xs text-danger">
            Not added to the draft yet: fix what is marked above first.
          </p>
        )}
        <p className="ml-auto text-xs text-muted">Changes go into the draft; save the draft to keep them.</p>
      </div>
    </form>
  );
}
