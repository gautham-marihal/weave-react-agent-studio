import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Annotation, EditorSelection, EditorState } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, bracketMatching, ensureSyntaxTree, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { locatePath } from '../jsonPath.js';
import type { JsonProblem } from './jsonProblems.ts';

// The configuration's JSON in a code editor (CodeMirror): colours for keys, text, numbers and true/false/null; folds;
// the matching bracket; Ctrl/Cmd+F to find and replace; and what is wrong marked where it is (underlined, a mark beside
// the line, the words when the pointer rests on it; F8 goes to the next). Tab indents; Escape then Tab leaves the
// editor. Ctrl/Cmd+S is the workspace's, as on every page. Its colours are the style's own (tokens), so it reads in
// every style, light and dark. It loads only when the JSON is opened (JsonEditor.jsx draws the plain editor until it is
// here).
//   text, onChange: the JSON, held by the workspace   problems: jsonProblems.ts   ref: jumpTo(path), jumpToOffset(offset)

export type JsonEditorHandle = { jumpTo: (path: (string | number)[]) => void; jumpToOffset: (offset: number) => void };
type Props = { text: string; onChange: (text: string) => void; problems: JsonProblem[]; label?: string };

// a change the workspace made (a form, a reload), not a key pressed here: not sent back to it
const fromOutside = Annotation.define<boolean>();

const colours = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--json-key)' },
  { tag: tags.string, color: 'var(--json-string)' },
  { tag: tags.number, color: 'var(--json-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--json-literal)', fontWeight: '600' },
  { tag: [tags.separator, tags.brace, tags.squareBracket], color: 'var(--json-punct)' },
]);

const look = EditorView.theme({
  '&': { height: '100%', color: 'var(--textStrong)', backgroundColor: 'transparent', fontSize: 'var(--fs-sm)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '20px', overflow: 'auto' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--textStrong)' },
  '.cm-line': { padding: '0 14px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--textStrong)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--textStrong) 4%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--dim)', borderRight: '1px solid var(--line)', fontSize: 'var(--fs-xs)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--textStrong) 6%, transparent)', color: 'var(--textStrong)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
  '.cm-foldGutter .cm-gutterElement': {
    width: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--muted)',
  },
  '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--textStrong)' },
  '.cm-foldPlaceholder': {
    margin: '0 4px',
    padding: '0 6px',
    border: '1px solid var(--line2)',
    borderRadius: '6px',
    backgroundColor: 'var(--panel)',
    color: 'var(--muted)',
    fontFamily: 'inherit',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
    borderRadius: '2px',
  },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--danger) 22%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--warn-text) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--warn-text) 45%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--warn-text) 40%, transparent)' },
  // the find bar: the studio's own fields and buttons
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', padding: '8px 40px 8px 12px', fontSize: 'var(--fs-sm)' },
  '.cm-search br': { display: 'none' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--muted)', fontSize: 'var(--fs-sm)' },
  '.cm-textfield': {
    height: '32px',
    margin: '0',
    padding: '0 10px',
    border: '1px solid var(--line2)',
    borderRadius: '8px',
    backgroundColor: 'var(--field, var(--panel))',
    color: 'var(--textStrong)',
    fontSize: 'var(--fs-sm)',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'color-mix(in srgb, var(--textStrong) 45%, var(--line2))' },
  '.cm-button': {
    height: '32px',
    margin: '0',
    padding: '0 12px',
    border: '1px solid var(--line2)',
    borderRadius: '8px',
    backgroundImage: 'none',
    backgroundColor: 'var(--panel)',
    color: 'var(--textStrong)',
    fontSize: 'var(--fs-sm)',
    fontWeight: '500',
    cursor: 'pointer',
  },
  '.cm-button:hover': { backgroundColor: 'var(--surface-hover, var(--surface2))' },
  '.cm-button:active': { backgroundImage: 'none' },
  '.cm-panel.cm-search [name=close]': { top: '50%', right: '12px', transform: 'translateY(-50%)', fontSize: '18px', color: 'var(--muted)', cursor: 'pointer' },
  // what is wrong: underlined, a mark beside the line, the words in a tip
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger-text)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn-text)', textUnderlineOffset: '3px' },
  '.cm-lintPoint-error:after': { borderBottomColor: 'var(--danger-text)' },
  '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--warn-text)' },
  '.cm-gutter-lint': { width: '18px' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-lint-marker': { width: '8px', height: '8px', borderRadius: '50%', content: 'none' },
  '.cm-lint-marker-error': { backgroundColor: 'var(--danger-text)' },
  '.cm-lint-marker-warning': { backgroundColor: 'var(--warn-text)' },
  '.cm-tooltip': {
    border: '1px solid var(--line2)',
    borderRadius: '8px',
    backgroundColor: 'var(--panel)',
    color: 'var(--textStrong)',
    boxShadow: 'var(--shadow)',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 'var(--fs-sm)',
    maxWidth: '480px',
  },
  '.cm-tooltip-lint': { padding: '4px 0' },
  '.cm-diagnostic': { padding: '6px 12px', lineHeight: '1.45', whiteSpace: 'normal' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger-text)' },
  '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warn-text)' },
});

// The editor reads the text a part at a time as it is shown; a whole configuration is read at once (it is quick), so
// the outer brace's partner, at the very end, is known from the start and not marked as missing.
const readWhole = (editor: EditorView) => {
  if (ensureSyntaxTree(editor.state, editor.state.doc.length, 300)) editor.dispatch({ selection: editor.state.selection });
};

const diagnosticsOf = (problems: JsonProblem[], length: number): Diagnostic[] =>
  problems
    .filter((p) => p.from <= length)
    .map((p) => ({ from: p.from, to: Math.min(Math.max(p.to, p.from), length), severity: p.severity, message: p.message }));

// a fold marker: the studio's chevron, pointing down when open and right when folded
const foldMarker = (open: boolean) => {
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${open ? 0 : -90}deg)"><path d="m6 9 6 6 6-6"/></svg>`;
  return mark;
};

const CodeJsonEditor = forwardRef<JsonEditorHandle, Props>(function CodeJsonEditor({ text, onChange, problems, label = 'Agent configuration (JSON)' }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          foldGutter({ markerDOM: foldMarker }),
          lintGutter(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          // the outer braces of a long configuration are far apart: they are still found, not marked as unmatched
          bracketMatching({ maxScanDistance: 2_000_000 }),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          json(),
          syntaxHighlighting(colours),
          look,
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...lintKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((t) => t.annotation(fromOutside))) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    readWhole(editor);
    // what the browser tests read the whole text through (the editor draws only the lines in sight)
    (host.current as HTMLDivElement & { weaveJsonText?: () => string }).weaveJsonText = () => editor.state.doc.toString();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // the editor is made once; the text and the problems follow below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the workspace's text, when it changed from outside (a form, a reload): the editor takes it, keeping the cursor where it can
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const now = editor.state.doc.toString();
    if (now === text) return;
    const { main } = editor.state.selection;
    const keep = (at: number) => Math.min(at, text.length);
    editor.dispatch({
      changes: { from: 0, to: now.length, insert: text },
      selection: EditorSelection.single(keep(main.anchor), keep(main.head)),
      annotations: fromOutside.of(true),
    });
    readWhole(editor);
  }, [text]);

  useEffect(() => {
    const editor = view.current;
    if (editor) editor.dispatch(setDiagnostics(editor.state, diagnosticsOf(problems, editor.state.doc.length)));
  }, [problems, text]);

  useImperativeHandle(ref, () => {
    const show = (from: number, to: number) => {
      const editor = view.current;
      if (!editor) return;
      const length = editor.state.doc.length;
      const a = Math.max(0, Math.min(from, length));
      editor.dispatch({ selection: EditorSelection.single(a, Math.max(a, Math.min(to, length))), effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      editor.focus();
    };
    return {
      // a line the browser named: the cursor on it, its words selected up to the end of that line
      jumpToOffset: (offset: number) => {
        const doc = view.current?.state.doc;
        if (!doc) return;
        const line = doc.lineAt(Math.max(0, Math.min(offset, doc.length)));
        show(offset, Math.min(line.to, offset + 40));
      },
      jumpTo: (path: (string | number)[]) => {
        const doc = view.current?.state.doc.toString() || '';
        const span = locatePath(doc, path);
        if (span) show(span[0], Math.min(span[1], span[0] + 400));
      },
    };
  }, []);

  return <div ref={host} className="stEditor stCodeEditor" />;
});

export default CodeJsonEditor;
