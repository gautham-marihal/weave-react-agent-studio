import React, { useRef, useState } from 'react';
import { LoaderCircleIcon, Trash2Icon, UploadCloudIcon } from 'lucide-react';
import { api, ApiError } from '../../../../api/client';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { AgentConfig } from '../../../../types/studio';
import { ACCEPT_ATTRIBUTE, addBaseFromFile, addFileSource, fileTypeProblem, humanize, sizeInWords, type KnowledgeFileView } from '../../../../models/knowledge';
import { addKnowledgeFile } from '../../../../models/setup';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';
import { whenInWords } from './words';

interface FilesCardProps {
  agentId: string;
  editor: DraftEditor;
  files: KnowledgeFileView[];
  /** The file input, so a base's "Upload a file" opens the same one. */
  inputRef: React.RefObject<HTMLInputElement>;
  onChanged: () => void;
  onDelete: (name: string) => void;
}

type DraftBase = { id?: string; type?: string; sources?: Array<{ type?: string; file_id?: string }> };
const draftBases = (config: AgentConfig | null) => (Array.isArray(config?.knowledge) ? (config?.knowledge as DraftBase[]) : []).filter((b) => b && typeof b === 'object');

/**
 * The files uploaded for this agent. Uploading puts a file on the server at once; it only counts once a base lists it,
 * so a new file goes where it obviously belongs (a first base when there is none, the only base when there is one), and
 * with several bases it waits for "Use in…". Deleting asks the server, which refuses a file a base reads (see DeleteFile).
 */
export function FilesCard({ agentId, editor, files, inputRef, onChanged, onDelete }: FilesCardProps) {
  const [uploading, setUploading] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [added, setAdded] = useState('');
  const [over, setOver] = useState(false);
  // an upload takes a while: what it adds goes into the draft as it is when the upload ends
  const latest = useRef(editor);
  latest.current = editor;
  const canEdit = editor.canEdit;
  const bases = draftBases(editor.config);

  const place = (names: string[]) => {
    const ed = latest.current;
    const config = ed.config;
    if (!config || !names.length || !ed.canEdit) return;
    const all = draftBases(config);
    const listed = (name: string) => all.some((b) => (b.sources ?? []).some((s) => s?.type === 'file' && s.file_id === name));
    const fresh = names.filter((name) => !listed(name));
    if (!fresh.length) return;
    const buildable = all.filter((b) => b.type === 'vector_store');
    if (all.length === 0) {
      ed.replaceConfig(fresh.reduce((c, name) => addKnowledgeFile(c, name), config));
      setAdded(`Added ${fresh.join(', ')} to what it knows: the agent that answers reads it in every conversation.`);
    } else if (buildable.length === 1 && buildable[0].id) {
      const id = buildable[0].id;
      ed.replaceConfig(fresh.reduce((c, name) => addFileSource(c, id, name), config));
      setAdded(`Added ${fresh.join(', ')} to “${humanize(id)}”.`);
    } else {
      setAdded(`${fresh.join(', ')} ${fresh.length === 1 ? 'is' : 'are'} on the server. Choose a base for ${fresh.length === 1 ? 'it' : 'them'} with “Use in…”.`);
    }
  };

  const upload = async (picked: FileList | File[] | null) => {
    const chosen = Array.from(picked ?? []);
    if (!chosen.length) return;
    setUploading((n) => n + 1);
    setAdded('');
    const found: string[] = [];
    const done: string[] = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) {
        found.push(bad);
        continue;
      }
      try {
        await api.uploadKnowledgeFile(agentId, file.name, file);
        done.push(file.name);
      } catch (err: unknown) {
        const status = err instanceof ApiError ? err.status : 0;
        const message = err instanceof Error ? err.message : 'something went wrong';
        found.push(status === 413 ? `“${file.name}” is too big for this server (${sizeInWords(file.size)}).` : `“${file.name}” didn’t upload: ${message}`);
      }
    }
    setProblems(found);
    setUploading((n) => n - 1);
    place(done);
    onChanged();
  };

  const putIn = (file: KnowledgeFileView, choice: string) => {
    const config = editor.config;
    if (!config || !choice) return;
    if (choice === '__new') {
      const made = addBaseFromFile(config, file.name);
      editor.replaceConfig(made.config);
      setAdded(`Made the base “${humanize(made.id)}” from ${file.name}. Nothing reads it yet: let the agent use it below.`);
    } else {
      editor.replaceConfig(addFileSource(config, choice, file.name));
      setAdded(`Added ${file.name} to “${humanize(choice)}”.`);
    }
  };

  const busy = uploading > 0;
  return (
    <section aria-labelledby="kb-files" className="rounded-xl border border-line bg-surface p-5 shadow-panel">
      <h4 id="kb-files" className="text-sm font-semibold text-ink">Files on the server</h4>
      <p className="mt-1 text-[13px] text-muted">
        Text, Markdown, HTML, PDF, CSV or JSON. A file does nothing until a base lists it as a source; replacing a file makes an index built from it out of date.
      </p>
      <div
        className={cn('mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-4 transition-colors duration-150', over && 'border-accent bg-accent-soft/40')}
        onDragOver={(e) => {
          e.preventDefault();
          if (canEdit) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (canEdit) void upload(e.dataTransfer.files);
        }}>
        <Button size="sm" variant="secondary" disabled={!canEdit || busy} onClick={() => inputRef.current?.click()}>
          {busy ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UploadCloudIcon className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Uploading…' : 'Upload files'}
        </Button>
        <span className="text-xs text-muted">or drop them here. They go to the server straight away.</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          aria-label="Choose files to upload"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }} />
      </div>
      {problems.length > 0 &&
      <ul role="alert" className="mt-3 space-y-1 text-[13px] text-danger">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      }
      {added &&
      <p role="status" className="mt-3 rounded-md bg-subtle px-3 py-2 text-[13px] text-ink-soft">
          {added} {editor.dirty ? 'It is in the draft, not saved: the server builds from the saved draft.' : ''}
        </p>
      }
      {files.length === 0 ?
      <p className="mt-4 text-[13px] text-muted">No files uploaded yet.</p> :

      <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 pr-3 font-medium">Updated</th>
                <th className="py-2 pr-3 font-medium">Read by</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {files.map((file) => {
              const free = bases.filter((b) => b.type === 'vector_store' && b.id && !(b.sources ?? []).some((s) => s?.type === 'file' && s.file_id === file.name));
              return (
                <tr key={file.name} data-file={file.name}>
                    <td className="py-2 pr-3"><code className="font-mono text-xs text-ink">{file.name}</code></td>
                    <td className="py-2 pr-3 text-muted">{sizeInWords(file.size)}</td>
                    <td className="py-2 pr-3 text-muted">{whenInWords(file.modified)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{file.usedBy.length ? file.usedBy.map(humanize).join(', ') : <span className="text-muted">Nothing</span>}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {canEdit &&
                      <select
                        className={cn(inputClass, 'h-8 w-auto py-1 text-xs')}
                        aria-label={`Use ${file.name} in a base`}
                        value=""
                        onChange={(e) => putIn(file, e.target.value)}>
                            <option value="">Use in…</option>
                            {free.map((b) =>
                        <option key={b.id} value={b.id}>{humanize(b.id ?? '')}</option>
                        )}
                            <option value="__new">A new base</option>
                          </select>
                      }
                        <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => onDelete(file.name)} aria-label={`Delete ${file.name}`} className="text-danger hover:bg-danger-soft hover:text-danger">
                          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>);

            })}
            </tbody>
          </table>
        </div>
      }
    </section>);

}
