import React, { useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { assignBot, patchBot, refreshBots, switchWorkspace, useWorkspaces } from '../agents.js';
import { envLabel, Modal, Notice, Spinner } from '../ui.jsx';
import { useAsync } from '../useAsync.js';
import { configToText, copyText, downloadText, exportFileName } from './exportConfig.js';
import { saveTemplate, templateFileName, templateToFile } from '../savedTemplates.js';

// ---- Rename ---------------------------------------------------------------------------------------------
// The display name is meta.name in the draft. The id is permanent (links and calls use it), and published
// versions keep the name they were published with, so this changes the draft only.

export function RenameDialog({ botId, currentName, onClose, onDone }) {
  const [name, setName] = useState(currentName || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const trimmed = name.trim();
  const unchanged = trimmed === String(currentName || '').trim();
  const problem = !trimmed ? 'Give the agent a name.' : trimmed.length > 80 ? 'Keep it to 80 characters or fewer.' : '';
  const canSave = !problem && !unchanged && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Read the latest draft and change only the name, so nothing else saved meanwhile is overwritten.
      const draft = await api.getDraft(botId);
      const config = { ...draft.config, meta: { ...draft.config.meta, name: trimmed } };
      const result = await api.saveDraft(botId, config, draft.revision);
      patchBot(botId, { name: trimmed, draft_revision: result.draft.revision, draft_saved_at: result.draft.saved_at });
      refreshBots();
      onDone?.(trimmed);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="RENAME"
      title="Rename this agent"
      subtitle="Changes the name people see. The id stays the same."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="modalCreate" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </>
      }
    >
      <div className="stFormStack">
        <label className={`workspaceField ${problem && name ? 'bad' : ''}`}>
          <span>Name</span>
          <small>Shown in lists and at the top of the agent.</small>
          <input
            autoFocus
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
            }}
            aria-invalid={!!problem || undefined}
          />
          {problem && name !== '' && <small className="stFieldError">{problem}</small>}
        </label>
        <p className="stMuted">
          The id <code>{botId}</code> is permanent. Published versions keep the name they were published with; the new name applies to the draft and to versions
          you publish from now on.
        </p>
        {error && (
          <Notice kind="error" title={error.kind === 'conflict' ? 'The draft changed while you were renaming' : 'Couldn’t rename'}>
            {error.kind === 'conflict' ? 'Someone saved it a moment ago. Try again.' : error.message}
          </Notice>
        )}
      </div>
    </Modal>
  );
}

// ---- Export ---------------------------------------------------------------------------------------------

export function ExportDialog({ botId, name, editor, onClose }) {
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId]);
  const [choice, setChoice] = useState('draft');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState(null);

  const editorReady = !!editor && editor.dirty && !editor.parsed?.error && editor.isObject;
  const options = useMemo(
    () => [
      { value: 'draft', label: 'Saved draft', note: 'The working copy as last saved.' },
      ...(editorReady ? [{ value: 'editor', label: 'What is in the editor now', note: 'Includes edits you haven’t saved.' }] : []),
      ...(versions.data || []).map((item, index) => ({
        value: `v:${item.version}`,
        label: `Version ${item.version}${index === 0 ? ' (latest)' : ''}`,
        note: 'Published and frozen.',
      })),
    ],
    [editorReady, versions.data],
  );

  const load = async () => {
    if (choice === 'editor') return { label: 'unsaved', config: editor.parsed.value };
    if (choice === 'draft') return { label: 'draft', config: (await api.getDraft(botId)).config };
    const version = choice.slice(2);
    return { label: version, config: (await api.getVersion(botId, version)).config };
  };

  const run = async (kind) => {
    setBusy(kind);
    setError(null);
    setDone('');
    try {
      const { label, config } = await load();
      const text = configToText(config);
      if (kind === 'download') {
        const file = exportFileName(botId, label);
        downloadText(file, text);
        setDone(`Saved as ${file}`);
      } else {
        setDone((await copyText(text)) ? 'Copied to the clipboard' : 'Couldn’t copy. Use Download instead.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      eyebrow="EXPORT"
      title={`Export ${name || botId}`}
      subtitle="Saves the configuration as a JSON file you can keep, share or import elsewhere."
      onClose={onClose}
      busy={!!busy}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose} disabled={!!busy}>
            Close
          </button>
          <button type="button" className="quietButton" onClick={() => run('copy')} disabled={!!busy || versions.loading}>
            {busy === 'copy' ? 'Copying…' : 'Copy JSON'}
          </button>
          <button type="button" className="modalCreate" onClick={() => run('download')} disabled={!!busy || versions.loading}>
            {busy === 'download' ? 'Preparing…' : 'Download'}
          </button>
        </>
      }
    >
      {versions.loading && !versions.data ? (
        <Spinner label="Loading versions" />
      ) : (
        <fieldset className="stExportChoices">
          <legend>What to export</legend>
          {options.map((option) => (
            <label key={option.value} className={choice === option.value ? 'on' : ''}>
              <input
                type="radio"
                name="export-source"
                value={option.value}
                checked={choice === option.value}
                onChange={() => {
                  setChoice(option.value);
                  setDone('');
                }}
                disabled={!!busy}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {versions.error && !versions.data && (
        <Notice kind="warn" title="Couldn’t list the versions">
          Only the draft can be exported right now. {versions.error.message}
        </Notice>
      )}
      <p className="stMuted">
        Secrets are never part of a configuration: the file only contains their names, such as <code>OPENAI_API_KEY</code>.
      </p>
      {done && <Notice kind="good" title={done} />}
      {error && (
        <Notice kind="error" title="Couldn’t export">
          {error.message}
        </Notice>
      )}
    </Modal>
  );
}

// ---- Save as a template ---------------------------------------------------------------------------------
// The agent's contents without what makes it THIS agent (id, name, version): the Create dialog then offers it next to the built-in starting
// points. Kept in this browser, and exportable to a file, which is how templates are shared until the API has somewhere to keep them.

export function SaveTemplateDialog({ botId, name, editor, onClose }) {
  const [templateName, setTemplateName] = useState(`${name || botId} template`);
  const [description, setDescription] = useState('');
  const [source, setSource] = useState(editor?.dirty && !editor.parsed?.error && editor.isObject ? 'editor' : 'draft');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // the saved template
  const [error, setError] = useState(null);
  const editorReady = !!editor && editor.dirty && !editor.parsed?.error && editor.isObject;
  const problem = !templateName.trim() ? 'Give the template a name.' : templateName.trim().length > 80 ? 'Keep it to 80 characters or fewer.' : '';

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const config = source === 'editor' ? editor.parsed.value : (await api.getDraft(botId)).config;
      const result = saveTemplate({ name: templateName, description, config, sourceName: config?.persona?.name || config?.meta?.name || name || '' });
      if (!result.saved) throw new Error('This browser couldn’t keep it (its storage is full or switched off). Download the file instead.');
      setDone(result.template);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      eyebrow="TEMPLATE"
      title={`Save ${name || botId} as a template`}
      subtitle="A template is a starting point for new agents. The id, name and version stay with this agent."
      onClose={onClose}
      busy={busy}
      footer={
        done ? (
          <>
            <button type="button" className="modalCancel" onClick={onClose}>
              Close
            </button>
            <button type="button" className="modalCreate" onClick={() => downloadText(templateFileName(done), templateToFile(done))}>
              Download the file
            </button>
          </>
        ) : (
          <>
            <button type="button" className="modalCancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="modalCreate" onClick={save} disabled={!!problem || busy}>
              {busy ? 'Saving…' : 'Save as template'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <Notice kind="good" title={`“${done.name}” is saved`}>
          It appears under “Your templates” when you create an agent, on this browser. To share it with a colleague, download the file: they can import it in
          the Create dialog.
        </Notice>
      ) : (
        <div className="stFormStack">
          <label className={`workspaceField ${problem && templateName ? 'bad' : ''}`}>
            <span>Template name</span>
            <input
              autoFocus
              value={templateName}
              maxLength={120}
              onChange={(event) => setTemplateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save();
              }}
            />
            {problem && <small className="stFieldError">{problem}</small>}
          </label>
          <label className="workspaceField">
            <span>
              What it is for <em>(optional)</em>
            </span>
            <input
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. A front desk for our clinics, with booking and handoff"
            />
          </label>
          {editorReady && (
            <fieldset className="stExportChoices">
              <legend>Made from</legend>
              <label className={source === 'draft' ? 'on' : ''}>
                <input type="radio" name="tpl-source" checked={source === 'draft'} onChange={() => setSource('draft')} />
                <span>
                  <strong>The saved draft</strong>
                  <small>As last saved.</small>
                </span>
              </label>
              <label className={source === 'editor' ? 'on' : ''}>
                <input type="radio" name="tpl-source" checked={source === 'editor'} onChange={() => setSource('editor')} />
                <span>
                  <strong>What is in the editor now</strong>
                  <small>Includes edits you haven’t saved.</small>
                </span>
              </label>
            </fieldset>
          )}
          <p className="stMuted">
            Secrets are never part of a configuration: only their names are. Test scenarios, tools, knowledge bases and channels are kept, so a new agent starts
            complete.
          </p>
          {error && (
            <Notice kind="error" title="Couldn’t save the template">
              {error.message}
            </Notice>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---- Remove from my list --------------------------------------------------------------------------------
// The API has no delete endpoint, so this hides the agent on this browser. It says so plainly.

export function RemoveDialog({ bot, onClose, onDone }) {
  const deployed = Object.entries(bot.deployed || {});
  const live = deployed.some(([env]) => env === 'production');
  return (
    <Modal
      eyebrow="REMOVE"
      title={`Remove ${bot.name || bot.id} from your list?`}
      subtitle="This hides the agent here. It does not delete anything on the server."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dangerButton"
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            Remove from my list
          </button>
        </>
      }
    >
      <Notice kind="info" title="Agents can’t be deleted from the server yet">
        The agent, its draft, its versions and its deployments stay on the server exactly as they are. You can bring it back any time from “Removed from your
        list” on the Agents page.
      </Notice>
      {deployed.length > 0 && (
        <Notice kind={live ? 'error' : 'warn'} title={live ? 'It is live in production' : 'It is still deployed'}>
          Removing it from your list does not stop it. It keeps running in {deployed.map(([env, version]) => `${envLabel(env)} (v${version})`).join(', ')}.
        </Notice>
      )}
    </Modal>
  );
}

// ---- Move to another workspace ----------------------------------------------------------------------------
// A workspace is a label kept in this browser, so moving an agent changes where it is listed here. The agent
// itself, its versions and its deployments are not touched.

export function MoveDialog({ bot, onClose, onDone }) {
  const { spaces, ownerOf } = useWorkspaces();
  // Where the agent was when the dialog opened: after the move it is already in the new workspace.
  const [here] = useState(() => ownerOf(bot.id));
  const others = spaces.filter((space) => space.id !== here);
  const [target, setTarget] = useState(others[0]?.id || '');
  const [moved, setMoved] = useState(null);
  const hereName = spaces.find((space) => space.id === here)?.name;
  const targetName = spaces.find((space) => space.id === (moved || target))?.name;

  if (moved) {
    return (
      <Modal
        eyebrow="MOVED"
        title={`${bot.name || bot.id} is now in ${targetName}`}
        subtitle="It no longer shows in the workspace you moved it from."
        onClose={() => {
          onClose();
          onDone(moved);
        }}
        footer={
          <>
            <button
              type="button"
              className="modalCancel"
              onClick={() => {
                onClose();
                onDone(moved);
              }}
            >
              Stay in {hereName}
            </button>
            <button
              type="button"
              className="modalCreate"
              onClick={() => {
                onClose();
                onDone(moved);
                switchWorkspace(moved);
              }}
            >
              Open {targetName}
            </button>
          </>
        }
      />
    );
  }

  return (
    <Modal
      eyebrow="MOVE"
      title={`Move ${bot.name || bot.id} to another workspace`}
      subtitle={`It is in ${hereName || 'this workspace'} now. Each agent belongs to one workspace.`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modalCancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modalCreate"
            disabled={!target}
            onClick={() => {
              assignBot(bot.id, target);
              setMoved(target);
            }}
          >
            Move agent
          </button>
        </>
      }
    >
      {others.length === 0 ? (
        <Notice kind="info" title="There is no other workspace yet">
          Create another workspace from the workspace menu, then come back to move this agent into it.
        </Notice>
      ) : (
        <fieldset className="stBump stWorkspacePick">
          <legend>Move to</legend>
          {others.map((space) => (
            <label key={space.id} className={`wide ${target === space.id ? 'on' : ''}`}>
              <input type="radio" name="move-target" value={space.id} checked={target === space.id} onChange={() => setTarget(space.id)} />
              <span>
                <strong>{space.name}</strong>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="stMuted">
        Sessions and simulations stay with the workspace they were recorded in. The agent’s configuration, versions and deployments are not changed.
      </p>
    </Modal>
  );
}
