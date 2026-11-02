import React, { useEffect, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { ACTION_KINDS, changeKind, describeAction, describeRule, kindLabel, makeAction, moveItem, newRule, typedValue, valueText, type Action, type Rule } from '../../../../models/effects';
import { refIds, type RefKind } from '../../../../models/tools';
import { speechText } from '../../../../models/messages';
import type { AgentConfig } from '../../../../types/studio';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';
import { ConditionBuilder } from './ConditionBuilder';
import { IdSelect, OrderButtons } from './parts';
import { linkButton, moveKeys } from './keys';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A spoken line: its own words, or one of the fixed lines (by id). */
function SpeechField({ value, onChange, config, label, disabled, optional }: { value: unknown; onChange: (v: unknown) => void; config: AgentConfig; label: string; disabled?: boolean; optional?: boolean }) {
  const fixed = isObj(value) && typeof value.message === 'string';
  const messages = refIds(config, 'messages');
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-ink-soft">
          <input type="radio" checked={!fixed} disabled={disabled} onChange={() => onChange(optional ? undefined : '')} />
          Its own words
        </label>
        <label className="flex items-center gap-1.5 text-ink-soft">
          <input type="radio" checked={fixed} disabled={disabled || !messages.length} onChange={() => onChange({ message: messages[0] })} />
          One of the fixed lines{messages.length ? '' : ' (none yet)'}
        </label>
      </div>
      {fixed ?
      <>
          <IdSelect label={label} value={String((value as Json).message)} options={messages} disabled={disabled} onChange={(v) => onChange({ message: v })} />
          {speechText(value, config) && <p className="text-xs text-muted">“{speechText(value, config)}”</p>}
        </> :

      <input className={inputClass} aria-label={label} value={typeof value === 'string' ? value : ''} placeholder={optional ? 'Nothing: it just does it' : 'What it says'} disabled={disabled} onChange={(e) => onChange(optional && !e.target.value ? undefined : e.target.value)} />
      }
    </div>);

}

/** Variable = value rows for a "Change state" step. */
function StateValues({ value, onChange, stateVars, label, disabled }: { value: unknown; onChange: (v: Json) => void; stateVars: string[]; label: string; disabled?: boolean }) {
  const values = isObj(value) ? value : {};
  const free = stateVars.filter((v) => !(v in values));
  return (
    <div className="space-y-2">
      {Object.entries(values).map(([name, v]) =>
      <div key={name} className="flex items-center gap-2">
          <code className="w-36 shrink-0 truncate font-mono text-[13px] text-ink" title={name}>{name}</code>
          <span className="text-xs text-muted">to</span>
          <input className={cn(inputClass, 'flex-1')} aria-label={`${label}: value for ${name}`} value={valueText(v)} disabled={disabled} placeholder="true, a number or text" onChange={(e) => onChange({ ...values, [name]: typedValue(e.target.value) })} />
          {!disabled &&
        <Button size="sm" variant="ghost" aria-label={`${label}: stop setting ${name}`} onClick={() => onChange(Object.fromEntries(Object.entries(values).filter(([k]) => k !== name)))}>
              <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
            </Button>
        }
        </div>
      )}
      {!disabled &&
      <select aria-label={`${label}: set a state variable`} className={cn(inputClass, 'max-w-xs')} value="" onChange={(e) => e.target.value && onChange({ ...values, [e.target.value]: '' })}>
          <option value="">{free.length ? 'Set a variable…' : stateVars.length ? 'Every variable is set here' : 'No state variables yet'}</option>
          {free.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      }
    </div>);

}

const REF_FIELDS: Record<string, [string, RefKind, string]> = {
  handoff: ['to', 'agents', 'Which agent'],
  transfer: ['transfer', 'transfers', 'Which transfer'],
  notify: ['notification', 'notifications', 'Which notification'],
  send_form: ['form', 'forms', 'Which form'],
  wrapup: ['wrapup', 'wrapups', 'Which wrap-up'],
  collect_dtmf: ['into', 'state_vars', 'Keep the digits in'],
};

/** The details of one step, by its kind. Anything a kind has that is not asked here stays as it is. */
function ActionFields({ action, onChange, config, label, disabled }: { action: Action; onChange: (a: Action) => void; config: AgentConfig; label: string; disabled?: boolean }) {
  const set = (key: string, v: unknown) => {
    const next = { ...action };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const type = String(action.type ?? '');
  const ref = REF_FIELDS[type];
  return (
    <div className="space-y-2">
      {type === 'say' && <SpeechField value={action.text} onChange={(v) => set('text', v)} config={config} label={`${label}: what it says`} disabled={disabled} />}
      {type === 'end_call' && <SpeechField value={action.say} onChange={(v) => set('say', v)} config={config} label={`${label}: what it says first`} disabled={disabled} optional />}
      {type === 'generate' &&
      <textarea className={cn(inputClass, 'resize-y')} rows={2} aria-label={`${label}: instructions for the model`} placeholder="Thank the caller and confirm what happens next." value={String(action.instructions ?? '')} disabled={disabled} onChange={(e) => set('instructions', e.target.value)} />
      }
      {type === 'set_state' && <StateValues value={action.values} onChange={(v) => set('values', v)} stateVars={refIds(config, 'state_vars')} label={label} disabled={disabled} />}
      {ref &&
      <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{ref[2]}</span>
          <IdSelect className="max-w-xs" label={`${label}: ${ref[2].toLowerCase()}`} value={String(action[ref[0]] ?? '')} options={refIds(config, ref[1])} disabled={disabled} onChange={(v) => set(ref[0], v)} />
        </div>
      }
      {type === 'collect_dtmf' &&
      <label className="flex items-center gap-2 text-xs text-muted">
          How many digits
          <input type="number" min={1} className={cn(inputClass, 'w-24')} value={typeof action.num_digits === 'number' ? action.num_digits : ''} disabled={disabled} onChange={(e) => set('num_digits', e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : undefined)} />
        </label>
      }
      {type === 'http' &&
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.5fr)]">
          <IdSelect label={`${label}: connection`} value={String(action.connection ?? '')} options={refIds(config, 'http_connections')} disabled={disabled} onChange={(v) => set('connection', v)} placeholder="Connection…" />
          <select className={inputClass} aria-label={`${label}: method`} value={String(action.method ?? 'GET')} disabled={disabled} onChange={(e) => set('method', e.target.value)}>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input className={cn(inputClass, 'font-mono text-[13px]')} aria-label={`${label}: path`} placeholder="/path" value={String(action.path ?? '')} disabled={disabled} onChange={(e) => set('path', e.target.value)} />
        </div>
      }
      {type === 'play_sound' && (typeof action.sound === 'string' || action.sound === undefined) &&
      <input className={inputClass} aria-label={`${label}: sound`} placeholder="A sound’s name or address" value={String(action.sound ?? '')} disabled={disabled} onChange={(e) => set('sound', e.target.value)} />
      }
      {type === 'log' &&
      <div className="flex gap-2">
          <select className={cn(inputClass, 'w-28')} aria-label={`${label}: level`} value={String(action.level ?? 'info')} disabled={disabled} onChange={(e) => set('level', e.target.value)}>
            {['debug', 'info', 'warning', 'error'].map((l) => <option key={l}>{l}</option>)}
          </select>
          <input className={inputClass} aria-label={`${label}: log line`} value={String(action.message ?? '')} disabled={disabled} onChange={(e) => set('message', e.target.value)} />
        </div>
      }
    </div>);

}

/** A list of steps, numbered: each picks its kind from a plain menu, then its details; move up / down or delete. */
export function ActionSteps({ actions, onChange, config, label, disabled }: { actions: Action[]; onChange: (next: Action[]) => void; config: AgentConfig; label: string; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <ol className="space-y-2" aria-label={`What ${label} does, in order`}>
        {actions.map((action, j) => {
          const name = `step ${j + 1} of ${label}`;
          return (
            <li key={j} data-step={j + 1} className="rounded-md border border-line bg-surface p-3" onKeyDown={moveKeys(j, actions.length, (to) => onChange(moveItem(actions, j, to)))}>
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>{j + 1}</span>
                <select
                  className={cn(inputClass, 'h-8 max-w-[16rem] py-1 text-[13px]')}
                  aria-label={`Step ${j + 1} of ${label}: what to do`}
                  value={String(action.type ?? '')}
                  disabled={disabled}
                  onChange={(e) => onChange(actions.map((a, k) => (k === j ? changeKind(a, e.target.value) : a)))}>
                  {!ACTION_KINDS.some((k) => k.type === action.type) && <option value={String(action.type ?? '')}>{kindLabel(action.type)}</option>}
                  {ACTION_KINDS.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
                </select>
                <span className="min-w-0 flex-1 truncate text-xs text-muted" data-sentence>{describeAction(action)}</span>
                <OrderButtons index={j} count={actions.length} name={name} disabled={disabled} onMove={(to) => onChange(moveItem(actions, j, to))} onDelete={() => onChange(actions.filter((_, k) => k !== j))} />
              </div>
              <div className="mt-2 pl-8">
                <ActionFields action={action} config={config} label={`Step ${j + 1} of ${label}`} disabled={disabled} onChange={(next) => onChange(actions.map((a, k) => (k === j ? next : a)))} />
              </div>
            </li>);

        })}
      </ol>
      {actions.length === 0 && <p className="text-xs text-warning">Needs at least one step.</p>}
      {!disabled &&
      <select aria-label={`Add a step to ${label}`} className={cn(inputClass, 'h-8 max-w-[16rem] py-1 text-[13px]')} value="" onChange={(e) => e.target.value && onChange([...actions, makeAction(e.target.value)])}>
          <option value="">Add a step…</option>
          {ACTION_KINDS.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
        </select>
      }
    </div>);

}

interface EffectsEditorProps {
  value: unknown;
  onChange: (next: Rule[] | undefined) => void;
  config: AgentConfig;
  argNames: string[];
  disabled?: boolean;
}

/** A tool's rules after it succeeds: each applies always or when a condition holds, then does its steps in order. */
export function EffectsEditor({ value, onChange, config, argNames, disabled }: EffectsEditorProps) {
  const rules: Rule[] = Array.isArray(value) ? (value as Rule[]) : [];
  const write = (next: Rule[]) => onChange(next.length ? next : undefined);
  const setRule = (i: number, rule: Rule) => write(rules.map((r, k) => (k === i ? rule : r)));
  const stateVars = refIds(config, 'state_vars');
  // the last-opened "Only when…" stays open while its condition is still empty
  const [opening, setOpening] = useState<number | null>(null);
  useEffect(() => setOpening(null), [rules.length]);

  return (
    <div className="space-y-3">
      {rules.length === 0 && <p className="text-[13px] text-muted">Nothing happens after this tool succeeds, apart from the model answering. Add a rule to say a line, change state, hand off or end the call.</p>}
      {rules.map((rule, i) => {
        const actions: Action[] = Array.isArray(rule.do) ? rule.do : [];
        const name = `rule ${i + 1}`;
        const hasWhen = rule.when !== undefined || opening === i;
        return (
          <section key={i} aria-label={`Rule ${i + 1}`} className="rounded-lg border border-line bg-canvas/40 p-3">
            <header className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">Rule {i + 1}</p>
                <p className="text-xs text-muted" data-rule-sentence>{describeRule(rule)}</p>
              </div>
              <OrderButtons index={i} count={rules.length} name={name} disabled={disabled} onMove={(to) => write(moveItem(rules, i, to))} onDelete={() => write(rules.filter((_, k) => k !== i))} />
            </header>
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted">When</p>
              {hasWhen ?
              <>
                  <ConditionBuilder value={rule.when} stateVars={stateVars} argNames={argNames} disabled={disabled} label={`Rule ${i + 1} condition`} onChange={(when) => setRule(i, { ...rule, when })} />
                  {!disabled &&
                <button
                  type="button"
                  className={cn(linkButton, 'text-xs')}
                  onClick={() => {
                    setOpening(null);
                    const rest = { ...rule };
                    delete rest.when;
                    setRule(i, rest);
                  }}>
                      Remove the condition (always do this)
                    </button>
                }
                </> :

              <p className="text-[13px] text-ink-soft">
                  Always.{' '}
                  {!disabled &&
                <button type="button" className={cn(linkButton, 'text-[13px]')} onClick={() => setOpening(i)}>
                      Only when…
                    </button>
                }
                </p>
              }
              <p className="pt-1 text-xs font-medium uppercase tracking-wider text-muted">Then</p>
              <ActionSteps actions={actions} config={config} label={name} disabled={disabled} onChange={(next) => setRule(i, { ...rule, do: next })} />
            </div>
          </section>);

      })}
      {!disabled &&
      <Button size="sm" variant="secondary" onClick={() => write([...rules, newRule()])}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a rule
        </Button>
      }
    </div>);

}
