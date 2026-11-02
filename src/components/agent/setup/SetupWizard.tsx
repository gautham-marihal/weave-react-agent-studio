import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon, CircleAlertIcon, LoaderCircleIcon, RocketIcon } from 'lucide-react';
import type { EnvironmentName } from '../../../types/studio';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useStudio } from '../../../contexts/StudioContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useTestSession } from '../../../hooks/useTestSession';
import { starters } from '../../../data/starters';
import { STEPS, reachOf, stepForPath, stepIndex, stepStates, numberProblem, type StepId } from '../../../models/setup';
import { readProgress, saveProgress, setupVersion, subscribeSetup } from '../../../utils/setupProgress';
import { currentDeployments, environments, envLabel, latestVersion } from '../../../utils/agentStatus';
import { api } from '../../../api/client';
import { Button } from '../../ui/Button';
import { StepIcon } from '../Readiness';
import { TestConsole } from '../test/TestConsole';
import { ActionsBlock, KnowledgeBlock, LanguageVoiceBlock, PurposeBlock, ReachBlock } from './SimpleBlocks';
import { cn, inputClass, inputErrorClass } from '../../../utils/styles';

interface SetupWizardProps {
  editor: DraftEditor;
  step: string | undefined;
}

/**
 * The guided setup: one screen per step, Back / Skip / Next. Every Next saves the draft (an explicit save of that step);
 * "Save and finish later" goes to the Overview, which offers Continue setup. Where the person is, and whether they have
 * tried the agent, is kept in this browser; the config is on the server.
 */
export function SetupWizard({ editor, step }: SetupWizardProps) {
  useSyncExternalStore(subscribeSetup, setupVersion, setupVersion);
  const navigate = useNavigate();
  const agent = editor.agent;
  const agentId = agent?.id ?? '';
  const progress = readProgress(agentId);
  const current: StepId = STEPS.some((s) => s.id === step) ? (step as StepId) : progress.step || 'purpose';
  const index = stepIndex(current);
  const [saving, setSaving] = useState(false);

  // Remember where the person is, so a closed browser opens the setup at the same step.
  useEffect(() => {
    if (agentId && progress.step !== current) saveProgress(agentId, { step: current });
  }, [agentId, current, progress.step]);

  if (!agent || !editor.config) return null;
  const deployed = Object.fromEntries(Object.entries(currentDeployments(agent)).map(([env, d]) => [env, d?.version ?? '']));
  const states = stepStates(editor.config, { tried: progress.tried, deployed, starters });
  const problems = (editor.validationView.report?.errors ?? []).filter((e) => stepForPath(e.path) === current);
  const def = STEPS[index];
  const go = (id: StepId) => navigate(`/agents/${encodeURIComponent(agentId)}/setup/${id}`);

  // Next and "finish later" save the step first; a save that fails (or a conflict) keeps the person here.
  const saveThen = async (then: () => void) => {
    setSaving(true);
    const ok = editor.dirty ? await editor.save() : true;
    setSaving(false);
    if (ok) then();
  };
  const next = () => void saveThen(() => (index < STEPS.length - 1 ? go(STEPS[index + 1].id) : finish()));
  const finish = () => {
    saveProgress(agentId, { finished: true });
    navigate(`/agents/${encodeURIComponent(agentId)}/overview`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-10">
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Setup steps" className="lg:sticky lg:top-44 lg:self-start">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Set up · step {index + 1} of {STEPS.length}</p>
          <ol className="mt-2 space-y-0.5">
            {STEPS.map((s) =>
            <li key={s.id}>
                <button
                type="button"
                aria-current={s.id === current ? 'step' : undefined}
                onClick={() => void saveThen(() => go(s.id))}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', s.id === current ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink')}>
                  <StepIcon state={states[s.id]} className="h-3.5 w-3.5" />
                  {s.label}
                </button>
              </li>
            )}
          </ol>
          <p className="mt-4 px-2 text-xs text-muted">Where you are in the setup is kept in this browser.</p>
        </nav>

        <section aria-labelledby="setup-title" className="min-w-0">
          <h2 id="setup-title" className="text-xl font-semibold tracking-tight text-ink">{def.title}</h2>
          <p className="mt-1 text-sm text-muted">{def.lead}</p>

          {problems.length > 0 &&
          <ul className="mt-4 space-y-1 rounded-lg border border-danger/30 bg-danger-soft/40 px-4 py-3">
              {problems.map((p, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-ink"><CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />{p.message}</li>)}
            </ul>
          }

          <div className="mt-6">
            {current === 'start' && <StartStep editor={editor} />}
            {current === 'purpose' && <PurposeBlock editor={editor} />}
            {current === 'reach' && <ReachBlock editor={editor} />}
            {current === 'voice' && <LanguageVoiceBlock editor={editor} />}
            {current === 'knowledge' && <KnowledgeBlock editor={editor} />}
            {current === 'actions' && <ActionsBlock editor={editor} />}
            {current === 'try' && <TryStep editor={editor} />}
            {current === 'live' && <LiveStep editor={editor} tried={progress.tried} onDone={() => saveProgress(agentId, { finished: true })} />}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void saveThen(() => go(STEPS[index - 1].id))} disabled={index === 0 || saving}>
                <ArrowLeftIcon className="h-4 w-4" aria-hidden />
                Back
              </Button>
              <Button variant="ghost" onClick={() => void saveThen(finishLater)} disabled={saving}>Save and finish later</Button>
            </div>
            <div className="flex gap-2">
              {index < STEPS.length - 1 && <Button variant="secondary" onClick={() => go(STEPS[index + 1].id)} disabled={saving}>Skip</Button>}
              <Button variant="primary" onClick={next} disabled={saving || !!editor.parseError}>
                {saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {index < STEPS.length - 1 ? 'Save and next' : 'Finish'}
                {index < STEPS.length - 1 && <ArrowRightIcon className="h-4 w-4" aria-hidden />}
              </Button>
            </div>
          </div>
          {editor.saveState === 'error' && <p role="alert" className="mt-3 text-[13px] text-danger">Could not save: {editor.saveError}</p>}
        </section>
      </div>
    </div>);

  function finishLater() {
    navigate(`/agents/${encodeURIComponent(agentId)}/overview`);
  }
}

/** Its name and company (the starter was chosen when it was created). */
function StartStep({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  if (!config) return null;
  return (
    <div className="grid max-w-xl gap-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">Its name</span>
        <span className="mt-0.5 block text-[13px] text-muted">Shown in the studio and call records.</span>
        <input className={cn(inputClass, 'mt-2', !config.meta?.name?.trim() && inputErrorClass)} value={config.meta?.name ?? ''} disabled={!editor.canEdit} onChange={(e) => editor.update(['meta', 'name'], e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink">Your company</span>
        <span className="mt-0.5 block text-[13px] text-muted">It introduces itself with this. Optional.</span>
        <input className={cn(inputClass, 'mt-2')} value={config.persona?.company ?? ''} disabled={!editor.canEdit} onChange={(e) => editor.update(['persona', 'company'], e.target.value === '' ? undefined : e.target.value)} />
      </label>
      <p className="text-xs text-muted">Its id is <code className="font-mono">{editor.agent?.id}</code> (it cannot change).</p>
    </div>);

}

/** A real test conversation with the saved draft. Trying it is remembered for the Go live step. */
function TryStep({ editor }: { editor: DraftEditor }) {
  const agentId = editor.agent?.id ?? '';
  const session = useTestSession(agentId, editor.config ?? undefined, editor.baseRevision);
  useEffect(() => {
    if (session.status === 'live') saveProgress(agentId, { tried: true });
  }, [session.status, agentId]);
  if (!editor.config) return null;
  const web = (editor.config.channels ?? []).some((c) => c.enabled && (c.type === 'web_chat' || c.type === 'web_voice'));
  if (!web)
    return <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-ink-soft">It is reached by phone only. Trying it in the studio uses chat or talking on the website: switch one on in “Where people reach it” (you can switch it off again before it goes live).</p>;
  return <TestConsole session={session} config={editor.config} revision={editor.baseRevision} onBeforeStart={() => editor.ensureSaved('Start the test')} hasUnsaved={editor.dirty} />;
}

/** Publish and put live in one go; a phone number can be added right here. */
function LiveStep({ editor, tried, onDone }: { editor: DraftEditor; tried: boolean; onDone: () => void }) {
  const { publish, deploy } = useStudio();
  const { can } = useAuth();
  const agent = editor.agent;
  const [env, setEnv] = useState<EnvironmentName>('development');
  const [confirm, setConfirm] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  if (!agent || !editor.config) return null;
  const phone = reachOf(editor.config).sip_voice;
  const isProd = env === 'production';
  const allowed = isProd ? can('deploy_production') : can('deploy') && can('publish');
  const confirmed = !isProd || confirm.trim() === agent.id;
  const live = currentDeployments(agent)[env];
  const numberIssue = number.trim() ? numberProblem(number) : '';

  const goLive = async () => {
    if (!(await editor.ensureSaved('Going live'))) return;
    setBusy(true);
    setResult(null);
    const lines: string[] = [];
    try {
      const pub = await publish(agent.id, latestVersion(agent) ? 'patch' : 'minor');
      if (!pub.ok) {
        setResult({ ok: false, lines: ['The server did not publish it:', ...pub.errors.map((e) => e.message)] });
        return;
      }
      lines.push(`Published version ${pub.version.version}.`);
      const out = await deploy(agent.id, pub.version.version, env, 'Put live from the setup');
      lines.push(out.deployment.status === 'active' ? `${envLabel(env)} now runs ${pub.version.version}.` : `Deploying to ${envLabel(env)}: ${out.deployment.status}.`);
      if (out.preflight?.secrets_missing?.length) lines.push(`Secrets the server is missing: ${out.preflight.secrets_missing.join(', ')}. Calls that need them will fail.`);
      if (phone && number.trim()) {
        try {
          await api.createNumber(agent.id, { number: number.trim(), environment: env });
          lines.push(`${number.trim()} now rings this agent in ${envLabel(env)}.`);
        } catch (err: unknown) {
          lines.push(`The number was not added: ${err instanceof Error ? err.message : 'the server refused it'}. Add it under Library › Numbers.`);
        }
      }
      setResult({ ok: out.deployment.status !== 'failed', lines });
      if (out.deployment.status === 'active') onDone();
    } catch (err: unknown) {
      setResult({ ok: false, lines: [...lines, err instanceof Error ? err.message : 'Something went wrong.'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      {!tried && <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">It has not been tried yet. You can still put it live; trying it first catches surprises.</p>}
      <fieldset>
        <legend className="text-sm font-medium text-ink">Where it runs</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {environments.map((e) =>
          <label key={e} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', env === e ? 'border-accent bg-accent-soft/50' : 'border-line')}>
              <input type="radio" name="setup-env" value={e} checked={env === e} onChange={() => setEnv(e)} className="mt-1" />
              <span>
                <span className="block font-medium text-ink">{envLabel(e)}</span>
                <span className="block text-xs text-muted">{e === 'development' ? 'The safe first stop.' : e === 'staging' ? 'A last look before callers.' : 'Real callers.'}</span>
              </span>
            </label>
          )}
        </div>
        {live && <p className="mt-2 text-[13px] text-muted">Version {live.version} runs there now. Going live puts your latest changes there.</p>}
      </fieldset>
      {isProd &&
      <label className="block">
          <span className="text-sm font-medium text-ink">Type <code className="font-mono">{agent.id}</code> to put it in front of real callers</span>
          <input className={cn(inputClass, 'mt-2 font-mono')} value={confirm} onChange={(e) => setConfirm(e.target.value)} spellCheck={false} />
        </label>
      }
      {phone &&
      <label className="block">
          <span className="text-sm font-medium text-ink">A phone number for it (optional)</span>
          <span className="mt-0.5 block text-[13px] text-muted">One your phone system already routes to the Agent Builder, with its country code.</span>
          <input className={cn(inputClass, 'mt-2 max-w-xs', numberIssue && inputErrorClass)} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+65 6123 4567" />
          {numberIssue && <span className="mt-1 block text-[13px] text-danger">{numberIssue}</span>}
        </label>
      }
      <Button variant="primary" onClick={() => void goLive()} disabled={busy || !allowed || !confirmed || !!numberIssue}>
        {busy ? <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden /> : <RocketIcon className="h-4 w-4" aria-hidden />}
        {busy ? 'Publishing and putting it live…' : `Publish and put live in ${envLabel(env)}`}
      </Button>
      {!allowed && <p className="text-[13px] text-muted">Your sign-in cannot do this here.</p>}
      {result &&
      <div role={result.ok ? 'status' : 'alert'} className={cn('rounded-lg px-4 py-3 text-[13px]', result.ok ? 'bg-success-soft text-ink' : 'bg-danger-soft text-ink')}>
          {result.lines.map((l, i) => <p key={i}>{l}</p>)}
          {result.ok && <p className="mt-2"><Link to={`/agents/${encodeURIComponent(agent.id)}/overview`} className="font-medium text-accent hover:underline">Go to its Overview</Link></p>}
        </div>
      }
    </div>);

}
