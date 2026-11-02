// "What is running where": for each environment the server has (GET /environments), the agents deployed there and
// their versions. Pure.

export interface RunningAgent {
  id: string;
  name: string;
  version: string;
}

export interface EnvironmentRow {
  env: string;
  label: string;
  agents: RunningAgent[];
}

interface AgentLike {
  id: string;
  name: string;
  deployments: { environment: string; status: string; version: string; deployed_at?: string }[];
}

const ORDER = ['development', 'staging', 'production'];

/** The newest active deployment to an environment: the latest deployed_at, and of equal times the later one listed. */
function latestActive<T extends { environment: string; status: string; deployed_at?: string }>(list: T[], env: string): T | undefined {
  let best: T | undefined;
  list.forEach((d) => {
    if (d.environment !== env || d.status !== 'active') return;
    if (!best || (Date.parse(d.deployed_at ?? '') || 0) >= (Date.parse(best.deployed_at ?? '') || 0)) best = d;
  });
  return best;
}

export const environmentLabel = (env: string): string => (env ? env.charAt(0).toUpperCase() + env.slice(1).replace(/[-_]+/g, ' ') : env);

/**
 * One row per environment: the server's list (in its order, the usual three first), plus any environment an agent is
 * deployed to that the list does not name. Each agent counts once per environment, with its newest active deployment
 * (a history can hold more than one entry marked active for an environment: the latest one is what runs).
 */
export function runningWhere(serverEnvironments: string[] | null, agents: AgentLike[]): EnvironmentRow[] {
  const names: string[] = [];
  const add = (env: string) => {
    if (env && !names.includes(env)) names.push(env);
  };
  (serverEnvironments ?? []).forEach(add);
  agents.forEach((a) => a.deployments.forEach((d) => d.status === 'active' && add(d.environment)));
  names.sort((x, y) => {
    const ix = ORDER.indexOf(x);
    const iy = ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  return names.map((env) => ({
    env,
    label: environmentLabel(env),
    agents: agents.flatMap((a) => {
      const active = latestActive(a.deployments, env);
      return active ? [{ id: a.id, name: a.name || a.id, version: active.version }] : [];
    }),
  }));
}

/** "Acme Support 1.2.0, Billing 0.3.1 and 2 more", or "Nothing deployed". */
export function runningText(row: EnvironmentRow, show = 3): string {
  if (row.agents.length === 0) return 'Nothing deployed';
  const listed = row.agents.slice(0, show).map((a) => `${a.name} ${a.version}`).join(', ');
  return row.agents.length > show ? `${listed} and ${row.agents.length - show} more` : listed;
}
