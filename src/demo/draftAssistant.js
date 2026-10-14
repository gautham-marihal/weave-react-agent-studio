// "Describe an agent and get a draft": turns a few sentences of requirements into an agent configuration to review and edit.
//
// THIS IS NOT AN AI MODEL. It reads the description with simple rules (keywords for what kind of agent, which channels, languages, tone;
// sentences that say "never…" or "always…" become rules) and fills in a starter and a few fields. That is why every screen that shows
// its result says so, lists what it ASSUMED, and lists what it could not decide (the questions). A real assistant would be another
// `generate` with the same inputs and outputs: { config, summary, assumptions, questions, source }, behind `ASSISTANT`.
// Pure: no network, no DOM, no randomness.

import { STARTERS, addPersonHandoff, applyStarter } from '../studio/starters.js';
import { buildChannel } from '../studio/form/presets.js';
import { setProvider } from '../studio/models/config.js';
import { baseOf } from '../studio/form/messages.js';
import { languageName } from '../studio/simple/simpleModel.js';

export const ASSISTANT = {
  kind: 'demo-rules',
  label: 'Demo assistant',
  isAi: false,
  description: 'Builds a first draft from your description with simple rules in your browser. It is not an AI model and does not understand what you wrote beyond keywords, so read and edit everything it makes.',
};

export const MIN_DESCRIPTION = 15;

// What kind of agent: the starter whose words are mentioned most.
const KINDS = [
  ['support', ['support', 'help desk', 'helpdesk', 'customer', 'complaint', 'issue', 'refund', 'order', 'billing', 'bill ', 'problem', 'ticket', 'troubleshoot', 'account'], 'customer care'],
  ['receptionist', ['front desk', 'reception', 'receptionist', 'visitor', 'directions', 'route calls', 'who to speak', 'greet', 'switchboard'], 'front desk'],
  ['knowledge', ['faq', 'frequently asked', 'knowledge', 'policies', 'policy', 'documentation', 'answer questions', 'information about'], 'knowledge guide'],
  ['lead', ['lead', 'sales', 'prospect', 'interested in', 'quote', 'demo request', 'capture details', 'contact details'], 'lead concierge'],
  ['appointment', ['book', 'appointment', 'schedule', 'reservation', 'booking', 'slot', 'clinic', 'salon', 'table for'], 'booking concierge'],
  ['feedback', ['feedback', 'survey', 'rating', 'nps', 'how we did', 'review'], 'feedback collector'],
];
const LANGS = { spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', dutch: 'nl', hindi: 'hi', arabic: 'ar', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', swahili: 'sw', indonesian: 'id', turkish: 'tr', polish: 'pl', swedish: 'sv' };
const LOCALE_OF = { es: 'es-ES', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT', nl: 'nl-NL', hi: 'hi-IN', ar: 'ar-SA', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', sw: 'sw-KE', id: 'id-ID', tr: 'tr-TR', pl: 'pl-PL', sv: 'sv-SE' };
const TONES = ['friendly', 'warm', 'formal', 'professional', 'casual', 'calm', 'upbeat', 'empathetic', 'concise', 'patient', 'playful', 'polite', 'reassuring', 'direct', 'cheerful'];

const sentences = (text) => String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const has = (text, words) => words.some((w) => text.includes(w));
const shorten = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

// -> { ok: false, problem } or { ok: true, config, summary, assumptions, questions, source }.
// `base` is the configuration the draft is made from (a new agent's minimal draft); its id and version are kept.
export function generateDraft(description, base, { name } = {}) {
  const raw = String(description || '').trim();
  if (raw.length < MIN_DESCRIPTION) return { ok: false, problem: 'Describe what the agent should do in a sentence or two, for example who it talks to and what it helps with.' };
  if (!base || typeof base !== 'object') return { ok: false, problem: 'There is no draft to build on.' };
  const text = raw.toLowerCase();
  const assumptions = []; const questions = [];

  // 1. what kind of agent
  const scored = KINDS.map(([id, words, label]) => ({ id, label, score: words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
  const kind = scored[0].score > 0 ? scored[0] : { id: 'support', label: 'customer care', score: 0 };
  assumptions.push(scored[0].score > 0 ? `Started from the “${STARTERS.find((s) => s.id === kind.id).label}” starter because the description mentions ${KINDS.find(([id]) => id === kind.id)[1].filter((w) => text.includes(w)).slice(0, 3).map((w) => `“${w.trim()}”`).join(', ')}.` : 'Nothing in the description says what kind of agent this is, so it started from the “Customer care” starter.');
  let config = applyStarter(base, kind.id);

  // 2. name and company
  const named = /\b(?:called|named)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/.exec(raw);
  const company = /\b(?:for|at|of)\s+((?:[A-Z][\w&.-]*)(?:\s+[A-Z][\w&.-]*){0,3})/.exec(raw);
  const agentName = named ? named[1] : name || config.meta?.name || 'Assistant';
  if (named) assumptions.push(`The agent is called ${agentName}, as the description says.`);
  config.persona = { ...config.persona, name: agentName };
  const notACompany = new Set([...Object.keys(LANGS), 'english', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
  if (company && company[1].length > 1 && !notACompany.has(company[1].toLowerCase().split(' ')[0])) { config.persona.company = company[1]; assumptions.push(`The company is ${company[1]}.`); }
  if (named) config.meta = { ...config.meta, name: agentName };

  // 3. channels
  const voiceWords = ['voice', 'phone', 'call', 'calls', 'calling', 'dial', 'ring'];
  const chatWords = ['chat', 'website', 'widget', 'web chat', 'text'];
  const voice = has(text, voiceWords.map((w) => ` ${w}`)) || has(text, ['phone', 'voice', 'calls']);
  const chat = has(text, chatWords);
  const wanted = [];
  if (voice) wanted.push('phone');
  if (chat || !voice) wanted.push('web_chat');
  if (text.includes('whatsapp')) wanted.push('whatsapp');
  if (/\bsms\b/.test(text)) wanted.push('sms');
  if (/\be-?mail\b/.test(text)) wanted.push('email');
  const taken = [];
  const channels = [];
  [...new Set(wanted)].forEach((preset) => {
    // keep the draft's own web chat; build the others from presets
    const existing = preset === 'web_chat' ? (config.channels || []).find((c) => c.type === 'web_chat') : null;
    const channel = existing || buildChannel(preset, { taken, botId: config.meta?.id || '' });
    taken.push(channel.id); channels.push(channel);
  });
  config.channels = channels;
  const starter = STARTERS.find((item) => item.id === kind.id);
  config.channels.forEach((c) => { if (c.greeting && typeof c.greeting.say === 'string' && starter?.greeting) c.greeting.say = starter.greeting(agentName); });
  assumptions.push(`Reachable by ${channels.map((c) => c.id.replace(/_/g, ' ')).join(' and ')}${voice ? '' : ', since no channel was mentioned'}.`);
  if (channels.some((c) => ['sip_voice', 'web_voice'].includes(c.type))) {
    config = setProvider(setProvider(config, 'stt', 'openai'), 'tts', 'openai');
    assumptions.push('Speech uses OpenAI for listening and speaking, because voice needs both. Change it under AI Model.');
    config.persona = { ...config.persona, disclosures: { ...(config.persona.disclosures || {}), recording_notice: 'This call may be recorded to improve our service.' } };
    assumptions.push('A recording notice was added because the agent speaks. Remove it if calls are not recorded.');
  }

  // 4. languages
  const spoken = Object.entries(LANGS).filter(([word]) => text.includes(word)).map(([, code]) => code);
  const english = text.includes('english') || !spoken.length;
  if (spoken.length) {
    const speaks = [...new Set([...(english ? ['en'] : []), ...spoken])];
    const primary = english ? 'en-US' : LOCALE_OF[spoken[0]];
    config.defaults = { ...config.defaults, language: { primary, speaks } };
    assumptions.push(`It speaks ${speaks.map((c) => languageName(c)).join(' and ')}; the primary language is ${languageName(primary)}. Its fixed lines are written in English only: add the other languages under Messages.`);
    questions.push(`The fixed lines (greeting, goodbye) are in English. Write them in ${spoken.map((c) => languageName(c)).join(', ')} under Messages.`);
  }

  // 5. tone
  const tones = TONES.filter((t) => text.includes(t));
  if (tones.length) { config.persona = { ...config.persona, tone: tones.join(', ') }; assumptions.push(`Tone: ${tones.join(', ')}.`); }
  else assumptions.push(`Tone: “${config.persona.tone}”, from the starter, since the description doesn’t say.`);

  // 6. rules the description states
  const rules = sentences(raw).filter((s) => /\b(never|always|must|must not|do not|don'?t|should not|shouldn'?t|only)\b/i.test(s)).slice(0, 5);
  const entry = (config.agents?.items || []).find((a) => a.id === config.agents?.entry) || config.agents?.items?.[0];
  if (entry && rules.length) { entry.instructions = { ...entry.instructions, rules: [...(entry.instructions?.rules || []), ...rules] }; assumptions.push(`${rules.length} sentence${rules.length === 1 ? '' : 's'} that sound like rules ${rules.length === 1 ? 'was' : 'were'} added as rules: ${rules.map((r) => `“${shorten(r, 50)}”`).join('; ')}.`); }

  // 7. a person to hand over to
  if (has(text, ['human', 'person', 'escalat', 'transfer', 'agent to take over', 'representative', 'someone'])) {
    if (!(config.tools || []).some((t) => t.builtin === 'transfer_or_callback')) { config = addPersonHandoff(config); assumptions.push('It can pass callers to a person: a transfer was added with no number yet, so callers hear a fallback line until you set one under Telephony.'); }
    questions.push('Which number should callers be transferred to? Set it on the transfer under Telephony.');
  }

  // 8. the role carries the description itself
  const target = (config.agents?.items || []).find((a) => a.id === config.agents?.entry) || config.agents?.items?.[0];
  if (target) target.instructions = { ...target.instructions, role: `${target.instructions?.role || ''}\n\nAbout this agent, in the words of whoever asked for it:\n${raw}`.trim() };
  config.meta = { ...config.meta, description: shorten(sentences(raw)[0] || raw, 140) };

  // 9. what it could not decide
  if (has(text, ['order', 'status', 'account', 'lookup', 'look up', 'balance', 'crm', 'database', 'calendar', 'inventory', 'api', 'system'])) questions.push('It mentions looking things up. Which system should it use? Add an HTTP connection and a tool for it under Connections; this draft has no tools for lookups.');
  if (has(text, ['card number', 'pin', 'password', 'otp', 'one-time code', 'ssn', 'social security'])) questions.push('It mentions secrets (card numbers, PINs, codes). Mark such state variables “sensitive”; note that the runtime does not enforce that yet.');
  if (has(text, ['hours', 'open ', 'closed', 'weekend', 'business hours'])) questions.push('It mentions opening hours. Add a schedule and use it to decide when to transfer.');
  if (!has(text, ['bye', 'goodbye', 'end the call', 'hang up'])) assumptions.push('It ends the conversation with a goodbye line when the caller is finished (from the starter).');
  questions.push('Read the role and the rules, and try the draft in the preview before you rely on it.');

  const summary = {
    kind: STARTERS.find((s) => s.id === kind.id)?.label || kind.label,
    name: config.persona.name,
    channels: channels.map((c) => c.id),
    languages: (config.defaults?.language?.speaks || ['en']).map((c) => baseOf(c)),
    tone: config.persona.tone,
    rules: (entry?.instructions?.rules || []).length,
    tools: (config.tools || []).map((t) => t.id),
  };
  return { ok: true, config, summary, assumptions, questions, source: ASSISTANT.kind };
}
