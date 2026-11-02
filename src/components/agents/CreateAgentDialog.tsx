import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  BookmarkIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarIcon,
  FileIcon,
  HeadsetIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  TargetIcon,
  UploadIcon,
  BoxIcon
} from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { StatusChip } from "../ui/StatusChip";
import { starters, StarterIcon } from "../../data/starters";
import { useStudio } from "../../contexts/StudioContext";
import { botIdProblem, freeBotId, withMainLanguage } from "../../models/setup";
import { applyTemplate, deleteTemplate, loadTemplates, parseTemplateFile, saveTemplate, type SavedTemplate } from "../../models/savedTemplates";
import { queueChange } from "../../models/pendingChange";
import { templateChange } from "../../models/manageChanges";
import { assignAgent } from "../../models/workspaces";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import { startSetup } from "../../utils/setupProgress";
import { formatShortDate } from "../../utils/format";
import { cn, inputClass, inputErrorClass } from "../../utils/styles";
import { gateway, GatewayError, runtimeAddress } from "../../api/gateway";
import type { GeneratedAgentConfig } from "../../api/gatewayTypes";
import { useBankingSource } from "../../hooks/useBankingSource";
import { useProviders } from "../../hooks/useProviders";
import { newBankingAssistant } from "../../models/bankingAgent";
import { bankingStatus } from "../../models/bankingStatus";

const icons: Record<StarterIcon, typeof BoxIcon> = {
  headset: HeadsetIcon,
  building: Building2Icon,
  book: BookOpenIcon,
  target: TargetIcon,
  calendar: CalendarIcon,
  message: MessageCircleIcon,
  blank: FileIcon
};

/**
 * What a new agent starts from: one of Studio's starters, or one of the person's own templates (kept in this browser).
 * A "Describe it" choice is added beside these by the part of Studio that writes a draft from a description.
 */
type StartChoice = { kind: 'starter'; id: string } | { kind: 'template'; id: string };

interface CreateAgentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateAgentDialog({ open, onClose }: CreateAgentDialogProps) {
  const { agents, createAgent, saveDraft } = useStudio();
  const { current: workspaceId, currentSpace } = useWorkspaces();
  const navigate = useNavigate();
  // The banking starter says where its banking answers come from (bankingSource): the bank's real systems, or the mock
  // bank's test data (Sandbox, and Live without a gateway on real systems).
  const banking = useBankingSource();
  const bankingState = banking ? bankingStatus(banking) : null;
  const { answer: providers } = useProviders();

  const [choice, setChoice] = useState<StartChoice>({ kind: 'starter', id: 'customer_care' });
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [importNote, setImportNote] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [removing, setRemoving] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setChoice({ kind: 'starter', id: 'customer_care' });
      setTemplates(loadTemplates());
      setImportNote(null);
      setRemoving('');
      setName('');
      setCompany('');
      setId('');
      setIdTouched(false);
      setSubmitted(false);
      setCreating(false);
    }
  }, [open]);

  const taken = useMemo(() => agents.map((a) => a.id), [agents]);
  // The id is made from the name and is always free ("-2" when taken); it can be changed under Advanced.
  const effectiveId = idTouched ? id : name.trim() ? freeBotId(name, taken) : '';
  const problem = effectiveId ? botIdProblem(effectiveId, taken) || null : name.trim() ? 'Give it an id.' : null;
  const nameProblem = name.trim() ? null : 'Give the agent a name.';
  const companyProblem = null;
  const template = choice.kind === 'template' ? templates.find((t) => t.id === choice.id) ?? null : null;
  const starter = choice.kind === 'starter' ? starters.find((s) => s.id === choice.id) ?? null : null;

  const handleName = (v: string) => setName(v);

  const importFile = async (file: File) => {
    const parsed = parseTemplateFile(await file.text(), file.name);
    if (parsed.error !== undefined) {
      setImportNote({ tone: 'bad', text: parsed.error });
      return;
    }
    const saved = saveTemplate(parsed.template);
    if (!saved.saved) {
      setImportNote({ tone: 'bad', text: 'This browser couldn’t keep it (its storage is full or switched off).' });
      return;
    }
    setTemplates(saved.list);
    setChoice({ kind: 'template', id: saved.template.id });
    setImportNote({ tone: 'good', text: `Imported “${saved.template.name}”.` });
  };

  const removeTemplate = (t: SavedTemplate) => {
    setTemplates(deleteTemplate(t.id));
    setRemoving('');
    if (choice.kind === 'template' && choice.id === t.id) setChoice({ kind: 'starter', id: 'customer_care' });
  };

  const handleCreateStarter = async () => {
    setSubmitted(true);
    if (problem || nameProblem || companyProblem) return;
    setCreating(true);
    try {
      // A banking agent's tools come from the gateway: asked first, so nothing is created when it cannot answer.
      let generated: GeneratedAgentConfig | null = null;
      // and the gateway address the deployed agent calls, filled in from this Studio server (nobody types it)
      let gatewayUrl = '';
      if (starter?.banking) {
        try {
          [generated, gatewayUrl] = await Promise.all([gateway.agentConfig(), runtimeAddress()]);
        } catch (e) {
          throw new Error(e instanceof GatewayError ? e.message : 'The banking gateway did not answer, so the banking agent was not created.');
        }
      }
      const created = await createAgent({
        id: effectiveId,
        name: name.trim(),
        company: company.trim(),
        starterId: template ? 'blank' : choice.id
      });
      // A new agent belongs to the workspace it was made in (kept in this browser).
      if (workspaceId) assignAgent(effectiveId, workspaceId);
      if (template) {
        // One of your own templates: its contents on top of the new agent's own id, name and version. If saving fails,
        // the agent still exists and the template lands in its draft, unsaved, for the person to review.
        const languages = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
        const config = withMainLanguage(applyTemplate(created.draft.config, template), languages);
        try {
          const saved = await saveDraft(effectiveId, config, created.draft.revision);
          if (!saved.ok) throw new Error('conflict');
        } catch {
          queueChange(effectiveId, templateChange(config, template.name));
        }
      }
      if (generated) {
        // The starter's agent becomes a banking agent (models/bankingAgent.ts), reached by web chat and web voice.
        const made = newBankingAssistant(created.draft.config, generated, { providers, botId: effectiveId, gatewayUrl: gatewayUrl || undefined });
        if (made.ok) {
          try {
            const saved = await saveDraft(effectiveId, made.config, created.draft.revision);
            if (!saved.ok) throw new Error('conflict');
          } catch {
            queueChange(effectiveId, { note: 'The banking roles and tools are in this draft. They couldn’t be saved when the agent was created.', edits: [{ op: 'use_template', config: made.config }] });
          }
        }
      }
      toast.success(`${name.trim()} created`, {
        description: 'Next: a few steps to make it yours, try it and put it live.'
      });
      startSetup(effectiveId);
      onClose();
      navigate(`/agents/${effectiveId}/setup/purpose`);
    } catch (err: unknown) {
      toast.error('Could not create agent', { description: err instanceof Error ? err.message : 'Server rejected creation' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Create an agent"
      description={`Pick a starter or one of your templates and name it. ${currentSpace ? `It is created in ${currentSpace.name}. ` : ''}The server makes the agent, and a few steps make it yours.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreateStarter} disabled={creating}>
            {creating ? (
              <>
                <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
                Creating…
              </>
            ) : (
              'Create agent'
            )}
          </Button>
        </>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          {/* Mount point: the "Describe it" choice (a draft written from a description) goes before the starters. */}
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-ink">Starter</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {starters.map((s) => {
                const Icon = icons[s.icon];
                const active = choice.kind === 'starter' && s.id === choice.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-starter={s.id}
                    onClick={() => setChoice({ kind: 'starter', id: s.id })}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong hover:bg-canvas'
                    )}
                  >
                    <Icon
                      className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-accent' : 'text-muted')}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium text-ink">
                        {s.name}
                        {s.recommended && <StatusChip tone="accent">Most popular</StatusChip>}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                        {s.summary}
                      </span>
                      {s.banking && bankingState && (
                        <span className={cn('mt-1 block text-[12px] leading-snug', bankingState.tone === 'warning' ? 'text-warning' : 'text-muted')} data-banking-reason>
                          {bankingState.text}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* The person's own templates: saved from an agent's "⋯" menu or imported from a file. */}
          <fieldset aria-labelledby="your-templates-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span id="your-templates-title" className="text-sm font-medium text-ink">Your templates</span>
                <span className="ml-2 text-xs text-muted">Kept in this browser</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={creating}>
                <UploadIcon className="h-3.5 w-3.5" aria-hidden />
                Import a file…
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Import a template file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void importFile(file);
                }}
              />
            </div>
            {importNote && (
              <p role="status" className={cn('mb-2 text-[13px]', importNote.tone === 'good' ? 'text-success' : 'text-danger')}>
                {importNote.text}
              </p>
            )}
            {templates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[13px] text-muted">
                None yet. Save any agent as a template from its “⋯” menu, or import a file a colleague shared.
              </p>
            ) : (
              <div role="radiogroup" aria-labelledby="your-templates-title" className="space-y-2">
                {templates.map((t) => {
                  const active = choice.kind === 'template' && choice.id === t.id;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'flex items-start gap-2 rounded-lg border p-1 transition-[border-color,background-color] duration-150',
                        active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong'
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChoice({ kind: 'template', id: t.id })}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <BookmarkIcon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-accent' : 'text-muted')} aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                            {t.description || `Saved ${t.createdAt ? formatShortDate(t.createdAt) : ''} from ${t.sourceName || 'an agent'}`}
                          </span>
                        </span>
                      </button>
                      {removing === t.id ? (
                        <span role="group" aria-label={`Remove the template ${t.name}?`} className="flex shrink-0 items-center gap-1 self-center pr-1">
                          <Button size="sm" variant="danger" onClick={() => removeTemplate(t)}>Remove</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoving('')}>Keep</Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="self-center"
                          aria-label={`Remove the template ${t.name}`}
                          title="Agents already made from it are not affected"
                          onClick={() => setRemoving(t.id)}
                          disabled={creating}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </fieldset>
        </div>

        <div className="space-y-5">
          <Field id="create-name" label="Agent name" error={submitted ? nameProblem ?? undefined : undefined}>
            <input
              id="create-name-input"
              className={cn(inputClass, submitted && nameProblem && inputErrorClass)}
              value={name}
              onChange={(e) => handleName(e.target.value)}
              placeholder="Customer care"
            />
          </Field>
          <Field
            id="create-company"
            label="Company name (optional)"
            help={template ? 'Templates keep their own greeting; the company is used by starters.' : 'The agent introduces itself with this.'}
            error={submitted ? companyProblem ?? undefined : undefined}
          >
            <input
              id="create-company-input"
              className={cn(inputClass, submitted && companyProblem && inputErrorClass)}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Northwind Energy"
            />
          </Field>
          <details className="rounded-lg border border-line px-3 py-2" open={idTouched || (submitted && !!problem)}>
            <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">Advanced</summary>
            <Field
              id="create-id"
              label="Agent id"
              help="Made from the name. Lowercase letters, digits, - and _; starts with a letter. Can’t be changed later."
              error={(submitted || idTouched) && problem ? problem : undefined}
              className="mt-2"
            >
              <input
                id="create-id-input"
                className={cn(inputClass, 'font-mono', (submitted || idTouched) && problem && inputErrorClass)}
                value={effectiveId}
                maxLength={64}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
                placeholder="customer-care"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </details>
        </div>
      </div>
    </Dialog>
  );
}
