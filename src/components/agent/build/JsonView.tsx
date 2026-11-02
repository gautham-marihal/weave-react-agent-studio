import React, { Suspense, forwardRef, lazy, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowDownToLineIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, CornerDownRightIcon, SearchIcon, WandSparklesIcon } from 'lucide-react';
import { toast } from '../../ui/Toast';
import type { AgentConfig, Path } from '../../../types/studio';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { Button } from '../../ui/Button';
import {
  checkJson,
  errorLinesOf,
  jsonProblems,
  lineOf,
  locatePath,
  offsetOfLine,
  parsePathText,
  type JsonPathPart } from
'../../../utils/jsonCheck';
import type { JsonEditorHandle } from './CodeJsonEditor';
import { cn, inputClass } from '../../../utils/styles';

// The whole configuration as JSON. The code editor (CodeMirror: highlighting, folds, find, F8 to the next problem) is
// loaded when the view opens; the plain editor shows until then and stays if it can't load. Text that doesn't parse,
// or repeats a key, is held back: the draft keeps its last good version and Save waits until the text is fixed.

const CodeJsonEditor = lazy(() => import('./CodeJsonEditor'));

const LINE_HEIGHT = 20;

/** A request to show a setting in the text (from the checks beside it). */
export interface JsonJump {
  path: Path;
  nonce: number;
}

/** focusKey: a top-level section to open at (for example "tests"); jumpTo: a setting to show, from the checks. */
export function JsonView({ editor, focusKey, jumpTo }: {editor: DraftEditor;focusKey?: string;jumpTo?: JsonJump | null;}) {
  const area = useRef<JsonEditorHandle>(null);
  const { config, replaceConfig, canEdit, setParseError } = editor;
  const serialized = config ? JSON.stringify(config, null, 2) : '';
  const [text, setText] = useState(serialized);
  const lastApplied = useRef(serialized);
  const [where, setWhere] = useState('');
  const [whereProblem, setWhereProblem] = useState('');

  // Take outside changes (other views, conflict resolution, undo) when the text isn't mid-edit.
  useEffect(() => {
    if (serialized !== lastApplied.current) {
      lastApplied.current = serialized;
      setText(serialized);
    }
  }, [serialized]);

  const check = useMemo(() => checkJson(text), [text]);

  useEffect(() => {
    if (text === lastApplied.current || !check.ok) return;
    const t = window.setTimeout(() => {
      const next = check.value as AgentConfig;
      lastApplied.current = JSON.stringify(next, null, 2);
      replaceConfig(next);
    }, 400);
    return () => window.clearTimeout(t);
  }, [text, check, replaceConfig]);

  // Text that is not a JSON object (or repeats a key) cannot be saved: the header's Save waits until it is fixed.
  const problemMessage = check.ok ? null : check.message;
  useEffect(() => {
    setParseError(problemMessage);
  }, [problemMessage, setParseError]);
  useEffect(() => () => setParseError(null), [setParseError]);

  // The server's checks are about what is in the draft: they are marked only while the text is that draft.
  const report = editor.validation;
  const problems = useMemo(
    () => jsonProblems(text, check.ok ? {} : { error: check.message, duplicates: check.duplicates }, check.ok && text === lastApplied.current ? report : null),
    [text, check, report]
  );
  const serverMarks = check.ok ? problems.length : 0;
  const errorLines = useMemo(() => errorLinesOf(text, problems), [text, problems]);
  const firstDuplicate = !check.ok ? check.duplicates?.[0] : undefined;
  const badLine = !check.ok ? check.line : null;

  // Open at a section: put the cursor on its key.
  const focusAt = focusKey ? text.indexOf(`\n  "${focusKey}":`) : -1;
  useEffect(() => {
    if (!focusKey || focusAt < 0) return;
    const t = window.setTimeout(() => area.current?.jumpTo([focusKey]), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, focusAt >= 0]);

  // A setting the checks beside it point at.
  useEffect(() => {
    if (!jumpTo) return;
    const t = window.setTimeout(() => area.current?.jumpTo(jumpTo.path), 60);
    return () => window.clearTimeout(t);
  }, [jumpTo]);

  const format = () => {
    if (check.ok) setText(JSON.stringify(check.value, null, 2));
  };

  const goWhere = (e: React.FormEvent) => {
    e.preventDefault();
    const path = parsePathText(where);
    if (!path) {
      setWhereProblem('Type a setting such as agents.items[0].tools or channels.1.greeting.');
      return;
    }
    if (!locatePath(text, path)) {
      setWhereProblem('The text can’t be read there yet. Fix the problem above first.');
      return;
    }
    setWhereProblem('');
    area.current?.jumpTo(path);
  };

  const plain = <PlainJsonEditor ref={area} text={text} onChange={setText} errorLines={errorLines} readOnly={!canEdit} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0 text-[13px]">
          {problemMessage ?
          <span className="flex items-start gap-1.5 text-danger">
              <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Not applied{badLine ? ` — line ${badLine}` : ''}: {problemMessage}</span>
            </span> :

          <span className="flex items-center gap-1.5 text-muted">
              <CircleCheckIcon className="h-4 w-4 text-success" aria-hidden />
              Valid JSON. Edits go into the draft as you type; Save keeps them.
              {serverMarks > 0 && <span className="text-ink-soft">{` ${serverMarks} problem${serverMarks === 1 ? '' : 's'} from the checks marked in the text.`}</span>}
            </span>
          }
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => area.current?.openFind()} title="Find and replace (Ctrl+F / ⌘F)">
            <SearchIcon className="h-3.5 w-3.5" aria-hidden />
            Find
          </Button>
          <Button size="sm" variant="ghost" onClick={() => area.current?.nextProblem()} disabled={!problems.length} aria-keyshortcuts="F8" title="Go to the next problem (F8)">
            <ArrowDownToLineIcon className="h-3.5 w-3.5" aria-hidden />
            Next problem
          </Button>
          <Button size="sm" variant="ghost" onClick={format} disabled={!canEdit || !check.ok}>
            <WandSparklesIcon className="h-3.5 w-3.5" aria-hidden />
            Format
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(text);
              toast('Configuration copied');
            }}>
            <CopyIcon className="h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
        </div>
      </div>

      {problemMessage &&
      <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-ink-soft">
          <span>{firstDuplicate ? 'A key written twice is held back: ' : ''}Your draft keeps the last valid version until this is fixed. Nothing is lost.</span>
          {(badLine || firstDuplicate) &&
        <button
          type="button"
          className="font-medium text-danger underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
          onClick={() => area.current?.jumpToOffset(firstDuplicate ? firstDuplicate.offset : offsetOfLine(text, badLine as number))}>
              Go to {firstDuplicate ? 'the repeated key' : `line ${badLine}`}
            </button>
        }
        </div>
      }
      {focusKey && focusAt < 0 &&
      <p className="mt-2 rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">
          This agent has no “{focusKey}” section yet. Add it at the top level of the configuration, then press Save.
          {focusKey === 'tests' && ' Each scenario is a conversation (what the caller says) and what must be true afterwards; GET /schema describes every field.'}
        </p>
      }

      <form onSubmit={goWhere} className="mt-3 flex flex-wrap items-center gap-2" aria-label="Go to a setting">
        <label htmlFor="json-go-to" className="text-[13px] font-medium text-ink-soft">Go to a setting</label>
        <input
          id="json-go-to"
          value={where}
          onChange={(e) => {
            setWhere(e.target.value);
            setWhereProblem('');
          }}
          placeholder="agents.items[0].tools"
          spellCheck={false}
          className={cn(inputClass, 'h-8 w-64 max-w-full font-mono text-[13px]')} />
        <Button size="sm" variant="secondary" type="submit" disabled={!where.trim()}>
          <CornerDownRightIcon className="h-3.5 w-3.5" aria-hidden />
          Show
        </Button>
        {whereProblem && <span className="text-xs text-danger" role="alert">{whereProblem}</span>}
      </form>

      <div className={cn('mt-3 overflow-hidden rounded-lg border bg-surface', problemMessage ? 'border-danger/50' : 'border-line')} data-json-frame>
        <OrPlain plain={plain}>
          <Suspense fallback={plain}>
            <CodeJsonEditor ref={area} text={text} onChange={setText} problems={problems} readOnly={!canEdit} />
          </Suspense>
        </OrPlain>
      </div>
      <p className="mt-2 text-xs text-muted">Ctrl+F finds and replaces, F8 goes to the next problem, the arrows beside the line numbers fold a part away.</p>
    </div>);

}

/** The plain editor, with line numbers and the lines with an error marked: shown while the code editor loads. */
const PlainJsonEditor = forwardRef<JsonEditorHandle, {text: string;onChange: (t: string) => void;errorLines: Set<number>;readOnly: boolean;}>(
  function PlainJsonEditor({ text, onChange, errorLines, readOnly }, ref) {
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const lines = text.split('\n').length;
    const select = (from: number, to: number) => {
      const el = areaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(from, to);
      scrollRef.current?.scrollTo({ top: Math.max(0, (lineOf(text, from) - 4) * LINE_HEIGHT) });
    };
    useImperativeHandle(ref, () => ({
      jumpToOffset: (offset: number) => select(offset, Math.min(text.length, offset + 40)),
      jumpTo: (path: JsonPathPart[]) => {
        const span = locatePath(text, path);
        if (span) select(span[0], Math.min(span[1], span[0] + 400));
        return !!span;
      },
      nextProblem: () => {
        const first = [...errorLines].sort((a, b) => a - b)[0];
        if (first) select(offsetOfLine(text, first), offsetOfLine(text, first));
      },
      openFind: () => areaRef.current?.focus()
    }));
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Tab' || e.shiftKey) return;
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart, selectionEnd } = el;
      onChange(`${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`);
      window.requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
    };
    return (
      <div
        ref={(el) => {
          scrollRef.current = el;
          // The browser tests read the text through this, as they do the code editor's.
          if (el) (el as HTMLDivElement & {weaveJsonText?: () => string;}).weaveJsonText = () => areaRef.current?.value ?? '';
        }}
        data-json-editor="plain"
        className="max-h-[70vh] overflow-auto">
        <div className="flex min-w-max font-mono text-[13px]" style={{ lineHeight: `${LINE_HEIGHT}px` }}>
          <pre aria-hidden className="sticky left-0 select-none border-r border-line bg-canvas px-3 py-3 text-right text-muted">
            {Array.from({ length: lines }, (_, i) =>
            <div key={i} className={cn(errorLines.has(i + 1) && 'bg-danger-soft text-danger')}>
                {i + 1}
              </div>
            )}
          </pre>
          <textarea
            ref={areaRef}
            aria-label="Agent configuration JSON"
            value={text}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            wrap="off"
            className="min-w-[640px] flex-1 resize-none overflow-hidden whitespace-pre bg-transparent px-4 py-3 text-ink focus:outline-none"
            style={{ height: lines * LINE_HEIGHT + 24, lineHeight: `${LINE_HEIGHT}px` }} />
        </div>
      </div>);

  }
);

/** If the code editor can't be loaded (offline, say), the plain one stays. */
class OrPlain extends React.Component<{plain: React.ReactNode;children: React.ReactNode;}, {failed: boolean;}> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.plain : this.props.children;
  }
}
