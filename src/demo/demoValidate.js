// A small stand-in for the API's validator, for demo mode. It is NOT the real validator and says so in every report: it checks the
// things that are cheap and most useful to see (the shape of the document, ids that must match, duplicate ids, references to tools
// that don't exist, the model settings, the schema version a feature needs) and lists what the runtime can't do yet. The real
// validator knows the whole schema and the runtime's rules.
// Pure: no network, no DOM.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

export const DEMO_VALIDATOR_NOTE =
  'Demo mode: checked by a few simple rules in your browser, not by the real validator. A real check happens when you use the real API.';
export const KNOWN_PROVIDERS = ['anthropic', 'assemblyai', 'cartesia', 'deepgram', 'elevenlabs', 'google', 'groq', 'openai', 'openai_compatible', 'silero'];
const REQUIRED_SECTIONS = ['schema_version', 'meta', 'runtime', 'defaults', 'persona', 'channels', 'agents'];
// what the real validator reports today (2026-10-16): task, keypad and knowledge tools run
const UNSUPPORTED_TOOL_KINDS = { mcp: 'MCP server tools', code: 'Custom code tools' };

// Every {"secret": "NAME"} in the config.
export function secretsIn(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => secretsIn(item, out));
  else if (isObj(value)) {
    if (typeof value.secret === 'string' && Object.keys(value).length === 1) out.add(value.secret);
    else Object.values(value).forEach((item) => secretsIn(item, out));
  }
  return out;
}

export function validateDemo(config, botId) {
  const errors = [];
  const warnings = [{ path: null, message: DEMO_VALIDATOR_NOTE }];
  const unsupported = [];
  const err = (path, message) => errors.push({ path, message });

  if (!isObj(config)) {
    return { valid: false, errors: [{ path: null, message: 'The configuration must be a JSON object.' }], warnings, unsupported, secrets_required: [] };
  }
  REQUIRED_SECTIONS.forEach((key) => {
    if (!(key in config)) err([key], `${key} is required`);
  });
  if (isObj(config.meta) && botId && config.meta.id !== botId) err(['meta', 'id'], `meta.id must be '${botId}' (it is '${config.meta.id}')`);
  if (isObj(config.meta) && !config.meta.name) err(['meta', 'name'], 'meta.name is required');
  // published as it is: one that isn't x.y.z would be a version the studio can't list or count on from
  if (isObj(config.meta) && !/^\d+\.\d+\.\d+$/.test(String(config.meta.version ?? '')))
    err(['meta', 'version'], `meta.version must be three numbers, like 1.0.0 (it is ${JSON.stringify(config.meta.version ?? null)})`);

  // duplicate ids inside the lists that have them
  const ids = (items) => list(items).map((item) => (isObj(item) ? item.id : undefined));
  const duplicates = (items, path, what) => {
    const seen = new Set();
    ids(items).forEach((id, index) => {
      if (typeof id !== 'string') return;
      if (seen.has(id)) err([...path, index, 'id'], `duplicate ${what} id '${id}'`);
      seen.add(id);
    });
  };
  duplicates(config.agents?.items, ['agents', 'items'], 'agent');
  duplicates(config.tools, ['tools'], 'tool');
  duplicates(config.channels, ['channels'], 'channel');
  duplicates(config.messages, ['messages'], 'message');

  // who answers first, and the tools each agent offers
  const agentIds = ids(config.agents?.items);
  if (isObj(config.agents) && !agentIds.includes(config.agents.entry))
    err(['agents', 'entry'], `'${config.agents.entry}' is not a declared agents id (declared: ${agentIds.filter(Boolean).join(', ') || 'none'})`);
  const toolIds = ids(config.tools).filter(Boolean);
  list(config.agents?.items).forEach((agent, index) => {
    list(agent?.tools).forEach((tool, t) => {
      if (!toolIds.includes(tool))
        err(['agents', 'items', index, 'tools', t], `'${tool}' is not a declared tools id (declared: ${toolIds.join(', ') || 'none'})`);
    });
  });
  // used: offered by an agent, checked with by a task step, or called by a guardrail (an escalation rule, the off-topic rule)
  const used = new Set([
    ...list(config.agents?.items).flatMap((agent) => list(agent?.tools)),
    ...list(config.tasks).flatMap((task) => list(task?.steps).map((step) => step?.validate?.tool)),
    ...list(config.guardrails?.escalation).map((rule) => rule?.tool),
    config.guardrails?.topics?.on_off_topic?.then,
  ]);
  list(config.tools).forEach((tool, index) => {
    if (isObj(tool) && tool.id && !used.has(tool.id))
      warnings.push({ path: ['tools', index], message: `tool '${tool.id}' is not used by any agent, task or guardrail` });
  });

  // channels need something to talk with
  list(config.channels).forEach((channel, index) => {
    const modalities = channel?.modalities;
    if (isObj(modalities) && (list(modalities.input).length === 0 || list(modalities.output).length === 0)) {
      err(
        ['channels', index, 'modalities', list(modalities.input).length === 0 ? 'input' : 'output'],
        'a channel needs at least one input and one output modality',
      );
    }
  });

  // models
  const models = config.defaults?.models;
  if (isObj(config.defaults)) {
    if (!isObj(models) || !isObj(models.llm)) err(['defaults', 'models', 'llm'], 'defaults.models.llm is required');
    else
      ['stt', 'llm', 'tts'].forEach((stage) => {
        const slot = models[stage];
        if (!isObj(slot)) return;
        if (!slot.provider) err(['defaults', 'models', stage, 'provider'], `${stage} needs a provider`);
        else if (!KNOWN_PROVIDERS.includes(slot.provider))
          err(['defaults', 'models', stage, 'provider'], `provider '${slot.provider}' is not known to the runtime (known: ${KNOWN_PROVIDERS.join(', ')})`);
        if (!slot.model) err(['defaults', 'models', stage, 'model'], `${stage} needs a model`);
      });
  }

  // features that need schema 1.2, and what the runtime can't do yet
  const variables = isObj(config.state?.variables) ? config.state.variables : {};
  const sensitive = Object.entries(variables).filter(([, variable]) => isObj(variable) && variable.sensitive === true);
  if (sensitive.length && config.schema_version === '1.1')
    err(['schema_version'], 'this config uses features that need schema_version 1.2 (sensitive state variables), but says 1.1');
  list(config.tools).forEach((tool, index) => {
    const kind = isObj(tool) ? tool.type : undefined;
    if (UNSUPPORTED_TOOL_KINDS[kind]) unsupported.push({ feature: UNSUPPORTED_TOOL_KINDS[kind], where: `tools[${index}]` });
  });
  // Since 2026-10-16 the server enforces sensitive variables and redaction, so neither is reported any more. A
  // protection that is declared but not enforced would come back as an item with `severity: "security"`, which the
  // studio still shows in red (the tests send one).

  const valid = errors.length === 0;
  return { valid, errors, warnings, unsupported: valid ? unsupported : [], secrets_required: [...secretsIn(config)].sort() };
}
