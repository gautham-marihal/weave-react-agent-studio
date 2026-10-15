import React, { Suspense, forwardRef, lazy, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { groupIssues } from '../api/client.js';
import { formatPath, formatWhen, prettyJson } from './format.js';
import { useTechnicalNames } from './usePref.js';
import { onSettingFocus, takeSettingFocus } from './settingFocus.js';
import { lineOf, locatePath } from './jsonPath.js';
// The form (with the catalogue of plain-language labels, the layout and the relationship views) and the plain-language problem list are loaded when they are
// first shown: the Simple view needs neither.
const FormEditor = lazy(() => import('./form/FormEditor.jsx'));
const IssueRows = lazy(() => import('./validation/IssueRows.jsx'));
import SimpleConfig from './simple/SimpleConfig.jsx';
import ChatPreview from './preview/ChatPreview.jsx';
import { splitUnsupported } from './preflight.js';
import { ErrorState, Notice, Spinner } from './ui.jsx';

const LINE_HEIGHT = 20;

const JsonEditor = forwardRef(function JsonEditor({ text, onChange, errorLines }, ref) {
  const areaRef = useRef(null);
  const gutterRef = useRef(null);
  const lineCount = useMemo(() => text.split('\n').length, [text]);

  useImperativeHandle(ref, () => ({
    jumpToOffset(offset) {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(offset, Math.min(text.length, offset + 40));
      area.scrollTop = Math.max(0, (lineOf(text, offset) - 4) * LINE_HEIGHT);
      if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
    },
    jumpTo(path) {
      const span = locatePath(text, path);
      const area = areaRef.current;
      if (!span || !area) return;
      area.focus();
      area.setSelectionRange(span[0], Math.min(span[1], span[0] + 400));
      area.scrollTop = Math.max(0, (lineOf(text, span[0]) - 4) * LINE_HEIGHT);
      if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
    },
  }), [text]);

  const onKeyDown = (event) => {
    // Ctrl/Cmd+S is handled once, on the window (see ConfigTab).
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const area = event.target;
      const { selectionStart: start, selectionEnd: end } = area;
      onChange(`${text.slice(0, start)}  ${text.slice(end)}`);
      window.requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
    }
  };

  return (
    <div className="stEditor">
      <div className="stGutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index} className={errorLines.has(index + 1) ? 'bad' : ''}>{index + 1}</span>
        ))}
      </div>
      <textarea
        ref={areaRef}
        className="stTextarea"
        value={text}
        spellCheck={false}
        wrap="off"
        aria-label="Agent configuration (JSON)"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.target.scrollTop; }}
      />
    </div>
  );
});

export function ValidationPanel({ editor, onJump, onJumpOffset, folded = false, onFold, onApply, onOpenModels }) {
  const { report, validating, parsed } = editor;
  const issues = useMemo(() => groupIssues(report), [report]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const { security, advice } = splitUnsupported(report?.unsupported);

  let headline;
  if (parsed.duplicates?.length) headline = { tone: 'bad', text: 'A key is repeated' };
  else if (parsed.error) headline = { tone: 'bad', text: 'Not valid JSON' };
  else if (!editor.isObject) headline = { tone: 'bad', text: 'The config must be a JSON object' };
  else if (!report) headline = { tone: 'idle', text: 'Checking…' };
  else if (report.valid && advice.length) headline = { tone: 'warn', text: `Valid, with ${advice.length} part${advice.length === 1 ? '' : 's'} that will not run` };
  else if (report.valid) headline = { tone: 'good', text: 'Valid. Ready to publish' };
  else headline = { tone: 'bad', text: `${errors.length} error${errors.length === 1 ? '' : 's'} to fix before publishing` };

  // What the folded line says besides the verdict: so a hidden panel never hides that parts of the agent will not run, or that a key is missing.
  const secretCount = (report?.secrets_required || []).length;
  const summaryLine = parsed.error || !report ? '' : [
    security.length ? `${security.length} not enforced` : '',
    report.valid && advice.length ? '' : advice.length ? `${advice.length} not available yet` : '',
    warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
    secretCount ? `${secretCount} secret${secretCount === 1 ? '' : 's'} needed` : '',
  ].filter(Boolean).join(' · ');

  return (
    <aside className={`stValidation ${folded ? 'folded' : ''}`} aria-label="Validation">
      <div className={`stValidationHead ${headline.tone}`}>
        <i aria-hidden="true" />
        <div>
          <strong>{headline.text}</strong>
          {folded && summaryLine && <small className="stValidationSummary">{summaryLine}</small>}
          {!folded && <small>{validating ? 'Checking your latest edit…' : warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}, which never block publishing` : 'Saving is always allowed, even with errors.'}</small>}
        </div>
        {onFold && <button type="button" className="stFoldBtn" aria-expanded={!folded} aria-label={folded ? 'Show the checks' : 'Hide the checks'} onClick={onFold}>{folded ? '▸' : '▾'}</button>}
      </div>

      {security.length > 0 && !parsed.error && (
        <div className="stSecurity" role="alert">
          <strong>{security.length} protection{security.length === 1 ? ' is' : 's are'} declared but not enforced</strong>
          <p>The agent looks protected and is not: the runtime doesn’t enforce {security.length === 1 ? 'this' : 'these'} yet. Don’t rely on {security.length === 1 ? 'it' : 'them'}, and think twice before deploying to production.</p>
          <ul>{security.map((item, index) => <li key={index}>{item.feature} <code>{item.where}</code></li>)}</ul>
        </div>
      )}
      {!folded && <>
      {parsed.error && <p className="stParseError">{parsed.error}</p>}
      {parsed.duplicates?.length > 0 && (
        <ul className="stIssues">
          {parsed.duplicates.map((item, index) => (
            <li key={index} className="error">
              <button type="button" onClick={() => onJumpOffset?.(item.offset)} title="Show the repeat">
                <b aria-hidden="true">!</b>
                <span><code>{formatPath([...item.path, item.key])}</code><em>Repeated key “{item.key}”. This one would win; the first would be lost.</em></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!parsed.error && (errors.length > 0 || warnings.length > 0) && (
        <Suspense fallback={<Spinner label="Reading the checks" />}><IssueRows issues={[...errors, ...warnings]} config={editor.parsed.value} onJump={onJump} onApply={onApply} onOpenModels={onOpenModels} foldAdvice /></Suspense>
      )}

      {advice.length > 0 && (
        <details className="stFold amber">
          <summary>Not available yet ({advice.length})</summary>
          <p className="stFoldNote">The runtime can’t run these parts of this agent yet. They are saved but will have no effect.</p>
          <ul className="stPlain">
            {advice.map((item, index) => (
              <li key={index}>{item.feature} <code>{item.where}</code></li>
            ))}
          </ul>
        </details>
      )}

      {report?.secrets_required?.length > 0 && (
        <details className="stFold">
          <summary>Secrets this agent needs ({report.secrets_required.length})</summary>
          <p className="stFoldNote">Names only. Values live in the server’s environment and cannot be set from here yet.</p>
          <div className="stChips">{report.secrets_required.map((name) => <code key={name}>{name}</code>)}</div>
        </details>
      )}
      </>}
    </aside>
  );
}

export default function ConfigTab({ editor, focusPath, botId, preview }) {
  const editorRef = useRef(null);
  const { text, parsed, report, dirty, saving, status } = editor;
  // Simple (cards for the everyday settings), All settings (the form built from the schema) or raw JSON. All of them edit the same
  // draft; the choice is remembered. An older models choice opens the Simple view on its AI model card.
  const [mode, setModeState] = useState(() => { try { const saved = localStorage.getItem('weave_config_mode'); return saved === 'json' ? 'json' : saved === 'form' ? 'form' : 'simple'; } catch { return 'simple'; } });
  const [openCard, setOpenCard] = useState(() => { try { return localStorage.getItem('weave_config_mode') === 'models' ? 'model' : null; } catch { return null; } });
  const setMode = (next) => { setModeState(next); try { localStorage.setItem('weave_config_mode', next); } catch { /* storage unavailable */ } };
  const showModels = () => { setOpenCard('model'); setMode('simple'); };
  const [technical, setTechnical] = useTechnicalNames();
  // A fix from the checks is an ordinary edit of the draft, with a way back.
  const [lastFix, setLastFix] = useState(null); // { label, previous }
  const openInJson = (path) => { setMode('json'); window.setTimeout(() => editorRef.current?.jumpTo(path), 80); };
  const [focusReq, setFocusReq] = useState(null);
  const applyFix = (next, label, jumpTo) => {
    setLastFix({ label, previous: editor.parsed.value });
    editor.setValue(next);
    if (jumpTo) window.setTimeout(() => jump(jumpTo), 60);
  };
  const jump = (path) => {
    if (mode === 'json') editorRef.current?.jumpTo(path);
    else {
      // The Simple view shows only the everyday settings, so a problem elsewhere opens All settings at that field.
      if (mode === 'simple') setMode('form');
      setFocusReq({ path, nonce: Date.now() });
    }
  };
  // The preview beside the editor, and the checks, can each be folded away; the choice is remembered.
  const [previewOpen, setPreviewOpenState] = useState(() => { try { const saved = localStorage.getItem('weave_preview_open'); if (saved !== null) return saved === '1'; return window.matchMedia ? window.matchMedia('(min-width: 1200px)').matches : true; } catch { return true; } });
  const setPreviewOpen = (value) => { setPreviewOpenState(value); try { localStorage.setItem('weave_preview_open', value ? '1' : '0'); } catch { /* storage unavailable */ } };
  const [checksFolded, setChecksFoldedState] = useState(() => { try { const saved = localStorage.getItem('weave_checks_folded'); return saved === null ? null : saved === '1'; } catch { return null; } });
  const folded = checksFolded === null ? mode === 'simple' : checksFolded;
  const setChecksFolded = (value) => { setChecksFoldedState(value); try { localStorage.setItem('weave_checks_folded', value ? '1' : '0'); } catch { /* storage unavailable */ } };

  const errorLines = useMemo(() => {
    const lines = new Set();
    // A repeated key is marked on both lines; any other problem with the text has no line of its own.
    (parsed.duplicates || []).forEach((item) => { lines.add(lineOf(text, item.offset)); lines.add(lineOf(text, item.firstOffset)); });
    if (parsed.error) return lines;
    groupIssues(report).filter((issue) => issue.severity === 'error' && issue.path).forEach((issue) => {
      const span = locatePath(text, issue.path);
      if (span) lines.add(lineOf(text, span[0]));
    });
    return lines;
  }, [text, report, parsed.error]);

  // Ctrl/Cmd+S saves from anywhere on this tab, not just inside the text box.
  const saveRef = useRef(editor.save);
  saveRef.current = editor.save;
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Something was just added to the draft from another page: show where.
  useEffect(() => {
    if (!focusPath || status !== 'ready') return undefined;
    const timer = window.setTimeout(() => jump(focusPath), 200);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPath, status]);

  // A setting found by the search is shown here, whichever tab the search was used from.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const run = () => { const request = takeSettingFocus(botId); if (request) jump(request.path); };
    run();
    return onSettingFocus(run);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, status, mode]);

  if (status === 'loading') return <Spinner label="Loading the draft" />;
  if (status === 'error') return <ErrorState error={editor.loadError} onRetry={editor.reload} what="the draft" />;

  const format = () => { if (!parsed.error && editor.isObject) editor.setText(prettyJson(parsed.value)); };
  const discard = () => {
    if (dirty && !window.confirm('Discard your unsaved edits and reload the saved draft?')) return;
    editor.reload();
  };
  const canSave = dirty && !saving && !parsed.error && editor.isObject;

  return (
    <div className="stConfig">
      {editor.conflict && (
        <Notice
          kind="warn"
          title="Someone else saved this draft after you opened it"
          actions={(
            <>
              <button type="button" className="quietButton" onClick={editor.reload}>Load theirs (drop my edits)</button>
              <button type="button" className="dangerButton" onClick={() => editor.save({ overwrite: true })}>Overwrite with mine</button>
            </>
          )}
        >
          Your changes were not saved. Overwriting replaces their version of the draft.
        </Notice>
      )}
      {lastFix && <Notice kind="info" title={`${lastFix.label}.`} actions={<><button type="button" className="quietButton" onClick={() => { editor.setValue(lastFix.previous); setLastFix(null); }}>Undo</button><button type="button" className="quietButton" onClick={() => setLastFix(null)}>Dismiss</button></>}>The checks will run again on the change.</Notice>}
      {editor.saveError && <Notice kind="error" title="Couldn’t save the draft" actions={<button type="button" className="quietButton" onClick={editor.dismissSaveError}>Dismiss</button>}>{editor.saveError.message}</Notice>}

      <div className="stToolbar">
        <div className="stSaveState" aria-live="polite">
          {parsed.error ? <span className="bad">{parsed.duplicates?.length ? 'Remove the repeated key to save' : 'Fix the JSON to save'}</span>
            : dirty ? <span className="warn">Unsaved changes</span>
              : <span className="good">Saved{editor.meta.savedAt ? ` ${formatWhen(editor.meta.savedAt)}` : ''}{editor.meta.savedBy ? ` by ${editor.meta.savedBy}` : ''}</span>}
          <small>draft revision {editor.revision}</small>
        </div>
        <div className="stToolbarActions">
          <div className="stMode" role="group" aria-label="Editor">
            <button type="button" className={mode === 'simple' ? 'on' : ''} aria-pressed={mode === 'simple'} onClick={() => setMode('simple')} title="The everyday settings: instructions, voice and language, AI model, connections">Simple</button>
            <button type="button" className={mode === 'form' ? 'on' : ''} aria-pressed={mode === 'form'} onClick={() => setMode('form')} title="Every setting, as a form built from the schema">All settings</button>
            {/* The raw file is for people who work with it: it appears with technical names (or while it is the view in use), so a customer's first screen has no jargon. */}
            {(technical || mode === 'json') && <button type="button" className={mode === 'json' ? 'on' : ''} aria-pressed={mode === 'json'} onClick={() => setMode('json')} title="The configuration file itself">JSON</button>}
          </div>
          {mode !== 'json' && (
            <label className="stTechSwitch" title="Show the name the configuration file uses beside every setting, and copy its path or open it in the JSON">
              <input type="checkbox" checked={technical} onChange={(event) => setTechnical(event.target.checked)} /> Technical names
            </label>
          )}
          {preview && <button type="button" className="quietButton" aria-pressed={previewOpen} onClick={() => setPreviewOpen(!previewOpen)} title="Talk to the agent while you edit it">{previewOpen ? 'Hide preview' : 'Preview'}</button>}
          {mode === 'json' && <button type="button" className="quietButton" onClick={format} disabled={!!parsed.error || !editor.isObject}>Format</button>}
          <button type="button" className="quietButton" onClick={discard}>{dirty ? 'Discard changes' : 'Reload'}</button>
          <button type="button" className="primaryCta compactCta" onClick={() => editor.save()} disabled={!canSave}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>

      <div className="stConfigGrid">
        {mode === 'simple' && <SimpleConfig key={openCard || 'simple'} editor={editor} initialOpen={openCard} onShowJson={() => setMode('json')} onOpenJson={openInJson} onOpenAll={(path) => { setMode('form'); setFocusReq({ path, nonce: Date.now() }); }} />}
        {mode === 'form' && <Suspense fallback={<Spinner label="Loading the form" />}><FormEditor editor={editor} focusRequest={focusReq} onShowJson={() => setMode('json')} onOpenJson={openInJson} onShowModels={showModels} /></Suspense>}
        {mode === 'json' && <JsonEditor ref={editorRef} text={text} onChange={editor.setText} errorLines={errorLines} />}
        <div className="stRail">
          {preview && previewOpen && <ChatPreview session={preview.session} mode={preview.mode} modeLocked={preview.locked} onMode={preview.onMode} botId={botId} editor={editor} onClose={() => setPreviewOpen(false)} />}
          <ValidationPanel editor={editor} folded={folded} onFold={() => setChecksFolded(!folded)} onJump={jump} onApply={applyFix} onOpenModels={showModels} onJumpOffset={(offset) => { if (mode !== 'json') setMode('json'); window.setTimeout(() => editorRef.current?.jumpToOffset(offset), 60); }} />
        </div>
      </div>
    </div>
  );
}
