// Which setting a Provider or Model box belongs to.
const STAGES = ['stt', 'llm', 'tts', 'realtime'];

// 'llm' for defaults.models.llm.model, and for its fallbacks too; null for any other setting called "model" or "provider".
export function modelStageOf(path) {
  const leaf = path[path.length - 1];
  if (leaf !== 'provider' && leaf !== 'model') return null;
  if (!path.includes('models')) return null;
  for (let i = path.length - 2; i >= 0; i -= 1) if (STAGES.includes(path[i])) return path[i];
  return null;
}
