import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  GripVerticalIcon,
  LayersIcon,
  ListIcon,
  PinIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  ShieldCheckIcon,
  TableIcon,
  WrenchIcon,
} from 'lucide-react';
import { useStudio } from '../contexts/StudioContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { SampleTag } from '../components/agents/SampleTag';
import { Badge } from '../components/ui/Badge';
import { Tooltip } from '../components/ui/Tooltip';
import { toast } from '../components/ui/Toast';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
} from '../components/ui/accordion';
import { CreateAgentDialog } from '../components/agents/CreateAgentDialog';
import { useDraftValidations } from '../hooks/useServerValidation';
import { useAgentsReadiness } from '../hooks/useReadiness';
import { AgentRowActivity } from '../components/insights/AgentRowActivity';
import { currentDeployments, draftChangeCount, environments, envShort, envLabel, latestVersion } from '../utils/agentStatus';
import { missingSecrets } from '../utils/providerOptions';
import { useSecretKeys } from '../hooks/useProviders';
import { timeAgo } from '../utils/format';
import { cn, inputClass, pageClass } from '../utils/styles';
import type { Agent } from '../types/studio';
import { SORTS, STATUSES, collectFacets, filterAgents, isSortKey, isStatusKey, metaOfConfig, paginate, statusCounts, type ListItem, type SortKey } from '../models/agentList';
import { OWN_ORDER, ORDER_KEY, arrange, moveInOrder, neighbour } from '../models/agentOrder';
import { agentsInWorkspace } from '../models/workspaces';
import { partitionAgents } from '../models/manage';
import { readJson, stringList, writeJson } from '../models/manageStore';
import { useRemovedAgents, useWorkspaces } from '../hooks/useWorkspaces';
import { WorkspaceSwitcher } from '../components/manage/WorkspaceSwitcher';
import { RemovedAgents } from '../components/manage/RemovedAgents';
import { MoreMenu, type MenuItem } from '../components/manage/MoreMenu';
import { ConfirmHost } from '../components/manage/ConfirmHost';
import { useAgentManage } from '../components/manage/useAgentManage';
import { currentSearchParams } from '../utils/searchParams';
import { ChecksBadge, NextStepCell, ReadinessIndicator, WorkspaceAction } from '../components/agents/AgentRowCells';

type ViewMode = 'accordion' | 'table';
// The list view and sort, kept in this browser so the list opens the way it was left (the address can still say otherwise).
const VIEW_KEY = 'weave_agents_view';
const SORT_KEY = 'weave_agents_sort';

export function Agents() {
  const { agents, pinnedAgentIds, togglePinAgent, error: agentsError, loading: agentsLoading, refreshAgents } = useStudio();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const q = params.get('q') ?? '';
  const statusParam = params.get('status');
  const status = isStatusKey(statusParam) ? statusParam : 'all';
  const [savedSort, setSavedSort] = useState<SortKey>(() => {
    const saved = readJson(SORT_KEY);
    return isSortKey(saved) ? saved : 'recent';
  });
  const sortParam = params.get('sort');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : savedSort;
  const tag = params.get('tag') ?? '';
  const owner = params.get('owner') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSizeParam = Number(params.get('size') ?? '10') || 10;
  const [pageSize, setPageSize] = useState<number>(pageSizeParam);
  const [viewMode, setViewModeState] = useState<ViewMode>(() => (readJson(VIEW_KEY) === 'table' ? 'table' : 'accordion'));
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    writeJson(VIEW_KEY, mode);
  };
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  // The person's own order ("Your order"), kept in this browser.
  const [customOrder, setCustomOrder] = useState<string[]>(() => stringList(readJson(ORDER_KEY)));

  // Workspaces and "removed from my list" are kept in this browser; the list shows the open workspace's agents.
  const { spaces, owners, current, currentSpace } = useWorkspaces();
  const { hidden, dismissed } = useRemovedAgents();
  const inWorkspace = useMemo(() => agentsInWorkspace(agents, owners, spaces, current), [agents, owners, spaces, current]);
  const { visible: listed, removed, dismissedIds } = useMemo(() => partitionAgents(inWorkspace, hidden, dismissed), [inWorkspace, hidden, dismissed]);
  const notRemoved = useMemo(() => agents.filter((a) => !hidden.includes(a.id)), [agents, hidden]);
  const manage = useAgentManage();

  const setParam = (key: string, value: string, fallback: string) => {
    const next = currentSearchParams();
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const setSort = (value: SortKey) => {
    setSavedSort(value);
    writeJson(SORT_KEY, value);
    setParam('sort', value, 'recent');
  };

  const handlePageChange = (newPage: number) => {
    const next = currentSearchParams();
    next.set('page', String(newPage));
    setParams(next, { replace: true });
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    const next = currentSearchParams();
    next.set('size', String(newSize));
    next.delete('page');
    setParams(next, { replace: true });
  };

  const secretKeys = useSecretKeys();
  // The server's checks on each saved draft (POST /validate); null while it has not answered.
  const validations = useDraftValidations(listed);
  // Readiness per agent: the same model as the agent's header, Overview and Release.
  const readinessById = useAgentsReadiness(listed);
  const rows = useMemo(
    () =>
      listed.map((a) => {
        const checks = validations[a.id];
        const report = checks?.report ?? null;
        const latest = latestVersion(a);
        const current = currentDeployments(a);
        const missing = report ? missingSecrets(report.secrets_required, secretKeys) : [];
        const isPinned = pinnedAgentIds.includes(a.id);
        // What the list's filters and sorts read: "needs attention" is unknown (null) until the server's checks answer.
        const attention = checks?.status === 'failed' ? true : report ? !report.valid || missing.length > 0 : null;
        const item: ListItem = {
          id: a.id,
          name: a.name,
          savedAt: a.draft.saved_at,
          latestVersion: latest?.version ?? null,
          deployed: Object.fromEntries(Object.entries(current).map(([env, d]) => [env, d?.version])),
          attention,
          meta: a.loadError ? null : metaOfConfig(a.draft.config),
        };
        return { ...item, agent: a, report, checks, latest, current, missing, changes: draftChangeCount(a), isPinned, readiness: readinessById[a.id]?.readiness };
      }),
    [listed, pinnedAgentIds, secretKeys, validations, readinessById]
  );

  const { matched, unknown } = useMemo(() => filterAgents(rows, { query: q, tag, owner, status }), [rows, q, tag, owner, status]);
  const counts = useMemo(() => statusCounts(rows, { query: q, tag, owner }), [rows, q, tag, owner]);
  const facets = useMemo(() => collectFacets(rows), [rows]);
  // Pinned first, then the sort chosen; "Your order" is the person's own, set by dragging or Move up / Move down.
  const filtered = useMemo(() => arrange(matched, { sort, pinned: pinnedAgentIds, order: customOrder }), [matched, sort, pinnedAgentIds, customOrder]);

  const paged = paginate(filtered, page, pageSize);
  const totalPages = paged.pages;
  const safePage = paged.page;
  const startIndex = paged.from ? paged.from - 1 : 0;
  const visible = paged.rows;

  // Moves one agent to where another is, in the person's own order (the list then shows "Your order").
  const moveAgent = useCallback(
    (sourceId: string, targetId: string) => {
      const all = arrange(rows, { sort, pinned: pinnedAgentIds, order: customOrder });
      const next = moveInOrder(all, pinnedAgentIds, sourceId, targetId);
      if (!next) {
        if (sourceId !== targetId) toast.info('Pinned agents stay above the others', { description: 'Unpin it first to move it among the rest.' });
        return;
      }
      setCustomOrder(next);
      writeJson(ORDER_KEY, next);
      if (sort !== OWN_ORDER) {
        setSavedSort(OWN_ORDER);
        writeJson(SORT_KEY, OWN_ORDER);
        const nextParams = currentSearchParams();
        nextParams.set('sort', OWN_ORDER);
        setParams(nextParams, { replace: true });
      }
      toast.success('Agent order updated', { description: 'Shown as “Your order”, kept in this browser.' });
    },
    [rows, sort, pinnedAgentIds, customOrder, setParams]
  );

  const handleReorderById = (sourceId: string, targetId: string) => moveAgent(sourceId, targetId);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  // A row's "⋯" menu: Move up / Move down (the keyboard's way to reorder), then rename, export, template, move, remove.
  const rowMenu = (agent: Agent): MenuItem[] => {
    const up = neighbour(visible, pinnedAgentIds, agent.id, -1);
    const down = neighbour(visible, pinnedAgentIds, agent.id, 1);
    return manage.items(agent, {
      before: [
        { label: 'Move up', icon: ArrowUpIcon, disabled: !up, onSelect: () => up && moveAgent(agent.id, up), hint: up ? undefined : 'Already first in its group' },
        { label: 'Move down', icon: ArrowDownIcon, disabled: !down, onSelect: () => down && moveAgent(agent.id, down), hint: down ? undefined : 'Already last in its group' },
        { divider: true },
      ],
    });
  };

  const workspaceName = currentSpace?.name ?? 'My workspace';
  const filtering = !!q || status !== 'all' || !!tag || !!owner;

  return (
    <div className={cn(pageClass, 'scroll-mt-20')}>
      <div className="flex flex-wrap items-end justify-between gap-4 scroll-mt-20">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Agents</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted">
            <span>
              {listed.length} {listed.length === 1 ? 'agent' : 'agents'} in
            </span>
            <WorkspaceSwitcher agents={notRemoved} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="View">
            <Tooltip content="Accordion list view with reordering & configuration breakdown" position="top">
              <button
                type="button"
                aria-pressed={viewMode === 'accordion'}
                onClick={() => setViewMode('accordion')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'accordion'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-muted hover:text-ink'
                )}
              >
                <ListIcon className="h-3.5 w-3.5" />
                <span>Accordions</span>
              </button>
            </Tooltip>
            <Tooltip content="Compact table grid view" position="top">
              <button
                type="button"
                aria-pressed={viewMode === 'table'}
                onClick={() => setViewMode('table')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'table'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-muted hover:text-ink'
                )}
              >
                <TableIcon className="h-3.5 w-3.5" />
                <span>Table</span>
              </button>
            </Tooltip>
          </div>

          {can('edit') && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4" aria-hidden />
              Create agent
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search agents"
            value={q}
            onChange={(e) => setParam('q', e.target.value, '')}
            placeholder="Search by name or id"
            className={`${inputClass} pl-9`}
          />
        </div>
        {/* The status filter, each with how many agents it would show */}
        <div role="group" aria-label="Filter by status" className="inline-flex flex-wrap rounded-lg border border-line bg-subtle p-0.5">
          {(Object.keys(STATUSES) as (keyof typeof STATUSES)[]).map((key) => {
            const active = key === status;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setParam('status', key, 'all')}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                {STATUSES[key]}
                <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-accent-soft text-accent' : 'bg-surface/70 text-muted')}>
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
        {/* the narrowing and the order stay together, so they wrap as one */}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {facets.tags.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Tag
              <select value={tag} onChange={(e) => setParam('tag', e.target.value, '')} className={`${inputClass} w-auto py-1.5`} aria-label="Filter by tag">
                <option value="">Any</option>
                {facets.tags.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.value} ({t.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          {facets.owners.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Owner
              <select value={owner} onChange={(e) => setParam('owner', e.target.value, '')} className={`${inputClass} w-auto py-1.5`} aria-label="Filter by owner">
                <option value="">Anyone</option>
                {facets.owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value} ({o.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(isSortKey(e.target.value) ? e.target.value : 'recent')}
              className={`${inputClass} w-auto py-1.5`}
              aria-label="Sort agents"
            >
              {(Object.keys(SORTS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORTS[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {unknown > 0 && (
        <p className="mt-2 text-[13px] text-muted" role="status" data-testid="not-checked">
          {unknown} {unknown === 1 ? 'agent' : 'agents'} not checked yet, so this filter doesn’t cover {unknown === 1 ? 'it' : 'them'}
          {status === 'attention' ? ': the server is still checking the saved drafts.' : ': the draft could not be read.'}
        </p>
      )}

      {/* the list couldn't be read (the server is down, or answered in a shape the studio can't read): said, not "no agents" */}
      {agents.length === 0 && agentsError && !agentsLoading ? (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-6 py-8 text-center" role="alert" data-testid="agents-error">
          <p className="text-sm font-medium text-ink">Couldn’t read your agents</p>
          <p className="mt-1 break-words text-sm text-ink-soft">{agentsError}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => void refreshAgents()}>
            Read them again
          </Button>
        </div>
      ) : listed.length === 0 && !filtering ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No agents in {workspaceName} yet</p>
          <p className="mt-1 text-sm text-muted">
            {removed.length
              ? `${removed.length} removed from your list: you can restore ${removed.length === 1 ? 'it' : 'them'} below.`
              : 'Create one, or move an agent here from another workspace.'}
          </p>
          {can('edit') && (
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              Create an agent
            </Button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No agents match</p>
          <p className="mt-1 text-sm text-muted">Try a different search or filter.</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        </div>
      ) : viewMode === 'table' ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Draft</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Latest version</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Live in</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Calls, last 7 days</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Next step</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Last edited</th>
                <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ agent, checks, latest, current, missing, changes, isPinned, readiness }) => (
                <tr
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  className="cursor-pointer border-b border-line transition-colors duration-150 last:border-0 hover:bg-canvas"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Tooltip content={isPinned ? 'Unpin agent' : 'Pin agent to top'} position="top">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinAgent(agent.id);
                          }}
                          className={cn(
                            'rounded p-1 transition-colors',
                            isPinned ? 'text-accent hover:text-accent/80' : 'text-muted/40 hover:text-muted'
                          )}
                          aria-label={isPinned ? 'Unpin agent' : 'Pin agent to top'}
                        >
                          <PinIcon className={cn('h-3.5 w-3.5', isPinned && 'fill-accent')} />
                        </button>
                      </Tooltip>
                      <div>
                        <Link
                          to={`/agents/${agent.id}`}
                          className="font-medium text-ink hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {agent.name}
                        </Link>
                        <p className="font-mono text-xs text-muted">{agent.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <SampleTag id={agent.id} />
                      <ChecksBadge view={checks} />
                      {!!changes && <StatusChip>{changes} unpublished</StatusChip>}
                      {missing.length > 0 && <StatusChip tone="warning" title={missing.join(', ')}>Missing secret</StatusChip>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {latest ? <span className="font-mono text-[13px]">{latest.version}</span> : <span className="text-muted">Not published</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {environments
                        .filter((e) => current[e])
                        .map((e) => (
                          <StatusChip key={e} tone={e === 'production' ? 'accent' : 'neutral'}>
                            {envShort(e)} <span className="font-mono">{current[e]?.version}</span>
                          </StatusChip>
                        ))}
                      {Object.keys(current).length === 0 && <span className="text-muted">Nowhere yet</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><AgentRowActivity agentId={agent.id} /></td>
                  <td className="px-4 py-3">
                    {readiness && <NextStepCell agentId={agent.id} readiness={readiness} />}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted">
                    {timeAgo(agent.draft.saved_at)}
                    <br />
                    by {agent.draft.saved_by}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <MoreMenu label={`More actions for ${agent.name}`} items={rowMenu(agent)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="border-t border-line px-4 py-3 flex items-center justify-between text-xs text-muted">
              <span>
                Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)} of {filtered.length} agents
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={safePage <= 1}
                  onClick={() => handlePageChange(safePage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                <span className="px-2 font-medium text-ink">
                  {safePage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={safePage >= totalPages}
                  onClick={() => handlePageChange(safePage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Uniform Accordion Experience */
        <div className="mt-5 p-1">
          <Accordion
            items={visible}
            getId={(item) => item.agent.id}
            onReorderById={handleReorderById}
            enableReordering={true}
            enableDragAndDrop={true}
            allowMultiple={false}
            expandedIds={expandedAgentId ? [expandedAgentId] : []}
            onExpandedChange={(ids) => setExpandedAgentId(ids.length > 0 ? ids[ids.length - 1] : null)}
            renderOverlay={(item) => (
              <div
                className={cn(
                  'grid grid-cols-[24px_36px_minmax(0,1fr)_auto_auto] gap-x-3.5 items-center px-4 sm:px-5 py-3 min-h-[64px]',
                  'select-none bg-surface rounded-xl border border-accent/40 shadow-overlay relative'
                )}
              >
                {item.report?.valid === false && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger rounded-l-xl z-10 pointer-events-none"
                    aria-hidden="true"
                  />
                )}
                {/* 1. Grip */}
                <div className="flex items-center justify-center w-6 shrink-0 text-accent">
                  <GripVerticalIcon className="h-4 w-4" />
                </div>
                {/* 2. Icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/30 text-accent">
                  <BotIcon className="h-5 w-5" />
                </div>
                {/* 3. MAIN */}
                <div className="min-w-0 flex flex-col justify-center">
                  <div className="text-sm font-semibold text-ink leading-snug truncate">
                    {item.agent.name}
                  </div>
                  <div className="text-xs text-muted leading-snug mt-0.5 truncate">
                    <span className="font-mono text-ink-soft">{item.agent.id}</span>
                    <span className="mx-1 text-muted/60">·</span>
                    <span>saved {timeAgo(item.agent.draft.saved_at)} by {item.agent.draft.saved_by}</span>
                  </div>
                </div>
                {/* 4. STATUS */}
                <div className="flex items-center justify-end gap-2 shrink-0">
                  <SampleTag id={item.agent.id} className="h-6 text-xs" />
                  {!!item.changes && (
                    <Badge variant="neutral" className="h-6 text-xs">
                      {item.changes} unpublished
                    </Badge>
                  )}
                  {item.missing.length > 0 && (
                    <StatusChip tone="warning" title={item.missing.join(', ')} className="h-6 text-xs">
                      Missing secret
                    </StatusChip>
                  )}
                  <ChecksBadge view={item.checks} className="h-6 text-xs" />
                  {item.readiness && (
                    <ReadinessIndicator readiness={item.readiness} />
                  )}
                  <Badge variant="outline" mono className="h-6 text-xs">
                    {item.latest ? item.latest.version : 'Unpublished'}
                  </Badge>
                </div>
                {/* 5. ACTIONS */}
                <div className="flex items-center justify-end gap-1.5 text-muted shrink-0">
                  <div className="h-8 w-8 rounded-lg flex items-center justify-center">
                    <ChevronDownIcon className="h-4 w-4" />
                  </div>
                </div>
              </div>
            )}
            pagination={{
              page: safePage,
              pageSize,
              totalItems: filtered.length,
              onPageChange: handlePageChange,
              onPageSizeChange: handlePageSizeChange,
              pageSizeOptions: [5, 10, 20, 50],
            }}
          >
            {visible.map(({ agent, report, checks, latest, current, missing, changes, isPinned, readiness }, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === visible.length - 1;

              return (
                <AccordionItem
                  key={agent.id}
                  id={agent.id}
                  index={idx}
                  isFirst={isFirst}
                  isLast={isLast}
                  hasProblem={report?.valid === false}
                >
                  <AccordionHeader
                    id={agent.id}
                    icon={<BotIcon className="h-5 w-5 text-accent" />}
                    hasProblem={report?.valid === false}
                    title={
                      <Tooltip content={agent.name} position="top" disabled={agent.name.length < 24}>
                        <div className="text-sm font-semibold text-ink leading-snug truncate">
                          {agent.name}
                        </div>
                      </Tooltip>
                    }
                    subtitle={
                      <Tooltip
                        content={
                          <div className="text-left text-xs space-y-0.5">
                            <div><span className="text-muted">Agent ID:</span> <span className="font-mono">{agent.id}</span></div>
                            <div><span className="text-muted">Last saved:</span> {new Date(agent.draft.saved_at).toLocaleString()}</div>
                            <div><span className="text-muted">Author:</span> {agent.draft.saved_by}</div>
                          </div>
                        }
                        position="top"
                      >
                        <div className="text-xs text-muted leading-snug mt-0.5 truncate cursor-default">
                          <span className="font-mono text-ink-soft">{agent.id}</span>
                          <span className="mx-1 text-muted/60">·</span>
                          <span>saved {timeAgo(agent.draft.saved_at)} by {agent.draft.saved_by}</span>
                        </div>
                      </Tooltip>
                    }
                    status={
                      <>
                        <SampleTag id={agent.id} className="h-6 text-xs shrink-0" />
                        {!!changes && (
                          <Badge variant="neutral" className="h-6 text-xs shrink-0">
                            {changes} unpublished
                          </Badge>
                        )}
                        {missing.length > 0 && (
                          <StatusChip tone="warning" title={missing.join(', ')} className="h-6 text-xs shrink-0">
                            Missing secret
                          </StatusChip>
                        )}
                        <div className="shrink-0 flex items-center">
                          <ChecksBadge view={checks} className="h-6 text-xs" />
                        </div>
                        {readiness && (
                          <div className="shrink-0 flex items-center">
                            <ReadinessIndicator readiness={readiness} />
                          </div>
                        )}
                        <AgentRowActivity agentId={agent.id} className="shrink-0" />
                        <div className="shrink-0 flex items-center">
                          <Badge variant="outline" mono className="h-6 text-xs">
                            {latest ? latest.version : 'Unpublished'}
                          </Badge>
                        </div>
                      </>
                    }
                    actions={
                      <>
                        <Tooltip content={isPinned ? 'Unpin agent' : 'Pin to top of list'} position="top">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinAgent(agent.id);
                            }}
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                              isPinned
                                ? 'text-accent hover:text-accent/80 hover:bg-accent-soft/30'
                                : 'text-muted/60 hover:text-ink hover:bg-subtle'
                            )}
                            aria-label={isPinned ? 'Unpin agent' : 'Pin agent'}
                          >
                            <PinIcon className={cn('h-4 w-4', isPinned && 'fill-accent')} />
                          </button>
                        </Tooltip>

                        <WorkspaceAction agentId={agent.id} agentName={agent.name} />

                        <MoreMenu label={`More actions for ${agent.name}`} items={rowMenu(agent)} />
                      </>
                    }
                  />

                  <AccordionContent>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      {/* Left column: Deployments + Configuration Health */}
                      <div className="lg:col-span-7 xl:col-span-8 space-y-5">
                        {/* Active Deployments */}
                        <div>
                          <div className="flex items-center justify-between mb-2.5">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                              <RocketIcon className="h-3.5 w-3.5 text-accent" />
                              <span>Active Deployments</span>
                            </h4>
                            <span className="text-[11px] text-muted">
                              {Object.keys(current).length > 0
                                ? `${Object.keys(current).length} environment${Object.keys(current).length === 1 ? '' : 's'} live`
                                : 'None deployed yet'}
                            </span>
                          </div>
                          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                            {environments.map((env) => {
                              const deployed = current[env];
                              const isProd = env === 'production';
                              return (
                                <div
                                  key={env}
                                  className={cn(
                                    'flex flex-col justify-between rounded-xl border p-3.5 min-h-[88px] transition-colors',
                                    deployed
                                      ? isProd
                                        ? 'border-accent/35 bg-accent-soft/20 dark:bg-accent-soft/10 shadow-xs'
                                        : 'border-line-strong/60 bg-surface shadow-xs'
                                      : 'border-line/60 bg-surface/60'
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-1.5">
                                    <span className="text-xs font-semibold text-ink">
                                      {envLabel(env)}
                                    </span>
                                    {deployed ? (
                                      <StatusChip
                                        tone={isProd ? 'accent' : 'success'}
                                        dot
                                        className="text-[10px] h-5 px-1.5"
                                      >
                                        Live
                                      </StatusChip>
                                    ) : (
                                      <span className="text-[10px] font-medium text-muted/70 bg-subtle px-1.5 py-0.5 rounded">
                                        Inactive
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2.5">
                                    {deployed ? (
                                      <div className="flex items-baseline gap-1.5">
                                        <span className="font-mono text-xs font-medium text-ink">
                                          {deployed.version}
                                        </span>
                                        {deployed.deployed_at && (
                                          <span className="text-[10px] text-muted truncate">
                                            · {timeAgo(deployed.deployed_at)}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-muted/70 font-mono">
                                        Not deployed
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Configuration Health */}
                        <div className="pt-1">
                          <div className="flex items-center justify-between mb-2.5">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                              <ShieldCheckIcon className="h-3.5 w-3.5 text-accent" />
                              <span>Configuration Health</span>
                            </h4>
                            {report && report.valid && (
                              <Badge variant="success" dot className="h-5 text-[11px]">
                                All Checks Passed
                              </Badge>
                            )}
                            {report && !report.valid && (
                              <Badge variant="danger" dot className="h-5 text-[11px]">
                                {report.errors.length} {report.errors.length === 1 ? 'Error' : 'Errors'} Found
                              </Badge>
                            )}
                          </div>

                          {!report ? (
                            <div className="rounded-xl border border-line bg-surface p-4 text-xs text-muted flex items-center gap-2.5">
                              {checks?.status === 'failed' ? (
                                <>
                                  <AlertCircleIcon className="h-4 w-4 text-warning shrink-0" />
                                  <span>The server’s checks could not be run: {checks.error}</span>
                                </>
                              ) : (
                                <>
                                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent shrink-0" />
                                  <span>The server is checking the saved draft…</span>
                                </>
                              )}
                            </div>
                          ) : report.valid ? (
                            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft/30 dark:bg-success-soft/10 p-4 text-xs text-success">
                              <CheckCircle2Icon className="h-4 w-4 shrink-0 text-success" />
                              <div className="min-w-0">
                                <div className="font-semibold text-ink">Configuration checks pass</div>
                                <div className="text-muted mt-0.5">The draft configuration has passed all schema validations and is ready for release.</div>
                              </div>
                            </div>
                          ) : (
                            <div className="max-h-[260px] overflow-y-auto overflow-x-hidden pr-1.5 space-y-2.5">
                              {report.errors.map((err, i) => (
                                <div
                                  key={i}
                                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-danger/25 bg-danger-soft/30 dark:bg-danger-soft/15 p-3 text-xs text-danger transition-colors hover:border-danger/40"
                                >
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <AlertCircleIcon className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium text-ink break-words leading-relaxed">
                                        {err.message}
                                      </div>
                                      {err.path && (
                                        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                                          <span className="font-mono text-danger/80 bg-danger-soft/50 dark:bg-danger-soft/30 px-1.5 py-0.5 rounded break-all">
                                            {err.path}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 self-end sm:self-center">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => navigate(`/agents/${agent.id}/build`)}
                                      className="h-7 text-xs px-2.5 bg-surface hover:bg-subtle text-ink border-line shadow-xs font-medium"
                                    >
                                      <span>Fix in Build</span>
                                      <ArrowRightIcon className="h-3 w-3 ml-1 text-accent" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right column: Quick Navigation */}
                      <div className="lg:col-span-5 xl:col-span-4 rounded-xl border border-line bg-surface p-4 sm:p-5 shadow-xs space-y-3">
                        <div className="flex items-center justify-between border-b border-line/60 pb-3">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <CompassIcon className="h-3.5 w-3.5 text-accent" />
                            <span>Quick Navigation</span>
                          </h4>
                          <span className="text-[11px] text-muted">Workspace Stages</span>
                        </div>

                        <div className="grid gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/agents/${agent.id}/build`)}
                            className="group flex w-full items-center justify-between rounded-lg border border-line/70 bg-canvas/40 p-2.5 text-left transition-all duration-150 hover:border-accent/40 hover:bg-accent-soft/20 dark:hover:bg-accent-soft/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft/40 text-accent group-hover:scale-105 transition-transform">
                                <WrenchIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-ink group-hover:text-accent transition-colors">
                                  Configure in Build Stage
                                </div>
                                <div className="text-[11px] text-muted truncate">
                                  Prompts, tools, models & instructions
                                </div>
                              </div>
                            </div>
                            <ChevronRightIcon className="h-4 w-4 text-muted/60 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/agents/${agent.id}/test`)}
                            className="group flex w-full items-center justify-between rounded-lg border border-line/70 bg-canvas/40 p-2.5 text-left transition-all duration-150 hover:border-success/40 hover:bg-success-soft/20 dark:hover:bg-success-soft/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-soft/40 text-success group-hover:scale-105 transition-transform">
                                <PlayIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-ink group-hover:text-success transition-colors">
                                  Test Conversation Live
                                </div>
                                <div className="text-[11px] text-muted truncate">
                                  Test conversations & scenario runs
                                </div>
                              </div>
                            </div>
                            <ChevronRightIcon className="h-4 w-4 text-muted/60 group-hover:text-success group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/agents/${agent.id}/release`)}
                            className="group flex w-full items-center justify-between rounded-lg border border-line/70 bg-canvas/40 p-2.5 text-left transition-all duration-150 hover:border-info/40 hover:bg-info-soft/20 dark:hover:bg-info-soft/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft/40 text-info group-hover:scale-105 transition-transform">
                                <RocketIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-ink group-hover:text-info transition-colors">
                                  Release & Deployment
                                </div>
                                <div className="text-[11px] text-muted truncate">
                                  Publish versions & target environments
                                </div>
                              </div>
                            </div>
                            <ChevronRightIcon className="h-4 w-4 text-muted/60 group-hover:text-info group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(`/agents/${agent.id}/monitor`)}
                            className="group flex w-full items-center justify-between rounded-lg border border-line/70 bg-canvas/40 p-2.5 text-left transition-all duration-150 hover:border-line-strong hover:bg-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-strong"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-soft group-hover:scale-105 transition-transform">
                                <LayersIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-ink group-hover:text-ink transition-colors">
                                  Performance Telemetry
                                </div>
                                <div className="text-[11px] text-muted truncate">
                                  Traces, latency, tokens & cost analytics
                                </div>
                              </div>
                            </div>
                            <ChevronRightIcon className="h-4 w-4 text-muted/60 group-hover:text-ink group-hover:translate-x-0.5 transition-all shrink-0 ml-2" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      )}

      <RemovedAgents removed={removed} dismissedIds={dismissedIds} />

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {manage.element}
      <ConfirmHost />
    </div>
  );
}
