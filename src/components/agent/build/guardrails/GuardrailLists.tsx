import React, { useState } from 'react';
import { ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { useRedactionEntities } from '../../../../hooks/useRedactionEntities';
import { entityLabel } from '../../../../models/afterCall';
import {
  CHECK_KINDS,
  ENFORCEMENT_CHOICES,
  TRIGGER_CHOICES,
  addCheck,
  addRule,
  checkParts,
  checkWords,
  fieldWords,
  momentOf,
  removeItem,
  ruleMissing,
  ruleWords,
  setItem,
  setRuleAction,
  setRuleWhen,
  type CheckSide,
  type GuardrailList,
} from '../../../../models/guardrails';
import { fieldId } from '../../../../utils/path';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import { Segmented } from '../../../ui/Segmented';
import { cn, inputClass } from '../../../../utils/styles';
import { AddChoices, LinesInput } from '../messages/parts';
import { useDeleted } from '../messages/useDeleted';
import { SpeechInput } from '../messages/SpeechInput';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const items = (config: AgentConfig, part: GuardrailList): unknown[] => (Array.isArray(config.guardrails?.[part]) ? (config.guardrails?.[part] as unknown[]) : []);
const SIDE_TEXT: Record<CheckSide, string> = { input: 'It reads what the caller says, before the agent answers.', output: 'It reads what the agent says, before it is spoken.' };

/** One row that opens to its settings, with a delete button. */
function Row({ id, title, sub, chips, open, onToggle, onDelete, disabled, children }: { id: string; title: string; sub?: string; chips?: React.ReactNode; open: boolean; onToggle: () => void; onDelete: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <li id={id} className="scroll-mt-28 rounded-lg border border-line bg-surface">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ChevronDownIcon className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform duration-150', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{title}</span>
            {sub && <span className="mt-0.5 block text-xs text-muted">{sub}</span>}
          </span>
        </button>
        {chips}
        <Button size="sm" variant="ghost" onClick={onDelete} disabled={disabled} aria-label={`Delete ${title}`}>
          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {open && <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>}
    </li>);

}

function Labelled({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-soft">{label}</label>
      {help && <p className="text-xs text-muted">{help}</p>}
      <div className="mt-1.5">{children}</div>
    </div>);

}

/** The checks on one side: each in words, opened to change it, added from a card that names its job, deleted with Undo. */
export function CheckList({ editor, side }: { editor: DraftEditor; side: CheckSide }) {
  const config = editor.config;
  const [open, setOpen] = useState<number | null>(null);
  const { notice, remember } = useDeleted(editor);
  const { entities } = useRedactionEntities();
  if (!config) return null;
  const disabled = !editor.canEdit;
  const list = items(config, side);
  const errors = editor.validationView.report?.errors ?? [];
  const set = (i: number, patch: Json) => editor.replaceConfig(setItem(config, side, i, patch));

  return (
    <div className="space-y-2" id={fieldId(['guardrails', side])}>
      {notice}
      {list.length === 0 ?
      <p className="text-[13px] text-muted">{side === 'input' ? 'No checks on what the caller says yet.' : 'No checks on what the agent says yet.'}</p> :

      <ul className="space-y-2">
          {list.map((raw, i) => {
          const r = isObj(raw) ? raw : {};
          const type = String(r.type ?? '');
          const w = checkWords(r);
          const parts = checkParts(type);
          const problems = errors.filter((e) => e.path?.[0] === 'guardrails' && e.path?.[1] === side && e.path?.[2] === i).length;
          const chosen = Array.isArray(r.entities) ? r.entities.filter((e): e is string => typeof e === 'string') : [];
          const kinds = Array.from(new Set([...(entities?.map((e) => e.kind) ?? []), ...chosen]));
          const trigger = isObj(r.on_trigger) ? r.on_trigger : {};
          const idBase = fieldId(['guardrails', side, i]);
          return (
            <Row
              key={`${String(r.id)}-${i}`}
              id={idBase}
              title={w.what || 'A check'}
              sub={[w.then ? `It ${w.then}` : '', w.how].filter(Boolean).join('. ')}
              chips={
              <>
                    {problems > 0 && <StatusChip tone="danger" dot>{problems} to fix</StatusChip>}
                    <code className="hidden self-center font-mono text-xs text-muted sm:inline" title="Its id">{String(r.id ?? '')}</code>
                  </>
              }
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              disabled={disabled}
              onDelete={() => {
                remember(`Check “${w.what || String(r.id)}” deleted.`, config);
                setOpen(null);
                editor.replaceConfig(removeItem(config, side, i));
              }}>
                <p className="text-[13px] text-ink-soft">{SIDE_TEXT[side]}</p>
                {parts.text &&
              <Labelled label={fieldWords('text', side).label} help={fieldWords('text', side).help} htmlFor={`${idBase}-text`}>
                    <textarea id={`${idBase}-text`} rows={2} className={cn(inputClass, 'resize-y')} value={typeof r.text === 'string' ? r.text : ''} disabled={disabled} placeholder="Never promise a refund." onChange={(e) => set(i, { text: e.target.value })} />
                  </Labelled>
              }
                {parts.entities &&
              <fieldset>
                    <legend className="text-[13px] font-medium text-ink-soft">{fieldWords('entities', side).label}</legend>
                    <p className="text-xs text-muted">{fieldWords('entities', side).help}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                      {kinds.map((k) =>
                  <label key={k} className="flex items-center gap-2 text-[13px] text-ink-soft" title={entities?.find((e) => e.kind === k)?.how}>
                          <input type="checkbox" checked={chosen.includes(k)} disabled={disabled || (chosen.length === 1 && chosen.includes(k))} onChange={(ev) => set(i, { entities: kinds.filter((x) => (x === k ? ev.target.checked : chosen.includes(x))) })} />
                          {entityLabel(k)}
                        </label>
                  )}
                    </div>
                  </fieldset>
              }
                {parts.patterns &&
              <Labelled label={fieldWords('patterns', side).label} help={fieldWords('patterns', side).help} htmlFor={`${idBase}-patterns`}>
                    <LinesInput id={`${idBase}-patterns`} label={fieldWords('patterns', side).label} value={Array.isArray(r.patterns) ? r.patterns.map(String) : []} disabled={disabled} placeholder={'\\bguaranteed\\b'} onChange={(v) => set(i, { patterns: v })} />
                  </Labelled>
              }
                {parts.fields &&
              <Labelled label={fieldWords('fields', side).label} help={fieldWords('fields', side).help} htmlFor={`${idBase}-fields`}>
                    <LinesInput id={`${idBase}-fields`} label={fieldWords('fields', side).label} value={Array.isArray(r.fields) ? r.fields.map(String) : []} disabled={disabled} placeholder="otp" onChange={(v) => set(i, { fields: v })} />
                  </Labelled>
              }
                <div className="flex flex-wrap gap-4">
                  <label className="block">
                    <span className="text-[13px] font-medium text-ink-soft">How it is applied</span>
                    <select className={cn(inputClass, 'mt-1.5')} value={String(r.enforcement ?? '')} disabled={disabled} onChange={(e) => set(i, { enforcement: e.target.value })}>
                      {!ENFORCEMENT_CHOICES[type]?.some((c) => c.value === r.enforcement) && <option value="">Choose…</option>}
                      {(ENFORCEMENT_CHOICES[type] ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                  {parts.onTrigger &&
                <label className="block">
                      <span className="text-[13px] font-medium text-ink-soft">When it finds something</span>
                      <select className={cn(inputClass, 'mt-1.5')} value={String(trigger.action ?? '')} disabled={disabled} onChange={(e) => set(i, { on_trigger: { ...trigger, action: e.target.value } })}>
                        {!trigger.action && <option value="">Choose…</option>}
                        {TRIGGER_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </label>
                }
                </div>
                {parts.onTrigger && (trigger.action === 'deflect' || trigger.action === 'end_call' || trigger.say !== undefined) &&
              <Labelled label={fieldWords('say', side).label} help={fieldWords('say', side).help}>
                    <SpeechInput
                  label="What it says when it finds something"
                  value={trigger.say}
                  config={config}
                  disabled={disabled}
                  placeholder="I can’t help with that, but I can help with your order."
                  onChange={(say) => {
                    const next: Json = { ...trigger };
                    if (say === undefined) delete next.say;
                    else next.say = say;
                    set(i, { on_trigger: next });
                  }} />
                  </Labelled>
              }
              </Row>);

        })}
        </ul>
      }
      <AddChoices
        label={side === 'input' ? 'Add a check on the caller' : 'Add a check on the agent'}
        disabled={disabled}
        choices={CHECK_KINDS[side]}
        onPick={(kind) => {
          const made = addCheck(config, side, kind);
          if (made.index < 0) return;
          editor.replaceConfig(made.config);
          setOpen(made.index);
        }} />
    </div>);

}

const SENTIMENTS = [
['', 'Any mood'],
['frustrated', 'Sounds frustrated'],
['negative', 'Is unhappy'],
['abusive', 'Is abusive']];


/** Reads a typed value the way a person means it: a number, true/false, or the text. */
const typedValue = (text: string): unknown => {
  const t = text.trim();
  if (t === '') return undefined;
  if (t === 'true' || t === 'false') return t === 'true';
  if (Number.isFinite(Number(t))) return Number(t);
  return text;
};

/** Every hand-over and ending rule, the switched-on ones included: when it applies, what it does, what it says first. */
export function RuleList({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  const [open, setOpen] = useState<number | null>(null);
  const { notice, remember } = useDeleted(editor);
  if (!config) return null;
  const disabled = !editor.canEdit;
  const list = items(config, 'escalation');
  const errors = editor.validationView.report?.errors ?? [];
  const tools = (config.tools ?? []).filter((t) => t?.id);
  const agents = (config.agents?.items ?? []).filter((a) => a?.id);
  const stateVars = Object.keys(isObj(config.state?.variables) ? (config.state?.variables as Json) : {});

  return (
    <div className="space-y-2" id={fieldId(['guardrails', 'escalation'])}>
      {notice}
      {list.length === 0 ?
      <p className="text-[13px] text-muted">No rules yet. Switch one on above, or add one of your own.</p> :

      <ul className="space-y-2">
          {list.map((raw, i) => {
          const r = isObj(raw) ? raw : {};
          const when = isObj(r.when) ? r.when : {};
          const missing = ruleMissing(r);
          const moment = momentOf(r, config);
          const problems = errors.filter((e) => e.path?.[0] === 'guardrails' && e.path?.[1] === 'escalation' && e.path?.[2] === i).length;
          const idBase = fieldId(['guardrails', 'escalation', i]);
          const action = r.action === 'tool' || r.action === 'handoff' ? r.action : 'end_call';
          return (
            <Row
              key={`${String(r.id)}-${i}`}
              id={idBase}
              title={missing || ruleWords(r, config)}
              sub={moment ? `The switch “${moment.label}” above. Change it here and it becomes a rule of your own.` : undefined}
              chips={
              <>
                    {problems > 0 && <StatusChip tone="danger" dot>{problems} to fix</StatusChip>}
                    {missing && !problems && <StatusChip tone="warning">Not finished</StatusChip>}
                    <code className="hidden self-center font-mono text-xs text-muted sm:inline" title="Its id">{String(r.id ?? '')}</code>
                  </>
              }
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              disabled={disabled}
              onDelete={() => {
                remember(`Rule “${missing ? String(r.id) : ruleWords(r, config)}” deleted.`, config);
                setOpen(null);
                editor.replaceConfig(removeItem(config, 'escalation', i));
              }}>
                <fieldset className="space-y-3">
                  <legend className="text-[13px] font-medium text-ink">Only when</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="block">
                      <span className="text-xs text-muted">The caller</span>
                      <select className={cn(inputClass, 'mt-1')} value={typeof when.sentiment === 'string' ? when.sentiment : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'sentiment', e.target.value))}>
                        {SENTIMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted">For this many turns in a row</span>
                      <input type="number" min={1} className={cn(inputClass, 'mt-1 w-28')} value={typeof when.consecutive_turns === 'number' ? when.consecutive_turns : ''} placeholder="1" disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'consecutive_turns', e.target.value === '' ? undefined : Math.max(1, Math.round(Number(e.target.value)))))} />
                    </label>
                    <label className="block min-w-[200px] flex-1">
                      <span className="text-xs text-muted">They want to (an intent)</span>
                      <input className={cn(inputClass, 'mt-1')} value={typeof when.intent === 'string' ? when.intent : ''} placeholder="asks_for_human" disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'intent', e.target.value))} />
                    </label>
                  </div>
                  <Labelled label="They say one of these words" help="One per line.">
                    <LinesInput label="Words that start this rule" mono={false} value={Array.isArray(when.keywords) ? when.keywords.map(String) : []} disabled={disabled} placeholder="manager" onChange={(v) => editor.replaceConfig(setRuleWhen(config, i, 'keywords', v))} />
                  </Labelled>
                  <div className="flex flex-wrap gap-4">
                    <label className="block">
                      <span className="text-xs text-muted">What it remembers</span>
                      <select className={cn(inputClass, 'mt-1')} value={typeof when.state === 'string' ? when.state : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'state', e.target.value))}>
                        <option value="">Not used</option>
                        {Array.from(new Set([...stateVars, ...(typeof when.state === 'string' && when.state ? [when.state] : [])])).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                    {typeof when.state === 'string' && when.state &&
                  <>
                        <label className="block">
                          <span className="text-xs text-muted">equals</span>
                          <input className={cn(inputClass, 'mt-1 w-32')} value={when.equals === undefined ? '' : String(when.equals)} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'equals', typedValue(e.target.value)))} />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">or at least</span>
                          <input type="number" className={cn(inputClass, 'mt-1 w-24')} value={typeof when.gte === 'number' ? when.gte : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'gte', e.target.value === '' ? undefined : Number(e.target.value)))} />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">at most</span>
                          <input type="number" className={cn(inputClass, 'mt-1 w-24')} value={typeof when.lte === 'number' ? when.lte : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleWhen(config, i, 'lte', e.target.value === '' ? undefined : Number(e.target.value)))} />
                        </label>
                      </>
                  }
                  </div>
                </fieldset>
                <div>
                  <p className="text-[13px] font-medium text-ink">Then it</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    <Segmented
                    size="sm"
                    label="What the rule does"
                    value={action}
                    options={[
                    { value: 'end_call', label: 'Ends the call' },
                    { value: 'tool', label: 'Runs a tool' },
                    { value: 'handoff', label: 'Hands over' }]
                    }
                    onChange={(v) => !disabled && editor.replaceConfig(setRuleAction(config, i, v, v === 'tool' ? tools.find((t) => t.builtin === 'transfer_or_callback')?.id ?? tools[0]?.id ?? '' : v === 'handoff' ? agents.find((a) => a.id !== config.agents?.entry)?.id ?? '' : ''))} />
                    {action === 'tool' &&
                  <label className="flex items-center gap-2 text-[13px] text-muted">
                        {fieldWords('tool', 'escalation').label}
                        <select className={cn(inputClass, 'w-auto')} value={typeof r.tool === 'string' ? r.tool : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleAction(config, i, 'tool', e.target.value))}>
                          <option value="">Choose…</option>
                          {tools.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                        </select>
                      </label>
                  }
                    {action === 'handoff' &&
                  <label className="flex items-center gap-2 text-[13px] text-muted">
                        {fieldWords('to', 'escalation').label}
                        <select className={cn(inputClass, 'w-auto')} value={typeof r.to === 'string' ? r.to : ''} disabled={disabled} onChange={(e) => editor.replaceConfig(setRuleAction(config, i, 'handoff', e.target.value))}>
                          <option value="">Choose…</option>
                          {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
                        </select>
                      </label>
                  }
                  </div>
                </div>
                <Labelled label={fieldWords('say', 'escalation').label} help={fieldWords('say', 'escalation').help}>
                  <SpeechInput label="What the rule says first" value={r.say} config={config} disabled={disabled} placeholder="Let me get you to someone who can help." onChange={(say) => editor.replaceConfig(setItem(config, 'escalation', i, { say }))} />
                </Labelled>
              </Row>);

        })}
        </ul>
      }
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          const made = addRule(config);
          editor.replaceConfig(made.config);
          setOpen(made.index);
        }}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a rule of your own
      </Button>
    </div>);

}
