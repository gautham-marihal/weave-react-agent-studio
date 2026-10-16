import React from 'react';
import { useGate, useGateStatus } from './gate.js';
import '../callers/callers.css';

// "Tests must pass before publishing": one switch for the agent, and where it stands now. When it is on, the publish panel holds until the newest run of the tests
// passed and nothing changed after it (and can still be overridden on purpose).
export default function GateStrip({ botId, editor, refreshKey = 0 }) {
  const [on, setOn] = useGate(botId);
  const status = useGateStatus(botId, editor, refreshKey);
  return (
    <div className="gateStrip" data-gate={on ? 'on' : 'off'}>
      <label>
        <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} aria-label="Tests must pass before publishing" /> Tests must pass
        before publishing
      </label>
      {on ? (
        <span className={status.check.ok ? '' : 'bad'} role="status">
          {status.loading ? 'Checking the latest run…' : status.check.ok ? status.check.why : `Publishing is held. ${status.check.why}`}
        </span>
      ) : (
        <span>Off: the tests inform, and nothing stops a publish.</span>
      )}
    </div>
  );
}
