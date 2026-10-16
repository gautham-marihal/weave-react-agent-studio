
// The one name for where an agent is (Draft, Tested, Live in Development, Live in Staging, Live in Production, Needs attention), in one colour per
// state, wherever an agent is shown. The meaning is in the words, never only in the colour.
export default function StatePill({ state, className = '' }) {
  if (!state) return null;
  return <span className={`stPill ${state.tone} ${className}`} data-state={state.id} title={state.hint}>{state.label}</span>;
}
