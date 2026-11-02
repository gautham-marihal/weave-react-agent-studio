import React, { useState } from 'react';
import { ClockIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { AgentConfig } from '../../../../types/studio';
import { Button } from '../../../ui/Button';
import { StatusChip } from '../../../ui/StatusChip';
import {
  DAYS,
  DAY_NAMES,
  addException,
  addWindow,
  describeWeek,
  exceptions,
  freeScheduleId,
  officeHours,
  removeException,
  removeWindow,
  renameSchedule,
  scheduleProblems,
  scheduleUses,
  schedulesOf,
  setSchedule,
  setWindow,
  followerWords,
  weekWindows,
  type Day,
} from '../../../../models/schedule';
import { cn, inputClass } from '../../../../utils/styles';

type Json = Record<string, unknown>;
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The browser's time zone, for the starter (never a guess: UTC when the browser does not say). */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
/** The time zones the browser knows, for suggestions (none when it cannot list them). */
function knownZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

/**
 * Business hours: each schedule as a week strip, its time zone, its open windows and its closed or different days. A
 * schedule nothing follows is flagged "Not used" (hours change nothing on their own). `onRemoved` offers Undo.
 */
export function HoursCard({ editor, onRemoved }: { editor: DraftEditor; onRemoved: (label: string, previous: AgentConfig, after: AgentConfig) => void }) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const all = schedulesOf(config);
  const start = () => editor.replaceConfig(setSchedule(config, freeScheduleId(config), officeHours(localZone())));

  return (
    <div id="hours" className="space-y-3">
      {all.length === 0 ?
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-line-strong px-5 py-5">
          <div className="flex items-start gap-3">
            <ClockIcon className="mt-0.5 h-4 w-4 text-muted" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">No business hours yet</p>
              <p className="mt-0.5 text-[13px] text-muted">A phone transfer or a rule can follow them, for example to pass calls to a person only while someone is there.</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={start} disabled={disabled}>
            Start with Monday to Friday, 9 to 5
          </Button>
        </div> :

      <>
          {all.map(([id, schedule]) =>
        <ScheduleEditor key={id} editor={editor} config={config} id={id} schedule={schedule} disabled={disabled} onRemoved={onRemoved} />
        )}
          <Button size="sm" variant="ghost" onClick={() => editor.replaceConfig(setSchedule(config, freeScheduleId(config, 'hours'), officeHours(localZone())))} disabled={disabled}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add another schedule
          </Button>
        </>
      }
    </div>);

}

function ScheduleEditor({ editor, config, id, schedule, disabled, onRemoved }: { editor: DraftEditor; config: AgentConfig; id: string; schedule: Json; disabled: boolean; onRemoved: (label: string, previous: AgentConfig, after: AgentConfig) => void }) {
  const [rename, setRename] = useState<string | null>(null);
  const [renameProblem, setRenameProblem] = useState('');
  const [day, setDay] = useState('');
  const [special, setSpecial] = useState<'closed' | 'hours'>('closed');
  const [hours, setHours] = useState({ start: '09:00', end: '13:00' });
  const uses = scheduleUses(config, id);
  const put = (next: Json) => editor.replaceConfig(setSchedule(config, id, next));
  const problems = scheduleProblems(schedule);
  const name = typeof schedule.description === 'string' && schedule.description.trim() ? schedule.description : id.replace(/[_-]+/g, ' ');
  const zones = knownZones();

  return (
    <section aria-label={`Business hours ${name}`} data-schedule={id} className="rounded-lg border border-line bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {name}
            {uses.length === 0 ? <StatusChip tone="warning">Not used</StatusChip> : null}
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {uses.length ? `Followed by ${uses.map((p) => followerWords(config, p)).join(', ')}.` : 'Nothing follows these hours yet: choose them on a phone transfer or in a condition, or they change nothing.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={`Delete business hours ${name}`}
          onClick={() => {
            const after = setSchedule(config, id, null);
            editor.replaceConfig(after);
            onRemoved(`Business hours “${name}” deleted.`, config, after);
          }}>
          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
          Delete
        </Button>
      </div>

      <WeekStrip schedule={schedule} />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">Name</span>
          <input className={cn(inputClass, 'mt-1.5')} value={typeof schedule.description === 'string' ? schedule.description : ''} placeholder={id} disabled={disabled} onChange={(e) => {
            const next = { ...schedule };
            if (e.target.value) next.description = e.target.value;
            else delete next.description;
            put(next);
          }} />
        </label>
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">Time zone</span>
          <input className={cn(inputClass, 'mt-1.5')} list={`zones-${id}`} value={typeof schedule.timezone === 'string' ? schedule.timezone : ''} placeholder="Europe/London" disabled={disabled} onChange={(e) => put({ ...schedule, timezone: e.target.value })} />
          {zones.length > 0 && <datalist id={`zones-${id}`}>{zones.map((z) => <option key={z} value={z} />)}</datalist>}
        </label>
        <div>
          <span className="text-[13px] font-medium text-ink-soft">Id</span>
          {rename === null ?
          <p className="mt-1.5 flex items-center gap-2">
              <code className="rounded bg-subtle px-2 py-1 font-mono text-[13px] text-ink">{id}</code>
              {!disabled && <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setRename(id)}>Rename</button>}
            </p> :

          <div className="mt-1.5 flex gap-2">
              <input aria-label="New id" className={cn(inputClass, 'font-mono text-[13px]')} value={rename} onChange={(e) => setRename(e.target.value)} />
              <Button size="sm" onClick={() => {
              const r = renameSchedule(config, id, rename);
              if (r.problem) setRenameProblem(r.problem);
              else {
                editor.replaceConfig(r.config);
                setRename(null);
                setRenameProblem('');
              }
            }}>Rename</Button>
            </div>
          }
          {renameProblem && <p className="mt-1 text-xs text-danger" role="alert">{renameProblem}</p>}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[13px] font-medium text-ink-soft">Open</p>
        <ul className="mt-1.5 space-y-2">
          {list<Json>(schedule.weekly).map((w, i) =>
          <li key={i} className="flex flex-wrap items-center gap-2" data-window={i}>
              <div role="group" aria-label={`Days of window ${i + 1}`} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
                {DAYS.map((d) => {
                const on = list<string>(w.days).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAMES[d]}
                    disabled={disabled}
                    onClick={() => put(setWindow(schedule, i, { days: (on ? list<Day>(w.days).filter((x) => x !== d) : [...list<Day>(w.days), d]) as Day[] }))}
                    className={cn('w-9 rounded-md py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', on ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                      {DAY_NAMES[d].slice(0, 2)}
                    </button>);

              })}
              </div>
              <input aria-label={`Opens (window ${i + 1})`} className={cn(inputClass, 'w-20 font-mono text-[13px]')} value={String(w.start ?? '')} placeholder="09:00" disabled={disabled} onChange={(e) => put(setWindow(schedule, i, { start: e.target.value }))} />
              <span className="text-[13px] text-muted">to</span>
              <input aria-label={`Closes (window ${i + 1})`} className={cn(inputClass, 'w-20 font-mono text-[13px]')} value={String(w.end ?? '')} placeholder="17:00" disabled={disabled} onChange={(e) => put(setWindow(schedule, i, { end: e.target.value }))} />
              {list(schedule.weekly).length > 1 && !disabled &&
            <button type="button" aria-label={`Remove window ${i + 1}`} onClick={() => put(removeWindow(schedule, i))} className="rounded p-1 text-muted hover:bg-subtle hover:text-ink">
                  <XIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
            }
            </li>
          )}
        </ul>
        <Button size="sm" variant="ghost" className="mt-2" disabled={disabled} onClick={() => put(addWindow(schedule))}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add opening hours
        </Button>
      </div>

      <div className="mt-4">
        <p className="text-[13px] font-medium text-ink-soft">Closed or different days</p>
        {exceptions(schedule).length > 0 &&
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {exceptions(schedule).map((x) =>
          <li key={x.date} className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-1 text-[13px] text-ink">
                <span className="font-mono">{x.date}</span> {x.text}
                {!disabled && <button type="button" aria-label={`Remove ${x.date}`} onClick={() => put(removeException(schedule, x.date))} className="rounded p-0.5 hover:bg-line"><XIcon className="h-3 w-3" aria-hidden /></button>}
              </li>
          )}
          </ul>
        }
        {!disabled &&
        <div className="mt-2 flex flex-wrap items-end gap-2">
            <input type="date" aria-label="Date" className={cn(inputClass, 'w-40')} value={day} onChange={(e) => setDay(e.target.value)} />
            <select aria-label="What happens that day" className={cn(inputClass, 'w-40')} value={special} onChange={(e) => setSpecial(e.target.value as 'closed' | 'hours')}>
              <option value="closed">Closed all day</option>
              <option value="hours">Other hours</option>
            </select>
            {special === 'hours' &&
          <>
                <input aria-label="Opens that day" className={cn(inputClass, 'w-20 font-mono text-[13px]')} value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} />
                <input aria-label="Closes that day" className={cn(inputClass, 'w-20 font-mono text-[13px]')} value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} />
              </>
          }
            <Button size="sm" variant="secondary" disabled={!day} onClick={() => {
            put(addException(schedule, day, special === 'closed' ? null : hours));
            setDay('');
          }}>Add the day</Button>
          </div>
        }
      </div>

      {problems.length > 0 &&
      <ul className="mt-3 space-y-0.5 text-[13px] text-warning" role="note">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      }
    </section>);

}

const percent = (minutes: number) => `${(minutes / 1440) * 100}%`;

/** The week at a glance: one bar per day, shaded where it is open, with the same in words. */
export function WeekStrip({ schedule }: { schedule: Json }) {
  const week = weekWindows(schedule);
  const words = describeWeek(schedule);
  return (
    <figure className="mt-3" aria-label="The week at a glance">
      <figcaption className="text-[13px] text-ink-soft" data-week>{words}</figcaption>
      <div role="img" aria-label={words} className="mt-2 space-y-1">
        {DAYS.map((d) =>
        <div key={d} className="flex items-center gap-2">
            <span className="w-8 text-[11px] font-medium text-muted">{DAY_NAMES[d].slice(0, 3)}</span>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-subtle">
              {week[d].map(([from, to]) => <i key={from} className="absolute inset-y-0 rounded-full bg-accent/70" style={{ left: percent(from), width: percent(to - from) }} />)}
            </div>
          </div>
        )}
        <div className="flex justify-between pl-10 text-[10px] tabular-nums text-muted" aria-hidden>
          <span>0:00</span>
          <span>6:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>
    </figure>);

}
