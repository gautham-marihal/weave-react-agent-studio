// The person's own templates ("save this agent as a template"), offered in the Create dialog beside the starters. Kept
// in this browser (the API has no templates endpoint yet) and shared as a file. Pure apart from `storage`.

import type { AgentConfig } from '../types/studio';
import { browserStorage } from './manageStore';

const KEY = 'weave_templates';
const FORMAT = 'weave-agent-template';
export const MAX_TEMPLATES = 50;

export interface SavedTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** The name of the agent it was made from, so that name doesn't leak into a new agent. */
  sourceName: string;
  config: AgentConfig;
}

type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const slug = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'template';

export function loadTemplates(storage: TemplateStorage = browserStorage()): SavedTemplate[] {
  try {
    const list: unknown = JSON.parse(storage?.getItem(KEY) || '[]');
    return Array.isArray(list) ? (list.filter((t) => isObj(t) && typeof t.id === 'string' && isObj(t.config)) as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedTemplate[], storage: TemplateStorage): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * A template keeps what makes an agent what it is, not what makes it THIS agent: id, name, version, status and the
 * server's timestamps are dropped. Secrets are only ever names.
 */
export function toTemplateConfig(config: AgentConfig): AgentConfig {
  const copy = clone(config);
  if (isObj(copy.meta)) ['id', 'name', 'version', 'status', 'created_at', 'updated_at'].forEach((k) => delete (copy.meta as Record<string, unknown>)[k]);
  return copy;
}

export function saveTemplate(
  { name, description = '', config, sourceName = '' }: { name: string; description?: string; config: AgentConfig; sourceName?: string },
  storage: TemplateStorage = browserStorage(),
): { template: SavedTemplate; saved: boolean; list: SavedTemplate[] } {
  const list = loadTemplates(storage);
  const taken = new Set(list.map((t) => t.id));
  let id = slug(name);
  for (let n = 2; taken.has(id); n += 1) id = `${slug(name)}-${n}`;
  const template: SavedTemplate = {
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

export function deleteTemplate(id: string, storage: TemplateStorage = browserStorage()): SavedTemplate[] {
  const next = loadTemplates(storage).filter((t) => t.id !== id);
  write(next, storage);
  return next;
}

/**
 * The template's contents on the server's new draft, which has the right id, version and status. The template's
 * agent name is replaced where it is the persona's name, so "Acme Support" doesn't leak into a new agent.
 */
export function applyTemplate(base: AgentConfig, template: Pick<SavedTemplate, 'config' | 'sourceName'>): AgentConfig {
  const config = clone(template.config);
  config.meta = { ...(isObj(config.meta) ? config.meta : {}), ...(isObj(base?.meta) ? base.meta : {}) };
  if (isObj(config.persona) && template.sourceName && config.persona.name === template.sourceName && base?.meta?.name)
    config.persona = { ...config.persona, name: base.meta.name };
  if (isObj(base) && base.schema_version) config.schema_version = config.schema_version || base.schema_version;
  return config;
}

// ---- files -----------------------------------------------------------------------------------------------------------

export const templateFileName = (template: Pick<SavedTemplate, 'name'>): string => `${slug(template.name)}.template.json`;

export const templateToFile = (template: Pick<SavedTemplate, 'name' | 'description' | 'sourceName' | 'config'>): string =>
  `${JSON.stringify({ format: FORMAT, version: 1, name: template.name, description: template.description, sourceName: template.sourceName || '', config: template.config }, null, 2)}\n`;

export type ParsedTemplate = { template: Omit<SavedTemplate, 'id' | 'createdAt'>; error?: undefined } | { error: string; template?: undefined };

/** A shared file -> a template, or why not. Takes this app's own file or a bare configuration (an exported agent). */
export function parseTemplateFile(text: string, fileName = ''): ParsedTemplate {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: `That isn’t valid JSON (${e instanceof Error ? e.message : 'it could not be read'}).` };
  }
  if (!isObj(value)) return { error: 'A template file holds one JSON object.' };
  const own = value.format === FORMAT;
  const config = own ? value.config : value;
  if (!isObj(config)) return { error: 'There is no configuration in that file.' };
  if (!isObj(config.agents) && !Array.isArray(config.channels)) return { error: 'That doesn’t look like an agent configuration (no agents or channels).' };
  const meta = isObj(config.meta) ? config.meta : {};
  const metaName = typeof meta.name === 'string' ? meta.name : '';
  const name = String((own && typeof value.name === 'string' && value.name) || metaName || String(fileName).replace(/\.template\.json$|\.json$/, '') || 'Imported template').trim();
  return {
    template: {
      name,
      description: own ? String(value.description || '') : '',
      sourceName: own ? String(value.sourceName || '') : metaName,
      config: toTemplateConfig(config as AgentConfig),
    },
  };
}
