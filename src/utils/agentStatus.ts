import type { Agent, Deployment, EnvironmentName, Version } from '../types/studio';
import { changesSince } from '../models/changes';

export const environments: EnvironmentName[] = ['development', 'staging', 'production'];

export const envLabel = (env: EnvironmentName): string => env.charAt(0).toUpperCase() + env.slice(1);
export const envShort = (env: EnvironmentName): string => env === 'development' ? 'Dev' : env === 'staging' ? 'Staging' : 'Prod';

/** Newest first, whichever order the server lists them in (it lists oldest first); equal times keep the later one first. */
export function newestFirst(deployments: Deployment[]): Deployment[] {
  return deployments
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (Date.parse(b.d.deployed_at) || 0) - (Date.parse(a.d.deployed_at) || 0) || b.i - a.i)
    .map(({ d }) => d);
}

/** What runs in each environment: its newest active deployment. */
export function currentDeployments(agent: Agent): Partial<Record<EnvironmentName, Deployment>> {
  const out: Partial<Record<EnvironmentName, Deployment>> = {};
  newestFirst(agent.deployments).forEach((d) => {
    if (d.status === 'active' && !out[d.environment]) out[d.environment] = d;
  });
  return out;
}

export const pendingDeployment = (agent: Agent, env: EnvironmentName): Deployment | undefined =>
agent.deployments.find((d) => d.environment === env && d.status === 'pending');

export const liveEnvironments = (agent: Agent): EnvironmentName[] => {
  const current = currentDeployments(agent);
  return environments.filter((e) => current[e]);
};

export const latestVersion = (agent: Agent): Version | undefined => agent.versions[0];

/** Changes in the draft since the newest version; null when that version's config has not been loaded (or the draft). */
export function draftChangeCount(agent: Agent): number | null {
  const latest = latestVersion(agent);
  if (!latest) return 0;
  if (!latest.config || agent.loadError) return null;
  return changesSince(latest.config, agent.draft.config).total;
}
