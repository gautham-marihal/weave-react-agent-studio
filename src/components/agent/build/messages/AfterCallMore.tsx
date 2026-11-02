import React from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { useProviders } from '../../../../hooks/useProviders';
import { llmProviders } from '../../../../data/providers';
import { providersFor } from '../../../../utils/providerOptions';
import {
  ARTIFACT_KINDS,
  LOG_LEVELS,
  SINK_METHODS,
  addArtifact,
  addWrapup,
  artifactWords,
  artifactsOf,
  folderProblem,
  observabilityOf,
  removeArtifact,
  removeWrapup,
  setArtifact,
  setObservability,
  setOtel,
  setSessionLogField,
  setSinkField,
  setSinkType,
  setSummaryModel,
  setWrapupGoodbye,
  setWrapupWait,
  summaryModelOf,
  summaryModelShown,
  wrapupStepWords,
  wrapupsOf,
  type ArtifactKind,
} from '../../../../models/afterCall';
import { speechText } from '../../../../models/messages';
import { fieldId } from '../../../../utils/path';
import { Button } from '../../../ui/Button';
import { Segmented } from '../../../ui/Segmented';
import { StatusChip } from '../../../ui/StatusChip';
import { Toggle } from '../../../ui/Toggle';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';
import { Card } from './parts';
import { useDeleted } from './useDeleted';

/**
 * More after-call settings: the model that writes the summaries, files written or sent when a call ends, closing
 * messages (wrap-ups), and the call records and logs. Each control writes the schema's own path; a setting not set
 * says "Server's default".
 */
export function AfterCallMore({ editor }: { editor: DraftEditor }) {
  return (
    <div className="space-y-8">
      <SummaryModel editor={editor} />
      <Files editor={editor} />
      <ClosingMessages editor={editor} />
      <Records editor={editor} />
    </div>);

}

function SummaryModel({ editor }: { editor: DraftEditor }) {
  const { answer } = useProviders();
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const shown = summaryModelShown(config);
  const m = summaryModelOf(config);
  const choices = providersFor('llm', answer, m.provider || undefined);
  const suggestions = llmProviders.find((p) => p.id === m.provider)?.models ?? [];
  const set = (change: Parameters<typeof setSummaryModel>[1]) => editor.replaceConfig(setSummaryModel(config, change));
  return (
    <Card title="The model that writes the summaries" text="Left empty, summaries are written by the agent’s own AI model.">
      {!shown ?
      <p className="text-[13px] text-muted">Switch on “Write a summary” above to choose a model for it.</p> :

      <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">Provider</span>
            <select className={cn(inputClass, 'mt-1.5 w-48')} value={m.provider} disabled={disabled} onChange={(e) => set({ provider: e.target.value })}>
              <option value="">The agent’s own</option>
              {choices.map((p) => <option key={p.value} value={p.value}>{p.unlisted ? `${p.label} (not reported)` : p.label}</option>)}
            </select>
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="text-[13px] font-medium text-ink-soft">Model</span>
            <input list="summary-models" className={cn(inputClass, 'mt-1.5 font-mono')} value={m.model} placeholder="The agent’s own" disabled={disabled} spellCheck={false} onChange={(e) => set({ model: e.target.value })} />
            <datalist id="summary-models">
              {suggestions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </datalist>
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">Temperature</span>
            <input type="number" min={0} max={2} step={0.1} className={cn(inputClass, 'mt-1.5 w-28')} value={m.temperature ?? ''} placeholder="Default" disabled={disabled} onChange={(e) => set({ temperature: e.target.value })} />
          </label>
        </div>
      }
    </Card>);

}

function Files({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  const { notice, remember } = useDeleted(editor);
  if (!config) return null;
  const disabled = !editor.canEdit;
  const files = artifactsOf(config);
  const connections = Object.keys(config.connections ?? {});
  const apply = editor.replaceConfig;
  return (
    <Card title="Files after each call" text="Written to a folder, or sent to one of its connections, when each call ends (however it ends). Hiding sensitive details applies to them.">
      <div id={fieldId(['post_call', 'artifacts'])} className="space-y-3">
        {notice}
        {files.length === 0 && <p className="text-[13px] text-muted">None yet.</p>}
        {files.map((a) =>
        <div key={a.index} className="rounded-lg border border-line px-3 py-3" data-artifact={a.index}>
            <div className="flex flex-wrap items-center gap-3">
              <select aria-label="What is kept" className={cn(inputClass, 'w-auto')} value={a.kind} disabled={disabled} onChange={(e) => apply(setArtifact(config, a.index, { kind: e.target.value as ArtifactKind }))}>
                {!a.kind && <option value="">Choose…</option>}
                {ARTIFACT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <Segmented
              size="sm"
              label="Where it goes"
              value={a.sink.type || 'file'}
              options={[
              { value: 'file', label: 'A folder' },
              { value: 'http', label: 'A web service' }]
              }
              onChange={(v) => !disabled && v !== a.sink.type && apply(setSinkType(config, a.index, v, connections))} />
              <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-soft">
                <Toggle checked={a.enabled} disabled={disabled} label={`Write ${a.kind || 'this file'}`} onChange={(v) => apply(setArtifact(config, a.index, { enabled: v }))} />
                On
              </span>
              <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label="Delete this file"
              onClick={() => {
                remember(`${artifactWords(a).replace(/\.$/, '')}: deleted.`, config);
                apply(removeArtifact(config, a.index));
              }}>
                <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            {a.sink.type === 'http' ?
          <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  Connection
                  <select className={cn(inputClass, 'w-auto')} value={a.sink.connection} disabled={disabled} onChange={(e) => apply(setSinkField(config, a.index, 'connection', e.target.value))}>
                    {!connections.includes(a.sink.connection) && <option value={a.sink.connection}>{a.sink.connection || 'Choose…'}</option>}
                    {connections.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <select aria-label="Method" className={cn(inputClass, 'w-auto')} value={a.sink.method || 'POST'} disabled={disabled} onChange={(e) => apply(setSinkField(config, a.index, 'method', e.target.value))}>
                  {SINK_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input aria-label="Path" className={cn(inputClass, 'min-w-[180px] flex-1 font-mono')} value={a.sink.path} placeholder="/calls/{{call.room}}" disabled={disabled} onChange={(e) => apply(setSinkField(config, a.index, 'path', e.target.value))} />
                {!connections.length && <p className="w-full text-[13px] text-warning">This agent has no connections yet. Add one under Tools first.</p>}
              </div> :

          <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex min-w-[200px] flex-1 items-center gap-2 text-[13px] text-muted">
                  Folder
                  <input className={cn(inputClass, 'flex-1 font-mono')} value={a.sink.directory} disabled={disabled} onChange={(e) => apply(setSinkField(config, a.index, 'directory', e.target.value))} />
                </label>
                <label className="flex min-w-[260px] flex-[2] items-center gap-2 text-[13px] text-muted">
                  File name
                  <input className={cn(inputClass, 'flex-1 font-mono')} value={a.sink.filename} placeholder="Server’s default" disabled={disabled} onChange={(e) => apply(setSinkField(config, a.index, 'filename', e.target.value))} />
                </label>
              </div>
          }
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_KINDS.map(([id, label]) =>
          <Button key={id} size="sm" variant="secondary" disabled={disabled} onClick={() => apply(addArtifact(config, id))}>
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </Button>
          )}
        </div>
      </div>
    </Card>);

}

function ClosingMessages({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  const { notice, remember } = useDeleted(editor);
  if (!config) return null;
  const disabled = !editor.canEdit;
  const wrapups = wrapupsOf(config);
  const apply = editor.replaceConfig;
  return (
    <Card title="Closing messages" text="After a natural end point (a tool just finished the job), it waits for a reply; if none comes, it does these steps, such as saying goodbye and ending the call. A tool’s effects start one.">
      <div className="space-y-3" id={fieldId(['wrapups'])}>
        {notice}
        {wrapups.length === 0 && <p className="text-[13px] text-muted">None yet.</p>}
        {wrapups.map((w) => {
          const end = w.steps.find((s) => s.type === 'end_call');
          const others = w.steps.filter((s) => s !== end);
          return (
            <div key={w.index} className="rounded-lg border border-line px-3 py-3" data-wrapup={w.id}>
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[13px] font-medium text-ink">{w.id}</code>
                {w.usedBy.length ? <span className="text-xs text-muted">Started by {w.usedBy.join(', ')}</span> : <StatusChip>Not used</StatusChip>}
                <span className="ml-auto" />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Delete ${w.id}`}
                  onClick={() => {
                    remember(`Closing message “${w.id}” deleted.`, config);
                    apply(removeWrapup(config, w.index));
                  }}>
                  <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  Waits
                  <input type="number" min={0.5} step={0.5} className={cn(inputClass, 'h-8 w-24 py-1')} defaultValue={w.waitS ?? ''} disabled={disabled} onChange={(e) => apply(setWrapupWait(config, w.index, e.target.value))} />
                  seconds for a reply
                </label>
                <label className="flex min-w-[260px] flex-1 items-center gap-2 text-[13px] text-muted">
                  then says
                  <input
                    className={cn(inputClass, 'h-8 flex-1 py-1')}
                    value={end && typeof end.say === 'string' ? end.say : ''}
                    placeholder={end && end.say && typeof end.say !== 'string' ? `“${speechText(end.say, config)}”` : 'Nothing'}
                    disabled={disabled || !!(end && end.say && typeof end.say !== 'string')}
                    onChange={(e) => apply(setWrapupGoodbye(config, w.index, e.target.value))} />
                  and ends the call
                </label>
              </div>
              {others.length > 0 &&
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-soft">
                  {others.map((s, i) => <li key={i}>{wrapupStepWords(s, config, (say) => speechText(say, config))}</li>)}
                </ol>
              }
            </div>);

        })}
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => apply(addWrapup(config))}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a closing message
        </Button>
      </div>
    </Card>);

}

type Tri = boolean | null;
function TriSwitch({ label, help, value, onChange, disabled }: { label: string; help: string; value: Tri; onChange: (v: Tri) => void; disabled: boolean }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-xs text-muted">{help}</p>
      <div className="mt-2">
        <Segmented
          size="sm"
          label={label}
          value={value === true ? 'on' : value === false ? 'off' : 'default'}
          options={[
          { value: 'default', label: 'Server’s default' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' }]
          }
          onChange={(v) => !disabled && onChange(v === 'on' ? true : v === 'off' ? false : null)} />
      </div>
    </div>);

}

function Records({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const o = observabilityOf(config);
  const apply = editor.replaceConfig;
  const folderBad = folderProblem(o.sessionDirectory);
  return (
    <Card title="Call records and logs" text="What the runtime writes about each call, for your team. Whether a log is kept, and for how long, is asked under Recording above.">
      <div className="grid gap-5 sm:grid-cols-2" id={fieldId(['observability'])}>
        <label className="block">
          <span className="text-sm font-medium text-ink">How much the call log holds</span>
          <span className="block text-xs text-muted">“Everything” adds every model request and API body in full. Keep it for testing.</span>
          <select className={cn(inputClass, 'mt-2')} value={o.sessionDetail} disabled={disabled} onChange={(e) => apply(setSessionLogField(config, 'detail', e.target.value))}>
            <option value="">Server’s default (what happened)</option>
            <option value="events">What happened</option>
            <option value="full">Everything</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Folder for call logs</span>
          <span className="block text-xs text-muted">A folder name inside the agent’s own folder.</span>
          <input className={cn(inputClass, 'mt-2 font-mono', folderBad && inputErrorClass)} value={o.sessionDirectory} placeholder="Server’s default (sessions)" disabled={disabled} onChange={(e) => apply(setSessionLogField(config, 'directory', e.target.value))} />
          {folderBad && <span className="mt-1 block text-[13px] text-danger" role="alert">{folderBad}</span>}
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">Worker log level</span>
          <span className="block text-xs text-muted">How much the runtime’s own log says.</span>
          <select className={cn(inputClass, 'mt-2')} value={o.logLevel} disabled={disabled} onChange={(e) => apply(setObservability(config, 'log_level', e.target.value))}>
            <option value="">Server’s default</option>
            {LOG_LEVELS.map((l) => <option key={l} value={l}>{l.charAt(0) + l.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
        <TriSwitch label="Write personal details in the worker log" help="Off by default. Keep it off in production." value={o.logPii} disabled={disabled} onChange={(v) => apply(setObservability(config, 'log_pii', v))} />
        <TriSwitch label="Record every model request in full" help="Everything sent to the model, every turn. Off by default; keep it off in production." value={o.logModelRequests} disabled={disabled} onChange={(v) => apply(setObservability(config, 'log_llm_requests', v))} />
        <TriSwitch label="Measure each call" help="Timings and model use, for the call’s numbers." value={o.metrics} disabled={disabled} onChange={(v) => apply(setObservability(config, 'metrics', v))} />
        <TriSwitch label="Trace each call" help="Spans for each step, for your tracing tools." value={o.tracing} disabled={disabled} onChange={(v) => apply(setObservability(config, 'tracing', v))} />
      </div>
      <div className="mt-5 rounded-lg bg-subtle px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Send traces to an OpenTelemetry collector</p>
            <p className="text-xs text-muted">An OTLP HTTP address, such as a self-hosted SigNoz.</p>
          </div>
          <Toggle checked={!!o.otel?.enabled} disabled={disabled} label="Send traces to an OpenTelemetry collector" onChange={(v) => apply(setOtel(config, { enabled: v }))} />
        </div>
        {o.otel &&
        <div className="mt-3 flex flex-wrap gap-3">
            <input aria-label="Collector address" className={cn(inputClass, 'min-w-[240px] flex-[2] font-mono')} value={o.otel.endpoint} placeholder="https://collector.example.com:4318" disabled={disabled} onChange={(e) => apply(setOtel(config, { endpoint: e.target.value }))} />
            <input aria-label="Service name" className={cn(inputClass, 'min-w-[160px] flex-1')} value={o.otel.serviceName} placeholder="Service name" disabled={disabled} onChange={(e) => apply(setOtel(config, { serviceName: e.target.value }))} />
          </div>
        }
      </div>
    </Card>);

}
