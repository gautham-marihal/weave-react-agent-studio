import React, { useSyncExternalStore } from 'react';
import { Toggle } from '../../ui/Toggle';
import { gateVersion, isGateOn, setGateOn, subscribeGate } from '../../../utils/gatePreference';

/** The per-agent switch for "tests must pass before publishing" (a preference kept in this browser). */
export function TestsGateSwitch({ agentId }: { agentId: string }) {
  useSyncExternalStore(subscribeGate, gateVersion, gateVersion);
  const on = isGateOn(agentId);
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">Tests must pass before publishing</p>
        <p className="mt-0.5 text-[13px] text-muted">
          Publishing waits until the newest run of the saved draft passed and nothing was changed after it. You can still publish anyway. Kept in this browser.
        </p>
      </div>
      <Toggle checked={on} onChange={(v) => setGateOn(agentId, v)} label="Tests must pass before publishing" />
    </div>);

}
