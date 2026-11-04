// Small helpers the guided setup's parts share: plain checks and copies of values, the agent that answers first,
// and words joined into a list ("Billing, Sales and Support").

import { entryAgentIndex } from '../simple/simpleModel.js';

export const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const list = (v) => (Array.isArray(v) ? v : []);
export const clone = (v) => JSON.parse(JSON.stringify(v));

export const entryOf = (config) => list(config?.agents?.items)[entryAgentIndex(config)] || null;

// "Billing", "Billing and Sales", "Billing, Sales and Support"
export const together = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '');
export const listWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || 'details');
