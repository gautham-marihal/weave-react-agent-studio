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
  rectangularSelection } from
'@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, bracketMatching, ensureSyntaxTree, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { lintGutter, lintKeymap, nextDiagnostic, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { locatePath, type JsonPathPart, type JsonProblem } from '../../../utils/jsonCheck';

// The configuration's JSON in CodeMirror: highlighting, folds, bracket matching, find and replace (Ctrl/⌘+F), problems
// marked where they are (F8 goes to the next). Tab indents; Escape then Tab leaves the editor; Ctrl/⌘+S stays the
// workspace's Save. Loaded only when the JSON view opens (JsonView draws the plain editor until then).

export interface JsonEditorHandle {
  jumpTo: (path: JsonPathPart[]) => boolean;
  jumpToOffset: (offset: number) => void;
  nextProblem: () => void;
  openFind: () => void;
}

interface Props {
  text: string;
  onChange: (text: string) => void;
  problems: JsonProblem[];
  readOnly?: boolean;
  label?: string;
}

// A change the view made (a reload, another view's edit), not a key pressed here: not sent back.
const fromOutside = Annotation.define<boolean>();

const tone = (name: string, alpha?: number) => alpha === undefined ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${alpha})`;

const colours = HighlightStyle.define([
{ tag: tags.propertyName, color: tone('accent') },
{ tag: tags.string, color: tone('success') },
{ tag: tags.number, color: tone('info') },
{ tag: [tags.bool, tags.null], color: tone('warning'), fontWeight: '600' },
{ tag: [tags.separator, tags.brace, tags.squareBracket], color: tone('muted') }]
);

const look = EditorView.theme({
  '&': { height: '100%', maxHeight: '70vh', color: tone('ink'), backgroundColor: 'transparent', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', lineHeight: '20px', overflow: 'auto' },
  '.cm-content': { padding: '12px 0', caretColor: tone('ink') },
  '.cm-line': { padding: '0 14px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: tone('ink'), borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: tone('accent', 0.22) },
  '.cm-activeLine': { backgroundColor: tone('ink', 0.035) },
  '.cm-gutters': { backgroundColor: tone('canvas'), color: tone('muted'), borderRight: `1px solid ${tone('line')}`, fontSize: '12px' },
  '.cm-activeLineGutter': { backgroundColor: tone('ink', 0.06), color: tone('ink') },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
  '.cm-foldGutter .cm-gutterElement': { width: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: tone('muted') },
  '.cm-foldGutter .cm-gutterElement:hover': { color: tone('ink') },
  '.cm-foldPlaceholder': { margin: '0 4px', padding: '0 6px', border: `1px solid ${tone('line-strong')}`, borderRadius: '6px', backgroundColor: tone('subtle'), color: tone('muted'), fontFamily: 'inherit' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: tone('accent', 0.16), outline: `1px solid ${tone('accent', 0.5)}`, borderRadius: '2px' },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: tone('danger', 0.2) },
  '.cm-selectionMatch': { backgroundColor: tone('accent', 0.1) },
  '.cm-searchMatch': { backgroundColor: tone('warning', 0.2), outline: `1px solid ${tone('warning', 0.45)}` },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: tone('warning', 0.38) },
  // the find bar, in the studio's own fields and buttons
  '.cm-panels': { backgroundColor: tone('surface'), color: tone('ink-soft') },
  '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${tone('line')}` },
  '.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', padding: '8px 40px 8px 12px', fontSize: '13px', fontFamily: '"IBM Plex Sans", system-ui, sans-serif' },
  '.cm-search br': { display: 'none' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '5px', color: tone('muted'), fontSize: '13px' },
  '.cm-textfield': { height: '32px', margin: '0', padding: '0 10px', border: `1px solid ${tone('line-strong')}`, borderRadius: '6px', backgroundColor: tone('surface'), color: tone('ink'), fontSize: '13px' },
  '.cm-textfield:focus': { outline: 'none', borderColor: tone('accent'), boxShadow: `0 0 0 2px ${tone('accent', 0.25)}` },
  '.cm-button': { height: '32px', margin: '0', padding: '0 12px', border: `1px solid ${tone('line-strong')}`, borderRadius: '6px', backgroundImage: 'none', backgroundColor: tone('surface'), color: tone('ink'), fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  '.cm-button:hover': { backgroundColor: tone('subtle') },
  '.cm-button:active': { backgroundImage: 'none' },
  '.cm-panel.cm-search [name=close]': { top: '50%', right: '12px', transform: 'translateY(-50%)', fontSize: '18px', color: tone('muted'), cursor: 'pointer' },
  // what is wrong: underlined, a dot beside the line, the words in a tip
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: `underline wavy ${tone('danger')}`, textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: `underline wavy ${tone('warning')}`, textUnderlineOffset: '3px' },
  '.cm-lintPoint-error:after': { borderBottomColor: tone('danger') },
  '.cm-lintPoint-warning:after': { borderBottomColor: tone('warning') },
  '.cm-gutter-lint': { width: '18px' },
  '.cm-gutter-lint .cm-gutterElement': { padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  '.cm-lint-marker': { width: '8px', height: '8px', borderRadius: '50%', content: 'none' },
  '.cm-lint-marker-error': { backgroundColor: tone('danger') },
  '.cm-lint-marker-warning': { backgroundColor: tone('warning') },
  '.cm-tooltip': { border: `1px solid ${tone('line-strong')}`, borderRadius: '8px', backgroundColor: tone('surface'), color: tone('ink'), boxShadow: '0 12px 32px rgb(16 24 40 / 0.14)', fontFamily: '"IBM Plex Sans", system-ui, sans-serif', fontSize: '13px', maxWidth: '480px' },
  '.cm-tooltip-lint': { padding: '4px 0' },
  '.cm-diagnostic': { padding: '6px 12px', lineHeight: '1.45', whiteSpace: 'normal' },
  '.cm-diagnostic-error': { borderLeft: `3px solid ${tone('danger')}` },
  '.cm-diagnostic-warning': { borderLeft: `3px solid ${tone('warning')}` }
});

// A whole configuration is read at once (it is quick), so the outer brace's partner at the very end is known from the
// start and not marked as missing.
const readWhole = (editor: EditorView) => {
  if (ensureSyntaxTree(editor.state, editor.state.doc.length, 300)) editor.dispatch({ selection: editor.state.selection });
};

const diagnosticsOf = (problems: JsonProblem[], length: number): Diagnostic[] =>
problems.
filter((p) => p.from <= length).
map((p) => ({ from: p.from, to: Math.min(Math.max(p.to, p.from), length), severity: p.severity, message: p.message }));

// A fold marker: a chevron pointing down when open and right when folded (lucide's chevron-down path).
const foldMarker = (open: boolean) => {
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${open ? 0 : -90}deg)"><path d="m6 9 6 6 6-6"/></svg>`;
  return mark;
};

export const CodeJsonEditor = forwardRef<JsonEditorHandle, Props>(function CodeJsonEditor(
{ text, onChange, problems, readOnly = false, label = 'Agent configuration JSON' },
ref)
{
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
        EditorState.readOnly.of(readOnly),
        indentOnInput(),
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
        })]

      })
    });
    view.current = editor;
    readWhole(editor);
    // What the browser tests read the whole text through (the editor draws only the lines in sight).
    (host.current as HTMLDivElement & {weaveJsonText?: () => string;}).weaveJsonText = () => editor.state.doc.toString();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is made once; the text and the problems follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text changed from outside (another view, a reload): the editor takes it, keeping the cursor where it can.
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
      annotations: fromOutside.of(true)
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
      jumpToOffset: (offset: number) => {
        const doc = view.current?.state.doc;
        if (!doc) return;
        const line = doc.lineAt(Math.max(0, Math.min(offset, doc.length)));
        show(offset, Math.min(line.to, offset + 40));
      },
      jumpTo: (path: JsonPathPart[]) => {
        const doc = view.current?.state.doc.toString() ?? '';
        const span = locatePath(doc, path);
        if (!span) return false;
        show(span[0], Math.min(span[1], span[0] + 400));
        return true;
      },
      nextProblem: () => {
        const editor = view.current;
        if (!editor) return;
        editor.focus();
        nextDiagnostic(editor);
      },
      openFind: () => {
        const editor = view.current;
        if (editor) openSearchPanel(editor);
      }
    };
  }, []);

  return <div ref={host} data-json-editor="code" className="min-h-[320px]" />;
});

export default CodeJsonEditor;
