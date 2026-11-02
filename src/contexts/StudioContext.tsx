import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityAction,
  ActivityItem,
  Agent,
  AgentConfig,
  Deployment,
  Draft,
  EnvironmentName,
  Issue,
  JobNotification,
  ValidationReport,
  Version,
  VersionBump,
} from '../types/studio';
import { starters } from '../data/starters';
import { useAuth } from './AuthContext';
import { applyStarter } from '../models/setup';
import { randomHex } from '../utils/format';
import { currentDeployments } from '../utils/agentStatus';
import { api, ApiError } from '../api/client';
import type { BotSummary, Preflight, ValidationIssue } from '../api/types';

export type SaveResult =
  /** validation: the server's report on what it saved (PUT /draft returns it). */
  | { ok: true; draft: Draft; validation: ValidationReport }
  | { ok: false; conflict: Draft };

export type PublishResult =
  | { ok: true; version: Version; warnings: Issue[]; secrets_required: string[] }
  | { ok: false; errors: Issue[] };

export interface DeployOutcome {
  deployment: Deployment;
  /** What the server checked for this version: missing secrets, features it cannot run, knowledge problems. */
  preflight: Preflight;
}

const toIssue = (issue: ValidationIssue): Issue => ({
  path: issue.path ? issue.path.map(String) : null,
  message: issue.message,
});

interface CreateInput {
  id: string;
  name: string;
  company: string;
  starterId: string;
}

interface StudioValue {
  agents: Agent[];
  activity: ActivityItem[];
  loading: boolean;
  error: string | null;
  technicalNames: boolean;
  setTechnicalNames: (v: boolean) => void;
  activeEnvironment: EnvironmentName;
  setActiveEnvironment: (env: EnvironmentName) => void;
  pinnedAgentIds: string[];
  togglePinAgent: (id: string) => void;
  savedFilters: { id: string; name: string; filter: string }[];
  saveFilter: (name: string, filter: string) => void;
  deleteFilter: (id: string) => void;
  notifications: JobNotification[];
  unreadCount: number;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  addNotification: (n: Omit<JobNotification, 'id' | 'timestamp' | 'read'>) => void;
  logAudit: (action: ActivityAction, agentId: string, detail: string) => void;
  getAgent: (id: string) => Agent | undefined;
  createAgent: (input: CreateInput) => Promise<Agent> | Agent;
  saveDraft: (agentId: string, config: AgentConfig, baseRevision: number | null) => Promise<SaveResult>;
  /** Without a bump, the draft is published under its own version number (meta.version). */
  publish: (agentId: string, bump?: VersionBump) => Promise<PublishResult>;
  deploy: (agentId: string, version: string, env: EnvironmentName, note: string) => Promise<DeployOutcome>;
  rollback: (agentId: string, env: EnvironmentName) => Promise<DeployOutcome | null>;
  /** A version's config from the server (cached on the agent once loaded). */
  loadVersionConfig: (agentId: string, version: string) => Promise<AgentConfig>;
  refreshAgents: () => Promise<void>;
  refreshAgent: (id: string) => Promise<Agent | undefined>;
}

const StudioContext = createContext<StudioValue | null>(null);

const emptyDraft = (summary: BotSummary): Draft => ({
  bot_id: summary.id,
  revision: summary.draft_revision ?? 0,
  saved_at: summary.draft_saved_at ?? '',
  saved_by: '',
  config: {},
});

interface StudioProviderProps {
  children: React.ReactNode;
}

export function StudioProvider({ children }: StudioProviderProps) {
  const { user } = useAuth();
  const who = user?.name ?? 'Unknown';

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [technicalNames, setTechnicalNames] = useState(false);
  const [activeEnvironment, setActiveEnvironment] = useState<EnvironmentName>('development');

  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('weave_pinned_agents');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const togglePinAgent = useCallback((id: string) => {
    setPinnedAgentIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem('weave_pinned_agents', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const [savedFilters, setSavedFilters] = useState<{ id: string; name: string; filter: string }[]>([
    { id: 'f1', name: 'Handovers only', filter: 'outcome:handed_over' },
    { id: 'f2', name: 'Cut off / Unfinished', filter: 'outcome:cut_off' },
    { id: 'f3', name: 'Web Voice Calls', filter: 'channel:web_voice' },
  ]);

  const saveFilter = useCallback((name: string, filter: string) => {
    setSavedFilters((prev) => [...prev, { id: `sf_${randomHex(4)}`, name, filter }]);
  }, []);

  const deleteFilter = useCallback((id: string) => {
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const addNotification = useCallback((n: Omit<JobNotification, 'id' | 'timestamp' | 'read'>) => {
    setNotifications((prev) => [
      {
        ...n,
        id: `notif_${randomHex(6)}`,
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...prev,
    ]);
  }, []);

  const agentsRef = useRef<Agent[]>(agents);
  agentsRef.current = agents;

  const commit = useCallback((next: Agent[]) => {
    agentsRef.current = next;
    setAgents(next);
  }, []);

  const updateAgent = useCallback(
    (id: string, fn: (a: Agent) => Agent) => commit(agentsRef.current.map((a) => (a.id === id ? fn(a) : a))),
    [commit]
  );

  const log = useCallback(
    (action: ActivityAction, agentId: string, detail: string) => {
      setActivity((prev) => {
        const item: ActivityItem = { id: `act_${randomHex(6)}`, at: new Date().toISOString(), who, action, agentId, detail };
        const top = prev[0];
        const mergeable =
          action === 'saved' &&
          top &&
          top.action === 'saved' &&
          top.agentId === agentId &&
          top.who === who &&
          Date.now() - new Date(top.at).getTime() < 10 * 60000;
        return mergeable ? [item, ...prev.slice(1)] : [item, ...prev];
      });
    },
    [who]
  );

  const logAudit = useCallback(
    (action: ActivityAction, agentId: string, detail: string) => {
      log(action, agentId, detail);
    },
    [log]
  );

  // Helper to load full bot details from server
  const fetchFullBot = useCallback(async (summary: BotSummary): Promise<Agent> => {
    try {
      const [draftRes, versionsRes, deploymentsRes] = await Promise.allSettled([
        api.getDraft(summary.id),
        api.listVersions(summary.id),
        api.listDeployments(summary.id),
      ]);

      let draft: Draft;
      let loadError: string | undefined;
      if (draftRes.status === 'fulfilled') {
        draft = {
          bot_id: summary.id,
          revision: draftRes.value.revision,
          saved_at: draftRes.value.saved_at,
          saved_by: draftRes.value.saved_by || 'Unknown',
          config: draftRes.value.config as AgentConfig,
        };
      } else {
        // No invented config: the agent says it could not be loaded and is not editable until it is.
        loadError = draftRes.reason instanceof Error ? draftRes.reason.message : 'The draft could not be loaded.';
        draft = emptyDraft(summary);
      }

      const versions: Version[] =
        versionsRes.status === 'fulfilled' && Array.isArray(versionsRes.value)
          ? versionsRes.value
              .map((v) => ({
                version: v.version,
                published_at: v.published_at,
                published_by: v.published_by || 'Server',
                checksum: v.checksum || '',
              }))
              .sort((a, b) => b.published_at.localeCompare(a.published_at))
          : [];
      // The newest version's config, for "changes since published". Older ones load when first needed.
      if (versions[0]) {
        try {
          const newest = await api.getVersion(summary.id, versions[0].version);
          versions[0] = { ...versions[0], config: newest.config as AgentConfig };
        } catch {
          // Leave it unloaded: counts of unpublished changes then say they could not be counted.
        }
      }

      const deployments: Deployment[] =
        deploymentsRes.status === 'fulfilled' && Array.isArray(deploymentsRes.value?.history)
          ? deploymentsRes.value.history.map((d: any) => ({
              id: d.id,
              status: d.status as any,
              environment: d.environment as EnvironmentName,
              version: d.version,
              previous_version: d.previous_version ?? null,
              deployed_at: d.deployed_at,
              deployed_by: d.deployed_by || 'Server',
              note: d.note || '',
            }))
          : [];

      return {
        id: summary.id,
        name: summary.name,
        starter: 'custom',
        draft,
        loadError,
        versions,
        deployments,
      };
    } catch (err: unknown) {
      return {
        id: summary.id,
        name: summary.name,
        starter: 'custom',
        draft: emptyDraft(summary),
        loadError: err instanceof Error ? err.message : 'The agent could not be loaded.',
        versions: [],
        deployments: [],
      };
    }
  }, []);

  // Refresh entire agent list from the real API
  const refreshAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaries = await api.listBots();
      const fullBots = await Promise.all(summaries.map(fetchFullBot));
      commit(fullBots);

      // Build real activity and notifications from the fetched bots
      const activities: ActivityItem[] = [];
      const notifs: JobNotification[] = [];

      fullBots.forEach((bot) => {
        if (bot.draft.saved_at) {
          activities.push({
            id: `act_${bot.id}_saved`,
            at: bot.draft.saved_at,
            who: bot.draft.saved_by || 'Server',
            action: 'saved',
            agentId: bot.id,
            detail: `Saved draft rev ${bot.draft.revision}`,
          });
        }
        bot.versions.forEach((v) => {
          activities.push({
            id: `act_${bot.id}_v_${v.version}`,
            at: v.published_at,
            who: v.published_by,
            action: 'published',
            agentId: bot.id,
            detail: `Published version ${v.version}`,
          });
        });
        bot.deployments.forEach((d) => {
          activities.push({
            id: `act_${bot.id}_d_${d.id}`,
            at: d.deployed_at,
            who: d.deployed_by,
            action: 'deployed',
            agentId: bot.id,
            detail: `Deployed ${d.version} to ${d.environment}`,
          });
          notifs.push({
            id: `notif_${d.id}`,
            title: `Deployment ${d.status === 'active' ? 'Active' : d.status} · ${d.environment}`,
            description: `${d.version} for ${bot.name} (${d.deployed_by}).`,
            timestamp: d.deployed_at,
            type: 'deploy',
            status: d.status === 'active' ? 'success' : d.status === 'failed' ? 'failed' : 'running',
            read: true,
            link: `/agents/${bot.id}/release`,
          });
        });
      });

      activities.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      notifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setActivity(activities);
      setNotifications(notifs);
    } catch (err: any) {
      setError(err?.message || 'Could not load agents from server.');
    } finally {
      setLoading(false);
    }
  }, [commit, fetchFullBot]);

  // Initial load
  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const refreshAgent = useCallback(
    async (id: string): Promise<Agent | undefined> => {
      try {
        const summary = await api.getBot(id);
        const full = await fetchFullBot(summary);
        updateAgent(id, () => full);
        return full;
      } catch {
        return agentsRef.current.find((a) => a.id === id);
      }
    },
    [fetchFullBot, updateAgent]
  );

  const getAgent = useCallback((id: string) => agents.find((a) => a.id === id), [agents]);

  const createAgent = useCallback(
    async ({ id, name, company, starterId }: CreateInput): Promise<Agent> => {
      const starter = starters.find((s) => s.id === starterId) ?? starters[0];

      // The server makes the agent with a minimal valid draft; a starter (other than Blank) is laid on top of it.
      const created = await api.createBot({ id, name });
      let draft: Draft = {
        bot_id: id,
        revision: created.revision,
        saved_at: created.saved_at,
        saved_by: created.saved_by,
        config: created.config as AgentConfig,
      };
      if (starter.id !== 'blank') {
        const languages = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
        const saved = await api.saveDraft(id, applyStarter(draft.config, { company, starter, languages }), created.revision);
        draft = { bot_id: id, revision: saved.draft.revision, saved_at: saved.draft.saved_at, saved_by: saved.draft.saved_by, config: saved.draft.config as AgentConfig };
      }

      const agent: Agent = {
        id,
        name,
        starter: starter.id,
        draft,
        versions: [],
        deployments: [],
      };

      commit([agent, ...agentsRef.current]);
      log('created', id, `Created from ${starter.name} starter`);
      return agent;
    },
    [commit, log]
  );

  // Saves to the server and reports what the server said: the new revision, or a conflict with the draft someone else
  // saved first. Never invents a revision, and never overwrites the caller's edits.
  const saveDraft = useCallback(
    async (agentId: string, config: AgentConfig, baseRevision: number | null): Promise<SaveResult> => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (!agent) throw new Error(`Unknown agent ${agentId}`);

      try {
        const res = await api.saveDraft(agentId, config, baseRevision);
        const draft: Draft = {
          bot_id: agentId,
          revision: res.draft.revision,
          saved_at: res.draft.saved_at,
          saved_by: res.draft.saved_by,
          config: (res.draft.config as AgentConfig) || config,
        };
        updateAgent(agentId, (a) => ({
          ...a,
          name: config.meta?.name?.trim() || a.name,
          draft,
        }));
        log('saved', agentId, `Saved draft revision ${draft.revision}`);
        return { ok: true, draft, validation: res.validation };
      } catch (err: unknown) {
        if (err instanceof ApiError && err.kind === 'conflict') {
          const latest = await api.getDraft(agentId);
          const serverDraft: Draft = {
            bot_id: agentId,
            revision: latest.revision,
            saved_at: latest.saved_at,
            saved_by: latest.saved_by,
            config: latest.config as AgentConfig,
          };
          updateAgent(agentId, (a) => ({ ...a, draft: serverDraft }));
          return { ok: false, conflict: serverDraft };
        }
        throw err;
      }
    },
    [updateAgent, log]
  );

  // Publishes the saved draft and reports what the server froze. Nothing is shown before the server answers.
  const publish = useCallback(
    async (agentId: string, bump?: VersionBump): Promise<PublishResult> => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (!agent) throw new Error(`Unknown agent ${agentId}`);

      // No local gate: the server decides, and its 422 (with the problems) is what stops a publish.
      try {
        const res = await api.publish(agentId, bump);
        await refreshAgent(agentId);
        log('published', agentId, `Published ${res.version}`);
        addNotification({
          title: `Version ${res.version} Published`,
          description: `Version ${res.version} for ${agent.name} is ready to deploy.`,
          type: 'deploy',
          status: 'success',
          link: `/agents/${agentId}/release`,
        });
        return {
          ok: true,
          version: { version: res.version, published_at: res.published_at, published_by: res.published_by, checksum: res.checksum },
          warnings: (res.warnings ?? []).map(toIssue),
          secrets_required: res.secrets_required ?? [],
        };
      } catch (err: unknown) {
        if (err instanceof ApiError && err.kind === 'invalid' && err.errors.length) return { ok: false, errors: err.errors.map(toIssue) };
        return { ok: false, errors: [{ path: null, message: err instanceof Error ? err.message : 'The server did not publish this draft.' }] };
      }
    },
    [refreshAgent, log, addNotification]
  );

  // Points an environment at a version. Resolves with the deployment once it is active or failed (the API may answer
  // "pending" first and finish later; then this polls GET /deployments/{id}), plus the server's preflight report.
  const deploy = useCallback(
    async (agentId: string, version: string, env: EnvironmentName, note: string): Promise<DeployOutcome> => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (!agent) throw new Error(`Unknown agent ${agentId}`);

      const res = await api.deploy(agentId, { version, environment: env, note });
      let dep = res.deployment;
      for (let tries = 0; dep.status === 'pending' && tries < 120; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        dep = await api.getDeployment(agentId, dep.id);
      }
      await refreshAgent(agentId);

      const deployment: Deployment = {
        id: dep.id,
        status: dep.status,
        environment: dep.environment as EnvironmentName,
        version: dep.version,
        previous_version: dep.previous_version,
        deployed_at: dep.deployed_at,
        deployed_by: dep.deployed_by,
        note: dep.note || '',
      };
      if (deployment.status === 'active') {
        addNotification({
          title: `Deployment Active · ${env.charAt(0).toUpperCase() + env.slice(1)}`,
          description: `${version} for ${agent.name} is now live.`,
          type: 'deploy',
          status: 'success',
          link: `/agents/${agentId}/release`,
        });
        log('deployed', agentId, `Deployed ${version} to ${env}`);
      }
      return { deployment, preflight: res.preflight };
    },
    [refreshAgent, log, addNotification]
  );

  const rollback = useCallback(
    async (agentId: string, env: EnvironmentName): Promise<DeployOutcome | null> => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      const current = agent ? currentDeployments(agent)[env] : undefined;
      if (!current?.previous_version) return null;
      return deploy(agentId, current.previous_version, env, `Rollback from ${current.version}`);
    },
    [deploy]
  );

  const loadVersionConfig = useCallback(
    async (agentId: string, version: string): Promise<AgentConfig> => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (version === 'draft' && agent) return agent.draft.config;
      const cached = agent?.versions.find((v) => v.version === version)?.config;
      if (cached) return cached;
      const res = await api.getVersion(agentId, version);
      const config = res.config as AgentConfig;
      updateAgent(agentId, (a) => ({
        ...a,
        versions: a.versions.map((v) => (v.version === version ? { ...v, config } : v)),
      }));
      return config;
    },
    [updateAgent]
  );

  const value = useMemo(
    () => ({
      agents,
      activity,
      loading,
      error,
      technicalNames,
      setTechnicalNames,
      activeEnvironment,
      setActiveEnvironment,
      pinnedAgentIds,
      togglePinAgent,
      savedFilters,
      saveFilter,
      deleteFilter,
      notifications,
      unreadCount,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      addNotification,
      logAudit,
      getAgent,
      createAgent,
      saveDraft,
      publish,
      deploy,
      rollback,
      loadVersionConfig,
      refreshAgents,
      refreshAgent,
    }),
    [
      agents,
      activity,
      loading,
      error,
      technicalNames,
      activeEnvironment,
      pinnedAgentIds,
      togglePinAgent,
      savedFilters,
      saveFilter,
      deleteFilter,
      notifications,
      unreadCount,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      addNotification,
      logAudit,
      getAgent,
      createAgent,
      saveDraft,
      publish,
      deploy,
      rollback,
      loadVersionConfig,
      refreshAgents,
      refreshAgent,
    ]
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used inside StudioProvider');
  return ctx;
}