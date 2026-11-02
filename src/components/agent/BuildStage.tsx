import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileJsonIcon } from 'lucide-react';
import type { Path } from '../../types/studio';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import type { SettingGroupId } from '../../data/settingsCatalog';
import type { Readiness } from '../../models/readiness';
import { openStepsOn } from '../../models/readiness';
import { BUILD_SECTIONS, problemsBySection, targetPath, type BuildSection } from '../../models/agentPages';
import { Button } from '../ui/Button';
import { GuidedBuild, GuidedView, type GuidedPart } from './build/GuidedView';
import { AgentPage } from './build/agent/AgentPage';
import { DetailedView } from './build/DetailedView';
import { JsonView, type JsonJump } from './build/JsonView';
import { WorkflowCanvas } from './build/WorkflowCanvas';
import { AgentMap } from './build/relations/AgentMap';
import { ToolGrid } from './build/relations/ToolGrid';
import { KnowledgeSection } from './build/KnowledgeSection';
import { ActionsBlock, KnowledgeBlock, ReachBlock } from './setup/SimpleBlocks';
import { GuardrailsPage } from './build/GuardrailsPage';
import { AfterCallPage } from './build/AfterCallPage';
import { ToolsPage } from './build/tools/ToolsPage';
import { ToolExtras } from './build/tools/ToolExtras';
import { ChannelsPage } from './build/channels/ChannelsPage';
import { FixedLinesPage } from './build/messages/FixedLinesPage';
import { ValidationPanel } from './ValidationPanel';
import { ConcurrentEditBanner } from './ConcurrentEditBanner';
import { ImportExportModal } from './build/ImportExportModal';
import { NavMark } from './AgentHeader';
import { fieldId } from '../../utils/path';
import { flash, highlight } from '../../utils/focusField';
import { requestSettingFocus } from '../../hooks/useSettingFocus';
import { currentSearchParams } from '../../utils/searchParams';
import { cn } from '../../utils/styles';

export interface FocusRequest {
  path: Path;
  nonce: number;
}

interface BuildStageProps {
  editor: DraftEditor;
  section: BuildSection;
  readiness: Readiness | null;
  focusRequest: FocusRequest | null;
}

type BuildView = 'section' | 'guided' | 'all' | 'canvas' | 'json';

const VIEWS: { id: Exclude<BuildView, 'section'>; label: string }[] = [
  { id: 'guided', label: 'One page' },
  { id: 'all', label: 'All settings' },
  { id: 'canvas', label: 'Workflow' },
  { id: 'json', label: 'JSON' },
];

/** What each section shows: its plain controls first, then every setting of that part. */
const SECTION_PARTS: Record<BuildSection, { parts: GuidedPart[]; groups: SettingGroupId[] }> = {
  // The Agent page (build/agent/AgentPage) asks the plain questions of this part.
  agent: { parts: [], groups: ['about', 'talks', 'behaves', 'engine'] },
  // Channels and Tools have their own pages (every channel, tool and extra), so nothing is asked twice.
  channels: { parts: [], groups: [] },
  tools: { parts: [], groups: [] },
  knowledge: { parts: [], groups: [] },
  guardrails: { parts: [], groups: [] },
  // Everything of After the call is asked on its own page (nothing is asked twice).
  aftercall: { parts: [], groups: [] },
};

/** A readiness step's `focus` -> the field it is about (on this section), by its id in the page. */
function focusElement(focus: string, editor: DraftEditor): HTMLElement | null {
  const config = editor.config;
  const items = config?.agents?.items ?? [];
  const entry = Math.max(0, items.findIndex((a) => a.id === config?.agents?.entry));
  const greeting = Math.max(0, (config?.channels ?? []).findIndex((c) => c.enabled));
  const ids: Record<string, string> = {
    instructions: fieldId(['agents', 'items', entry, 'instructions']),
    greeting: fieldId(['channels', greeting, 'greeting']),
    language: fieldId('defaults.language.primary'),
    voice: fieldId('defaults.models.tts.voice_id'),
    model: fieldId('defaults.models.llm.model'),
    problems: 'checks-panel',
  };
  return ids[focus] ? document.getElementById(ids[focus]) : null;
}

export function BuildStage({ editor, section, readiness, focusRequest }: BuildStageProps) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get('view');
  // 'detailed' is the old name of All settings, kept so old links open it
  const view: BuildView = raw === 'guided' || raw === 'all' || raw === 'canvas' || raw === 'json' ? raw : raw === 'detailed' ? 'all' : 'section';
  const [detailedGroup, setDetailedGroup] = useState<SettingGroupId | null>(null);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [jsonJump, setJsonJump] = useState<JsonJump | null>(null);
  const agentId = editor.agent?.id ?? '';

  const setView = useCallback(
    (v: BuildView) => {
      const next = currentSearchParams();
      next.delete('focus');
      if (v === 'section') next.delete('view');
      else next.set('view', v);
      setParams(next, { replace: true });
    },
    [setParams]
  );

  const focusPath = useCallback(
    (path: Path) => {
      // In the JSON view, a problem is shown in the text, at its setting.
      if (view === 'json') return setJsonJump({ path, nonce: Date.now() });
      // the field itself on this page, else the settings form on this page, else All settings (which takes the request)
      if (highlight(path, path.length)) return;
      if (requestSettingFocus(agentId, path)) return;
      setView('all');
    },
    [view, setView, agentId]
  );

  useEffect(() => {
    if (!focusRequest) return;
    const t = window.setTimeout(() => focusPath(focusRequest.path), 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  // ?focus= from a readiness step: open the field it is about (or the JSON view).
  const focus = params.get('focus');
  useEffect(() => {
    if (!focus) return;
    if (focus === 'json' || focus === 'tests') {
      // Keep ?focus= so the JSON view can open at the tests section.
      if (view !== 'json') {
        const next = new URLSearchParams(params);
        next.set('view', 'json');
        setParams(next, { replace: true });
      }
      return;
    }
    const t = window.setTimeout(() => {
      const el = focusElement(focus, editor);
      if (el) flash(el);
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, section]);

  if (!editor.config || !editor.agent) return null;
  const problems = problemsBySection(editor.validationView.report?.errors ?? []);
  const { parts, groups } = SECTION_PARTS[section];
  const current = BUILD_SECTIONS.find((s) => s.id === section);
  const importExport =
  <ImportExportModal
    open={importExportOpen}
    onClose={() => setImportExportOpen(false)}
    agent={editor.agent}
    currentConfig={editor.config}
    onConfigImported={editor.replaceConfig} />;


  // The Workflow uses the whole width: its own panels hold the blocks, the settings and the server's checks.
  if (view === 'canvas')
  return (
    <div className="w-full px-4 py-4 lg:px-6">
        <ConcurrentEditBanner editor={editor} />
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">Workflow</h2>
            <p className="text-[13px] text-muted">Where a conversation starts, which agent talks, and what each one can use and hand over to. Every block is part of this agent’s settings.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => navigate(targetPath(agentId, { stage: 'build', section }))}>Back to {current?.label}</Button>
            <Button size="sm" variant="ghost" onClick={() => setView('all')}>All settings</Button>
            <Button size="sm" variant="ghost" onClick={() => setView('json')}>JSON</Button>
            <Button size="sm" variant="ghost" onClick={() => setImportExportOpen(true)}>
              <FileJsonIcon className="h-3.5 w-3.5" aria-hidden />
              Import / Export
            </Button>
          </div>
        </div>
        <WorkflowCanvas editor={editor} onGoTo={focusPath} onOpenSection={(s) => navigate(targetPath(agentId, { stage: 'build', section: s }))} />
        {importExport}
      </div>);


  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
      <ConcurrentEditBanner editor={editor} />

      <div className="grid gap-8 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_300px]">
        <nav aria-label="Build sections" className="lg:sticky lg:top-44 lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
            {BUILD_SECTIONS.map((s) => {
              const active = view === 'section' && s.id === section;
              const open = readiness ? openStepsOn(readiness, (t) => t.stage === 'build' && t.section === s.id).length : 0;
              return (
                <li key={s.id}>
                  <Link
                    to={targetPath(agentId, { stage: 'build', section: s.id })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink'
                    )}>
                    {s.label}
                    <NavMark open={open} problems={problems[s.id] ?? 0} />
                  </Link>
                </li>);

            })}
          </ul>
          <p className="mt-4 hidden px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted lg:block">Views</p>
          <ul className="mt-1 flex flex-wrap gap-1 lg:flex-col lg:gap-0.5">
            {VIEWS.map((v) =>
            <li key={v.id}>
                <button
                type="button"
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  'w-full rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  view === v.id ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink'
                )}>
                  {v.label}
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                onClick={() => setImportExportOpen(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-ink-soft hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <FileJsonIcon className="h-3.5 w-3.5" aria-hidden />
                Import / Export
              </button>
            </li>
          </ul>
        </nav>

        <div className="min-w-0">
          {view === 'section' &&
          <>
              <div className="mb-5">
                <h2 className="text-base font-semibold text-ink">{current?.label}</h2>
                <p className="text-[13px] text-muted">{current?.description}</p>
              </div>
              {section === 'agent' &&
            <>
                  <AgentPage editor={editor} readiness={readiness} />
                  <AgentMap config={editor.config} onOpenAgent={(i) => focusPath(['agents', 'items', i])} />
                </>
            }
              {section === 'channels' &&
            <>
                  <SimpleTop title="Where people reach it"><ReachBlock editor={editor} /></SimpleTop>
                  <ChannelsPage editor={editor} onOpenJson={() => setView('json')} />
                </>
            }
              {section === 'tools' &&
            <>
                  <SimpleTop title="What it can do"><ActionsBlock editor={editor} /></SimpleTop>
                  <ToolGrid editor={editor} />
                  <ToolsPage editor={editor} onOpenJson={() => setView('json')} />
                  <ToolExtras editor={editor} onOpenJson={() => setView('json')} />
                </>
            }
              {section === 'knowledge' &&
            <>
                  <SimpleTop title="What it knows"><KnowledgeBlock editor={editor} /></SimpleTop>
                  <h3 className="mb-3 text-sm font-semibold text-ink">Every knowledge base</h3>
                  <KnowledgeSection editor={editor} />
                </>
            }
              {section === 'guardrails' && <GuardrailsPage editor={editor} onOpenJson={() => setView('json')} />}
              {section === 'aftercall' && <AfterCallPage editor={editor} />}
              {parts.length > 0 &&
            <GuidedView
              editor={editor}
              parts={parts}
              onMore={(g) => {
                setDetailedGroup(g);
                setView('all');
              }} />
            }
              {section === 'agent' && <FixedLinesPage editor={editor} onOpenJson={() => setView('json')} />}
              {groups.length > 0 &&
            <section aria-label={`All settings for ${current?.label}`} className="mt-8">
                  <h3 className="mb-3 text-sm font-semibold text-ink">All settings for this part</h3>
                  <DetailedView editor={editor} initialGroup={null} onOpenJson={() => setView('json')} only={groups} />
                </section>
            }
            </>
          }
          {view === 'guided' && <GuidedBuild editor={editor} problems={problems} onOpenSection={(s) => navigate(targetPath(agentId, { stage: 'build', section: s }))} onOpenWorkflow={() => setView('canvas')} />}
          {view === 'all' && <DetailedView editor={editor} initialGroup={detailedGroup} onOpenJson={() => setView('json')} />}
          {view === 'json' && <JsonView editor={editor} focusKey={focus === 'tests' ? 'tests' : undefined} jumpTo={jsonJump} />}
          {view !== 'section' &&
          <Button size="sm" variant="ghost" className="mt-4" onClick={() => navigate(targetPath(agentId, { stage: 'build', section }))}>
              Back to {current?.label}
            </Button>
          }
        </div>

        <aside id="checks-panel" className="self-start lg:col-span-2 xl:sticky xl:top-44 xl:col-span-1">
          <ValidationPanel view={editor.validationView} config={editor.config} onGoTo={focusPath} onRepair={editor.canEdit ? editor.replaceConfig : undefined} onUndo={editor.canEdit ? editor.undo : undefined} />
        </aside>
      </div>

      {importExport}
    </div>);

}

/** The plain controls at the top of a section (the same ones the guided setup uses). */
function SimpleTop({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="mb-8">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>);

}
