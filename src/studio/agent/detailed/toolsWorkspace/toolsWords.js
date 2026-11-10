// Build › Tools in plain words: the four quick abilities and their state, the sentence, the tiles, each tool's line,
// and a tool as the steps of one run (agent-config guide 3.18: asked for → may it run → the call → what comes back →
// then → if it fails). Pure: no React, no DOM, so the tests run it in Node.

import { DETAIL_FIELDS, actionsOf, handOverCases, switchOf } from '../../../setup/setupActions.js';
import { agentsUsingTool, kindOfTool, toolNamedElsewhere, toolNotRun } from '../../../form/toolInfo.js';
import { agentLabel, humanize } from '../../rowNames.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const together = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || '');
const either = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : words[0] || '');
const textOf = (v) => (typeof v === 'string' ? v : isObj(v) ? textOf(v.text ?? Object.values(v)[0]) : '');
const clip = (text, n = 60) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

// the four quick abilities: switch one on and say the details, and the tool is made for you (setupActions.js)
const ABILITIES = [
  { key: 'end', action: 'end_call', name: 'End politely', words: 'end the conversation politely', icon: 'endCall', about: 'Says a goodbye, then hangs up' },
  {
    key: 'hand',
    action: 'hand_over',
    name: 'Pass to a person',
    words: 'pass people to a person',
    icon: 'user',
    about: 'To a number, or it offers a call back',
  },
  { key: 'details', action: 'details', name: 'Take requests', words: 'take requests', icon: 'records', about: 'Asks for a name, a phone number, an email…' },
  {
    key: 'lookup',
    action: 'lookup',
    name: 'Look things up',
    words: 'look things up in your system',
    icon: 'plug',
    about: 'In your system, at a web address you give',
  },
];

// the words a fixed line says ({ message: id } is one of the agent's fixed lines)
function lineWords(config, value) {
  if (isObj(value) && typeof value.message === 'string') {
    const line = list(config?.messages).find((m) => isObj(m) && m.id === value.message);
    return line ? textOf(line.text) : '';
  }
  return textOf(value);
}

// each ability: on or off, and what it does in a few words
export function abilitiesOf(config) {
  const a = actionsOf(config);
  const goodbye = (() => {
    const tool = list(config?.tools).find((t) => isObj(t) && t.type === 'builtin' && t.builtin === 'end_call');
    return tool ? lineWords(config, tool.params?.say) : '';
  })();
  const cases = handOverCases(config);
  const fields = a.details.fields.map((name) => DETAIL_FIELDS.find((f) => f.name === name)?.label.toLowerCase() || name);
  const detail = {
    end: goodbye ? `“${clip(goodbye, 70)}”` : 'says a goodbye, then hangs up',
    hand: cases.length
      ? `${cases.length === 1 ? 'one case' : `${cases.length} cases`}${cases.some((c) => c.number) ? '' : ' · it offers a call back'}`
      : 'to a number, or it offers a call back',
    details: fields.length ? `asks for ${together(fields)}` : 'a name, a phone number, an email…',
    lookup: a.lookup.url ? `at ${clip(a.lookup.url, 50)}` : 'in your system, at a web address',
  };
  return ABILITIES.map((ab) => {
    const state = a[ab.action];
    return { ...ab, on: !!state.on, detail: detail[ab.key], kept: state.kept || '' };
  });
}

// what each kind of tool does, in words, and its picture
export const TOOL_KINDS = {
  http: ['Looks up in your system', 'plug'],
  builtin: ['Built in', 'bolt'],
  transfer: ['Passes the caller on', 'phoneTransfer'],
  form: ['Shows a form', 'records'],
  task: ['Runs a multi-step task', 'flag'],
  knowledge: ['Searches its knowledge', 'book'],
  mcp: ['A tool from an MCP server', 'webhook'],
  code: ['Your own code', 'code'],
};
const BUILTIN_WORDS = {
  end_call: 'Ends the conversation',
  transfer_or_callback: 'Passes the caller to a person',
  return_to_entry: 'Sends back to the first agent',
  send_dtmf: 'Presses phone keys',
  collect_dtmf: 'Collects phone keys',
  send_form: 'Shows a form',
  noop: 'Rules only',
};

const toolName = (t) => (typeof t.title === 'string' && t.title ? t.title : humanize(t.id));

// every tool, as a line: its name, what it does, who uses it, whether it is ready, and the ability that made it
//   unsupported: the server's check of the draft (what it doesn't run), when known
export function toolsOf(config, unsupported = null) {
  return list(config?.tools)
    .filter((t) => isObj(t) && typeof t.id === 'string')
    .map((t) => {
      const kind = kindOfTool(t);
      const [kindWords, icon] = TOOL_KINDS[kind] || [kind ? humanize(kind) : 'A tool', 'tools'];
      const agents = agentsUsingTool(config, t.id);
      const made = switchOf(config, t.id);
      const ability = made && ABILITIES.find((ab) => ab.action === made.id);
      const missing = toolNotRun(config, t, unsupported);
      return {
        id: t.id,
        name: toolName(t),
        kind,
        icon,
        does: kind === 'builtin' && BUILTIN_WORDS[t.builtin] ? BUILTIN_WORDS[t.builtin] : kindWords,
        agents: agents.map((id) => agentLabel(config, id)),
        madeBy: ability ? ability.name : '',
        state: missing
          ? { tone: 'warn', words: 'Not run yet' }
          : !agents.length && !toolNamedElsewhere(config, t.id)
            ? { tone: 'off', words: 'Not given to an agent' }
            : { tone: 'good', words: 'Ready' },
      };
    });
}

// the sentence: what it can do, the tools of its own it uses, and the abilities not switched on yet
export function sentenceOf(config) {
  const abilities = abilitiesOf(config);
  const own = toolsOf(config).filter((t) => !t.madeBy && t.agents.length);
  return { on: abilities.filter((a) => a.on), off: abilities.filter((a) => !a.on), own };
}

// the line under the name: how many tools, and who uses them
export function summaryLine(config) {
  const tools = toolsOf(config);
  if (!tools.length) return 'Only talk, for now';
  const users = [...new Set(tools.flatMap((t) => t.agents))];
  return `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}${users.length ? ` · used by ${together(users)}` : ''}`;
}
export { either, together };

// a tool as the steps of one run, each said in a few words
export function stepsOf(config, toolId) {
  // a tool with no id yet (written in the JSON) is known by its place, as its list names it
  const tools = list(config?.tools);
  const t =
    tools.find((x) => isObj(x) && x.id === toolId) ||
    (/^\d+$/.test(String(toolId)) && isObj(tools[Number(toolId)]) && !tools[Number(toolId)].id ? tools[Number(toolId)] : null);
  if (!t) return [];
  const kind = kindOfTool(t);
  const http = kind === 'http';
  const inputs = Object.keys(isObj(t.parameters?.properties) ? t.parameters.properties : {});
  const effects = list(t.effects).length;
  const request = isObj(t.request) ? t.request : {};
  const sees = list(t.result?.to_llm);
  return [
    {
      key: 'asked',
      n: 1,
      title: 'Asked for',
      words: inputs.length ? `when, and ${inputs.length === 1 ? 'one value' : `${inputs.length} values`} it fills in` : 'when it is used',
    },
    { key: 'may', n: 2, title: 'May it run?', words: list(t.preconditions).length || isObj(t.preconditions) ? 'only when…' : 'always' },
    {
      key: 'calls',
      n: 3,
      title: http ? 'Calls your system' : 'What it does',
      words: http
        ? `${request.method || 'GET'} ${request.path || ''}`.trim()
        : kind === 'builtin' && BUILTIN_WORDS[t.builtin]
          ? BUILTIN_WORDS[t.builtin].toLowerCase()
          : TOOL_KINDS[kind]?.[0].toLowerCase() || 'its own work',
    },
    {
      key: 'back',
      n: 4,
      title: 'What comes back',
      words: http
        ? sees.length
          ? `${sees.length === 1 ? 'one field' : `${sees.length} fields`} to the model`
          : 'all of it, to the model'
        : 'its result, to the model',
    },
    {
      key: 'then',
      n: 5,
      title: 'Then',
      words: `${t.reply === 'none' ? 'nothing more is said' : 'the model answers'}${effects ? ` · ${effects === 1 ? '1 step' : `${effects} steps`}` : ''}`,
    },
    {
      key: 'fails',
      n: 6,
      title: 'If it fails',
      words: http ? (typeof t.timeout_s === 'number' ? `after ${t.timeout_s} s` : 'after the usual wait') : 'the model is told',
      fail: true,
    },
  ];
}
