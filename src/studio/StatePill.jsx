import React from 'react';
import StatusChip from '../ui/StatusChip.tsx';

// Where an agent is (Draft, Tested, Live in …, Needs attention), one colour per state, wherever an agent is shown.
// The meaning is in the words, never only in the colour.
export default function StatePill({ state, className = '' }) {
  if (!state) return null;
  return (
    <StatusChip tone={state.tone} className={className} data-state={state.id} title={state.hint}>
      {state.label}
    </StatusChip>
  );
}
