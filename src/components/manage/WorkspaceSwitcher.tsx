import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { toast } from '../ui/Toast';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { askConfirm } from '../../models/manageConfirm';
import { countByWorkspace, createWorkspace, deleteWorkspace, renameWorkspace, switchWorkspace, workspaceNameProblem, type Workspace } from '../../models/workspaces';
import { cn, inputClass, inputErrorClass } from '../../utils/styles';

/**
 * The open workspace and the menu to switch, make, rename or delete one. Workspaces are kept in this browser (the API has
 * none), and the menu says so: they group agents here and don't control who can see an agent.
 */
export function WorkspaceSwitcher({ agents }: { agents: { id: string }[] }) {
  const { spaces, owners, current, currentSpace } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<{ mode: 'create' } | { mode: 'rename'; space: Workspace } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const counts = useMemo(() => countByWorkspace(agents, owners, spaces), [agents, owners, spaces]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const remove = async (space: Workspace) => {
    setOpen(false);
    const to = spaces.find((s) => s.id !== space.id);
    const yes = await askConfirm({
      title: `Delete the workspace “${space.name}”?`,
      body: `Its ${counts[space.id] ?? 0} ${counts[space.id] === 1 ? 'agent moves' : 'agents move'} to ${to?.name ?? 'another workspace'}. The agents themselves are not deleted, and nothing on the server changes.`,
      confirmLabel: 'Delete workspace',
      tone: 'danger'
    });
    if (!yes) return;
    const movedTo = deleteWorkspace(space.id);
    if (movedTo) toast.success(`${space.name} deleted`, { description: `Its agents are now in ${movedTo.name}.` });
  };

  return (
    <div ref={boxRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-ink transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        title="Switch workspace">
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        <span className="truncate">{currentSpace?.name ?? 'My workspace'}</span>
        <ChevronDownIcon className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">, switch workspace</span>
      </button>

      {open &&
      <div role="group" aria-label="Workspaces" className="absolute left-0 top-full z-40 mt-1.5 w-80 rounded-xl border border-line-strong/50 bg-surface p-1.5 shadow-overlay">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Your workspaces</p>
          <ul className="max-h-72 overflow-y-auto">
            {spaces.map((space) => {
            const here = space.id === current;
            const n = counts[space.id] ?? 0;
            return (
              <li key={space.id} className="group flex items-center gap-1 rounded-lg hover:bg-subtle">
                  <button
                  type="button"
                  aria-current={here || undefined}
                  onClick={() => {
                    switchWorkspace(space.id);
                    setOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{here && <CheckIcon className="h-4 w-4 text-accent" aria-hidden />}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{space.name}</span>
                      <span className="block text-xs text-muted">{n} {n === 1 ? 'agent' : 'agents'}</span>
                    </span>
                  </button>
                  <button
                  type="button"
                  aria-label={`Rename ${space.name}`}
                  title="Rename"
                  onClick={() => {
                    setOpen(false);
                    setNaming({ mode: 'rename', space });
                  }}
                  className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <PencilIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                  type="button"
                  aria-label={`Delete ${space.name}`}
                  title={spaces.length <= 1 ? 'The last workspace can’t be deleted' : 'Delete'}
                  disabled={spaces.length <= 1}
                  onClick={() => void remove(space)}
                  className="mr-1 rounded-md p-1.5 text-muted hover:bg-surface hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:hover:text-muted">
                    <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>);

          })}
          </ul>
          <p className="mx-2.5 mt-1 border-t border-line pt-2 text-xs leading-relaxed text-muted">
            Kept in this browser. Workspaces group agents here; they don’t control who can see an agent.
          </p>
          <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNaming({ mode: 'create' });
          }}
          className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-accent hover:bg-accent-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <PlusIcon className="h-4 w-4" aria-hidden />
            New workspace
          </button>
        </div>
      }

      {naming && <WorkspaceNameDialog naming={naming} spaces={spaces} onClose={() => setNaming(null)} />}
    </div>);

}

function WorkspaceNameDialog({ naming, spaces, onClose }: { naming: { mode: 'create' } | { mode: 'rename'; space: Workspace }; spaces: Workspace[]; onClose: () => void }) {
  const renaming = naming.mode === 'rename' ? naming.space : null;
  const [name, setName] = useState(renaming?.name ?? '');
  const [tried, setTried] = useState(false);
  const problem = workspaceNameProblem(name, spaces, renaming?.id);
  const submit = () => {
    setTried(true);
    if (problem) return;
    if (renaming) {
      renameWorkspace(renaming.id, name);
      toast.success(`Renamed to ${name.trim()}`);
    } else {
      const space = createWorkspace(name);
      toast.success(`${space.name} is ready`, { description: 'New agents you create here belong to it.' });
    }
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={renaming ? `Rename ${renaming.name}` : 'New workspace'}
      description={renaming ? undefined : 'A workspace groups agents in this browser. You can move agents between workspaces at any time.'}
      footer={
      <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{renaming ? 'Rename' : 'Create workspace'}</Button>
        </>
      }>
      <Field id="workspace-name" label="Workspace name" help="Kept in this browser." error={tried || name ? problem || undefined : undefined}>
        <input
          id="workspace-name-input"
          className={cn(inputClass, (tried || name) && problem && inputErrorClass)}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Customer care" />
      </Field>
    </Dialog>);

}
