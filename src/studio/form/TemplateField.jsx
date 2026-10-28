import React, { useRef } from 'react';
import { RUNTIME_ROOTS, TEMPLATE_FILTERS, highlightSegments, insertAt, insertables, templateProblems, wordCount } from './templates.ts';
import { humanize } from './engine.js';
import { Input, TextArea } from '../../ui/Input.tsx';

// A text box for a runtime template ({{state.x}}, {{const.x}}): a click inserts a value at the caret. A name that may
// point at nothing is hinted in amber, never red: names depend on where the text sits, so the server's check decides.
//   scope: which names exist (see templateScope)
//   showCount: add a word count (for text a model is given)
//   plain: the menu for a person writing to the agent: "Insert a detail", details by name ("Order number"), no filters
export default function TemplateField({
  value,
  onChange,
  scope,
  multiline = false,
  placeholder,
  id,
  disabled,
  mono = true,
  rows,
  ariaLabel,
  invalid,
  showCount = false,
  plain = false,
}) {
  const ref = useRef(null);
  // whether the box has had the cursor: until then the person chose no place in it, so a value goes at the end
  const placed = useRef(false);
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const problems = templateProblems(text, scope);
  const chips = insertables(scope);

  // `back` puts the caret that many characters before the end of the insert (`{{call.}}` with 2: before the braces)
  const insert = (snippet, back = 0) => {
    const el = ref.current;
    const start = placed.current ? (el?.selectionStart ?? text.length) : text.length;
    const end = placed.current ? (el?.selectionEnd ?? start) : start;
    // at the end of words, after a space, so it is not glued to the last one
    const spaced = !placed.current && text && !/\s$/.test(text) ? ` ${snippet}` : snippet;
    placed.current = true;
    const result = insertAt(text, start, end, spaced);
    onChange(result.text);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret - back, result.caret - back);
    });
  };
  const common = {
    id,
    value: text,
    disabled,
    placeholder,
    spellCheck: false,
    'aria-label': ariaLabel,
    'aria-invalid': invalid ? true : undefined,
    onFocus: () => {
      placed.current = true;
    },
    onChange: (event) => onChange(event.target.value),
    ref,
  };

  return (
    <div className="stTpl">
      {multiline ? (
        <TextArea
          mono={mono}
          rows={rows || Math.min(10, Math.max(3, text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 90)), 0) + 1))}
          {...common}
        />
      ) : (
        <Input mono={mono} type="text" {...common} />
      )}
      {text.includes('{{') && (
        <div className="stTplPreview" aria-label="Template preview">
          {highlightSegments(text, scope).map((segment, index) => (
            <span key={index} className={`seg ${segment.kind}`}>
              {segment.text}
            </span>
          ))}
        </div>
      )}
      {showCount && (
        <small className="stMuted stTplCount">
          {wordCount(text)} word{wordCount(text) === 1 ? '' : 's'}
        </small>
      )}
      {problems.map((problem, index) => (
        <small key={index} className="stFWarn stTplHint" role="note">
          {problem.text} {problem.reason}
        </small>
      ))}
      {!disabled && plain && (
        <details className="stTplInsert">
          <summary>Insert a detail</summary>
          <div className="stTplChips">
            {chips.filter((chip) => chip.group !== 'argument').length === 0 && (
              <span className="stMuted">Nothing to insert yet. What it keeps during a call, and fixed values you set, show here.</span>
            )}
            {chips
              .filter((chip) => chip.group !== 'argument')
              .map((chip) => (
                <button
                  type="button"
                  key={chip.label}
                  className="stTplChip plain"
                  title={`${chip.group === 'state' ? 'What it keeps during the call' : 'A fixed value'}: inserts ${chip.snippet}`}
                  onClick={() => insert(chip.snippet)}
                >
                  {humanize(chip.label.replace(/^(state|const)[.]/, ''))}
                </button>
              ))}
          </div>
        </details>
      )}
      {!disabled && !plain && (
        <details className="stTplInsert">
          <summary>Insert a value</summary>
          <div className="stTplChips">
            {chips.length === 0 && <span className="stMuted">No state variables, constants or arguments yet.</span>}
            {chips.map((chip) => (
              <button type="button" key={chip.label} className="stTplChip" title={`Insert ${chip.snippet}`} onClick={() => insert(chip.snippet)}>
                {chip.label}
              </button>
            ))}
            {scope.names.args !== null && (
              <button type="button" className="stTplChip" onClick={() => insert('{{result.}}', 2)} title="A field of the API response">
                result.…
              </button>
            )}
          </div>
          <div className="stTplChips">
            <span className="stMuted">Also:</span>
            {RUNTIME_ROOTS.map((item) => (
              <button
                type="button"
                key={item.root}
                className="stTplChip"
                title={item.help}
                onClick={() => insert(`{{${item.root}.}}`, 2)}
              >{`${item.root}.…`}</button>
            ))}
          </div>
          <div className="stTplChips">
            <span className="stMuted">Filters:</span>
            {TEMPLATE_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.name}
                className="stTplChip filter"
                title={filter.help}
                onClick={() => insert(` | ${filter.snippet}`)}
              >{`| ${filter.name}`}</button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
