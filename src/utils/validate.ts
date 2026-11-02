// Plain-language readers and labels for a config. The checks themselves are the server's (POST /validate, see
// serverValidation.ts): the studio no longer keeps its own list of what makes a config valid.
import type { AgentConfig, ChannelType, Issue, Path } from '../types/studio';
import { settingsCatalog } from '../data/settingsCatalog';
import { pathKey } from './path';
import { labelPath } from '../models/validationIssues';

const channelLabels: Record<ChannelType, string> = {
  web_chat: 'Web chat',
  web_voice: 'Web voice',
  sip_voice: 'Phone',
  whatsapp: 'WhatsApp',
  sms: 'Text message',
  email: 'Email',
  custom: 'Custom channel'
};
export const channelLabel = (type: ChannelType): string => channelLabels[type] ?? type;

export function getGreetingText(greeting: unknown): string {
  if (typeof greeting === 'string') return greeting;
  if (greeting && typeof greeting === 'object') {
    const g = greeting as Record<string, unknown>;
    if (typeof g.say === 'string') return g.say;
    if (typeof g.text === 'string') return g.text;
    if (typeof g.message === 'string') return g.message;
  }
  return '';
}

export function getInstructionsText(instructions: unknown): string {
  if (typeof instructions === 'string') return instructions;
  if (instructions && typeof instructions === 'object') {
    const ins = instructions as Record<string, unknown>;
    if (typeof ins.role === 'string') return ins.role;
    if (typeof ins.text === 'string') return ins.text;
    if (typeof ins.system === 'string') return ins.system;
  }
  return '';
}

// Plain names for places the server's checks can point at that are not single settings in the catalogue.
const PLACES: Record<string, string> = {
  guardrails: 'Guardrails',
  'guardrails.topics': 'Guardrails › Topics',
  'guardrails.topics.allowed': 'Guardrails › What it talks about',
  'guardrails.topics.blocked': 'Guardrails › What it must not talk about',
  'guardrails.topics.on_off_topic': 'Guardrails › When someone keeps going off topic',
  'guardrails.escalation': 'Guardrails › A hand-over or ending rule',
  'guardrails.input': 'Guardrails › A check on what the caller says',
  'guardrails.output': 'Guardrails › A check on what it says',
  'guardrails.limits': 'Guardrails › Limits',
  'guardrails.limits.max_call_duration_s': 'Guardrails › Longest call',
  'guardrails.limits.max_silence_s': 'Guardrails › Longest silence',
  'guardrails.limits.max_tool_calls_per_call': 'Guardrails › Most tool uses in one call',
  'guardrails.limits.max_handoffs_per_call': 'Guardrails › Most moves between agents',
  'guardrails.limits.say': 'Guardrails › What it says when a limit ends the call',
  post_call: 'After the call',
  'post_call.summary': 'After the call › Summary',
  'post_call.analysis': 'After the call › Questions about each call',
  'post_call.recording': 'After the call › Recording',
  'post_call.redaction': 'After the call › Hiding sensitive details',
  'defaults.models.tts': 'Voice',
  'defaults.models.llm': 'AI model',
  'defaults.models.stt': 'Speech recognition',
  'defaults.language': 'Language',
  tools: 'What it can do',
  knowledge: 'What it knows',
  telephony: 'Phone transfers',
  forms: 'Forms',
  messages: 'Fixed lines',
};

export function describePath(path: Path, config: AgentConfig): string {
  const key = pathKey(path);
  const def = settingsCatalog.find((s) => s.path === key);
  if (def) return def.label;
  // the closest named place, ignoring list positions
  const shape = path.filter((p) => typeof p === 'string');
  for (let n = shape.length; n > 0; n--) {
    const place = PLACES[shape.slice(0, n).join('.')];
    if (place && path[0] !== 'channels' && path[0] !== 'agents') return place;
  }
  if (path[0] === 'channels' && typeof path[1] === 'number') {
    const ch = config.channels?.[path[1]];
    return ch ? `${channelLabel(ch.type)} › ${path[2] === 'greeting' ? 'Greeting' : String(path[2] ?? '')}` : key;
  }
  if (path[0] === 'agents' && path[1] === 'items' && typeof path[2] === 'number') {
    const a = config.agents?.items?.[path[2]];
    const field = path[3] === 'tools' ? 'Tools' : path[3] === 'instructions' ? 'Instructions' : String(path[3] ?? '');
    return `${a?.name ?? 'Role'} › ${field}`;
  }
  // anything else by the plain labels of what holds it
  return labelPath(config, null, path).text || key;
}

export function issuesAt(issues: Issue[], path: Path | string): Issue[] {
  const key = typeof path === 'string' ? path : pathKey(path);
  return issues.filter((i) => i.path && (pathKey(i.path) === key || pathKey(i.path).startsWith(`${key}.`)));
}