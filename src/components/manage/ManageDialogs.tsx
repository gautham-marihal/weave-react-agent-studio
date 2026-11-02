import React, { useMemo, useState } from 'react';
import { CheckCircle2Icon, CircleAlertIcon, InfoIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { toast } from '../ui/Toast';
import { api } from '../../api/client';
import { useStudio } from '../../contexts/StudioContext';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import type { Agent, AgentConfig, EnvironmentName } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { currentDeployments, envLabel } from '../../utils/agentStatus';
import { RENAME_CONFLICT, agentNameProblem, configToText, exportFileName, renameErrorWords, renamedConfig } from '../../models/manage';
import { saveTemplate, templateFileName, templateToFile, type SavedTemplate } from '../../models/savedTemplates';
import { assignAgent, switchWorkspace } from '../../models/workspaces';
import { copyText, downloadText } from './download';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

// The dialogs behind an agent's "⋯" menu. Each opens for one agent and closes itself; useAgentManage opens them.

/** A coloured note inside a dialog. */
export function Note({ tone, title, children }: { tone: 'info' | 'good' | 'warn' | 'bad'; title: string; children?: React.ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle2Icon : tone === 'warn' ? TriangleAlertIcon : tone === 'bad' ? CircleAlertIcon : InfoIcon;
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3 text-[13px]',
        tone === 'good' && 'border-success/30 bg-success-soft/50',
        tone === 'warn' && 'border-warning/30 bg-warning-soft/50',
        tone === 'bad' && 'border-danger/30 bg-danger-soft/50',
        tone === 'info' && 'border-line bg-canvas'
      )}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-danger' : 'text-accent')} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-ink">{title}</p>
        {children && <div className="mt-0.5 leading-relaxed text-ink-soft">{children}</div>}
      </div>
    </div>);

}

/** A choice among a few, as radio cards. */
function Choices<T extends string>({ legend, value, options, onChange, name }: { legend: string; name: string; value: T; options: { value: T; label: string; note: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {options.map((o) =>
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
            value === o.value ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/40' : 'border-line hover:border-line-strong hover:bg-canvas'
          )}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-[rgb(var(--accent))]" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{o.label}</span>
              <span className="block text-xs text-muted">{o.note}</span>
            </span>
          </label>
        )}
      </div>
    </fieldset>);

}

const editorHasEdits = (editor?: DraftEditor | null): editor is DraftEditor => !!editor && editor.dirty && !!editor.config && !editor.parseError;

// ---- Rename ------------------------------------------------------------------------------------------------------------
// The display name is meta.name in the draft. The id is permanent (links and calls use it), and published versions keep
// the name they were published with, so this changes the draft only, saved with the revision it was read at.

export function RenameDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { saveDraft } = useStudio();
  const [name, setName] = useState(agent.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const problem = agentNameProblem(name);
  const unchanged = name.trim() === agent.name.trim();

  const save = async () => {
    if (problem || unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Read the latest draft and change only its name, so nothing saved meanwhile is overwritten; a save in between
      // makes the server answer 409, which is said plainly.
      const draft = await api.getDraft(agent.id);
      const result = await saveDraft(agent.id, renamedConfig(draft.config as AgentConfig, name), draft.revision);
      if (!result.ok) {
        setError(RENAME_CONFLICT);
        setBusy(false);
        return;
      }
      toast.success(`Renamed to ${name.trim()}`, { description: 'The draft is saved with the new name. The id stays the same.' });
      onClose();
    } catch (err: unknown) {
      setError(renameErrorWords(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      title="Rename this agent"
      description="Changes the name people see. The id stays the same."
      footer={
      <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!!problem || unchanged || busy}>
            {busy && <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? 'Saving…' : 'Rename'}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <Field id="rename-agent" label="Name" help="Shown in lists and at the top of the agent." error={name !== agent.name ? problem || undefined : undefined}>
          <input
            id="rename-agent-input"
            className={cn(inputClass, problem && name !== agent.name && inputErrorClass)}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }} />
        </Field>
        <p className="text-[13px] leading-relaxed text-muted">
          The id <code className="font-mono text-xs text-ink-soft">{agent.id}</code> is permanent. Published versions keep the name they were published with;
          the new name applies to the draft and to versions you publish from now on.
        </p>
        {error && <Note tone="bad" title={error.title}>{error.text}</Note>}
      </div>
    </Dialog>);

}

// ---- Export ------------------------------------------------------------------------------------------------------------

export function ExportDialog({ agent, editor, onClose }: { agent: Agent; editor?: DraftEditor | null; onClose: () => void }) {
  const { getAgent, loadVersionConfig } = useStudio();
  const versions = getAgent(agent.id)?.versions ?? agent.versions;
  const [choice, setChoice] = useState('draft');
  const [busy, setBusy] = useState<'' | 'copy' | 'download'>('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const withEdits = editorHasEdits(editor);

  const options = useMemo(
    () => [
    { value: 'draft', label: 'Saved draft', note: 'The working copy as last saved.' },
    ...(withEdits ? [{ value: 'editor', label: 'What is in the editor now', note: 'Includes edits you haven’t saved.' }] : []),
    ...versions.map((v, i) => ({ value: `v:${v.version}`, label: `Version ${v.version}${i === 0 ? ' (latest)' : ''}`, note: 'Published and frozen.' }))],

    [withEdits, versions]
  );

  const load = async (): Promise<{ label: string; config: unknown }> => {
    if (choice === 'editor' && editor?.config) return { label: 'unsaved', config: editor.config };
    if (choice === 'draft') return { label: 'draft', config: (await api.getDraft(agent.id)).config };
    const version = choice.slice(2);
    return { label: version, config: await loadVersionConfig(agent.id, version) };
  };

  const run = async (kind: 'copy' | 'download') => {
    setBusy(kind);
    setError('');
    setDone('');
    try {
      const { label, config } = await load();
      const text = configToText(config);
      if (kind === 'download') {
        const file = exportFileName(agent.id, label);
        downloadText(file, text);
        setDone(`Saved as ${file}`);
      } else {
        setDone((await copyText(text)) ? 'Copied to the clipboard' : 'Couldn’t copy. Use Download instead.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The configuration could not be read.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Export ${agent.name}`}
      description="Saves the configuration as a JSON file you can keep, share or import elsewhere."
      footer={
      <>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Done</Button>
          <Button variant="secondary" onClick={() => void run('copy')} disabled={!!busy}>{busy === 'copy' ? 'Copying…' : 'Copy JSON'}</Button>
          <Button variant="primary" onClick={() => void run('download')} disabled={!!busy}>{busy === 'download' ? 'Preparing…' : 'Download'}</Button>
        </>
      }>
      <div className="space-y-4">
        <Choices legend="What to export" name="export-source" value={choice} options={options} onChange={(v) => {setChoice(v);setDone('');}} />
        <p className="text-[13px] text-muted">
          Secrets are never part of a configuration: the file only holds their names, such as <code className="font-mono text-xs">OPENAI_API_KEY</code>.
        </p>
        {done && <Note tone="good" title={done} />}
        {error && <Note tone="bad" title="Couldn’t export">{error}</Note>}
      </div>
    </Dialog>);

}

// ---- Save as a template ------------------------------------------------------------------------------------------------
// The agent's contents minus what makes it THIS agent (id, name, version), offered in the Create dialog beside the
// starters. Kept in this browser and shared as a file, until the API has somewhere to keep templates.

export function SaveTemplateDialog({ agent, editor, onClose }: { agent: Agent; editor?: DraftEditor | null; onClose: () => void }) {
  const withEdits = editorHasEdits(editor);
  const [name, setName] = useState(`${agent.name} template`);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<'draft' | 'editor'>(withEdits ? 'editor' : 'draft');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SavedTemplate | null>(null);
  const [error, setError] = useState('');
  const problem = !name.trim() ? 'Give the template a name.' : name.trim().length > 80 ? 'Keep it to 80 characters or fewer.' : '';

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError('');
    try {
      const config = source === 'editor' && editor?.config ? editor.config : ((await api.getDraft(agent.id)).config as AgentConfig);
      const result = saveTemplate({ name, description, config, sourceName: config?.persona?.name || config?.meta?.name || agent.name });
      if (!result.saved) throw new Error('This browser couldn’t keep it (its storage is full or switched off). Download the file instead.');
      setDone(result.template);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The template could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Save ${agent.name} as a template`}
      description="A template is a starting point for new agents. The id, name and version stay with this agent."
      footer={
      done ?
      <>
            <Button variant="ghost" onClick={onClose}>Done</Button>
            <Button variant="primary" onClick={() => downloadText(templateFileName(done), templateToFile(done))}>Download the file</Button>
          </> :

      <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!!problem || busy}>{busy ? 'Saving…' : 'Save as template'}</Button>
          </>

      }>
      {done ?
      <Note tone="good" title={`“${done.name}” is saved`}>
          It appears under “Your templates” when you create an agent. Kept in this browser: to share it, download the file; a colleague can import it in the
          Create dialog.
        </Note> :

      <div className="space-y-4">
          <Field id="template-name" label="Template name" error={problem || undefined}>
            <input
            id="template-name-input"
            className={cn(inputClass, problem && inputErrorClass)}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }} />
          </Field>
          <Field id="template-description" label="What it is for (optional)">
            <input
            id="template-description-input"
            className={inputClass}
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A front desk for our clinics, with booking and handover" />
          </Field>
          {withEdits &&
        <Choices
          legend="Made from"
          name="template-source"
          value={source}
          onChange={setSource}
          options={[
          { value: 'draft', label: 'The saved draft', note: 'As last saved.' },
          { value: 'editor', label: 'What is in the editor now', note: 'Includes edits you haven’t saved.' }]
          } />

        }
          <p className="text-[13px] leading-relaxed text-muted">
            Kept in this browser. Secrets are never part of a configuration, only their names. Tools, knowledge, channels and tests are kept, so a new agent
            starts complete.
          </p>
          {error && <Note tone="bad" title="Couldn’t save the template">{error}</Note>}
        </div>
      }
    </Dialog>);

}

// ---- Remove from my list -----------------------------------------------------------------------------------------------
// The API has no delete endpoint, so this hides the agent in this browser, and says so.

export function RemoveDialog({ agent, onRemove, onClose }: { agent: Agent; onRemove: () => void; onClose: () => void }) {
  const deployed = Object.entries(currentDeployments(agent));
  const live = deployed.some(([env]) => env === 'production');
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Remove ${agent.name} from your list?`}
      description="This hides the agent here. It does not delete anything on the server."
      footer={
      <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
          variant="danger"
          onClick={() => {
            onRemove();
            onClose();
          }}>
            Remove from my list
          </Button>
        </>
      }>
      <div className="space-y-3">
        <Note tone="info" title="Agents can’t be deleted from the server yet">
          The agent, its draft, versions and deployments stay on the server as they are. Kept in this browser: you can bring it back any time from
          “Removed from your list” on the Agents page.
        </Note>
        {deployed.length > 0 &&
        <Note tone={live ? 'bad' : 'warn'} title={live ? 'It is live in production' : 'It is still deployed'}>
            Removing it from your list does not stop it. It keeps running in{' '}
            {deployed.map(([env, d]) => `${envLabel(env as EnvironmentName)} (v${d?.version})`).join(', ')}.
          </Note>
        }
      </div>
    </Dialog>);

}

// ---- Move to another workspace -----------------------------------------------------------------------------------------
// A workspace is a label kept in this browser, so moving an agent changes where it is listed here. The agent itself, its
// versions and deployments are not touched.

export function MoveDialog({ agent, onMoved, onClose }: { agent: Agent; onMoved?: (workspaceId: string) => void; onClose: () => void }) {
  const { spaces, ownerOf } = useWorkspaces();
  const [here] = useState(() => ownerOf(agent.id));
  const others = spaces.filter((s) => s.id !== here);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [moved, setMoved] = useState('');
  const hereName = spaces.find((s) => s.id === here)?.name ?? 'this workspace';
  const targetName = spaces.find((s) => s.id === (moved || target))?.name ?? '';

  if (moved) {
    const finish = (open: boolean) => {
      onClose();
      onMoved?.(moved);
      if (open) switchWorkspace(moved);
    };
    return (
      <Dialog
        open
        onClose={() => finish(false)}
        title={`${agent.name} is now in ${targetName}`}
        description="It no longer shows in the workspace you moved it from."
        footer={
        <>
            <Button variant="ghost" onClick={() => finish(false)}>Stay in {hereName}</Button>
            <Button variant="primary" onClick={() => finish(true)}>Open {targetName}</Button>
          </>
        }>
        <p className="text-[13px] text-muted">Workspaces are kept in this browser. The agent’s configuration, versions and deployments did not change.</p>
      </Dialog>);

  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Move ${agent.name} to another workspace`}
      description={`It is in ${hereName} now. Each agent belongs to one workspace.`}
      footer={
      <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
          variant="primary"
          disabled={!target}
          onClick={() => {
            assignAgent(agent.id, target);
            setMoved(target);
          }}>
            Move agent
          </Button>
        </>
      }>
      <div className="space-y-4">
        {others.length === 0 ?
        <Note tone="info" title="There is no other workspace yet">
            Create one from the workspace menu on the Agents page, then come back to move this agent into it.
          </Note> :

        <Choices legend="Move to" name="move-target" value={target} onChange={setTarget} options={others.map((s) => ({ value: s.id, label: s.name, note: 'Kept in this browser' }))} />
        }
        <p className="text-[13px] text-muted">Workspaces group agents in this browser; they don’t control who can see an agent. Nothing on the server changes.</p>
      </div>
    </Dialog>);

}
