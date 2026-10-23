// What a person can ADD to a list, written as the job it does rather than the kind it is in the file: "Hand over to a person", not
// "Built-in"; "Look something up in your systems", not "HTTP". Each option says what it is for in a sentence, and the ones the runtime can't run
// yet say so before anything is built. The options are matched to the schema's own branches, so a branch the schema adds later still appears
// (under "More", named by the schema) and nothing the schema has is left out. Pure: no network, no DOM.

import { isObj } from './engine.js';
import { CHANNEL_PRESETS, REACH_WORDS, buildChannel } from './presets.js';
import { UNSUPPORTED_BUILTINS, UNSUPPORTED_KINDS } from './toolInfo.js';
import { uniqueId } from './ctx.js';
import { NOT_RUNNING, notRunningYet } from './channelTypes.js';

const NOT_YET = 'Not available in the runtime yet';
// the plain name when it is free (end_call), else numbered (end_call_2)
const freeId = (taken, base) => (taken.includes(base) ? uniqueId(taken, base) : base);

// ---- tools ----------------------------------------------------------------------------------------------------------------------------------
// kind: the schema's `type`; builtin: which built-in action. `seed` is merged over the schema's own starting value.
const TOOLS = [
  {
    id: 'hand_over',
    group: 'Pass the caller on',
    label: 'Hand over to a person',
    help: 'Pass the caller to someone on your team, or take a callback when nobody is free. It needs a transfer under Phone transfers.',
    kind: 'builtin',
    builtin: 'transfer_or_callback',
    base: 'hand_over',
    seed: { description: 'Use when the caller asks for a person, or you cannot help them.' },
  },
  {
    id: 'back_to_start',
    group: 'Pass the caller on',
    label: 'Send the caller back to the first agent',
    help: 'For a specialist agent: return the caller to the agent who answers first, with a note of what is still needed.',
    kind: 'builtin',
    builtin: 'return_to_entry',
    base: 'back_to_start',
    seed: { description: 'Use when the caller needs something this agent cannot help with.' },
  },
  {
    id: 'end_call',
    group: 'During the call',
    label: 'End the call',
    help: 'Say goodbye and hang up. Give the agent this so it can finish a call by itself.',
    kind: 'builtin',
    builtin: 'end_call',
    base: 'end_call',
    seed: { description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.' },
  },
  {
    id: 'show_form',
    group: 'During the call',
    label: 'Show the caller a form',
    help: 'Collect details such as a name and number on screen. It needs a form under Forms, and a channel that can show forms.',
    kind: 'builtin',
    builtin: 'send_form',
    base: 'show_form',
    seed: { description: 'Use when you need several details from the caller at once.' },
  },
  {
    id: 'lookup',
    group: 'Look something up',
    label: 'Look something up in your systems',
    help: 'Ask a web service you already have, such as an order or billing system, and tell the agent what came back.',
    kind: 'http',
    base: 'lookup',
  },
  {
    id: 'search',
    group: 'Look something up',
    label: 'Search your knowledge',
    help: 'Answer from your documents and web pages. Set the knowledge up first.',
    kind: 'knowledge',
    base: 'search_knowledge',
  },
  {
    id: 'keypad_collect',
    group: 'Keypad',
    label: 'Collect digits the caller presses',
    help: 'Take a PIN or an account number from the keypad.',
    kind: 'builtin',
    builtin: 'collect_dtmf',
    base: 'collect_digits',
    unavailable: UNSUPPORTED_BUILTINS.collect_dtmf,
    seed: { description: 'Use when you need digits the caller types on the keypad.' },
  },
  {
    id: 'keypad_send',
    group: 'Keypad',
    label: 'Press keypad tones',
    help: 'Press digits on a call, for example to get through a menu.',
    kind: 'builtin',
    builtin: 'send_dtmf',
    base: 'send_tones',
    unavailable: UNSUPPORTED_BUILTINS.send_dtmf,
    seed: { description: 'Use to press keypad digits on the call.' },
  },
  {
    id: 'task',
    group: 'Connect other things',
    label: 'Run a multi-step task',
    help: 'Walk the caller through several steps, such as checking who they are and then asking for a code.',
    kind: 'task',
    base: 'task',
    unavailable: UNSUPPORTED_KINDS.task,
  },
  {
    id: 'server',
    group: 'Connect other things',
    label: 'Use another system’s tools',
    help: 'Offer the tools another system publishes (an MCP server) to the agent.',
    kind: 'mcp',
    base: 'server_tools',
    unavailable: UNSUPPORTED_KINDS.mcp,
  },
  {
    id: 'code',
    group: 'Connect other things',
    label: 'Run your own code',
    help: 'For an engineer: call a function you wrote when nothing else fits.',
    kind: 'code',
    base: 'custom_code',
    unavailable: UNSUPPORTED_KINDS.code,
  },
  {
    id: 'rules_only',
    group: 'Other',
    label: 'Only run rules',
    help: 'No action of its own: only its rules run (change what is remembered, hand off). For a conditional hand-off.',
    kind: 'builtin',
    builtin: 'noop',
    base: 'rules_only',
    seed: { description: 'Use when the caller’s request needs only the rules attached to this tool.' },
  },
];

// ---- guardrails -----------------------------------------------------------------------------------------------------------------------------
const GUARDRAILS = {
  input: [
    {
      id: 'injection',
      group: 'Protect the agent',
      label: 'Refuse tricks to change its instructions',
      help: 'Notice when a caller tries to make the agent ignore its rules, and decline.',
      kind: 'prompt_injection',
      base: 'prompt_injection',
      seed: { enforcement: 'both' },
    },
    {
      id: 'pii',
      group: 'Protect the caller',
      label: 'Hide personal details they say',
      help: 'Notice card numbers and the like in what the caller says, and keep them out of the records.',
      kind: 'pii_detect',
      base: 'personal_details',
      seed: { entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    },
    {
      id: 'blocklist',
      group: 'Protect the agent',
      label: 'Block certain words or patterns',
      help: 'Act when the caller’s words match a pattern you list.',
      kind: 'regex_block',
      base: 'blocked_words',
      seed: { enforcement: 'code' },
    },
    {
      id: 'firewall',
      group: 'Protect the caller',
      label: 'Keep secret fields away from the model',
      help: 'Name fields such as a password or a one-time code: they are removed from what the model sees and from what it says.',
      kind: 'field_firewall',
      base: 'secret_fields',
      seed: { enforcement: 'code' },
    },
    {
      id: 'statement',
      group: 'Something else',
      label: 'A rule in words',
      help: 'Write a rule in a sentence for the agent to follow. It is advice to the model, not a check.',
      kind: 'statement',
      base: 'rule',
      seed: { enforcement: 'prompt' },
    },
  ],
  output: [
    {
      id: 'firewall',
      group: 'Keep things private',
      label: 'Keep secret fields out of everything it says',
      help: 'Name fields such as a token or a one-time code: they are removed from what the model sees and from what it says.',
      kind: 'field_firewall',
      base: 'secret_fields',
      seed: { enforcement: 'code' },
    },
    {
      id: 'pii',
      group: 'Keep things private',
      label: 'Hide personal details in what it says',
      help: 'Notice card numbers and the like in the agent’s own words, and act.',
      kind: 'pii_detect',
      base: 'personal_details',
      seed: { entities: ['card_number'], enforcement: 'code', on_trigger: { action: 'redact_in_logs' } },
    },
    {
      id: 'blocklist',
      group: 'Stop it saying something',
      label: 'Block certain words or patterns',
      help: 'Act when the agent’s words match a pattern you list, such as a promise it must not make.',
      kind: 'regex_block',
      base: 'blocked_words',
      seed: { enforcement: 'code' },
    },
    {
      id: 'statement',
      group: 'Something else',
      label: 'A rule in words',
      help: 'Write a rule in a sentence, such as “Never promise a refund”. It is advice to the model, not a check.',
      kind: 'statement',
      base: 'rule',
      seed: { enforcement: 'prompt' },
    },
  ],
};

// Kinds the schema allows in a list but the runtime does not run there, so Add does not offer them. The real validator (POST /validate, 2026-10-23)
// lists a prompt-injection check on the agent's own words as unsupported: it looks for tricks in what the caller says.
const NOT_RUN_THERE = { 'guardrails.output': ['prompt_injection'] };

// The ids a new item of the list at `path` must not take: those of the list itself, and for a list of guardrails those of all three (the checks on
// what the caller says, on what the agent says, and the hand-over rules), which the server takes as one set: "personal_details" on both lists is refused.
export function takenIdsAt(config, path) {
  const at = (p) => p.reduce((v, key) => (v && typeof v === 'object' ? v[key] : undefined), config);
  const idsAt = (p) => {
    const items = at(p);
    return (Array.isArray(items) ? items : [])
      .filter(isObj)
      .map((item) => item.id)
      .filter((id) => typeof id === 'string');
  };
  const parts = ['input', 'output', 'escalation'];
  const guardrails = path.length === 2 && path[0] === 'guardrails' && parts.includes(path[1]);
  return guardrails ? [...new Set(parts.flatMap((part) => idsAt(['guardrails', part])))] : idsAt(path);
}

// ---- pronunciation rules: how written text is said aloud, by what the rule does (not by its kind in the file)
const PRONUNCIATION = [
  {
    id: 'say_words',
    group: 'Words',
    label: 'Say certain words a certain way',
    help: 'A list of words a voice reads wrongly (a brand, a name, a place) and how to say each one. It can run to hundreds.',
    kind: 'dictionary',
    base: 'word_list',
  },
  {
    id: 'find_replace',
    group: 'Words',
    label: 'Replace some text with other text',
    help: 'Wherever a pattern is found, say something else instead.',
    kind: 'replace',
    base: 'replace',
  },
  {
    id: 'spell_out',
    group: 'Words',
    label: 'Spell something out letter by letter',
    help: 'For codes and reference numbers: “AB12” is said “A B 1 2”.',
    kind: 'spell',
    base: 'spell_out',
  },
  {
    id: 'say_digits',
    group: 'Numbers',
    label: 'Read long numbers in groups',
    help: 'A phone number or an account number is read a few digits at a time, so a caller can follow it.',
    kind: 'digits',
    base: 'digits',
  },
  {
    id: 'say_money',
    group: 'Numbers',
    label: 'Say amounts of money in words',
    help: '“$12.50” is said “12 dollars and 50 cents”. Say which currency words to use.',
    kind: 'currency',
    base: 'money',
    seed: { major_unit: 'dollars', minor_unit: 'cents', symbols: ['$'] },
  },
  {
    id: 'say_times',
    group: 'Dates and times',
    label: 'Say times of day aloud',
    help: '“4:30 PM” is said as it is spoken, not read as a string of symbols.',
    kind: 'time',
    base: 'times',
  },
  {
    id: 'say_dates',
    group: 'Dates and times',
    label: 'Say dates aloud',
    help: '“27-Feb-2026” is said “27th February 2026”.',
    kind: 'date',
    base: 'dates',
  },
];

// The picture on each choice's card, so a long list can be scanned at a glance. One table: a choice has the same id (and picture) wherever it is offered.
const OPTION_ICONS = {
  hand_over: 'phoneTransfer',
  back_to_start: 'undo',
  end_call: 'endCall',
  show_form: 'records',
  lookup: 'plug',
  search: 'search',
  keypad_collect: 'keypad',
  keypad_send: 'keypad',
  task: 'flag',
  server: 'tools',
  code: 'code',
  rules_only: 'sliders',
  injection: 'shield',
  pii: 'lock',
  blocklist: 'block',
  statement: 'pencil',
  firewall: 'shield',
  say_words: 'sound',
  find_replace: 'pencil',
  spell_out: 'quote',
  say_digits: 'dial',
  say_money: 'dial',
  say_times: 'clock',
  say_dates: 'clock',
  phone: 'phone',
  web_voice: 'mic',
  web_chat: 'chat',
  whatsapp: 'chat',
  sms: 'chat',
  email: 'mail',
};

const CHANNEL_GROUPS = { sip_voice: 'Voice', web_voice: 'Voice', web_chat: 'Text', whatsapp: 'Text', sms: 'Text', email: 'Text' };
const CHANNEL_HELP = {
  phone: 'Callers dial a number and talk to the agent.',
  web_voice: 'Visitors talk to the agent in the browser.',
  web_chat: 'A chat box on your website.',
  whatsapp: 'People message the agent on WhatsApp.',
  sms: 'People text the agent.',
  email: 'People write to the agent by email.',
};

const branchKind = (engine, branch) => {
  const f = engine.flatten(branch);
  return f.properties?.type?.const;
};

// The thing a person is adding, for the button and the heading: "tool", "channel", "check on what the caller says".
export const WHAT = {
  tools: 'a tool',
  channels: 'a channel',
  'guardrails.input': 'a check on what the caller says',
  'guardrails.output': 'a check on what the agent says',
  pronunciation: 'a pronunciation rule',
};

// The line under the title of the window the choices open in: what is being chosen, and that its details come next.
export const INTRO = {
  tools: 'Pick what it should be able to do. Its details come next.',
  channels: 'Pick where people will reach it. Its details come next.',
  'guardrails.input': 'Pick what to look for in what callers say, before the agent answers. Its details come next.',
  'guardrails.output': 'Pick what to look for in what the agent says, before it is said. Its details come next.',
  pronunciation: 'Pick how some written text should be said aloud. Its details come next.',
};

// Options for a list, or null when the list should use the plain add control. `collection` is 'tools', 'channels', 'guardrails.input'…
// `ctx` has what building an item needs: the engine, the ids already taken, the agent's id.
export function pickerFor(collection, { engine, branches, takenIds = [], botId = '', channelTypes = null }) {
  if (collection === 'channels') {
    return CHANNEL_PRESETS.map((preset) => ({
      id: preset.id,
      group: CHANNEL_GROUPS[preset.type] || 'More',
      label: preset.label,
      help: REACH_WORDS[preset.type]?.text || CHANNEL_HELP[preset.id] || preset.note,
      icon: OPTION_ICONS[preset.id] || 'chat',
      type: preset.type,
      // a kind nothing connects to the runtime yet says so on its card (the server's list, `runs_today`)
      ...(notRunningYet(channelTypes, preset.type) ? { badge: NOT_RUNNING, unavailable: NOT_RUNNING } : {}),
      make: () => buildChannel(preset.id, { taken: takenIds, botId }),
    }));
  }
  const table = collection === 'tools' ? TOOLS : collection === 'pronunciation' ? PRONUNCIATION : GUARDRAILS[collection.replace('guardrails.', '')];
  if (!table || !branches) return null;
  const listed = [];
  const covered = new Set();
  table.forEach((info) => {
    const branch = branches.find((b) => branchKind(engine, b) === info.kind);
    if (!branch) return;
    covered.add(branch);
    listed.push({
      id: info.id,
      group: info.group,
      label: info.label,
      help: info.help,
      icon: OPTION_ICONS[info.id] || 'plus',
      badge: info.unavailable ? NOT_YET : '',
      unavailable: info.unavailable || '',
      make: () => {
        const made = engine.defaultFor(branch);
        const item = isObj(made) ? { ...made, ...(info.builtin ? { builtin: info.builtin } : {}), ...JSON.parse(JSON.stringify(info.seed || {})) } : made;
        if (isObj(item) && 'id' in item && (item.id === '' || item.id === undefined)) item.id = freeId(takenIds, info.base);
        return item;
      },
    });
  });
  // a branch the schema has and this table doesn't know: still offered, by the schema's own name (but not one the runtime does not run there)
  branches.forEach((branch, i) => {
    if (covered.has(branch)) return;
    const kind = branchKind(engine, branch);
    if (NOT_RUN_THERE[collection]?.includes(kind)) return;
    listed.push({
      id: `schema-${i}`,
      group: 'More',
      label: engine.branchLabel(branch, i),
      help: '',
      icon: 'plus',
      badge: '',
      unavailable: '',
      make: () => {
        const made = engine.defaultFor(branch);
        if (isObj(made) && 'id' in made && made.id === '') made.id = freeId(takenIds, String(kind || 'item'));
        return made;
      },
    });
  });
  return listed;
}

// Options in groups, in the order the groups first appear.
export function groupOptions(options) {
  const groups = [];
  options.forEach((option) => {
    let group = groups.find((g) => g.name === option.group);
    if (!group) {
      group = { name: option.group, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  });
  return groups;
}

// Options matching what was typed: every word must appear in the label, the help or the group.
export function filterOptions(options, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const hay = `${o.label} ${o.help} ${o.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
