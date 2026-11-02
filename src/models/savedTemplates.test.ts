import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { MAX_TEMPLATES, applyTemplate, deleteTemplate, loadTemplates, parseTemplateFile, saveTemplate, templateFileName, templateToFile, toTemplateConfig } from './savedTemplates';
import { applyChange } from './pendingChange';
import { templateChange } from './manageChanges';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, String(v)) };
};
const fresh = (id: string, name: string): AgentConfig => ({
  schema_version: '1.2',
  meta: { id, name, version: '0.1.0', status: 'draft' },
  persona: { name },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name, instructions: { role: 'Help.' } }] },
});
const acme = (): AgentConfig => ({
  ...fresh('acme-support', 'Acme Support'),
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }],
  agents: { entry: 'desk', items: [{ id: 'desk', name: 'Desk', instructions: { role: 'You are the front desk.' }, tools: ['end_call'] }] },
  meta: { id: 'acme-support', name: 'Acme Support', version: '0.4.2', status: 'published', created_at: 'x', updated_at: 'y', tags: ['care'], owner: 'team-a', description: 'Care' },
});

describe('your templates (ported from Weave React savedTemplates)', () => {
  it('a template keeps what makes an agent what it is and nothing that makes it THIS agent', () => {
    const config = acme();
    const t = toTemplateConfig(config);
    expect(Object.keys(t.meta ?? {}).sort()).toEqual(['description', 'owner', 'tags']);
    expect(t.channels).toEqual(config.channels);
    expect(t.agents).toEqual(config.agents);
    expect(t.tools).toEqual(config.tools);
    expect(config.meta?.id).toBe('acme-support');
  });

  it('templates are saved newest first with unique ids, listed, and removed', () => {
    const store = memory();
    expect(loadTemplates(store)).toEqual([]);
    const one = saveTemplate({ name: 'Clinic front desk', description: 'For clinics', config: acme(), sourceName: 'Acme Support' }, store);
    expect(one.saved).toBe(true);
    expect(one.template.id).toBe('clinic-front-desk');
    expect(saveTemplate({ name: 'Clinic front desk', config: acme() }, store).template.id).toBe('clinic-front-desk-2');
    expect(loadTemplates(store).map((t) => t.id)).toEqual(['clinic-front-desk-2', 'clinic-front-desk']);
    expect(loadTemplates(store)[1].description).toBe('For clinics');
    expect(deleteTemplate('clinic-front-desk-2', store).map((t) => t.id)).toEqual(['clinic-front-desk']);
    for (let i = 0; i < MAX_TEMPLATES + 5; i += 1) saveTemplate({ name: `t${i}`, config: acme() }, store);
    expect(loadTemplates(store)).toHaveLength(MAX_TEMPLATES);
    const full = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(saveTemplate({ name: 'x', config: acme() }, full).saved).toBe(false);
    expect(saveTemplate({ name: 'x', config: acme() }, null).saved).toBe(false);
    expect(loadTemplates({ getItem: () => { throw new Error('no storage'); }, setItem: () => undefined })).toEqual([]);
    expect(loadTemplates({ getItem: () => '{"not":"a list"}', setItem: () => undefined })).toEqual([]);
    expect(loadTemplates({ getItem: () => 'not json', setItem: () => undefined })).toEqual([]);
  });

  it('a new agent from a template has its own id, name and version, and the template’s contents', () => {
    const { template } = saveTemplate({ name: 'Care', config: { ...acme(), persona: { name: 'Acme Support' } }, sourceName: 'Acme Support' }, memory());
    const made = applyTemplate(fresh('beta-care', 'Beta Care'), template);
    expect([made.meta?.id, made.meta?.name, made.meta?.version, made.meta?.status]).toEqual(['beta-care', 'Beta Care', '0.1.0', 'draft']);
    expect(made.meta?.tags).toEqual(['care']);
    expect(made.meta?.owner).toBe('team-a');
    expect(made.tools).toEqual(acme().tools);
    expect(made.agents).toEqual(acme().agents);
    expect(made.persona?.name).toBe('Beta Care');
    expect(template.config.meta?.id).toBeUndefined();
    const custom = applyTemplate(fresh('beta-care', 'Beta Care'), { config: { ...template.config, persona: { name: 'Sam' } }, sourceName: 'Acme Support' });
    expect(custom.persona?.name).toBe('Sam');
  });

  it('a template that could not be saved when the agent was made lands in its draft as a queued change', () => {
    const { template } = saveTemplate({ name: 'Care', config: acme(), sourceName: 'Acme Support' }, memory());
    const base = fresh('beta-care', 'Beta Care');
    const change = templateChange(applyTemplate(base, template), 'Care');
    const landed = applyChange(base, change);
    expect(landed.tools).toEqual(acme().tools);
    expect(landed.meta?.id).toBe('beta-care');
    expect(change.note).toMatch(/Care/);
    expect(applyChange(landed, change)).toBe(landed);
  });

  it('a template is shared as a file, and a shared file (or a plain exported configuration) can be imported', () => {
    const { template } = saveTemplate({ name: 'Care desk', description: 'Front desk', config: acme(), sourceName: 'Acme Support' }, memory());
    expect(templateFileName(template)).toBe('care-desk.template.json');
    const text = templateToFile(template);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text).format).toBe('weave-agent-template');
    const back = parseTemplateFile(text);
    expect(back.template?.name).toBe('Care desk');
    expect(back.template?.description).toBe('Front desk');
    expect(back.template?.config).toEqual(template.config);
    const bare = parseTemplateFile(JSON.stringify(acme()), 'acme-support.json');
    expect(bare.template?.name).toBe('Acme Support');
    expect(bare.template?.config.meta?.id).toBeUndefined();
    expect(parseTemplateFile(JSON.stringify({ agents: { items: [] } }), 'My bot.json').template?.name).toBe('My bot');
    expect(parseTemplateFile('not json').error).toMatch(/isn’t valid JSON/);
    expect(parseTemplateFile('[1,2]').error).toMatch(/one JSON object/);
    expect(parseTemplateFile('{"format":"weave-agent-template","config":5}').error).toMatch(/no configuration/);
    expect(parseTemplateFile('{"hello":"world"}').error).toMatch(/doesn’t look like an agent configuration/);
  });
});
