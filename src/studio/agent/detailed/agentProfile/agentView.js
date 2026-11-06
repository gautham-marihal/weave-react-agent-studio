import { makeViewStore } from '../workspaceView.js';

// How a person sees Build › Agent: 'profile' (the agent as a profile and a sentence, then three chapters) or 'all' (every
// setting in one searchable list). One choice per person, remembered in this browser.
const store = makeViewStore('weave_agent_view', 'profile');
export const setAgentView = store.set;
export const useAgentView = store.use;
