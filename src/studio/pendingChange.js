// A change another page asks for on an agent's draft ("use this voice", "apply this starter"). Queued, applied when
// the agent's Config tab opens, and left unsaved so the person reviews it first.

import { applyStarter, starterById } from './starters.ts';

const KEY = 'weave_pending_change';

export function queueChange(botId, change) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ botId, ...change }));
  } catch {
    /* the change is simply not carried over */
  }
}

export function takeChange(botId) {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const change = JSON.parse(raw);
    if (change.botId !== botId) return null;
    window.sessionStorage.removeItem(KEY);
    return change;
  } catch {
    return null;
  }
}

const TTS_DEFAULT_MODEL = { elevenlabs: 'eleven_multilingual_v2', cartesia: 'sonic-3', openai: 'gpt-4o-mini-tts' };

// Returns { config, note, where } or null when there is nothing to change.
export function applyChange(config, change) {
  if (!config || !change) return null;
  if (change.kind === 'starter') {
    const starter = starterById(change.starter);
    return {
      config: applyStarter(config, starter.id),
      note: `The “${starter.label}” starter is applied to this draft. It couldn’t be saved when the agent was created.`,
      where: ['agents'],
    };
  }
  // a whole draft made when the agent was created: from a description, from your template, or blank (its language only)
  const MADE = {
    assistant: 'The draft made from your description is applied to this agent.',
    template: 'Your template is applied to this agent.',
    blank: 'The agent’s main language is set on this draft.',
  };
  if (MADE[change.kind] && change.config && typeof change.config === 'object') {
    return {
      config: change.config,
      note: `${MADE[change.kind]} It couldn’t be saved when the agent was created.`,
      where: ['agents'],
    };
  }
  if (change.kind === 'voice') {
    const provider = String(change.provider || '').toLowerCase();
    const tts = config.defaults?.models?.tts || {};
    const next = {
      ...tts,
      provider,
      model: provider === tts.provider && tts.model ? tts.model : TTS_DEFAULT_MODEL[provider] || tts.model || '',
      voice_id: change.voiceId || tts.voice_id || '',
    };
    const models = { ...(config.defaults?.models || {}), tts: next };
    return {
      config: { ...config, defaults: { ...(config.defaults || {}), models } },
      note: `Voice “${change.name}” (${change.providerLabel || provider}) is set on this draft.`,
      where: ['defaults', 'models', 'tts'],
    };
  }
  return null;
}
