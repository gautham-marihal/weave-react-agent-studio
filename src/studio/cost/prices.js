import { useSyncExternalStore } from 'react';

// What the parts of a call cost, to estimate what an agent costs to run. Prices are in US dollars:
//   llm: per million tokens, in and out     stt: per minute of audio heard     tts: per million characters spoken
// The starting prices are the providers' public list prices as we last checked them (PRICES_REVIEWED). A price that depends on a plan or a contract
// (ElevenLabs, Cartesia, Anthropic's newest models...) is left out rather than guessed: the page asks for it. Every price can be changed, and the changes
// are kept in this browser (`weave_prices_v1`), so a team can put in what it actually pays.

export const PRICES_REVIEWED = '2026-10-20';

export const STARTING_PRICES = {
  llm: {
    'openai/gpt-4.1': { input: 2, output: 8 },
    'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'openai/gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'openai/gpt-4o': { input: 2.5, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
    'google/gemini-2.0-flash': { input: 0.1, output: 0.4 },
    'google/gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'google/gemini-2.5-pro': { input: 1.25, output: 10 },
    'groq/llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
    'groq/llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  },
  stt: {
    'deepgram/nova-3': { minute: 0.0077 },
    'deepgram/nova-2': { minute: 0.0058 },
    'openai/whisper-1': { minute: 0.006 },
    'openai/gpt-4o-transcribe': { minute: 0.006 },
    'openai/gpt-4o-mini-transcribe': { minute: 0.003 },
  },
  tts: {
    'openai/tts-1': { million: 15 },
    'openai/tts-1-hd': { million: 30 },
    'deepgram/aura-2-thalia-en': { million: 30 },
    'deepgram/aura-asteria-en': { million: 15 },
  },
};

// The fields of a price, by stage, and how each reads.
export const PRICE_FIELDS = {
  llm: [
    { key: 'input', label: 'In', unit: 'per 1M tokens' },
    { key: 'output', label: 'Out', unit: 'per 1M tokens' },
  ],
  stt: [{ key: 'minute', label: 'Per minute', unit: 'of audio' }],
  tts: [{ key: 'million', label: 'Per 1M', unit: 'characters' }],
};
export const STAGE_NAMES = { llm: 'Language model', stt: 'Listening (speech to text)', tts: 'Speaking (text to speech)' };

export const priceKey = (provider, model) => `${String(provider || '').toLowerCase()}/${String(model || '')}`;

const valid = (stage, price) =>
  price &&
  typeof price === 'object' &&
  PRICE_FIELDS[stage].every((f) => typeof price[f.key] === 'number' && Number.isFinite(price[f.key]) && price[f.key] >= 0);

// The prices in use: the starting ones, with the person's own on top (a null removes a starting price).
export function mergePrices(own = {}) {
  const out = {};
  Object.keys(STARTING_PRICES).forEach((stage) => {
    out[stage] = { ...STARTING_PRICES[stage] };
    Object.entries(own?.[stage] || {}).forEach(([key, price]) => {
      if (price === null) delete out[stage][key];
      else if (valid(stage, price)) out[stage][key] = price;
    });
  });
  return out;
}

// The price of a model: by provider and model, or by the model alone when the provider is written differently (a call may say "api.openai.com").
export function priceFor(prices, stage, provider, model) {
  const table = prices?.[stage] || {};
  const exact = table[priceKey(provider, model)];
  if (exact) return exact;
  const name = String(model || '');
  if (!name) return null;
  const byModel = Object.entries(table).filter(([key]) => key.slice(key.indexOf('/') + 1) === name);
  return byModel.length === 1 ? byModel[0][1] : null;
}

// ---- kept in this browser --------------------------------------------------------------------------------------------------------------------------
const KEY = 'weave_prices_v1';
const listeners = new Set();
let saved = null;
function read() {
  if (saved) return saved;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    saved = raw && typeof raw === 'object' ? raw : {};
  } catch {
    saved = {};
  }
  return saved;
}
function write(next) {
  saved = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept for this page only */
  }
  listeners.forEach((l) => l());
}
const subscribe = (listener) => {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === KEY) {
      saved = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
const EMPTY = {};
// [own prices, prices in use]
export function usePrices() {
  const own = useSyncExternalStore(subscribe, read, () => EMPTY);
  return own;
}
export const setPrice = (stage, key, price) => write({ ...read(), [stage]: { ...(read()[stage] || {}), [key]: price } });
export const resetPrice = (stage, key) => {
  const mine = { ...(read()[stage] || {}) };
  delete mine[key];
  write({ ...read(), [stage]: mine });
};
export const resetAllPrices = () => write({});
export const ownPriceCount = (own) => Object.values(own || {}).reduce((n, stage) => n + Object.keys(stage || {}).length, 0);
export function resetPricesForTests() {
  saved = null;
}
