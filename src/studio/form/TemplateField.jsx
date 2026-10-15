import React, { useRef } from 'react';
import { RUNTIME_ROOTS, TEMPLATE_FILTERS, highlightSegments, insertAt, insertables, templateProblems, wordCount } from './templates.js';

// A text box for a string the runtime reads as a template ({{state.x}}, {{args.x}}, {{const.x}}). It helps write one
// (a click inserts a value at the caret), shows which parts are templates, and hints at a name that may point at nothing (in amber, never
// red: the names depend on where the text sits, so the server's check, with its path, is the one that counts).
// `scope` says which names exist (see templateScope). `showCount` adds a word count (for the text a model is given).
export default function TemplateField({ value, onChange, scope, multiline = false, placeholder, id, disabled, mono = true, rows, ariaLabel, invalid, showCount = false }) {
  const ref = useRef(null);
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const problems = templateProblems(text, scope);
  const chips = insertables(scope);

  // `back` puts the caret that many characters before the end of what was inserted (`{{call.}}` with 2: before the braces).
  const insert = (snippet, back = 0) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const result = insertAt(text, start, end, snippet);
    onChange(result.text);
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(result.caret - back, result.caret - back); });
  };
  const common = { id, value: text, disabled, placeholder, spellCheck: false, 'aria-label': ariaLabel, 'aria-invalid': invalid ? true : undefined, onChange: (event) => onChange(event.target.value), ref };

  return (
    <div className="stTpl">
      {multiline
        ? <textarea className={`stFInput ${mono ? 'mono' : ''}`} rows={rows || Math.min(10, Math.max(3, text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 90)), 0) + 1))} {...common} />
        : <input className={`stFInput ${mono ? 'mono' : ''}`} type="text" {...common} />}
      {text.includes('{{') && (
        <div className="stTplPreview" aria-label="Template preview">
          {highlightSegments(text, scope).map((segment, index) => <span key={index} className={`seg ${segment.kind}`}>{segment.text}</span>)}
        </div>
      )}
      {showCount && <small className="stMuted stTplCount">{wordCount(text)} word{wordCount(text) === 1 ? '' : 's'}</small>}
      {problems.map((problem, index) => <small key={index} className="stFWarn stTplHint" role="note">{problem.text} {problem.reason}</small>)}
      {!disabled && (
        <details className="stTplInsert">
          <summary>Insert a value</summary>
          <div className="stTplChips">
            {chips.length === 0 && <span className="stMuted">No state variables, constants or arguments yet.</span>}
            {chips.map((chip) => <button type="button" key={chip.label} className="stTplChip" title={`Insert ${chip.snippet}`} onClick={() => insert(chip.snippet)}>{chip.label}</button>)}
            {scope.names.args !== null && <button type="button" className="stTplChip" onClick={() => insert('{{result.}}', 2)} title="A field of the API response">result.…</button>}
          </div>
          <div className="stTplChips">
            <span className="stMuted">Also:</span>
            {RUNTIME_ROOTS.map((item) => <button type="button" key={item.root} className="stTplChip" title={item.help} onClick={() => insert(`{{${item.root}.}}`, 2)}>{`${item.root}.…`}</button>)}
          </div>
          <div className="stTplChips">
            <span className="stMuted">Filters:</span>
            {TEMPLATE_FILTERS.map((filter) => <button type="button" key={filter.name} className="stTplChip filter" title={filter.help} onClick={() => insert(` | ${filter.snippet}`)}>{`| ${filter.name}`}</button>)}
          </div>
        </details>
      )}
    </div>
  );
}
