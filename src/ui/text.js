// Labels written in capitals ("TOTAL CALL DURATION") are shown in sentence case ("Total call duration"), like every other label in the app. Short
// abbreviations stay as they are ("LLM tokens", "Agent ID", "SIP URI").
const KEEP = new Set(['AI', 'API', 'DEV', 'DTMF', 'HTTP', 'ID', 'IVR', 'LLM', 'MCP', 'PROD', 'SIP', 'SMS', 'STG', 'STT', 'TTS', 'URI', 'URL']);

export function sentenceCase(text) {
  const value = String(text ?? '');
  if (!value || /[a-z]/.test(value)) return value; // already written in normal case
  const words = value
    .split(/(\s+)/)
    .map((word) => (KEEP.has(word.replace(/[^A-Z]/g, '')) && word.replace(/[^A-Z]/g, '').length > 1 ? word : word.toLowerCase()));
  const joined = words.join('');
  const first = joined.search(/[a-zA-Z]/);
  return first < 0 ? joined : joined.slice(0, first) + joined[first].toUpperCase() + joined.slice(first + 1);
}
