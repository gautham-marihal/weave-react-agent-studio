// Starting points an author makes themselves: "save this agent as a template", then pick it in the Create dialog next to the built-in ones.
// The built-in seven (starters.ts) are a default set written for customer-care style agents; an organisation has its own, so these are data,
// not code. They are kept in THIS browser (the API has no templates endpoint yet: see "what the backend side can provide next") and can be
// exported to a file and imported, which is how they are shared today. Pure apart from `storage` (localStorage, or anything with
// getItem/setItem in tests).

import { isObj } from './form/engine.js';

const KEY = 'weave_templates';
const FORMAT = 'weave-agent-template';
export const MAX_TEMPLATES = 50;

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);
const clone = (v) => JSON.parse(JSON.stringify(v));
const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'template';

export function loadTemplates(storage = defaultStorage()) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((t) => isObj(t) && typeof t.id === 'string' && isObj(t.config)) : [];
  } catch {
    return [];
  }
}

function write(list, storage) {
  try {
    storage?.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// What stays when an agent becomes a template: everything that makes it what it is, and nothing that makes it THIS agent. The id, name,
// version and status are the new agent's own (set when it is created); `created_at`/`updated_at` are the server's. Secrets are only names.
export function toTemplateConfig(config) {
  const copy = clone(config);
  if (isObj(copy.meta)) ['id', 'name', 'version', 'status', 'created_at', 'updated_at'].forEach((k) => delete copy.meta[k]);
  return copy;
}

export function saveTemplate({ name, description = '', config, sourceName = '' }, storage = defaultStorage()) {
  const list = loadTemplates(storage);
  const taken = new Set(list.map((t) => t.id));
  let id = slug(name);
  let n = 2;
  while (taken.has(id)) {
    id = `${slug(name)}-${n}`;
    n += 1;
  }
  const template = {
    id,
    name: String(name).trim(),
    description: String(description).trim(),
    createdAt: new Date().toISOString(),
    sourceName,
    config: toTemplateConfig(config),
  };
  const next = [template, ...list].slice(0, MAX_TEMPLATES);
  return { template, saved: write(next, storage), list: next };
}

export function deleteTemplate(id, storage = defaultStorage()) {
  const next = loadTemplates(storage).filter((t) => t.id !== id);
  write(next, storage);
  return next;
}

// A new agent from a template: the draft the server made (it has the right id, version and status) gets the template's contents. The
// template's own agent name is replaced by the new one wherever it is the persona's name, so "Acme Support" doesn't leak into a new agent.
export function applyTemplate(base, template) {
  const config = clone(template.config);
  config.meta = { ...(isObj(config.meta) ? config.meta : {}), ...(isObj(base?.meta) ? base.meta : {}) };
  if (isObj(config.persona) && template.sourceName && config.persona.name === template.sourceName && base?.meta?.name)
    config.persona = { ...config.persona, name: base.meta.name };
  if (isObj(base) && base.schema_version) config.schema_version = config.schema_version || base.schema_version;
  return config;
}

// ---- files ----------------------------------------------------------------------------------------------------------------------------
export const templateFileName = (template) => `${slug(template.name)}.template.json`;
export const templateToFile = (template) =>
  `${JSON.stringify({ format: FORMAT, version: 1, name: template.name, description: template.description, sourceName: template.sourceName || '', config: template.config }, null, 2)}\n`;

// A file someone shared -> { template } or { error }. Accepts this app's own file, or a bare configuration (an exported agent).
export function parseTemplateFile(text, fileName = '') {
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: `That isn’t valid JSON (${e.message}).` };
  }
  if (!isObj(value)) return { error: 'A template file holds one JSON object.' };
  const own = value.format === FORMAT;
  const config = own ? value.config : value;
  if (!isObj(config)) return { error: 'There is no configuration in that file.' };
  if (!isObj(config.agents) && !Array.isArray(config.channels)) return { error: 'That doesn’t look like an agent configuration (no agents or channels).' };
  const name = String((own && value.name) || config.meta?.name || String(fileName).replace(/\.template\.json$|\.json$/, '') || 'Imported template').trim();
  return {
    template: {
      name,
      description: own ? String(value.description || '') : '',
      sourceName: own ? String(value.sourceName || '') : String(config.meta?.name || ''),
      config: toTemplateConfig(config),
    },
  };
}
