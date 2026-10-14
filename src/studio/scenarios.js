// "Readiness checks": does an agent's configuration cover everyday situations? Each check looks at one saved configuration
// (a draft or a published version); no conversation is run, no call is placed and nothing is sent to the runtime.

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const channelsOf = (c) => list(c.channels).filter((channel) => channel && channel.enabled !== false);
const toolsOf = (c) => list(c.tools);
const entryAgent = (c) => list(c.agents?.items).find((agent) => agent.id === c.agents?.entry) || list(c.agents?.items)[0];
const hasVoiceChannel = (c) => channelsOf(c).some((channel) => list(channel.modalities?.input).includes('audio') || list(channel.modalities?.output).includes('audio'));

// Can the agent pass a caller to a person? A transfer-or-callback tool, a defined transfer, or an escalation rule.
export function hasHumanHandoff(config) {
  const c = config || {};
  return toolsOf(c).some((tool) => tool?.builtin === 'transfer_or_callback')
    || list(c.telephony?.transfers).length > 0
    || list(c.guardrails?.escalation).some((rule) => rule?.action === 'tool' || rule?.action === 'handoff');
}

export const SCENARIOS = [
  { id: 'greet', name: 'Caller says hello', check: (c) => channelsOf(c).some((ch) => !!ch.greeting?.say) || list(c.messages).some((m) => /greet|welcome/i.test(m.id || '')),
    pass: 'Greets the caller with a greeting you set.', fail: 'No channel has a greeting.' },
  { id: 'goal', name: 'Caller explains why they called', check: (c) => !!text(entryAgent(c)?.instructions?.role),
    pass: 'The agent that answers first has instructions to work from.', fail: 'The agent that answers first has no instructions.' },
  { id: 'person', name: 'Caller asks for a person', check: hasHumanHandoff,
    pass: 'Can hand the caller to a person or take a callback.', fail: 'No transfer, callback tool or escalation rule is set.' },
  { id: 'silent', name: 'Caller goes quiet', check: (c) => { const i = c.defaults?.conversation?.inactivity; return !!i && i.enabled !== false && (list(i.nudges).length > 0 || !!i.on_exhausted); },
    pass: 'Nudges a silent caller, then closes politely.', fail: 'Inactivity handling is off or not set.' },
  { id: 'bye', name: 'Caller says goodbye', check: (c) => toolsOf(c).some((tool) => tool?.builtin === 'end_call') || list(c.messages).some((m) => /bye|goodbye/i.test(m.id || '')),
    pass: 'Can end the call with a goodbye.', fail: 'No end-call tool or goodbye message.' },
  { id: 'speech', name: 'Caller speaks instead of typing', check: (c) => hasVoiceChannel(c) && !!c.defaults?.models?.stt?.provider,
    pass: 'A voice channel and speech-to-text are set.', fail: 'No voice channel, or no speech-to-text model.' },
  { id: 'voice', name: 'Agent replies by voice', check: (c) => !!c.defaults?.models?.tts?.provider && !!text(c.defaults?.models?.tts?.voice_id),
    pass: 'A text-to-speech provider and voice are set.', fail: 'No text-to-speech voice is set.' },
  { id: 'offtopic', name: 'Caller goes off topic', check: (c) => { const g = c.guardrails || {}; return list(g.input).length + list(g.output).length > 0 || list(g.topics?.blocked).length + list(g.topics?.allowed).length > 0; },
    pass: 'Guardrails keep it on topic.', fail: 'No guardrails or topic limits are set.' },
  { id: 'lookup', name: 'Caller asks about their account', check: (c) => toolsOf(c).some((tool) => ['http', 'mcp', 'knowledge', 'task', 'code'].includes(tool?.type)),
    pass: 'Has tools to look things up.', fail: 'No tool can look anything up.' },
  { id: 'chat', name: 'Caller switches to chat', check: (c) => channelsOf(c).some((ch) => ch.type === 'web_chat'),
    pass: 'A web chat channel is on.', fail: 'No web chat channel is on.' },
  { id: 'spam', name: 'A caller tries to hijack the agent', check: (c) => list(c.guardrails?.input).some((rule) => rule?.type === 'prompt_injection'),
    pass: 'A prompt-injection guardrail is set.', fail: 'No prompt-injection guardrail.' },
  { id: 'record', name: 'Conversation is kept for review', check: (c) => !!c.post_call?.recording?.transcript || list(c.post_call?.artifacts).some((a) => a?.kind === 'transcript' && a.enabled !== false),
    pass: 'Transcripts are kept.', fail: 'Transcripts are not kept.' },
];

export function runScenarioChecks(config, count = SCENARIOS.length) {
  return SCENARIOS.slice(0, count).map((scenario) => {
    let passed = false;
    try { passed = !!(config && scenario.check(config)); } catch { passed = false; }
    return { id: scenario.id, name: scenario.name, passed, detail: config ? (passed ? scenario.pass : scenario.fail) : 'The configuration couldn’t be read.' };
  });
}
