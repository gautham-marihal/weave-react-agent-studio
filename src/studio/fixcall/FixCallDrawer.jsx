import React, { useMemo, useState } from 'react';
import Drawer from '../agent/Drawer.jsx';
import ReplayView from '../replay/ReplayView.jsx';
import { diffConfigs } from '../../demo/diff.js';
import { plainChanges } from '../compare/plainCompare.js';
import { diagnoseCall, headline } from './diagnose.js';
import { applyFixes, fixesFor } from './fixes.js';
import './fixcall.css';

const SEVERITY = { high: 'Serious', medium: 'Worth fixing', low: 'Worth knowing' };

// "Fix this call": what went wrong in this call (with the evidence), what is suggested for it (as sentences, before
// anything is changed), the call played again with those changes, and then the changes put into the draft, with a test
// so the call is checked from then on. Nothing changes until the last button.
export default function FixCallDrawer({ botId, facts, call, events, editor, onClose, onApplied }) {
  const config = editor.parsed.value;
  const findings = useMemo(() => diagnoseCall(facts, { call, config }), [facts, call, config]);
  const [chosen, setChosen] = useState(findings[0]?.id || '');
  const finding = findings.find((f) => f.id === chosen) || null;
  const fixes = useMemo(() => (finding ? fixesFor(finding, config) : []), [finding, config]);
  const [ticked, setTicked] = useState(() => new Set());
  const [trying, setTrying] = useState(false);

  const picked = fixes.filter((f) => ticked.has(f.id) && !f.applied(config));
  const candidate = useMemo(() => applyFixes(config, picked), [config, picked]);
  const sentences = useMemo(() => plainChanges(diffConfigs(config, candidate)), [config, candidate]);
  const candidateEditor = useMemo(
    () => ({ ...editor, parsed: { ...editor.parsed, value: candidate }, text: JSON.stringify(candidate, null, 2), dirty: false }),
    [editor, candidate],
  );
  const needsRuntime = picked.some((f) => f.needsRuntime);

  const choose = (id) => {
    setChosen(id);
    setTicked(new Set());
    setTrying(false);
  };
  const tick = (id) => {
    setTicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setTrying(false);
  };
  const apply = () => {
    if (!picked.length) return;
    onApplied({ previous: config, fixes: picked, finding });
    editor.setValue(candidate);
    onClose();
  };

  return (
    <Drawer
      title="Fix this call"
      icon="sparkle"
      width="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="quietButton" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primaryCta compactCta" onClick={apply} disabled={picked.length === 0}>
            {picked.length > 1 ? `Put these ${picked.length} changes in the draft` : 'Put this change in the draft'}
          </button>
        </>
      }
    >
      <div className="fxBody">
        <section className="fxBlock" aria-label="What went wrong">
          <header>
            <h3>1. What went wrong</h3>
            <p>{headline(findings)} These come from what was recorded in the call; nothing is guessed.</p>
          </header>
          {findings.length === 0 ? (
            <p className="fxNone">If the call still felt wrong, replay it or keep it as a test, then say below what should have happened.</p>
          ) : (
            <ul className="fxFindings" role="radiogroup" aria-label="Findings">
              {findings.map((f) => (
                <li key={f.id}>
                  <label className={`fxFinding ${chosen === f.id ? 'on' : ''}`}>
                    <input type="radio" name="fx-finding" checked={chosen === f.id} onChange={() => choose(f.id)} aria-label={f.title} />
                    <span className="fxFindingText">
                      <strong>{f.title}</strong>
                      {f.evidence.map((e, i) => (
                        <small key={i}>{e}</small>
                      ))}
                    </span>
                    <span className={`fxSeverity ${f.severity}`}>{SEVERITY[f.severity]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {finding && (
          <section className="fxBlock" aria-label="Suggested changes">
            <header>
              <h3>2. What to change</h3>
              <p>Suggested from a checklist of common remedies, not by an AI. Tick the ones you want; each is shown as it would be written in the draft.</p>
            </header>
            {fixes.length === 0 ? (
              <p className="fxNone">There is no ready-made change for this one. Replay the call, or keep it as a test and fix it by hand.</p>
            ) : (
              <ul className="fxFixes" aria-label="Changes">
                {fixes.map((fix) => {
                  const done = fix.applied(config);
                  return (
                    <li key={fix.id}>
                      <label className={`fxFix ${ticked.has(fix.id) ? 'on' : ''} ${done ? 'done' : ''}`}>
                        <input type="checkbox" checked={ticked.has(fix.id) || done} disabled={done} onChange={() => tick(fix.id)} aria-label={fix.title} />
                        <span className="fxFixText">
                          <strong>{fix.title}</strong>
                          <small>{fix.why}</small>
                          <em>{done ? 'Already in the draft.' : fix.change}</em>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {picked.length > 0 && (
          <section className="fxBlock" aria-label="Check the change">
            <header>
              <h3>3. Check it</h3>
              <p>Play this call again with these changes, and see what is different.</p>
            </header>
            <div className="fxChanges" aria-label="What changes in the draft">
              <strong>In the draft</strong>
              <ul>{sentences.groups.flatMap((g) => g.items.map((item, i) => <li key={`${g.key}-${i}`}>{item.text}</li>))}</ul>
            </div>
            {needsRuntime && (
              <p className="fxHonest" role="note">
                The replay in the browser is a simulation: it follows tools and hand-overs but does not read instructions, so it cannot show a change of
                wording. To see one, replay on the runtime, or keep the call as a test and run it.
              </p>
            )}
            {!trying ? (
              <button type="button" className="quietButton" onClick={() => setTrying(true)}>
                Replay the call with these changes
              </button>
            ) : (
              <ReplayView key={JSON.stringify(candidate)} botId={botId} events={events} editor={candidateEditor} draftLabel="The draft with these changes" />
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
