import React from 'react';

// Asked when a voice channel is added and callers aren't told anything yet. A recording notice is a legal matter in
// many places and calls are recorded unless turned off, so it is raised when it matters, not left to a default.
//   onAdd: writes the notice; onDone: closes the question either way
export const DEFAULT_RECORDING_NOTICE = 'This call may be recorded to improve our service.';

export default function RecordingNoticeOffer({ onAdd, onDone }) {
  return (
    <div className="stFOffer" role="group" aria-label="Recording notice">
      <p>
        <strong>Tell callers they may be recorded?</strong> This channel talks by voice, and the agent keeps a record of its calls. Many places require callers
        to be told.
      </p>
      <div className="stFOfferActions">
        <button
          type="button"
          className="primaryCta compactCta"
          onClick={() => {
            onAdd(DEFAULT_RECORDING_NOTICE);
            onDone();
          }}
        >
          Add a notice
        </button>
        <button type="button" className="quietButton" onClick={onDone}>
          Not now
        </button>
      </div>
    </div>
  );
}
