import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { BotNumbersState } from '../../../../hooks/useBotNumbers';
import type { Path } from '../../../../types/studio';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
import { Toggle } from '../../../ui/Toggle';
import { StatusChip } from '../../../ui/StatusChip';
import {
  CAPABILITIES,
  CHANNEL_TYPES,
  ENTRY_FIELDS,
  ENTRY_LABELS,
  PLATFORM_ROUTE,
  changeChannelType,
  channelTitle,
  greetingNote,
  modalityNotes,
  modalityWords,
  phoneLineWords,
  shareFirstLine,
  typeLabel,
} from '../../../../models/channels';
import { canForms, canKeypad, findVoiceOnly, infoOf, isVoiceChannel, mislabelledChat, plainSetting, stripVoiceOnly, type ChannelKind } from '../../../../models/channelTypes';
import { fieldId } from '../../../../utils/path';
import { cn, inputClass } from '../../../../utils/styles';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const MODALITY_WORDS: Record<string, string> = { audio: 'Voice', text: 'Text', image: 'Pictures', video: 'Video' };
// Every value the schema allows, for a kind the server did not describe.
const ALL_MODALITIES = { input: ['audio', 'text', 'image', 'video'], output: ['audio', 'text'] };

interface ChannelDialogProps {
  editor: DraftEditor;
  index: number;
  types: ChannelKind[] | null;
  numbers: BotNumbersState;
  onClose: () => void;
  onDelete: (index: number) => void;
  onOpenJson: () => void;
}

/**
 * One channel, drawn for its kind: on or off, what it says first (asked on the Agent page), what it can do and carry
 * (only what GET /channel-types allows for the kind), how it is reached, and its technical details. Every change is an
 * edit of the draft as it is made (Undo takes it back); Done closes.
 */
export function ChannelDialog({ editor, index, types, numbers, onClose, onDelete, onOpenJson }: ChannelDialogProps) {
  const [confirmType, setConfirmType] = useState<{ type: string; cleared: string[] } | null>(null);
  const config = editor.config;
  const channel = config?.channels?.[index];
  if (!config || !isObj(channel)) return null;
  const disabled = !editor.canEdit;
  const type = String(channel.type);
  const kind = infoOf(types, type);
  const path: Path = ['channels', index];
  const set = (next: Json) => editor.update(path, next);
  const patch = (change: Json) => set({ ...channel, ...change });
  const without = (key: string) => {
    const next: Json = { ...channel };
    delete next[key];
    set(next);
  };

  const note = greetingNote(config, index);
  const greeting = isObj(channel.greeting) ? channel.greeting : null;
  const speaks = Array.isArray(channel.modalities?.output) ? list(channel.modalities.output).includes('audio') : type === 'sip_voice' || type === 'web_voice';
  const caps: Json = isObj(channel.capabilities) ? channel.capabilities : {};
  const unavailable = (key: string) => (key === 'dtmf' && !canKeypad(types, type)) || (key === 'forms' && !canForms(types, type));
  const modalities: Json = isObj(channel.modalities) ? channel.modalities : {};
  const notes = modalityNotes(channel, config);
  const mislabelled = mislabelledChat(channel);
  const voiceOnly = kind && !isVoiceChannel(channel, types) ? findVoiceOnly(channel.overrides) : [];
  const errors = (editor.validationView.report?.errors ?? []).filter((e) => e.path?.[0] === 'channels' && e.path?.[1] === index);

  const entry: Json = isObj(channel.entry) ? channel.entry : {};
  const applicable = kind ? (kind.entryFields === null ? Object.keys(ENTRY_LABELS) : kind.entryFields) : ENTRY_FIELDS[type] ?? Object.keys(ENTRY_LABELS);
  const phoneLine = type === 'sip_voice';
  const shown = applicable.filter((key) => !(phoneLine && PLATFORM_ROUTE.includes(key)));
  const noted = phoneLine ? PLATFORM_ROUTE.filter((key) => entry[key] !== undefined && entry[key] !== '') : [];
  const stray = Object.keys(entry).filter((key) => !applicable.includes(key));
  const setEntry = (key: string, value: unknown) => {
    const next: Json = { ...entry };
    if (value === '' || (Array.isArray(value) && !value.length)) delete next[key];
    else next[key] = value;
    if (!Object.keys(next).length && type !== 'sip_voice' && type !== 'web_chat') without('entry');
    else patch({ entry: next });
  };
  const dropEntry = (keys: string[]) => {
    const next: Json = { ...entry };
    keys.forEach((k) => delete next[k]);
    patch({ entry: next });
  };

  const toggleModality = (way: 'input' | 'output', value: string, on: boolean) => {
    const current = list<string>(modalities[way]);
    const next = on ? [...current, value] : current.filter((v) => v !== value);
    if (!next.length) return; // the schema needs one each way
    patch({ modalities: { ...modalities, [way]: ALL_MODALITIES[way].filter((v) => next.includes(v)).concat(next.filter((v) => !ALL_MODALITIES[way].includes(v))) } });
  };

  const askType = (next: string) => {
    if (next === type) return;
    const { channel: changed, cleared } = changeChannelType(channel, next, editor.agent?.id ?? '', types);
    if (cleared.length) setConfirmType({ type: next, cleared });
    else set(changed);
  };
  const applyType = () => {
    if (!confirmType) return;
    set(changeChannelType(channel, confirmType.type, editor.agent?.id ?? '', types).channel);
    setConfirmType(null);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={channelTitle(config, index)}
      description={<>{kind?.note || modalityWords(channel.modalities) || typeLabel(type)}</>}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger" disabled={disabled} onClick={() => onDelete(index)}>
            <Trash2Icon className="h-4 w-4" aria-hidden />
            Delete channel
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }>
      <div className="space-y-6" data-channel-type={type}>
        {errors.length > 0 &&
        <ul className="space-y-1 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {errors.map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
        }

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">On</p>
            <p className="mt-0.5 text-[13px] text-muted">Switched off, nobody reaches the agent this way; its settings are kept.</p>
          </div>
          <Toggle checked={channel.enabled !== false} onChange={(v) => patch({ enabled: v })} label="Channel on" disabled={disabled} />
        </div>
        {kind && !kind.runsToday &&
        <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" role="note">
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            Nothing connects {kind.label} to the runtime yet, so this channel is saved but nobody can reach the agent through it.
          </p>
        }

        <Block title="What it says first">
          <p className="text-[13px] text-ink-soft" data-note="greeting">
            {note.text}{' '}
            {note.share && !disabled &&
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => editor.replaceConfig(shareFirstLine(config, index))}>
                {note.share === 'instead' ? 'Say the agent’s first line here instead' : 'Say the agent’s first line here too'}
              </button>
            }
          </p>
          {speaks && greeting && greeting.say !== undefined &&
          <Row title="Let the caller interrupt the first line" text={`Whether someone can talk over what it says first${'allow_interruptions' in greeting ? '' : ' (the server’s default: they can)'}.`}>
              <Toggle checked={greeting.allow_interruptions !== false} onChange={(v) => patch({ greeting: { ...greeting, allow_interruptions: v } })} label="Let the caller interrupt the first line" disabled={disabled} />
            </Row>
          }
        </Block>

        {phoneLine &&
        <Block title="How callers reach it">
            <p className="text-[13px] text-ink-soft" data-note="numbers">
              {numbers.status === 'ready' ? `${phoneLineWords(numbers.numbers)}.` : numbers.status === 'unavailable' ? 'Phone numbers are not available on this server.' : numbers.status === 'error' ? `The numbers could not be read (${numbers.message}).` : 'Reading its numbers…'}{' '}
              Numbers are added and changed in <Link to="/library" className="font-medium text-accent hover:underline">Library › Phone numbers</Link>, or when it goes live: the phone line and the rule that routes calls are set up for you. There is nothing to fill in here.
            </p>
            {noted.length > 0 &&
          <div className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-soft" data-note="route-notes">
                <p>This channel still notes {noted.length === 1 ? 'a value' : 'values'} from an older setup. Calls are not routed by {noted.length === 1 ? 'it' : 'them'}.</p>
                <dl className="mt-1 space-y-0.5">
                  {noted.map((key) =>
              <div key={key} className="flex gap-2">
                      <dt>{ENTRY_LABELS[key]?.[0] ?? key}:</dt>
                      <dd><code className="font-mono">{typeof entry[key] === 'string' ? String(entry[key]) : JSON.stringify(entry[key])}</code></dd>
                    </div>
              )}
                </dl>
                {!disabled && <button type="button" className="mt-1 font-medium text-accent hover:underline" onClick={() => dropEntry(noted)}>Remove {noted.length === 1 ? 'this note' : 'these notes'}</button>}
              </div>
          }
          </Block>
        }

        <Block title="What it can do">
          <div className="space-y-2">
            {CAPABILITIES.filter((cap) => !unavailable(cap.key) || caps[cap.key] === true).map((cap) => {
              const explicit = cap.key in caps;
              return (
                <Row key={cap.key} title={cap.label} text={`${cap.help}${explicit ? '' : ' Using the default for this kind.'}`} warn={unavailable(cap.key) ? `${kind?.label ?? 'This kind'} has ${cap.key === 'dtmf' ? 'no keypad' : 'no screen to show a form on'}, so the server refuses this. Turn it off.` : ''}>
                  <Toggle checked={explicit ? caps[cap.key] === true : cap.fallback(type)} onChange={(v) => patch({ capabilities: { ...caps, [cap.key]: v } })} label={cap.label} disabled={disabled} />
                </Row>);

            })}
          </div>
        </Block>

        <Block title="What it carries" lead={kind ? 'Only what this kind of channel can carry is offered.' : 'The server did not describe this kind, so every choice is offered.'}>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['input', 'output'] as const).map((way) => {
              const allowed = (kind ? way === 'input' ? kind.input : kind.output : null) ?? ALL_MODALITIES[way];
              const current = list<string>(modalities[way]);
              const extra = current.filter((v) => !allowed.includes(v));
              return (
                <fieldset key={way} id={fieldId([...path, 'modalities', way])}>
                  <legend className="text-[13px] font-medium text-ink-soft">{way === 'input' ? 'From the person' : 'From the agent'}</legend>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
                    {[...allowed, ...extra].map((value) =>
                    <label key={value} className={cn('flex items-center gap-2 text-[13px]', extra.includes(value) ? 'text-danger' : 'text-ink')}>
                        <input type="checkbox" checked={current.includes(value)} disabled={disabled} onChange={(e) => toggleModality(way, value, e.target.checked)} />
                        {MODALITY_WORDS[value] ?? value}
                        {extra.includes(value) && <span className="text-xs">(this kind can’t carry it)</span>}
                      </label>
                    )}
                  </div>
                </fieldset>);

            })}
          </div>
          {notes.length > 0 &&
          <ul className="mt-3 space-y-1">
              {notes.map((n) =>
            <li key={n.text} className={cn('text-[13px]', n.level === 'warn' ? 'text-warning' : 'text-muted')}>{n.text}</li>
            )}
            </ul>
          }
        </Block>

        <Block title="Extra instructions on this channel" lead="Added to every agent’s instructions here, such as “the caller has no screen”.">
          <textarea
            aria-label="Extra instructions on this channel"
            rows={2}
            className={cn(inputClass, 'resize-y')}
            value={typeof channel.instructions_append === 'string' ? channel.instructions_append : ''}
            disabled={disabled}
            onChange={(e) => (e.target.value ? patch({ instructions_append: e.target.value }) : without('instructions_append'))} />
        </Block>

        {(mislabelled || voiceOnly.length > 0) &&
        <ul className="space-y-2" aria-label="What does not fit this channel">
            {mislabelled &&
          <li className="flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" data-note="mislabelled">
                This web chat carries audio, so it is really a web voice channel.
                {!disabled && <Button size="sm" variant="secondary" onClick={() => askType('web_voice')}>Make it a web voice channel</Button>}
              </li>
          }
            {voiceOnly.length > 0 &&
          <li className="flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" data-note="voice-only">
                {kind?.label ?? 'This kind of channel'} has no voice, so these settings do nothing here: {voiceOnly.map(plainSetting).join(', ')}.
                {!disabled &&
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const { overrides } = stripVoiceOnly(channel.overrides);
                if (overrides) patch({ overrides });
                else without('overrides');
              }}>
                    Remove them
                  </Button>
            }
              </li>
          }
          </ul>
        }

        <details className="group rounded-lg border border-line" open={errors.length > 0 || undefined}>
          <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] font-medium text-ink-soft hover:text-ink">
            Technical details <span className="font-normal text-muted">· {[typeLabel(type), modalityWords(channel.modalities)].filter(Boolean).join(' · ')}</span>
          </summary>
          <div className="space-y-4 border-t border-line px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[13px] font-medium text-ink-soft">Id</p>
                <code className="mt-1.5 inline-block rounded bg-subtle px-2 py-1 font-mono text-[13px] text-ink">{String(channel.id ?? '')}</code>
              </div>
              <label className="block">
                <span className="text-[13px] font-medium text-ink-soft">Kind of channel</span>
                <select aria-label="Kind of channel" className={cn(inputClass, 'mt-1.5')} value={type} disabled={disabled} onChange={(e) => askType(e.target.value)}>
                  {!CHANNEL_TYPES.includes(type) && <option value={type}>{type}</option>}
                  {CHANNEL_TYPES.filter((t) => !types || !!infoOf(types, t) || t === type).map((t) =>
                  <option key={t} value={t}>
                      {typeLabel(t)}
                      {infoOf(types, t)?.runsToday === false ? ' (not available yet)' : ''}
                    </option>
                  )}
                </select>
                <span className="mt-1 block text-xs text-muted">Changing it clears the settings that only belong to the old kind (you are asked first).</span>
              </label>
            </div>
            {confirmType &&
            <div className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" role="alertdialog" aria-label="Change the kind of channel">
                <p>
                  Change this channel to {typeLabel(confirmType.type)}? These settings don’t apply to it and are cleared: {confirmType.cleared.map(plainSetting).join(', ')}.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={applyType}>Change channel</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmType(null)}>Cancel</Button>
                </div>
              </div>
            }
            {!phoneLine && (shown.length > 0 || stray.length > 0) &&
            <div className="space-y-3">
                <p className="text-[13px] text-muted">How it is reached, for reference only: the runtime does not read these. A visitor reaches the agent through the widget’s session.</p>
                {shown.map((key) => {
                const [label, help, example] = ENTRY_LABELS[key] ?? [key, '', ''];
                const id = `${fieldId([...path, 'entry', key])}-input`;
                return (
                  <div key={key} id={fieldId([...path, 'entry', key])}>
                      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">{label}</label>
                      {key === 'allowed_origins' ?
                    <textarea id={id} rows={2} className={cn(inputClass, 'mt-1.5 resize-y font-mono text-[13px]')} placeholder={`${example} (one per line)`} disabled={disabled} value={list<string>(entry[key]).join('\n')} onChange={(e) => setEntry(key, e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} /> :

                    <input id={id} className={cn(inputClass, 'mt-1.5 font-mono text-[13px]')} placeholder={example} disabled={disabled} value={typeof entry[key] === 'string' ? String(entry[key]) : ''} onChange={(e) => setEntry(key, e.target.value)} />
                    }
                      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
                    </div>);

              })}
              </div>
            }
            {stray.length > 0 &&
            <div className="rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-soft">
                <p>{stray.length === 1 ? 'This field doesn’t' : 'These fields don’t'} apply to {typeLabel(type)}: {stray.map((k) => <code key={k} className="mr-1 font-mono">{k}</code>)}</p>
                {!disabled && <button type="button" className="mt-1 font-medium text-accent hover:underline" onClick={() => dropEntry(stray)}>Remove {stray.length === 1 ? 'it' : 'them'}</button>}
              </div>
            }
            {(isObj(channel.match) || isObj(channel.inputs) || isObj(channel.overrides)) &&
            <p className="text-[13px] text-muted">
                It also has {[isObj(channel.match) && 'how callers are matched', isObj(channel.inputs) && 'picture and camera settings', isObj(channel.overrides) && 'its own model or conversation settings'].filter(Boolean).join(', ')}: change these in the <button type="button" className="font-medium text-accent hover:underline" onClick={onOpenJson}>JSON view</button>.
              </p>
            }
          </div>
        </details>
        {disabled && <StatusChip>Read only</StatusChip>}
      </div>
    </Dialog>);

}

function Block({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {lead && <p className="mt-0.5 text-[13px] text-muted">{lead}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </section>);

}

function Row({ title, text, warn, children }: { title: string; text: string; warn?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{text}</p>
          {warn && <p className="mt-1 text-[13px] text-warning" role="note">{warn}</p>}
        </div>
        {children}
      </div>
    </div>);

}
