import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, LayoutTemplateIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { TEMPLATES, type Template } from '../../../../models/workflowExtras';
import { cn } from '../../../../utils/styles';

// “Templates”: ready-made pieces of a workflow, each added in one go (Undo takes it back). One that would add nothing
// here says why instead.
export function TemplatesMenu({ config, disabled, onPick }: {config: AgentConfig;disabled: boolean;onPick: (t: Template) => void;}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Templates: ready-made pieces of a workflow"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-40',
          open ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-subtle hover:text-ink'
        )}>
        <LayoutTemplateIcon className="h-4 w-4" aria-hidden />
        <span className="hidden 2xl:inline">Templates</span>
        <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open &&
      <div role="menu" aria-label="Templates" className="absolute left-0 top-9 z-30 w-80 rounded-lg border border-line bg-surface p-1.5 shadow-overlay">
          {TEMPLATES.map((t) => {
          const why = t.unavailable(config);
          return (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              aria-disabled={!!why || undefined}
              onClick={() => {
                if (why) return;
                setOpen(false);
                onPick(t);
              }}
              className={cn('block w-full rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', why ? 'cursor-not-allowed opacity-60' : 'hover:bg-subtle')}>
                <span className="block text-[13px] font-medium text-ink">{t.title}</span>
                <span className="block text-xs text-muted">{why || t.description}</span>
              </button>);

        })}
        </div>
      }
    </div>);

}
