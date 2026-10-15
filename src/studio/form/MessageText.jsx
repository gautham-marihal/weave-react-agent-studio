import React, { useState } from 'react';
import { isObj } from './engine.js';
import { useConfigSelect, useForm } from './ctx.js';
import TemplateField from './TemplateField.jsx';
import { scopeAt } from './templates.js';
import { LANGUAGE_PATTERN, hasLanguage, languageProblem, languageStatus, primaryOf, toLanguages, toPlain, wantedLanguages } from './messages.js';

// The text of a message: one line for everyone, or the same line per language. In per-language mode every language the agent speaks
// has a row, so a missing one is plain to see (and one click adds it), and the primary language can't be left out by accident.
export default function MessageText({ value, onChange, path, disabled }) {
  const ctx = useForm();
  const perLanguage = isObj(value);
  const { scope, primary, wanted, status } = useConfigSelect((c) => ({ scope: scopeAt(c, path), primary: primaryOf(c), wanted: wantedLanguages(c), status: isObj(value) ? languageStatus(value, c) : null }));
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState('');

  if (!perLanguage) {
    return (
      <div className="stMsgText">
        <TemplateField value={typeof value === 'string' ? value : ''} onChange={onChange} scope={scope} multiline mono={false} disabled={disabled} ariaLabel="Message text" />
        {!disabled && (
          <button type="button" className="stLink" onClick={() => onChange(toLanguages(value, ctx.store.get()))}>
            Write it in more than one language{wanted.length > 1 ? ` (${wanted.join(', ')})` : ''}
          </button>
        )}
      </div>
    );
  }

  // Rows: the languages already written first (primary on top), then the ones still missing.
  const written = Object.keys(value).sort((a, b) => (hasLanguage({ [a]: 1 }, primary) ? -1 : 0) - (hasLanguage({ [b]: 1 }, primary) ? -1 : 0));
  const set = (code, text) => onChange({ ...value, [code]: text });
  const add = (code) => { onChange({ ...value, [code]: '' }); };
  const remove = (code) => {
    ctx.markDelete(`the ${code} text`);
    const { [code]: _gone, ...rest } = value;
    onChange(rest);
  };
  const submit = () => {
    const bad = languageProblem(adding, value);
    if (bad) { setProblem(bad); return; }
    add(adding.trim()); setAdding(''); setProblem('');
  };

  return (
    <div className="stMsgText stMsgLanguages">
      {status.primaryMissing && <small className="stFErr">The primary language ({primary}) needs a text. Without it, callers in that language have nothing to hear.</small>}
      {written.map((code) => {
        const isPrimary = !!primary && hasLanguage({ [code]: 1 }, primary);
        return (
          <div className="stLangRow" key={code} data-lang={code}>
            <div className="stLangHead">
              <code>{code}</code>
              {isPrimary && <span className="stFTag">primary</span>}
              {!disabled && !isPrimary && <button type="button" className="stFDel small" aria-label={`Delete the ${code} text`} onClick={() => remove(code)}>Delete</button>}
            </div>
            <TemplateField value={value[code]} onChange={(text) => set(code, text)} scope={scope} multiline mono={false} disabled={disabled} ariaLabel={`Text in ${code}`} rows={2} />
            {value[code] === '' && <small className="stFWarn">Empty. A line with no text is refused.</small>}
          </div>
        );
      })}
      {status.missing.length > 0 && (
        <div className="stLangMissing" role="note">
          <span className="stFTag warn">missing</span> The agent speaks {status.missing.join(', ')}, but this message has no text for {status.missing.length === 1 ? 'it' : 'them'}.
          {!disabled && status.missing.map((code) => <button type="button" key={code} className="stLink" onClick={() => add(code)}>＋ Add {code}</button>)}
        </div>
      )}
      {!disabled && (
        <div className="stFAddKey">
          <input className="stFInput small" type="text" spellCheck={false} value={adding} placeholder="Another language, e.g. fr" aria-label="Another language code" aria-invalid={!!problem || undefined}
            onChange={(event) => { setAdding(event.target.value); setProblem(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} pattern={LANGUAGE_PATTERN.source} />
          <button type="button" className="stAddBtn" disabled={!adding.trim()} onClick={submit}>＋ Add language</button>
          {problem && <small className="stFErr">{problem}</small>}
        </div>
      )}
      {!disabled && (
        <button type="button" className="stLink" onClick={() => { ctx.markDelete('the other languages'); onChange(toPlain(value, ctx.store.get())); }}>
          Use one text for every language (keeps the {primary ? `${primary}` : 'first'} one)
        </button>
      )}
    </div>
  );
}
