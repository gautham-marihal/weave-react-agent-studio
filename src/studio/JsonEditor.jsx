import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { lineOf, locatePath, syntaxErrorLine } from './jsonPath.js';
import { groupIssues } from '../api/client.js';

// The agent's configuration as JSON text, with line numbers and a way to jump to a place in it (a problem's path, a character offset). Ctrl/Cmd+S is
// the workspace's, as on every page.
const LINE_HEIGHT = 20;

export const JsonEditor = forwardRef(function JsonEditor({ text, onChange, errorLines }, ref) {
  const areaRef = useRef(null);
  const gutterRef = useRef(null);
  const lineCount = useMemo(() => text.split('\n').length, [text]);

  useImperativeHandle(
    ref,
    () => ({
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
    }),
    [text],
  );

  const onKeyDown = (event) => {
    // Ctrl/Cmd+S is handled once, on the window (the agent's workspace).
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
          <span key={index} className={errorLines.has(index + 1) ? 'bad' : ''}>
            {index + 1}
          </span>
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
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.target.scrollTop;
        }}
      />
    </div>
  );
});

// The whole configuration as JSON, with what is wrong with it said above it and marked beside it: a syntax error (with its line and a way to it), a key
// written twice (both lines), and, while the JSON reads, the settings the checks reject.
export function JsonPart({ editor }) {
  const { text, parsed, report } = editor;
  const area = useRef(null);
  const line = parsed.error && !parsed.duplicates?.length ? syntaxErrorLine(parsed.error, text) : null;
  const errorLines = useMemo(() => {
    const lines = new Set();
    (parsed.duplicates || []).forEach((item) => {
      lines.add(lineOf(text, item.offset));
      lines.add(lineOf(text, item.firstOffset));
    });
    if (line) lines.add(line);
    if (parsed.error) return lines;
    groupIssues(report)
      .filter((issue) => issue.severity === 'error' && issue.path)
      .forEach((issue) => {
        const span = locatePath(text, issue.path);
        if (span) lines.add(lineOf(text, span[0]));
      });
    return lines;
  }, [text, report, parsed.error, parsed.duplicates, line]);
  const offsetOfLine = (n) =>
    text
      .split('\n')
      .slice(0, n - 1)
      .reduce((sum, l) => sum + l.length + 1, 0);
  const first = parsed.duplicates?.[0];
  return (
    <div className="stJsonPart">
      {parsed.error && (
        <div className="stParseError" role="alert">
          <span>
            {line ? `Line ${line}: ` : ''}
            {parsed.error}
          </span>
          {(line || first) && (
            <button type="button" className="linkButton" onClick={() => area.current?.jumpToOffset(first ? first.offset : offsetOfLine(line))}>
              Go to {first ? 'the repeated key' : `line ${line}`}
            </button>
          )}
        </div>
      )}
      <JsonEditor ref={area} text={text} onChange={editor.setText} errorLines={errorLines} />
    </div>
  );
}
