// The guided setup's actions part ("What it can do"): ending the conversation, handing over to a person, taking
// details with a form, and looking something up in the person's own system; each switch's tools and what they use.

import { CALLBACK_MESSAGE, STARTERS, addPersonHandoff } from '../starters.ts';
import { freshId } from '../form/references.js';
import { entryAgentIndex } from '../simple/simpleModel.js';
import { clone, entryOf, isObj, list, listWords, together } from './setupBasics.js';
import { cleanUrl } from './setupKnowledge.js';

// Applies `change` to a copy of the entry agent (the one that answers first); unchanged when there is no agent.
function withEntry(config, change) {
  const index = entryAgentIndex(config);
  if (index < 0) return config;
  const next = clone(config);
  change(next.agents.items[index], next);
  return next;
}

// ---- what it can do
export const ACTIONS = [
  {
    id: 'end_call',
    icon: 'endCall',
    label: 'End the conversation politely',
    text: 'It says goodbye and ends the conversation when the person has nothing more to ask.',
  },
  { id: 'hand_over', icon: 'phoneTransfer', label: 'Pass people to a person on your team', text: 'When someone asks for a person, or it can’t help.' },
  {
    id: 'details',
    icon: 'records',
    label: 'Take requests and details',
    text: 'For bookings, call-backs, orders or questions for your team: a short form in chat, asked in conversation on the phone. Your team confirms each request.',
  },
  {
    id: 'lookup',
    icon: 'plug',
    label: 'Look something up in your own system',
    text: 'For example an order’s status, from a web address your system answers on.',
  },
];
// `ask`: how it asks for it on the phone, where "your …" doesn't fit ("Could you tell me your name and what you need?")
export const DETAIL_FIELDS = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'phone', label: 'Phone number', type: 'phone' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'need', label: 'What they need', type: 'text', ask: 'what you need' },
  { name: 'when', label: 'Preferred day and time', type: 'text', ask: 'the day and time that suit you' },
  { name: 'message', label: 'Message', type: 'textarea' },
];
// what a request (a booking, an order, a call-back) asks for
export const REQUEST_FIELDS = ['name', 'phone', 'need', 'when'];

const IDS = { end_call: 'end_call', hand_over: 'escalate_to_human', details: 'collect_details', lookup: 'look_up' };
const TRANSFER_ID = 'human_support';
const FORM_ID = 'contact_details';
const CONNECTION_ID = 'your_system';
const GOODBYE = { id: 'goodbye', text: 'Thank you for getting in touch. Goodbye!' };

// A switch's own tool: its id, or that id with a number when the plain one was taken ("end_call_2").
const isOwn = (id, base) => typeof id === 'string' && (id === base || new RegExp(`^${base}_\\d+$`).test(id));
const toolIds = (config) => list(config?.tools).map((t) => t?.id);

// The tools each switch stands for. Ending and handing over count any tool of that kind; details and lookup count only
// the switch's own (a form or web service set up for something else is not taken over).
const IS_TOOL = {
  end_call: (t) => t.type === 'builtin' && t.builtin === 'end_call',
  hand_over: (t) => t.type === 'builtin' && t.builtin === 'transfer_or_callback',
  // only the switch's own form: a tool showing the person's own form is theirs, whatever it is called
  details: (t) => t.type === 'builtin' && t.builtin === 'send_form' && isOwn(t.params?.form, FORM_ID),
  lookup: (t) => t.type === 'http' && isOwn(t.id, IDS.lookup),
};
// The answering agent's tools come first, then the switch's own.
function toolsFor(config, action) {
  const has = list(entryOf(config)?.tools);
  const rank = (t) => (has.includes(t.id) ? 0 : isOwn(t.id, IDS[action]) ? 1 : 2);
  return list(config?.tools)
    .filter((t) => isObj(t) && typeof t.id === 'string' && IS_TOOL[action](t))
    .sort((a, b) => rank(a) - rank(b));
}
const offered = (config, id) => !!id && list(entryOf(config)?.tools).includes(id);

// The Tools page switch that stands for a tool (the first of its kind, the agent's own first), as { id, label, on },
// or null when no switch shows it.
export function switchOf(config, toolId) {
  if (typeof toolId !== 'string' || !toolId) return null;
  const action = ACTIONS.find((a) => toolsFor(config, a.id)[0]?.id === toolId);
  return action ? { id: action.id, label: action.label, on: offered(config, toolId) } : null;
}

// The top-level sections ('agents', 'guardrails'…) that point at an id: a tool in an agent's list or a rule's `tool`,
// a transfer, form or connection by its own field, a fixed line by `{ message }`. Switches never delete what these use.
const POINTERS = {
  tools: ['tool', 'then', 'tool_called', 'tool_not_called'],
  transfers: ['transfer'],
  forms: ['form'],
  connections: ['connection', 'server', 'via'],
  messages: ['message'],
};
function usedIn(config, kind, id) {
  const keys = POINTERS[kind];
  const found = new Set();
  const visit = (node, key, section) => {
    if (Array.isArray(node)) {
      if (kind === 'tools' && key === 'tools' && node.includes(id)) found.add(section);
      node.forEach((item) => visit(item, key, section));
    } else if (isObj(node))
      Object.entries(node).forEach(([k, v]) => {
        if (typeof v !== 'string') visit(v, k, section || k);
        else if (keys.includes(k) && v === id) found.add(section || k);
      });
  };
  visit(config, '', '');
  return [...found];
}
// The same, in words: "a rule under Guardrails"
const PLACES = { agents: 'another agent', guardrails: 'a rule under Guardrails', tasks: 'a multi-step task', tests: 'a test' };
const placesOf = (sections) => [...new Set(sections.map((s) => PLACES[s] || 'another part of the agent'))];

// What is switched on, with each action's details. An action is on when the answering agent has its tool. When off,
// `kept` (only when set) says why its tool is still there: something else uses it.
export function actionsOf(config) {
  const [end, hand, form, lookup] = ['end_call', 'hand_over', 'details', 'lookup'].map((a) => toolsFor(config, a)[0] || null);
  const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === hand?.params?.transfer);
  const formDef = list(config?.forms).find((f) => isObj(f) && f.id === (form?.params?.form || FORM_ID));
  const state = (action, tool) => {
    const on = offered(config, tool?.id);
    const places = on ? [] : placesOf(toolsFor(config, action).flatMap((t) => usedIn(config, 'tools', t.id)));
    const words = together(places);
    return { on, ...(words ? { kept: `${words[0].toUpperCase()}${words.slice(1)} still ${places.length > 1 ? 'use' : 'uses'} it, so it is kept.` } : {}) };
  };
  return {
    end_call: state('end_call', end),
    hand_over: {
      ...state('hand_over', hand),
      number: typeof transfer?.target === 'string' ? transfer.target : '',
      // the number is chosen by what the caller wants (a lookup): it is changed under Phone transfers, not here
      ...(transfer && transfer.target != null && typeof transfer.target !== 'string' ? { numberElsewhere: true } : {}),
    },
    details: {
      ...state('details', form),
      fields: list(formDef?.fields)
        .map((f) => f?.name)
        .filter(Boolean),
    },
    lookup: { ...state('lookup', lookup), ...lookupDetails(config, lookup) },
  };
}

// Takes the switch's tools from the answering agent. A tool the switch made leaves the configuration once nothing uses
// it (with `extra` and its fixed lines); one made by hand stays in the tools list for the person to delete.
function dropTools(config, action, extra = () => {}) {
  const ids = toolsFor(config, action).map((t) => t.id);
  if (!ids.length) return config;
  return withEntry(config, (agent, next) => {
    agent.tools = list(agent.tools).filter((id) => !ids.includes(id));
    ids
      .filter((id) => isOwn(id, IDS[action]) && !usedIn(next, 'tools', id).length)
      .forEach((id) => {
        const tool = list(next.tools).find((t) => t?.id === id);
        next.tools = list(next.tools).filter((t) => t !== tool);
        dropLines(next, tool);
        extra(next, tool);
      });
  });
}
const giveTool = (config, id) =>
  withEntry(config, (agent) => {
    if (!list(agent.tools).includes(id)) agent.tools = [...list(agent.tools), id];
  });

// A removed tool's fixed lines (goodbye, callback line) go too while nothing else says them and they are the studio's
// own wording. A line the person reworded or translated stays, and is used again when the switch is turned back on.
const STUDIO_LINES = [GOODBYE.text, CALLBACK_MESSAGE.text, ...STARTERS.map((s) => s.goodbye).filter(Boolean)];
const untouched = (line) => Object.keys(line).every((k) => k === 'id' || k === 'text') && STUDIO_LINES.includes(line.text);
export function dropLines(next, tool) {
  const ids = [];
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) Object.entries(node).forEach(([k, v]) => (k === 'message' && typeof v === 'string' ? ids.push(v) : visit(v)));
  };
  visit(tool);
  ids.forEach((id) => {
    const line = list(next.messages).find((m) => isObj(m) && m.id === id);
    if (!line || !untouched(line) || usedIn(next, 'messages', id).length) return;
    next.messages = list(next.messages).filter((m) => m !== line);
    if (!next.messages.length) delete next.messages;
  });
}

export function setEndCall(config, on) {
  if (!on) return dropTools(config, 'end_call');
  const existing = toolsFor(config, 'end_call')[0];
  if (existing) return giveTool(config, existing.id);
  const next = clone(config);
  if (!list(next.messages).some((m) => m?.id === GOODBYE.id)) next.messages = [...list(next.messages), { ...GOODBYE }];
  const id = freshId(toolIds(next), IDS.end_call);
  next.tools = [
    ...list(next.tools),
    {
      id,
      type: 'builtin',
      builtin: 'end_call',
      description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.',
      params: { say: { message: GOODBYE.id } },
    },
  ];
  return giveTool(next, id);
}

// The number goes on the hand-over's transfer; with no number the callback line is said instead. A missing transfer is
// made again, so the switch is never on with nowhere to go. A number chosen by a lookup is not replaced from here.
export function setHandOver(config, on, { number } = {}) {
  if (!on)
    return dropTools(config, 'hand_over', (next, tool) => {
      const transfer = tool?.params?.transfer;
      if (!isOwn(transfer, TRANSFER_ID) || usedIn(next, 'transfers', transfer).length || !isObj(next.telephony)) return;
      next.telephony.transfers = list(next.telephony.transfers).filter((t) => t?.id !== transfer);
      if (!next.telephony.transfers.length) delete next.telephony.transfers;
      if (!Object.keys(next.telephony).length) delete next.telephony;
    });
  const existing = toolsFor(config, 'hand_over')[0];
  const next = clone(existing ? giveTool(config, existing.id) : addPersonHandoff(config, { id: freshId(toolIds(config), IDS.hand_over) }));
  const tool = toolsFor(next, 'hand_over')[0];
  if (!tool) return next;
  tool.params = isObj(tool.params) ? tool.params : {};
  if (!tool.params.transfer) tool.params.transfer = TRANSFER_ID;
  const telephony = isObj(next.telephony) ? next.telephony : {};
  let transfer = list(telephony.transfers).find((t) => isObj(t) && t.id === tool.params.transfer);
  if (!transfer) {
    transfer = {
      id: tool.params.transfer,
      description: 'A person to take over. Add the number to transfer to; until then the callers hear the fallback line.',
      method: 'sip_refer',
      target: '',
    };
    next.telephony = { ...telephony, transfers: [...list(telephony.transfers), transfer] };
  }
  if (number !== undefined && (transfer.target == null || typeof transfer.target === 'string')) transfer.target = String(number).trim();
  return next;
}

// A phone call has no screen: the agent asks for the same details in conversation, in this sentence.
const askInWords = (fields) =>
  `Could you tell me your ${listWords(fields.map((f) => DETAIL_FIELDS.find((d) => d.name === f.name)?.ask || String(f.label || f.name).toLowerCase()))}?`;
const detailField = (f) => ({ name: f.name, label: f.label, type: f.type, ...(f.name === 'name' ? { required: true } : {}) });

// What is wrong with a number to pass calls to ('' when it looks dialable): it needs its country code ("+65 6123 4567")
// or a phone-system address ("sip:desk@pbx.example.com"). Spaces, dashes, dots and brackets are fine.
export function numberProblem(typed) {
  const value = String(typed || '').trim();
  if (!value || /^sips?:\S+@\S+$/i.test(value)) return '';
  const digits = value.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return '';
  return digits.startsWith('+')
    ? 'This doesn’t look like a whole number: check the digits after the country code.'
    : 'Write it with the country code, for example +65 6123 4567, or calls can’t be passed on.';
}

// The contact details: a form and the tool that shows it. `fields` are DETAIL_FIELDS names. An existing form only
// gains or loses ticked details: its other fields, wording and what happens on sending stay as they are.
export function setDetails(config, on, { fields } = {}) {
  if (!on)
    return dropTools(config, 'details', (next, tool) => {
      const formId = tool?.params?.form;
      if (!isOwn(formId, FORM_ID) || usedIn(next, 'forms', formId).length) return;
      next.forms = list(next.forms).filter((f) => f?.id !== formId);
      if (!next.forms.length) delete next.forms;
    });
  const existing = toolsFor(config, 'details')[0];
  const next = clone(config);
  const formId = existing?.params?.form || FORM_ID;
  const form = list(next.forms).find((f) => isObj(f) && f.id === formId);
  if (!form) {
    const chosen = DETAIL_FIELDS.filter((f) => (fields && fields.length ? fields : ['name', 'phone']).includes(f.name));
    next.forms = [
      ...list(next.forms),
      { id: formId, title: 'Your details', fields: chosen.map(detailField), submit_label: 'Send', otherwise: [{ type: 'say', text: askInWords(chosen) }] },
    ];
  } else if (fields && fields.length) {
    const had = list(form.fields).filter(isObj);
    const known = DETAIL_FIELDS.map((f) => f.name);
    const kept = had.filter((f) => !known.includes(f.name) || fields.includes(f.name));
    const added = DETAIL_FIELDS.filter((f) => fields.includes(f.name) && !had.some((h) => h.name === f.name)).map(detailField);
    // a form needs a field: the last one stays
    if (kept.length + added.length) {
      const said = list(form.otherwise);
      // the phone sentence follows the fields, while it is still the one written for them
      if (said.length === 1 && isObj(said[0]) && said[0].type === 'say' && said[0].text === askInWords(had))
        form.otherwise = [{ ...said[0], text: askInWords([...kept, ...added]) }];
      form.fields = [...kept, ...added];
    }
  }
  let id = existing?.id;
  if (!id) {
    id = freshId(toolIds(next), IDS.details);
    next.tools = [
      ...list(next.tools),
      {
        id,
        type: 'builtin',
        builtin: 'send_form',
        description: 'Use when the person wants to book, order or be called back, or when you need their details for your team.',
        params: { form: formId },
      },
    ];
  }
  return giveTool(next, id);
}

const paramName = (words) =>
  String(words || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40) || 'value';

// The lookup as the setup asks for it: web address (the person's answer in {curly brackets}), what it finds and what it
// needs. Read back from the tool and its connection, query included, so saving it unchanged writes the same request.
//   param: the name the answer is sent under
function readLookup(config, tool) {
  if (!tool) return { url: '', finds: '', needs: '', param: '' };
  const connection = isObj(config?.connections) ? config.connections[tool.connection] : null;
  const param = Object.keys(tool.parameters?.properties || {})[0] || '';
  const needs = String(tool.parameters?.properties?.[param]?.description || param).replace(/^The /, '');
  const answer = new RegExp(`\\{\\{\\s*args\\.${param}\\s*\\}\\}`, 'g');
  const slot = (text) => (param ? String(text).replace(answer, `{${needs}}`) : String(text));
  const base = String(connection?.base_url || '').replace(/\/$/, '');
  // a "%" in the path stands for itself: written as %25, it reads back the same
  const path = slot(String(tool.request?.path || '').replace(/%/g, '%25'));
  const query = Object.entries(isObj(tool.request?.query) ? tool.request.query : {});
  const elsewhere = answer.test(String(tool.request?.path || '')) || query.some(([k, v]) => k !== param && String(v).match(answer));
  // the answer added at the end because the address had no {curly brackets} is not shown: saving adds it again
  const shown = query.filter(([k, v]) => elsewhere || k !== param || String(v).trim() !== `{{args.${param}}}`);
  const encode = (text) => String(text).replace(/[%&=#+]/g, encodeURIComponent);
  const search = shown.map(([k, v]) => `${encode(k)}=${encode(slot(v))}`).join('&');
  const finds = String(tool.description || '').match(/^Looks up (.*?)\. /)?.[1] || '';
  return { url: `${base}${path}${search ? `?${search}` : ''}`, finds, needs, param };
}
function lookupDetails(config, tool) {
  const { url, finds, needs } = readLookup(config, tool);
  return { url, finds, needs };
}

// The address minus its base when it starts with it ("https://crm.example.com/api" + "/bookings/…"), else null.
function pathUnder(base, address) {
  let start = String(base || '').replace(/\/+$/, '');
  try {
    const u = new URL(start);
    start = `${u.origin}${decodeURI(u.pathname).replace(/\/+$/, '')}`;
  } catch {
    // not a plain address (a value filled in at run time): compared as written
  }
  if (!start) return null;
  if (address === start) return '/';
  return address.startsWith(`${start}/`) ? address.slice(start.length) : null;
}

// "…/orders/{order number}" becomes a connection base plus path /orders/{{args.order_number}} (no {}: a query value).
// `problem` says why an address isn't usable. Changes keep sign-in, headers and body; a shared connection never moves.
export function setLookup(config, on, { url, finds, needs } = {}) {
  if (!on)
    return {
      config: dropTools(config, 'lookup', (next, tool) => {
        const id = tool?.connection;
        if (!isOwn(id, CONNECTION_ID) || !isObj(next.connections) || usedIn(next, 'connections', id).length) return;
        delete next.connections[id];
        if (!Object.keys(next.connections).length) delete next.connections;
      }),
      problem: '',
    };
  const existing = toolsFor(config, 'lookup')[0] || null;
  const was = readLookup(config, existing);
  const same = (a, b) => String(a || '').trim() === String(b || '').trim();
  const typed = String(url || '').trim();
  // nothing changed: the tool stays exactly as it is (it may hold more than these three answers show)
  if (existing && same(typed, was.url) && same(finds, was.finds) && same(needs, was.needs)) return { config: giveTool(config, existing.id), problem: '' };
  if (!String(needs || '').trim()) return { config, problem: 'Say what it needs from the person, for example “order number”.' };
  const param = existing && same(needs, was.needs) && was.param ? was.param : paramName(needs);
  const next = clone(config);
  const tool = existing ? list(next.tools).find((t) => t?.id === existing.id) : { id: freshId(toolIds(next), IDS.lookup), type: 'http' };
  const request = isObj(tool.request) ? tool.request : { method: 'GET' };
  if (!existing || !same(typed, was.url)) {
    // {{templates}} written by hand stay as they are; each {answer} becomes the person's answer
    const kept = [];
    const marked = typed.replace(/\{\{[^{}]*\}\}/g, (t) => `__keep${kept.push(t) - 1}__`);
    const hasSlot = /\{[^{}]*\}/.test(marked);
    const withSlots = marked.replace(/\{[^{}]*\}/g, `__${param}__`);
    if (!cleanUrl(withSlots)) return { config, problem: 'Type the web address your system answers on, starting with https://.' };
    const parsed = new URL(/^https?:\/\//i.test(withSlots) ? withSlots : `https://${withSlots}`);
    if (/__keep\d+__/.test(parsed.origin) || parsed.origin.includes(`__${param}__`))
      return { config, problem: 'Put the curly brackets after the site’s name, for example https://shop.example.com/orders/{order number}.' };
    let pathname;
    try {
      pathname = decodeURI(parsed.pathname);
    } catch {
      return { config, problem: 'There is a stray “%” in the web address. Check it and try again.' };
    }
    const restore = (text) => text.replaceAll(`__${param}__`, `{{args.${param}}}`).replace(/__keep(\d+)__/g, (m, n) => kept[Number(n)] ?? m);
    const address = restore(`${parsed.origin}${pathname}`);
    const query = Object.fromEntries([...parsed.searchParams.entries()].map(([k, v]) => [restore(k), restore(v)]));
    if (!hasSlot) query[param] = `{{args.${param}}}`;
    // the connection: any web service whose base the address starts with; else its own, moved to the new address when
    // nothing else uses it; else a new one
    const connections = isObj(next.connections) ? next.connections : {};
    const http = (id) => isObj(connections[id]) && connections[id].type === 'http';
    const candidates = [tool.connection, ...Object.keys(connections).filter((id) => id !== tool.connection)].filter((id) => id && http(id));
    let connectionId = candidates.find((id) => pathUnder(connections[id].base_url, address) !== null);
    let path = connectionId ? pathUnder(connections[connectionId].base_url, address) : restore(pathname) || '/';
    if (!connectionId) {
      const others = { ...next, tools: list(next.tools).filter((t) => t !== tool) };
      if (http(tool.connection) && !usedIn(others, 'connections', tool.connection).length) {
        connectionId = tool.connection;
        connections[connectionId] = { ...connections[connectionId], base_url: parsed.origin };
      } else {
        connectionId = freshId(Object.keys(connections), CONNECTION_ID);
        connections[connectionId] = { type: 'http', base_url: parsed.origin };
      }
      path = restore(pathname) || '/';
    }
    next.connections = connections;
    tool.connection = connectionId;
    request.path = path;
    if (Object.keys(query).length) request.query = query;
    else delete request.query;
  }
  // a new name for the answer is used wherever the request sends it
  if (was.param && was.param !== param) {
    const from = new RegExp(`\\{\\{\\s*args\\.${was.param}\\s*\\}\\}`, 'g');
    const rename = (node) =>
      typeof node === 'string'
        ? node.replace(from, `{{args.${param}}}`)
        : Array.isArray(node)
          ? node.map(rename)
          : isObj(node)
            ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rename(v)]))
            : node;
    Object.assign(request, rename(request));
  }
  tool.request = { ...request, method: request.method || 'GET' };
  if (!existing || !same(finds, was.finds) || !same(needs, was.needs))
    tool.description = `Looks up ${String(finds || 'what the person asks about').trim()}. Use it when the person asks, once you have their ${String(needs).trim()}.`;
  const properties = isObj(tool.parameters?.properties) ? { ...tool.parameters.properties } : {};
  const before = isObj(properties[was.param]) ? properties[was.param] : {};
  delete properties[was.param];
  delete properties[param];
  tool.parameters = {
    ...(isObj(tool.parameters) ? tool.parameters : {}),
    type: 'object',
    required: [param, ...list(tool.parameters?.required).filter((r) => r !== was.param && r !== param)],
    // the answer first: it is the one the switch reads back
    properties: {
      [param]: { type: 'string', ...before, description: same(needs, was.needs) && before.description ? before.description : `The ${String(needs).trim()}` },
      ...properties,
    },
  };
  if (!existing) next.tools = [...list(next.tools), tool];
  return { config: giveTool(next, tool.id), problem: '' };
}
