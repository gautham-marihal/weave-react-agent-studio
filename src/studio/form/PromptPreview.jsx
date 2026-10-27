import React, { useMemo, useState } from 'react';
import { useConfigSelect } from './ctx.js';
import { usePromptPreview } from './usePreview.js';
import { promptAdvice } from './serverPreview.js';
import { describeWhen } from './promptPreview.js';
import PromptExtras from './PromptExtras.jsx';
import WhatIfBar, { useWhatIf } from './WhatIfBar.jsx';
import Icon from '../../ui/Icon.jsx';

// What the model will be told, from the server: the exact instructions, each conditional block and whether it is in,
// the tools as the model sees them, and the size. The API runs the runtime's code on the editor's config and spends
// nothing; "Preview as…" sets what-ifs. Without the server, an APPROXIMATE browser copy is shown, labelled so.

function Marked({ text }) {
  const parts = String(text).split(/(‹[^›]*›)/);
  return parts.map((part, index) =>
    part.startsWith('‹') ? (
      <mark key={index} className="stPromptHole">
        {part}
      </mark>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    ),
  );
}

const SOURCE = {
  server: { text: 'exact', title: 'Built by the runtime’s own code on the server' },
  demo: { text: 'demo imitation', title: 'Demo mode has no runtime: this is a simple imitation' },
  approximate: { text: 'approximate', title: 'The server could not be asked, so this was built in your browser and its wording and order may differ' },
};

// Inside the form, the config is read from the form's store.
export function PromptPreviewFromForm({ agentId }) {
  const config = useConfigSelect((c) => c, Object.is);
  return <PromptPreview agentId={agentId} config={config} />;
}

//   config: given by a screen that has the whole config in hand (the Agent page)
//   startOpen: drawn open (in its own panel, from the agent's bar), not as a row to open
export default function PromptPreview({ agentId, config, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [exactOpen, setExactOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const what = useWhatIf(config);
  const preview = usePromptPreview({
    config,
    agentId,
    channel: what.channel,
    state: what.state,
    nowLocal: what.nowLocal,
    callerPhone: what.callerPhone,
    enabled: open,
  });
  const prompt = preview.data;
  const advice = useMemo(() => promptAdvice(prompt), [prompt]);
  const source = SOURCE[preview.source];

  return (
    <details
      className={`stPromptPreview ${startOpen ? 'standalone' : ''}`}
      open={startOpen || undefined}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {/* a row like the setting rows around it: what it is, one grey line, and a chevron that turns when it opens */}
      <summary>
        <span className="nlRowIcon" aria-hidden="true">
          <Icon name="records" size={18} />
        </span>
        <span className="nlRowText">
          <strong>
            Preview the prompt{' '}
            {source && (
              <span className={`stTag ${preview.source === 'server' ? 'good' : ''}`} title={source.title}>
                {source.text}
              </span>
            )}
          </strong>
          <small>Everything the model is told, put together from this page</small>
        </span>
        <Icon name="chevronDown" size={16} className="stPromptChev" />
      </summary>
      {open && (
        <div className="stPromptBody">
          <WhatIfBar config={config} what={what} />

          {preview.source === 'approximate' && (
            <p className="stFWarn" role="note">
              The server couldn’t be asked ({preview.error?.message || 'no answer'}), so this is an <strong>approximate</strong> preview built in your browser:
              the runtime’s own wording and order may differ.
            </p>
          )}
          {preview.note && (
            <p className="stFWarn" role="note">
              {preview.note}
            </p>
          )}

          {!prompt ? (
            preview.loading ? (
              <p className="stFEmpty" role="status">
                Asking the server…
              </p>
            ) : (
              <p className="stFEmpty">Give this agent an id to preview its prompt.</p>
            )
          ) : (
            <>
              <p className="stPromptTotal" role="status">
                <strong>{prompt.stats.words.toLocaleString()}</strong> word{prompt.stats.words === 1 ? '' : 's'} · about{' '}
                <strong>{prompt.stats.tokens.toLocaleString()}</strong> tokens · <strong>{prompt.stats.toolsOffered}</strong> tool
                {prompt.stats.toolsOffered === 1 ? '' : 's'} offered
                {preview.loading && <span className="stMuted"> · updating…</span>}
              </p>
              {advice.map((item) => (
                <p key={item.id} className="stFWarn" role="note" data-advice={item.id}>
                  {item.text}
                </p>
              ))}

              {prompt.sections.length === 0 && <p className="stFEmpty">Nothing to show yet: this agent has no role or persona text.</p>}
              {prompt.sections.map((section) => (
                <section key={section.id} className={`stPromptSection ${section.active ? '' : 'conditional off'}`} data-section={section.kind}>
                  <header>
                    <strong>{section.label}</strong>
                    <small>
                      {section.active
                        ? section.when
                          ? `in now · ${describeWhen(section.when)}`
                          : 'in the prompt'
                        : `not in right now${section.when ? ` · only ${describeWhen(section.when)}` : ''}`}
                    </small>
                  </header>
                  <pre>
                    <Marked text={section.text} />
                  </pre>
                </section>
              ))}

              {(prompt.opening || prompt.greeting) && (
                <section className="stPromptSection" data-section="spoken">
                  <header>
                    <strong>What it says first</strong>
                    <small>not part of the instructions</small>
                  </header>
                  {prompt.greeting && (
                    <p className="stPromptSay">
                      <b>Greeting:</b> {prompt.greeting}
                    </p>
                  )}
                  {prompt.opening && (
                    <p className="stPromptSay">
                      <b>When it takes over:</b> {prompt.opening}
                    </p>
                  )}
                </section>
              )}

              {prompt.tools.length > 0 && (
                <details className="stPromptTools">
                  <summary>
                    The tools it is offered ({prompt.tools.filter((t) => t.offered).length}
                    {prompt.tools.some((t) => !t.offered) ? ` of ${prompt.tools.length}` : ''})
                  </summary>
                  <ul>
                    {prompt.tools.map((tool) => (
                      <li key={tool.name} className={tool.offered ? '' : 'off'}>
                        <code>{tool.name}</code>
                        {tool.description && <span> {tool.description}</span>}
                        {!tool.offered && <em> not offered{tool.reason ? `: ${tool.reason}` : ''}</em>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <PromptExtras prompt={prompt} />

              <details className="stPromptExact" open={exactOpen || undefined} onToggle={(event) => setExactOpen(event.currentTarget.open)}>
                <summary>The exact text the model receives</summary>
                <pre aria-label="The exact instructions">{prompt.instructions}</pre>
                <button
                  type="button"
                  className="quietButton"
                  onClick={async () => {
                    // writeText answers later: a blocked clipboard rejects
                    // then, so it is awaited (as the Alerts page's Copy does)
                    try {
                      await navigator.clipboard.writeText(prompt.instructions);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1800);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </details>
            </>
          )}
        </div>
      )}
    </details>
  );
}
