import React from 'react';
import Button from '../../ui/Button.tsx';

// Asked when a voice channel is added and callers aren't told anything yet. A recording notice is a legal matter in
// many places and calls are recorded unless turned off, so it is raised when it matters, not left to a default.
//   onAdd: writes the notice; onDone: closes the question either way
const DEFAULT_RECORDING_NOTICE = 'This call may be recorded to improve our service.';

export default function RecordingNoticeOffer({ onAdd, onDone }) {
  return (
    <div className="stFOffer" role="group" aria-label="Recording notice">
      <p>
        <strong>Tell callers they may be recorded?</strong> This channel talks by voice, and the agent keeps a record of its calls. Many places require callers
        to be told.
      </p>
      <div className="stFOfferActions">
        <Button
          type="button"
          variant="primary"
          size="compact"
          onClick={() => {
            onAdd(DEFAULT_RECORDING_NOTICE);
            onDone();
          }}
        >
          Add a notice
        </Button>
        <Button type="button" onClick={onDone}>
          Not now
        </Button>
      </div>
    </div>
  );
}
