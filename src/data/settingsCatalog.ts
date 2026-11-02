// Every path is a real config path from GET /schema: what a form writes is exactly what the JSON view shows.
// 'lines' edits a list of strings, one per line.
export type SettingType = 'text' | 'textarea' | 'lines' | 'select' | 'toggle' | 'number';
export type SettingLevel = 'guided' | 'detailed' | 'expert';
export type OptionsSource =
'languages' |
'llm_providers' |
'llm_models' |
'stt_providers' |
'stt_models' |
'tts_providers' |
'tts_models' |
'tts_voices' |
'agents';
export type SettingGroupId = 'about' | 'talks' | 'can_do' | 'behaves' | 'available' | 'after' | 'records' | 'engine';
export type CollectionId = 'tools' | 'agents' | 'channels';

export interface SettingGroup {
  id: SettingGroupId;
  label: string;
  description: string;
  collection?: CollectionId;
}

export interface SettingDef {
  path: string;
  label: string;
  help: string;
  group: SettingGroupId;
  type: SettingType;
  level: SettingLevel;
  options?: {value: string;label: string;}[];
  optionsFrom?: OptionsSource;
  unit?: string;
  min?: number;
  max?: number;
}

export const settingGroups: SettingGroup[] = [
{ id: 'about', label: 'About this agent', description: 'Name, company and personality shared by every role.' },
{ id: 'talks', label: 'How it talks', description: 'Language, voice and conversation behaviour.' },
{ id: 'can_do', label: 'What it can do', description: 'Tools the agent can use during a conversation.', collection: 'tools' },
{ id: 'behaves', label: 'How it behaves', description: 'The AI model, who answers first and each role’s instructions.', collection: 'agents' },
{ id: 'available', label: 'Where it is available', description: 'Phone, web chat and web voice, each with its own greeting.', collection: 'channels' },
{ id: 'after', label: 'After the call', description: 'Summaries, recording and redaction.' },
{ id: 'records', label: 'Quality and records', description: 'What is kept and for how long.' },
{ id: 'engine', label: 'Engine and operator settings', description: 'Runtime internals. Change only if you know why.' }];


export const settingsCatalog: SettingDef[] = [
{ path: 'meta.name', label: 'Agent name', help: 'Shown in Studio and call records. Callers never see it.', group: 'about', type: 'text', level: 'guided' },
{ path: 'meta.description', label: 'Description', help: 'A sentence for your team about what this agent is for.', group: 'about', type: 'textarea', level: 'detailed' },
{ path: 'persona.company', label: 'Company name', help: 'The agent uses this to introduce itself.', group: 'about', type: 'text', level: 'guided' },
{ path: 'persona.name', label: 'Agent’s spoken name', help: 'What the agent calls itself, for example “Ada”.', group: 'about', type: 'text', level: 'guided' },
{
  path: 'persona.tone',
  label: 'Tone',
  help: 'Sets the overall style of every reply.',
  group: 'about',
  type: 'select',
  level: 'guided',
  options: [
  { value: 'warm', label: 'Warm' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'formal', label: 'Formal' },
  { value: 'upbeat', label: 'Upbeat' }]

},
{ path: 'persona.shared_rules', label: 'Rules for every role', help: 'Instructions every role follows, whoever is talking. One rule per line.', group: 'about', type: 'lines', level: 'detailed' },
{ path: 'persona.style_rules', label: 'How it speaks', help: 'Style rules, for example “One question at a time.” One per line.', group: 'about', type: 'lines', level: 'detailed' },

{ path: 'defaults.language.primary', label: 'Language', help: 'The language the agent listens and speaks in.', group: 'talks', type: 'select', level: 'guided', optionsFrom: 'languages' },
{ path: 'defaults.models.tts.provider', label: 'Voice provider', help: 'Who generates the spoken voice.', group: 'talks', type: 'select', level: 'guided', optionsFrom: 'tts_providers' },
{ path: 'defaults.models.tts.model', label: 'Voice model', help: 'The provider’s speech model. The server needs one whenever a voice provider is set.', group: 'talks', type: 'select', level: 'detailed', optionsFrom: 'tts_models' },
{ path: 'defaults.models.tts.voice_id', label: 'Voice', help: 'What callers hear on phone and web voice.', group: 'talks', type: 'select', level: 'guided', optionsFrom: 'tts_voices' },
{ path: 'defaults.conversation.turn_handling.interruption.enabled', label: 'Let callers interrupt', help: 'When on, the agent stops talking as soon as the caller speaks.', group: 'talks', type: 'toggle', level: 'detailed' },
{ path: 'defaults.conversation.inactivity.timeout_s', label: 'Silence before checking in', help: 'How long the agent waits in silence before asking if the caller is still there.', group: 'talks', type: 'number', level: 'detailed', unit: 'seconds', min: 1, max: 600 },

{ path: 'defaults.models.llm.provider', label: 'AI model provider', help: 'Who runs the language model that decides what to say.', group: 'behaves', type: 'select', level: 'guided', optionsFrom: 'llm_providers' },
{ path: 'defaults.models.llm.model', label: 'AI model', help: 'Bigger models reason better but cost more and respond slower.', group: 'behaves', type: 'select', level: 'guided', optionsFrom: 'llm_models' },
{ path: 'agents.entry', label: 'Who answers first', help: 'The role that greets every caller.', group: 'behaves', type: 'select', level: 'detailed', optionsFrom: 'agents' },

{ path: 'post_call.summary.enabled', label: 'Write a summary after each call', help: 'A short summary appears on the call record.', group: 'after', type: 'toggle', level: 'detailed' },
{ path: 'post_call.recording.audio', label: 'Record audio', help: 'Keeps an audio recording of phone and voice calls.', group: 'after', type: 'toggle', level: 'guided' },
{ path: 'post_call.recording.transcript', label: 'Keep transcripts', help: 'The written conversation, kept with the call.', group: 'after', type: 'toggle', level: 'guided' },
{ path: 'post_call.recording.retention_days', label: 'Keep recordings and transcripts for', help: 'After this, the recording and transcript are deleted.', group: 'after', type: 'number', level: 'detailed', unit: 'days', min: 1, max: 3650 },
{ path: 'persona.disclosures.recording_notice', label: 'What callers hear about recording', help: 'Said at the start of the call. Leave empty to say nothing.', group: 'after', type: 'text', level: 'guided' },
{ path: 'post_call.redaction.enabled', label: 'Hide personal details in what is kept', help: 'Masks the details listed under redaction before storing.', group: 'after', type: 'toggle', level: 'detailed' },

{ path: 'observability.session_log.enabled', label: 'Keep a log of each call', help: 'What was said, each tool used and every error. Needed to review calls in Studio.', group: 'records', type: 'toggle', level: 'guided' },
{ path: 'observability.session_log.retention_days', label: 'Keep call logs for', help: 'After this, the call logs are deleted.', group: 'records', type: 'number', level: 'guided', unit: 'days', min: 1, max: 3650 },

{ path: 'defaults.models.stt.provider', label: 'Speech recognition provider', help: 'Turns caller audio into text.', group: 'engine', type: 'select', level: 'expert', optionsFrom: 'stt_providers' },
{ path: 'defaults.models.stt.model', label: 'Speech recognition model', help: 'Model used for transcription.', group: 'engine', type: 'select', level: 'expert', optionsFrom: 'stt_models' },
{
  path: 'runtime.provider_mode',
  label: 'Provider mode',
  help: 'Plugins call providers directly; inference routes through the LiveKit gateway.',
  group: 'engine',
  type: 'select',
  level: 'expert',
  options: [
  { value: 'plugins', label: 'plugins' },
  { value: 'inference', label: 'inference' }]

},
{ path: 'runtime.timezone', label: 'Timezone', help: 'Used for business hours and time in prompts. IANA name, e.g. Europe/London.', group: 'engine', type: 'text', level: 'expert' },
{ path: 'meta.version', label: 'Next version number', help: 'Managed by publishing. Only change it to avoid a collision.', group: 'engine', type: 'text', level: 'expert' }];