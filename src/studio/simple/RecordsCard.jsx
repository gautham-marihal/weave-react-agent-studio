import React, { useState } from 'react';
import { Switch } from '../form/fields.jsx';
import { describeRecords, enableRedaction, setKeepTranscript, setLogDays, setLogEnabled, setRecordAudio, setRecordingDays } from '../records/recordsModel.js';
import { readSimple, setRecordingNotice } from './simpleModel.js';

// What is kept about each call, said plainly and changeable here: the per-call log (on unless turned off), recordings, how long they are
// kept, the notice callers hear, and whether sensitive details are hidden in what is saved. These are decisions that sit behind defaults, so
// they are shown, not left to be discovered. The sentences follow the schema's own account of what the runtime does.
export default function RecordsCard({ config, set }) {
  const described = describeRecords(config);
  const r = described.read;
  const read = readSimple(config);
  const [raised, setRaised] = useState(false);
  return (
    <div className="smFields">
      <div className="smField"><span>Call log</span>
        <div className="smSwitchRow"><Switch checked={r.logOn} label="Keep a log of each call" onChange={(on) => set(setLogEnabled(config, on))} /><span>Keep a log of each call</span></div>
        {r.logOn && (
          <label className="smInline"><span>Delete call logs after (days)</span>
            <input className="stFInput small" type="number" min="1" inputMode="numeric" value={r.logDays ?? ''} placeholder="Keep until deleted" aria-label="Delete call logs after (days)" onChange={(event) => set(setLogDays(config, event.target.value))} />
          </label>
        )}
      </div>

      <div className="smField"><span>Recordings</span>
        <div className="smSwitchRow"><Switch checked={r.audio} label="Record the audio" onChange={(on) => set(setRecordAudio(config, on))} /><span>Record the audio</span></div>
        <div className="smSwitchRow"><Switch checked={r.transcript} label="Keep the transcript" onChange={(on) => set(setKeepTranscript(config, on))} /><span>Keep the transcript</span></div>
        {(r.audio || r.transcript) && (
          <label className="smInline"><span>Delete recordings after (days)</span>
            <input className="stFInput small" type="number" min="1" inputMode="numeric" value={r.recordingDays ?? ''} placeholder="Keep until deleted" aria-label="Delete recordings after (days)" onChange={(event) => set(setRecordingDays(config, event.target.value))} />
          </label>
        )}
      </div>

      {read.voiceChannel && (
        <label className="smField"><span>Recording notice</span>
          <input className="stFInput" type="text" value={read.recordingNotice} placeholder="e.g. This call may be recorded to improve our service." onChange={(event) => set(setRecordingNotice(config, event.target.value))} aria-label="Recording notice" />
          <small>Said at the start of voice conversations. Leave it empty only if no one needs to be told.</small>
        </label>
      )}

      <div className="smField"><span>What this means</span>
        <ul className="smFacts" aria-label="What is kept">{described.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        {described.problems.length > 0 && <ul className="smProblems" role="note" aria-label="Things to look at">{described.problems.map((line) => <li key={line}>{line}</li>)}</ul>}
        {r.sensitive.length > 0 && !r.redactionOn && (r.logOn || r.audio || r.transcript) && (
          <div className="smAddActions">
            <button type="button" className="quietButton" onClick={() => { const out = enableRedaction(config); set(out.config); setRaised(out.raised); }}>Hide sensitive details in saved transcripts</button>
          </div>
        )}
        {raised && <small className="smNote" role="status">Hiding sensitive details needs schema version 1.2, so the agent’s version was raised to 1.2.</small>}
      </div>
    </div>
  );
}
