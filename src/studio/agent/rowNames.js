// How an agent's list pages name a row: in words a person reads ("Escalate to human", "Web chat"), not the id the configuration uses
// (escalate_to_human, web-chat), which stays in the row's tooltip for whoever needs it. Pure: no React, no DOM.

import { summarize } from '../form/cardLogic.js';
import { channelName } from '../simple/simpleModel.js';
import { TYPE_LABELS } from '../form/presets.js';
import { momentOf, ruleWords } from './blocks/guardrailModel.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// "escalate_to_human" → "Escalate to human", "web-chat" → "Web chat", "lookupOrder" → "Lookup order"
export function humanize(id) {
  const words = String(id || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : '';
}

// An agent of the workflow by name: its own name, else (when it is the only one) the agent's name, else its id in words.
export function agentLabel(config, id) {
  const agents = list(config?.agents?.items).filter(isObj);
  const agent = agents.find((a) => a.id === id);
  if (typeof agent?.name === 'string' && agent.name.trim()) return agent.name.trim();
  if (agent && agents.length === 1 && typeof config?.meta?.name === 'string' && config.meta.name.trim()) return config.meta.name.trim();
  return humanize(id);
}

// A channel by the name its row has on the Channels page ("Chat on your website"); an id the agent does not have stays as it is.
export function channelLabel(config, id) {
  const channels = list(config?.channels);
  const index = channels.findIndex((c) => isObj(c) && c.id === id);
  return index < 0 ? String(id || '') : rowName('channels', channels[index], index, config).title;
}

const clip = (text, n = 60) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// { title, hint, id } for one row of a list page. kind: 'tools' | 'channels' | 'guardrails' | another list's kind.
export function rowName(kind, item, index, config) {
  const base = summarize(item, index);
  if (!isObj(item)) return { title: base.title, hint: base.hint, id: '' };
  const id = typeof item.id === 'string' ? item.id : '';
  if (kind === 'channels') {
    // by its kind, in the words of the page's switches ("Chat on your website"); two of one kind are told apart by their ids in words ("Phone calls ·
    // Sales line"), or by number when the ids say nothing more than the kind ("web-chat", "web_chat_2": "Chat on your website", "… 2")
    const sameKind = list(config?.channels).filter((c) => isObj(c) && c.type === item.type);
    const kindTitle = TYPE_LABELS[item.type] || channelName(item.type);
    const plainId = (c) => {
      const w = humanize(c?.id).toLowerCase();
      return !w || [channelName(c.type), TYPE_LABELS[c.type] || '', c.type].some((name) => w.startsWith(humanize(name).toLowerCase()));
    };
    const words = humanize(id);
    const lookalike = sameKind.some((c) => typeof c.id === 'string' && c.id !== id && humanize(c.id) === words);
    const position = sameKind.indexOf(item) + 1;
    const title =
      sameKind.length < 2 || !id ? kindTitle : plainId(item) || lookalike ? `${kindTitle}${position > 1 ? ` ${position}` : ''}` : `${kindTitle} · ${words}`;
    const say = item.greeting?.say;
    const hint =
      typeof say === 'string' && say.trim() ? `Says “${clip(say.trim())}”` : isObj(say) ? 'Says one of its fixed lines first' : 'Waits for the person to start';
    return { title, hint, id };
  }
  // a rule for handing over or ending: when it applies and what it does, in words
  if (kind === 'escalation') {
    // the rules switched on above are named as their switches are, while they still do what the switch says
    const moment = momentOf(item, config);
    return { title: moment ? moment.label : id ? humanize(id) : base.title, hint: ruleWords(item, config), id };
  }
  return { title: id ? humanize(id) : base.title, hint: base.hint, id };
}
