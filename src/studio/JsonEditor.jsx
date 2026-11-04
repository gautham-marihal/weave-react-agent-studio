import React, { Suspense, forwardRef, lazy, useImperativeHandle, useMemo, useRef } from 'react';
import { lineOf, locatePath, syntaxErrorLine } from './jsonPath.js';
import { errorLinesOf, jsonProblems, offsetOfLine } from './json/jsonProblems.ts';

// The CodeMirror editor is loaded only when the JSON is opened.
const CodeJsonEditor = lazy(() => import('./json/CodeJsonEditor.tsx'));

// The configuration as plain JSON text, with line numbers and jumps to a path or offset. Shown while the code editor
// loads, and kept if it can't load (offline, say). Ctrl/Cmd+S belongs to the workspace, as on every page.
const LINE_HEIGHT = 20;

const JsonEditor = forwardRef(function JsonEditor({ text, onChange, errorLines }, ref) {
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
    <div
      className="stEditor"
      ref={(el) => {
        // the browser tests read the text through this, as they do the code editor's
        if (el) el.weaveJsonText = () => areaRef.current?.value ?? '';
      }}
    >
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

// if the code editor can't be loaded, the plain one stays
class OrPlain extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.plain : this.props.children;
  }
}

// The whole configuration as JSON, with problems listed above and marked inline: a syntax error (with its line), a key
// written twice (both places), and, while the JSON parses, what the checks say about a setting.
export function JsonPart({ editor }) {
  const { text, parsed, report } = editor;
  const area = useRef(null);
  const line = parsed.error && !parsed.duplicates?.length ? syntaxErrorLine(parsed.error, text) : null;
  const problems = useMemo(() => jsonProblems(text, parsed, report), [text, parsed, report]);
  const errorLines = useMemo(() => errorLinesOf(text, problems), [text, problems]);
  const first = parsed.duplicates?.[0];
  const plain = <JsonEditor ref={area} text={text} onChange={editor.setText} errorLines={errorLines} />;
  return (
    <div className="stJsonPart">
      {parsed.error && (
        <div className="stParseError" role="alert">
          <span>
            {line ? `Line ${line}: ` : ''}
            {parsed.error}
          </span>
          {(line || first) && (
            <button type="button" className="linkButton" onClick={() => area.current?.jumpToOffset(first ? first.offset : offsetOfLine(text, line))}>
              Go to {first ? 'the repeated key' : `line ${line}`}
            </button>
          )}
        </div>
      )}
      <OrPlain plain={plain}>
        <Suspense fallback={plain}>
          <CodeJsonEditor ref={area} text={text} onChange={editor.setText} problems={problems} />
        </Suspense>
      </OrPlain>
    </div>
  );
}
