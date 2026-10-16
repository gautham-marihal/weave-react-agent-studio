import { useMemo, useState } from 'react';
import { ASSISTANT, MIN_DESCRIPTION, generateDraft } from '../demo/draftAssistant.js';
import { minimalConfig } from '../demo/minimalConfig.js';
import { entryAgent, readSimple } from './simple/simpleModel.js';

// "Describe the agent" in the Create dialog: write what it should do, get a draft to review. The assistant is the rule-based demo one
// (demo/draftAssistant.js) and every part of this panel says so: what it is, what it assumed, and what it left for you to decide.
export default function AssistantPanel({ description, onDescription, name, id, generated, onGenerated, edits, onEdits, disabled }) {
  const [tried, setTried] = useState(false);
  const tooShort = description.trim().length < MIN_DESCRIPTION;
  const preview = generated?.result;
  const read = useMemo(() => (preview?.ok ? readSimple(preview.config) : null), [preview]);

  const generate = () => {
    setTried(true);
    if (tooShort) return;
    const result = generateDraft(description, minimalConfig(id || 'new-agent', name || 'New agent'), { name: name.trim() || undefined });
    onGenerated({ result, for: description });
    onEdits({ role: result.ok ? readSimple(result.config).role : '', greeting: result.ok ? readSimple(result.config).greeting : '' });
  };
  const stale = generated && generated.for !== description;

  return (
    <div className="asPanel">
      <p className="pvBanner sim" role="note"><b>{ASSISTANT.label}.</b> {ASSISTANT.description}</p>
      <label className="workspaceField">
        <span>Describe the agent</span>
        <small>Who it talks to, what it helps with, how it should sound, anything it must never do. A few sentences are enough.</small>
        <textarea className="stFInput" rows={5} value={description} onChange={(event) => onDescription(event.target.value)} disabled={disabled} aria-label="Describe the agent" aria-invalid={tried && tooShort ? true : undefined}
          placeholder="e.g. A friendly phone agent for Acme Telecom that helps customers with their bills, in English and Spanish. Never promise a refund. Pass the caller to a person if they ask." />
        {tried && tooShort && <small className="stFieldError">Describe what the agent should do in a sentence or two.</small>}
      </label>
      <button type="button" className="quietButton" onClick={generate} disabled={disabled}>{generated ? 'Generate again' : 'Generate a draft'}</button>

      {preview && !preview.ok && <p className="stFieldError" role="alert">{preview.problem}</p>}
      {preview?.ok && (
        <section className="asReview" aria-label="The generated draft">
          {stale && <p className="pvBanner warn" role="status">You changed the description after this draft was made. Generate again to update it.</p>}
          <h4>The draft, to review</h4>
          <dl className="asFacts">
            <div><dt>Kind</dt><dd>{preview.summary.kind}</dd></div>
            <div><dt>Name</dt><dd>{read.persona || read.name}</dd></div>
            <div><dt>Reachable by</dt><dd>{preview.summary.channels.join(', ')}</dd></div>
            <div><dt>Tone</dt><dd>{preview.summary.tone}</dd></div>
            <div><dt>Tools</dt><dd>{preview.summary.tools.join(', ') || 'none'}</dd></div>
          </dl>
          <label className="workspaceField"><span>What it is told to do (its role)</span>
            <textarea className="stFInput" rows={6} value={edits.role} onChange={(event) => onEdits({ ...edits, role: event.target.value })} disabled={disabled} aria-label="Role of the generated agent" />
          </label>
          <label className="workspaceField"><span>What it says first</span>
            <input className="stFInput" type="text" value={edits.greeting} onChange={(event) => onEdits({ ...edits, greeting: event.target.value })} disabled={disabled} aria-label="Greeting of the generated agent" />
          </label>
          <details className="stFold" open>
            <summary>What it assumed ({preview.assumptions.length})</summary>
            <ul className="stPlain">{preview.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
          <details className="stFold amber" open>
            <summary>What you still need to decide ({preview.questions.length})</summary>
            <ul className="stPlain">{preview.questions.map((q) => <li key={q}>{q}</li>)}</ul>
          </details>
          <p className="stMuted">Creating it makes a draft you can keep editing. Nothing is published or deployed.</p>
        </section>
      )}
    </div>
  );
}

export { entryAgent };
