import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  ExternalLinkIcon,
  HistoryIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
} from 'lucide-react';
import { useStudio } from '../contexts/StudioContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { StatusChip } from '../components/ui/StatusChip';
import { Tooltip } from '../components/ui/Tooltip';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
} from '../components/ui/accordion';
import { CreateAgentDialog } from '../components/agents/CreateAgentDialog';
import { AuditTrailDialog } from '../components/ui/AuditTrailDialog';
import { currentDeployments, environments, envLabel, envShort, pendingDeployment } from '../utils/agentStatus';
import { useAgentsReadiness } from '../hooks/useReadiness';
import { FirstRunChecklist } from '../components/home/FirstRunChecklist';
import { AgentChooser } from '../components/home/AgentChooser';
import { QuickActions } from '../components/home/QuickActions';
import { TestConversationStats } from '../components/home/TestConversationStats';
import { lastAgentId, rememberLastAgent } from '../components/home/lastAgent';
import { focusAgent, greetingFor, workspaceLine } from '../models/home';
import { firstNameOf } from '../models/profile';
import { useStepLink } from '../hooks/useStepLink';
import { timeAgo } from '../utils/format';
import { cn, pageClass } from '../utils/styles';
import type { StageId } from '../types/studio';
import { WorkspacePulse } from '../components/insights/WorkspacePulse';
import { SampleAgentsNotice } from '../components/home/SampleAgentsNotice';
import { SampleTag } from '../components/agents/SampleTag';
import { useRemovedAgents } from '../hooks/useWorkspaces';
import { isSandbox, isSandboxSample } from '../sandbox/mode';

const stages: { id: StageId; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'test', label: 'Test' },
  { id: 'release', label: 'Release' },
  { id: 'monitor', label: 'Monitor' },
];

/** Where a page sits in Build -> Test -> Release -> Monitor (Overview and setup count as Build). */
const stageIndexOf = (stage: StageId) => Math.max(0, stages.findIndex((s) => s.id === stage));

const actionVerb = {
  created: 'created',
  saved: 'saved',
  published: 'published',
  deployed: 'deployed',
  rolled_back: 'rolled back',
  restored: 'restored',
  exported: 'exported',
  imported: 'imported',
} as const;

export function Home() {
  const { agents: allAgents, activity, loading } = useStudio();
  // Sandbox: the sample agents hidden from Home ("Hide the samples") are left out; Live shows every agent, as before
  const { hidden } = useRemovedAgents();
  const agents = useMemo(
    () => (isSandbox() ? allAgents.filter((a) => !(isSandboxSample(a.id) && hidden.includes(a.id))) : allAgents),
    [allAgents, hidden]
  );
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [showChecklist, setShowChecklist] = useState(() => {
    return localStorage.getItem('weave_first_run_dismissed') !== 'true';
  });
  const [liveViewMode, setLiveViewMode] = useState<'accordion' | 'table'>('accordion');

  // Ordered list of agents for What's Live
  const [liveAgents, setLiveAgents] = useState(() => agents);
  const [livePage, setLivePage] = useState(1);
  const [livePageSize, setLivePageSize] = useState(5);

  React.useEffect(() => {
    setLiveAgents(agents);
  }, [agents]);

  const handleDismissChecklist = () => {
    setShowChecklist(false);
    localStorage.setItem('weave_first_run_dismissed', 'true');
  };

  const handleReopenChecklist = () => {
    setShowChecklist(true);
    localStorage.removeItem('weave_first_run_dismissed');
  };

  // "Next step" is about the agent chosen here, else the one opened last, else the one saved most recently.
  const [chosenId, setChosenId] = useState('');
  const focus = useMemo(
    () =>
      focusAgent(
        agents.map((a) => ({ id: a.id, savedAt: a.draft.saved_at, agent: a })),
        chosenId,
        lastAgentId()
      )?.agent,
    [agents, chosenId]
  );
  const chooseAgent = (id: string) => {
    setChosenId(id);
    rememberLastAgent(id);
  };
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);
  const firstName = firstNameOf(user?.name ?? '');
  const publishedCount = agents.filter((a) => a.versions.length > 0).length;
  // The same readiness model as the agent's own pages and the agent list.
  const focusState = useAgentsReadiness(focus ? [focus] : [])[focus?.id ?? ''];
  const stepLink = useStepLink(focus?.id ?? '');
  const next = focusState?.readiness.next ?? null;
  const stageIndex = next ? stageIndexOf(next.target.stage) : stages.length - 1;

  const totalPages = Math.max(1, Math.ceil(liveAgents.length / livePageSize));
  const safePage = Math.min(livePage, totalPages);
  const startIndex = (safePage - 1) * livePageSize;
  const visibleLiveAgents = liveAgents.slice(startIndex, startIndex + livePageSize);

  const handleReorderLive = (newVisible: typeof visibleLiveAgents) => {
    const next = [...liveAgents];
    next.splice(startIndex, visibleLiveAgents.length, ...newVisible);
    setLiveAgents(next);
  };

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {firstName ? `${greeting}, ${firstName}` : greeting}
          </h1>
          <p className="mt-1 text-sm text-ink-soft" data-testid="home-counts">
            {loading ? 'Reading your agents…' : workspaceLine({ agents: agents.length, published: publishedCount, workspaceName: user?.workspaceName })}
          </p>
          {!showChecklist && (
            <button
              type="button"
              onClick={handleReopenChecklist}
              className="mt-1 text-xs text-accent hover:underline flex items-center gap-1 font-medium"
            >
              Show first-run checklist
            </button>
          )}
        </div>
        {can('edit') && (
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-4 w-4" aria-hidden />
            Create agent
          </Button>
        )}
      </div>

      {isSandbox() && <SampleAgentsNotice agents={agents} />}

      {/* the workspace pulse: calls today, calls now, alerts, answer time */}
      <div className="mt-6 empty:hidden"><WorkspacePulse /></div>

      {showChecklist && (
        <div className="mt-6">
          <FirstRunChecklist agent={focus} state={focusState} onOpenCreate={() => setCreateOpen(true)} onDismiss={handleDismissChecklist} />
        </div>
      )}

      {focus && focusState ? (
        <section aria-labelledby="next-step" className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-panel lg:p-8">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
              <span>Next step</span>
              <span aria-hidden>·</span>
              <Link to={`/agents/${focus.id}`} className="font-medium text-ink hover:underline">
                {focus.name}
              </Link>
              <span className="font-mono text-xs">{focus.id}</span>
            </div>
            <AgentChooser agents={agents} value={focus.id} onChange={chooseAgent} />
          </div>
          <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h2 id="next-step" className="text-xl font-semibold tracking-tight text-ink">
                {next ? next.label : `${focus.name} is ready and live`}
              </h2>
              <p className={cn('mt-2 max-w-xl text-sm leading-relaxed', next?.state === 'blocked' ? 'text-danger' : 'text-ink-soft')}>
                {next ? next.text : 'Every step is done. Keep an eye on how its calls go.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {next ? (
                  <Button variant={next.state === 'blocked' ? 'danger' : 'primary'} onClick={() => navigate(stepLink(next))}>
                    {stepLink(next).includes('/setup/') ? 'Continue setup' : `Go to ${stages[stageIndex].label}`}
                    <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => navigate(`/agents/${focus.id}/monitor`)}>
                    Go to Monitor
                    <ArrowRightIcon className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>
            <ol className="flex flex-wrap items-center gap-1.5" aria-label="Where this agent is in the journey">
              {stages.map((s, i) => {
                const done = i < stageIndex || (!next && i === stageIndex);
                const current = !!next && i === stageIndex;
                return (
                  <li key={s.id} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                        done && 'bg-success-soft text-success',
                        current && 'bg-ink text-canvas',
                        !done && !current && 'bg-subtle text-muted'
                      )}
                      aria-current={current ? 'step' : undefined}
                    >
                      {done && <CheckIcon className="h-3 w-3" aria-hidden />}
                      {s.label}
                    </span>
                    {i < stages.length - 1 && <span className="h-px w-3 bg-line-strong" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ) : loading || focus ? (
        // the agents (or the chosen one's readiness) are still being read: not "create your first agent" yet
        <section aria-label="Your next step" aria-busy="true" className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-panel lg:p-8">
          <div className="h-4 w-48 animate-pulse rounded bg-subtle" />
          <div className="mt-4 h-6 w-80 max-w-full animate-pulse rounded bg-subtle" />
          <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-subtle" />
        </section>
      ) : (
        <section className="mt-6 rounded-xl border border-line bg-surface p-8 shadow-panel">
          <h2 className="text-xl font-semibold text-ink">Create your first agent</h2>
          <p className="mt-2 max-w-lg text-sm text-ink-soft">Pick a starter, change the company name and greeting, and you can be talking to it in a few minutes.</p>
          {can('edit') && (
            <Button variant="primary" className="mt-5" onClick={() => setCreateOpen(true)}>
              Choose a starter
            </Button>
          )}
        </section>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="whats-live">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 id="whats-live" className="text-sm font-semibold text-ink">
                What’s live
              </h2>
              <span className="flex h-2 w-2 rounded-full bg-success animate-pulse" />
            </div>
            <div className="flex items-center gap-3">
              <Segmented
                label="How to show what is live"
                size="sm"
                value={liveViewMode}
                onChange={setLiveViewMode}
                options={[
                  { value: 'accordion', label: 'List' },
                  { value: 'table', label: 'Table' },
                ]}
              />
              <Link to="/agents" className="text-[13px] font-medium text-accent hover:underline">
                All agents
              </Link>
            </div>
          </div>

          {liveViewMode === 'table' ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>
                    {environments.map((e) => (
                      <th key={e} scope="col" className="px-4 py-2.5 font-medium">{envLabel(e)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleLiveAgents.map((a) => {
                    const current = currentDeployments(a);
                    return (
                      <tr key={a.id} className="border-b border-line last:border-0 hover:bg-canvas transition-colors">
                        <th scope="row" className="px-4 py-3 text-left font-medium">
                          <Link to={`/agents/${a.id}/release`} className="text-ink hover:underline">
                            {a.name}
                          </Link>{' '}
                          <SampleTag id={a.id} className="ml-1 align-middle" />
                        </th>
                        {environments.map((e) => {
                          const pending = pendingDeployment(a, e);
                          return (
                            <td key={e} className="px-4 py-3">
                              {pending ? (
                                <StatusChip tone="info" dot>Deploying {pending.version}</StatusChip>
                              ) : current[e] ? (
                                <span className="font-mono text-[13px] text-ink">{current[e]?.version}</span>
                              ) : (
                                <span className="text-muted" aria-label="Not deployed">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Uniform Accordion for What's live */
            <div className="mt-3">
              <Accordion
                items={visibleLiveAgents}
                onReorder={handleReorderLive}
                enableReordering={true}
                enableDragAndDrop={true}
                pagination={{
                  page: safePage,
                  pageSize: livePageSize,
                  totalItems: liveAgents.length,
                  onPageChange: (p) => setLivePage(p),
                  onPageSizeChange: (s) => {
                    setLivePageSize(s);
                    setLivePage(1);
                  },
                  pageSizeOptions: [3, 5, 10],
                }}
              >
                {visibleLiveAgents.map((a, idx) => {
                  const current = currentDeployments(a);
                  const isFirst = idx === 0;
                  const isLast = idx === visibleLiveAgents.length - 1;
                  const liveCount = environments.filter((e) => current[e]).length;

                  return (
                    <AccordionItem
                      key={a.id}
                      id={a.id}
                      index={idx}
                      isFirst={isFirst}
                      isLast={isLast}
                    >
                      <AccordionHeader
                        id={a.id}
                        icon={<BotIcon className="h-4 w-4 text-accent" />}
                        title={a.name}
                        subtitle={
                          <span>
                            <code className="font-mono text-xs">{a.id}</code> · {liveCount > 0 ? `Serving in ${liveCount} environments` : 'Not deployed yet'}
                          </span>
                        }
                        badge={
                          <div className="flex flex-wrap items-center gap-1.5">
                            <SampleTag id={a.id} />
                            {environments
                              .filter((e) => current[e])
                              .map((e) => (
                                <StatusChip
                                  key={e}
                                  tone={e === 'production' ? 'accent' : 'neutral'}
                                >
                                  {envShort(e)} <span className="font-mono text-[11px]">{current[e]?.version}</span>
                                </StatusChip>
                              ))}
                            {liveCount === 0 && <StatusChip tone="neutral">Idle</StatusChip>}
                          </div>
                        }
                        actions={
                          <Tooltip content="Open release manager" position="top">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/agents/${a.id}/release`)}
                              className="h-8 px-2 text-xs"
                            >
                              <RocketIcon className="h-3.5 w-3.5 mr-1 text-info" />
                              <span className="hidden sm:inline">Releases</span>
                            </Button>
                          </Tooltip>
                        }
                      />

                      <AccordionContent>
                        <div className="space-y-4">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                            Environment Rollout Status
                          </h4>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {environments.map((e) => {
                              const deployed = current[e];
                              const pending = pendingDeployment(a, e);
                              return (
                                <div
                                  key={e}
                                  className="rounded-lg border border-line bg-surface p-3 text-xs"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-ink">{envLabel(e)}</span>
                                    {pending ? (
                                      <StatusChip tone="info" dot>
                                        Deploying
                                      </StatusChip>
                                    ) : deployed ? (
                                      <StatusChip tone={e === 'production' ? 'accent' : 'success'} dot>
                                        Active
                                      </StatusChip>
                                    ) : (
                                      <span className="text-muted text-[11px]">Inactive</span>
                                    )}
                                  </div>
                                  <div className="mt-2 font-mono text-ink text-xs font-semibold">
                                    {pending ? pending.version : deployed ? deployed.version : '—'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line/60">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => navigate(`/agents/${a.id}/release`)}
                              >
                                <RocketIcon className="h-3.5 w-3.5 mr-1.5 text-info" />
                                Manage Deployments
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => navigate(`/agents/${a.id}/test`)}
                              >
                                <PlayIcon className="h-3.5 w-3.5 mr-1.5 text-success" />
                                Test Live
                              </Button>
                            </div>
                            <Link
                              to={`/agents/${a.id}`}
                              className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
                            >
                              <span>Workspace</span>
                              <ExternalLinkIcon className="h-3 w-3" />
                            </Link>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          )}
        </section>

        <div className="space-y-10">
        <QuickActions />

        <section aria-labelledby="activity">
          <div className="flex items-center justify-between gap-2">
            <h2 id="activity" className="text-sm font-semibold text-ink">Recent activity</h2>
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
              Audit log
            </button>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {activity.slice(0, 7).map((item) => {
              const agent = agents.find((a) => a.id === item.agentId);
              return (
                <li key={item.id} className="py-2.5 text-[13px]">
                  <p className="text-ink">
                    <span className="font-medium">{item.who}</span> {actionVerb[item.action]}{' '}
                    <Link to={`/agents/${item.agentId}`} className="font-medium hover:underline">{agent?.name ?? item.agentId}</Link>
                  </p>
                  <p className="mt-0.5 text-muted">
                    {item.detail} · {timeAgo(item.at)}
                  </p>
                </li>
              );
            })}
          </ul>
          {activity.length === 0 && <p className="mt-3 text-[13px] text-muted">Nothing yet. Saves, publishes and deploys show here.</p>}
        </section>
        </div>
      </div>

      {/* test conversations: real calls of each agent's draft, counted over 7 or 30 days */}
      {!loading && agents.length > 0 && <TestConversationStats agentIds={agents.map((a) => a.id)} />}

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <AuditTrailDialog open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
