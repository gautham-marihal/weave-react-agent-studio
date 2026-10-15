import React from 'react';
import { knowledgeBlocks, modelLines, onEnterLines, stateLines } from './previewWords.js';

// The parts of the server's prompt preview besides the instructions, the tools and the numbers: what runs when the agent takes over, what knowledge is
// searched and by what, which models and which secret names would be used, and the state the preview was built from (sensitive values masked). A part
// the server sent empty is left out; a part it sent is always shown.

export default function PromptExtras({ prompt }) {
  const enter = onEnterLines(prompt.onEnter);
  const knowledge = knowledgeBlocks(prompt.knowledge);
  const models = modelLines(prompt.models);
  const state = stateLines(prompt.state);
  const tools = prompt.tools.filter((tool) => tool.parameters && Object.keys(tool.parameters.properties || {}).length > 0);
  return (
    <>
      {enter.length > 0 && (
        <details className="stPromptExtra" data-extra="on_enter">
          <summary>What runs when it takes over ({enter.length})</summary>
          <ol>{enter.map((line, i) => <li key={i}>{line}</li>)}</ol>
        </details>
      )}
      {knowledge.length > 0 && (
        <details className="stPromptExtra" data-extra="knowledge">
          <summary>What it searches</summary>
          {knowledge.map((block) => (
            <div key={block.heading}><strong>{block.heading}</strong><ul>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
          ))}
        </details>
      )}
      {models.length > 0 && (
        <details className="stPromptExtra" data-extra="models">
          <summary>The models it would use</summary>
          <dl>{models.map((line) => <React.Fragment key={line.label}><dt>{line.label}</dt><dd>{line.text}</dd></React.Fragment>)}</dl>
          <p className="stMuted">Only the names of secrets are shown, never their values.</p>
        </details>
      )}
      {state.length > 0 && (
        <details className="stPromptExtra" data-extra="state">
          <summary>What it remembers at this point ({state.length})</summary>
          <dl>{state.map((line) => <React.Fragment key={line.name}><dt><code>{line.name}</code></dt><dd className={line.masked ? 'masked' : ''}>{line.text}{line.masked && <small className="stMuted"> hidden: it is sensitive</small>}</dd></React.Fragment>)}</dl>
        </details>
      )}
      {tools.length > 0 && (
        <details className="stPromptExtra" data-extra="parameters">
          <summary>What it gives each tool</summary>
          <ul>{tools.map((tool) => (
            <li key={tool.name}><code>{tool.name}</code> <span className="stMuted">takes</span> {Object.entries(tool.parameters.properties).map(([name, spec]) => <span key={name} className="stPromptParam"><code>{name}</code>{spec?.type ? <em> {Array.isArray(spec.type) ? spec.type.join(' or ') : spec.type}</em> : null}{Array.isArray(tool.parameters.required) && tool.parameters.required.includes(name) ? <b title="required"> *</b> : null}</span>)}</li>
          ))}</ul>
        </details>
      )}
    </>
  );
}
