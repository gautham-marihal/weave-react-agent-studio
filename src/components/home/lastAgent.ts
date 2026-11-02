// The agent opened last, kept in this browser so Home's "Next step" starts from it.

const LAST_AGENT_KEY = 'weave_last_agent';

export function rememberLastAgent(agentId: string): void {
  try {
    localStorage.setItem(LAST_AGENT_KEY, agentId);
  } catch {
    // storage unavailable: Home falls back to the agent saved last
  }
}

export function lastAgentId(): string {
  try {
    return localStorage.getItem(LAST_AGENT_KEY) ?? '';
  } catch {
    return '';
  }
}
