import React, { useState } from 'react';
import { useForm } from './ctx.js';
import { assemblePrompt } from './promptPreview.js';

// Shows the pieces of an agent's prompt in the order the configuration gives them, as one read-only block. It is built here, from
// the fields as they are now (saved or not), so it is approximate: the runtime's own wording and ordering decide what the model
// really receives. Names that only exist during a call show as ‹placeholders›.
function Marked({ text }) {
  const parts = String(text).split(/(‹[^›]*›)/);
  return parts.map((part, index) => (part.startsWith('‹') ? <mark key={index} className="stPromptHole">{part}</mark> : <React.Fragment key={index}>{part}</React.Fragment>));
}

export default function PromptPreview({ agentId }) {
  const { config } = useForm();
  const channels = (Array.isArray(config?.channels) ? config.channels : []).map((channel) => channel?.id).filter(Boolean);
  const [channelId, setChannelId] = useState('');
  const [open, setOpen] = useState(false);
  const result = open ? assemblePrompt(config, agentId, { channelId }) : null;

  return (
    <details className="stPromptPreview" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Preview the prompt <span className="stTag">approximate</span></summary>
      {open && (
        !result ? <p className="stFEmpty">Give this agent an id to preview its prompt.</p> : (
          <div className="stPromptBody">
            <p className="stFHelp">
              The pieces the configuration says this agent is told, in order, built here from the fields as they are now. It is <strong>not</strong> the
              runtime’s exact prompt: the wording and ordering are the runtime’s own, and conditional blocks appear only while their condition holds on a call.
            </p>
            {channels.length > 0 && (
              <label className="stPromptChannel"><span>On channel</span>
                <select className="stFInput small" value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label="Preview on channel">
                  <option value="">Any (no channel addition)</option>
                  {channels.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
            )}
            {result.sections.length === 0 && <p className="stFEmpty">Nothing to show yet: this agent has no role or persona text.</p>}
            {result.sections.map((section) => (
              <section key={section.id} className={`stPromptSection ${section.conditional ? 'conditional' : ''}`} data-section={section.id}>
                <header><strong>{section.title}</strong><small>{section.note} · {section.words} word{section.words === 1 ? '' : 's'}</small></header>
                <pre><Marked text={section.text} /></pre>
              </section>
            ))}
            <p className="stPromptTotal" role="status">
              {result.words} word{result.words === 1 ? '' : 's'} that always apply{result.conditionalWords ? `, plus up to ${result.conditionalWords} in conditional blocks` : ''}.
              {result.unresolved.length > 0 && <> Filled in during a call: {result.unresolved.map((name, index) => <React.Fragment key={name}>{index ? ', ' : ''}<code>{name}</code></React.Fragment>)}.</>}
            </p>
          </div>
        )
      )}
    </details>
  );
}
