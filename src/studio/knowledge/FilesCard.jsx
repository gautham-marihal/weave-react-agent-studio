import React, { useRef, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { api } from '../../api/client.ts';
import { formatWhen, slugify } from '../format.js';
import { ACCEPT_ATTRIBUTE, addFileSource, fileTypeProblem, formatBytes } from './model.js';
import { KNOWLEDGE_ID, addKnowledgeFile, knowledgeOf } from '../setup/setupModel.js';
import { humanize } from '../agent/rowNames.js';
import { askConfirm } from '../../ui/dialogs.js';
import Button from '../../ui/Button.tsx';

// The uploaded-documents card: upload, list and remove the files the agent answers from.
//   uploads: offer to upload here (off when the page has its own place to add documents above)
//   attachFirst: a first base made from an upload is read by the answering agent every turn, so no other step is needed
export default function FilesCard({ botId, files, bases, editor, onChanged, inputRef, uploads = true, attachFirst = false }) {
  const [uploading, setUploading] = useState(0); // uploads in progress (a drop during one starts another)
  const busy = uploading > 0;
  const [problems, setProblems] = useState([]);
  const [over, setOver] = useState(false);
  // what was just added, and the save it followed: the "not saved yet" note goes once the draft is saved from anywhere
  const savedAt = editor.meta?.savedAt || '';
  const [added, setAddedNote] = useState(null);
  const setAdded = (text) => setAddedNote(text ? { text, savedAt } : null);
  // an upload takes a while: what it adds goes into the draft as it is when the upload ends (with anything typed or
  // uploaded meanwhile), not as it was when the upload began
  const latest = useRef({ editor, files, bases });
  latest.current = { editor, files, bases };

  const upload = async (picked) => {
    const chosen = [...picked];
    if (!chosen.length) return;
    setUploading((n) => n + 1);
    const found = [];
    const uploaded = [];
    for (const file of chosen) {
      const bad = fileTypeProblem(file.name);
      if (bad) {
        found.push(bad);
        continue;
      }
      try {
        await api.uploadKnowledgeFile(botId, file.name, file);
        uploaded.push(file.name);
      } catch (e) {
        found.push(
          e?.status === 413
            ? `“${file.name}” is too big for this server (${formatBytes(file.size)}).`
            : e?.status === 400
              ? `“${file.name}”: ${e.message}`
              : `“${file.name}” didn’t upload: ${e?.message || 'something went wrong'}.`,
        );
      }
    }
    setProblems(found);
    setUploading((n) => n - 1);
    placeUploaded(uploaded);
    onChanged();
  };
  // A file only counts once a base lists it, so a new file goes where it obviously belongs: a new base when the agent
  // has none, the only base when it has one. With several, it waits for "Use in…", since only the author knows which.
  const placeUploaded = (names) => {
    const { editor, files, bases } = latest.current;
    const fresh = names.filter((name) => !files.some((f) => f.name === name && f.usedBy.length));
    if (!fresh.length) return;
    const config = editor.parsed.value;
    if (!config || typeof config !== 'object') return;
    const buildable = bases.filter((b) => b.buildable);
    const list = Array.isArray(config.knowledge) ? config.knowledge : [];
    if (list.length === 0 && attachFirst) {
      editor.setValue(fresh.reduce((c, name) => addKnowledgeFile(c, name), config));
      setAdded(`Added ${fresh.join(', ')} to what it knows: the agent that answers reads it in every conversation. Save the draft, then build the index.`);
    } else if (list.length === 0) {
      editor.setValue({
        ...config,
        knowledge: [{ id: 'knowledge', type: 'vector_store', mode: 'tool', sources: fresh.map((name) => ({ type: 'file', file_id: name })) }],
      });
      setAdded(`Made the knowledge base “knowledge” from ${fresh.join(', ')}. Save the draft, then build its index.`);
    } else if (buildable.length === 1) {
      editor.setValue(fresh.reduce((c, name) => addFileSource(c, buildable[0].id, name), config));
      setAdded(`Added ${fresh.join(', ')} to “${buildable[0].id}”. Save the draft, then rebuild its index.`);
    }
  };
  const remove = async (name, force = false) => {
    try {
      await api.deleteKnowledgeFile(botId, name, force);
      setProblems([]);
      onChanged();
    } catch (e) {
      if (e?.status === 409 && !force) {
        const anyway = await askConfirm({
          title: `Delete “${name}” anyway?`,
          body: `${e.message}\n\nThe index keeps what it had until it is rebuilt, and the base will say the file is missing.`,
          confirmLabel: 'Delete anyway',
          tone: 'danger',
        });
        if (anyway) remove(name, true);
        return;
      }
      setProblems([`“${name}” wasn’t deleted: ${e?.message || 'something went wrong'}.`]);
    }
  };
  const addTo = (file, baseId) => {
    const config = editor.parsed.value;
    if (baseId === '__new') {
      const id = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40) || 'knowledge';
      const taken = new Set((Array.isArray(config.knowledge) ? config.knowledge : []).map((b) => b?.id));
      let unique = id;
      let n = 2;
      while (taken.has(unique)) {
        unique = `${id}_${n}`;
        n += 1;
      }
      editor.setValue({
        ...config,
        knowledge: [
          ...(Array.isArray(config.knowledge) ? config.knowledge : []),
          { id: unique, type: 'vector_store', mode: 'tool', sources: [{ type: 'file', file_id: file.name }] },
        ],
      });
      setAdded(`Made the base “${unique}” from ${file.name}.`);
    } else {
      editor.setValue(addFileSource(config, baseId, file.name));
      setAdded(`Added ${file.name} to “${baseId}”.`);
    }
  };
  // the documents of the page's "What it knows" (in the draft, so one added a moment ago counts)
  const inDraft = attachFirst ? knowledgeOf(editor.parsed.value).files : [];
  // the status line above says what to do next (save, then build)
  const addToWhatItKnows = (file) => {
    editor.setValue(addKnowledgeFile(editor.parsed.value, file.name));
    setAdded(`Added ${file.name} to what it knows.`);
  };
  // who reads a file, in words: the page's "What it knows" (and whether that is saved yet), and any other base by name
  const readBy = (file) => {
    const others = file.usedBy.filter((id) => id !== KNOWLEDGE_ID).map((id) => humanize(id));
    const saved = file.usedBy.includes(KNOWLEDGE_ID);
    const mine = inDraft.includes(file.name) ? (saved ? 'What it knows' : 'What it knows, once saved') : saved ? 'Nothing, once saved' : '';
    return [mine, ...others].filter(Boolean).join(', ');
  };

  return (
    <section className="stCard kwFiles" aria-label="Files">
      <h3>{uploads ? 'Files' : 'Files on the server'}</h3>
      <p className="stMuted">
        {uploads
          ? 'Text, markdown, HTML, PDF, CSV or JSON. A file does nothing until a base lists it as a source; replacing a file makes any index built from it out of date.'
          : 'Every document uploaded for this agent. Remove one from “What it knows” above to stop it being read; delete it here to take it off the server.'}
      </p>
      {uploads && (
        <div
          className={`kwDrop ${over ? 'over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            upload(event.dataTransfer.files);
          }}
        >
          <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload files'}
          </Button>
          <span className="stMuted">or drop them here</span>
        </div>
      )}
      {/* always here: a base's own "Upload" opens it, also when this card does not offer to upload */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        hidden
        aria-label="Choose files to upload"
        onChange={(event) => {
          upload(event.target.files);
          event.target.value = '';
        }}
      />
      {problems.length > 0 && (
        <ul className="kwProblemsList" role="alert">
          {problems.map((p) => (
            <li key={p} className="stFErr">
              {p}
            </li>
          ))}
        </ul>
      )}
      {added && added.savedAt === savedAt && attachFirst && (
        <p className="kwDone" role="status">
          {added.text}
        </p>
      )}
      {added && added.savedAt === savedAt && !attachFirst && (
        <p className="kwDone" role="status">
          {added.text} It is in the draft but not saved: the server builds from the saved draft.{' '}
          {editor.dirty && (
            <button type="button" className="stLink" onClick={() => editor.save()} disabled={editor.saving}>
              {editor.saving ? 'Saving…' : 'Save the draft'}
            </button>
          )}
        </p>
      )}
      {files.length === 0 ? (
        <p className="stFEmpty">No files uploaded yet.</p>
      ) : (
        <table className="kwTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Updated</th>
              <th>Read by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const free = bases.filter((b) => b.buildable && !file.usedBy.includes(b.id));
              return (
                <tr key={file.name}>
                  <td>
                    <code>{file.name}</code>
                  </td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatWhen(file.modified)}</td>
                  <td>
                    {attachFirst ? (
                      readBy(file) || <span className="stMuted">Nothing</span>
                    ) : file.usedBy.length ? (
                      file.usedBy.map((id) => humanize(id)).join(', ')
                    ) : (
                      <span className="stMuted">Nothing</span>
                    )}
                  </td>
                  <td className="kwRowActions">
                    {attachFirst ? (
                      // "What it knows" holds the documents: add the file there, not to a new base nothing reads
                      !inDraft.includes(file.name) && (
                        <Button type="button" size="small" onClick={() => addToWhatItKnows(file)}>
                          Add to what it knows
                        </Button>
                      )
                    ) : (
                      <SmartSelect
                        action
                        className="stFInput small"
                        ariaLabel={`Use ${file.name} in a base`}
                        placeholder="Use in…"
                        options={[...free.map((b) => ({ value: b.id, label: humanize(b.id) })), { value: '__new', label: 'a new base' }]}
                        onChange={(chosen) => {
                          if (chosen) addTo(file, chosen);
                        }}
                      />
                    )}
                    <button type="button" className="stFDel small" aria-label={`Delete ${file.name}`} onClick={() => remove(file.name)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
