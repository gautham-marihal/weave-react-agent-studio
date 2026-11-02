import React, { useRef, useState } from 'react';
import { toast } from '../../ui/Toast';
import { AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, FileJsonIcon, UploadIcon, XCircleIcon } from 'lucide-react';
import type { Agent, AgentConfig } from '../../../types/studio';
import { useStudio } from '../../../contexts/StudioContext';
import { useAuth } from '../../../contexts/AuthContext';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { api } from '../../../api/client';
import type { ValidationReport } from '../../../types/studio';
import { checkJson } from '../../../utils/jsonCheck';
import { inputClass } from '../../../utils/styles';

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  agent: Agent;
  currentConfig: AgentConfig;
  /** Puts the imported config in the editor as one undoable change; it is saved like any other edit. */
  onConfigImported: (newConfig: AgentConfig) => void;
}

export function ImportExportModal({ open, onClose, agent, currentConfig, onConfigImported }: ImportExportModalProps) {
  const { logAudit } = useStudio();
  const { can } = useAuth();
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [importJson, setImportJson] = useState('');
  // The server's report on the pasted config (POST /validate). It informs; an invalid config can still be imported
  // and saved, as with any edit. Publishing is where the server refuses.
  const [validationResult, setValidationResult] = useState<ValidationReport | null>(null);
  const [checking, setChecking] = useState(false);
  const checkSeq = useRef(0);
  const [parsed, setParsed] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const jsonStr = JSON.stringify(currentConfig, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.id}-draft-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logAudit('exported', agent.id, `Exported draft configuration (${(jsonStr.length / 1024).toFixed(1)} KB)`);
    toast.success(`Exported ${agent.id} configuration`, {
      description: 'The JSON file has been downloaded and an audit record was logged.',
    });
    onClose();
  };

  const handleTextChange = (text: string) => {
    setImportJson(text);
    setParsed(false);
    checkSeq.current++;
    setChecking(false);
    if (!text.trim()) {
      setJsonError(null);
      setValidationResult(null);
      return;
    }

    const check = checkJson(text);
    if (!check.ok) {
      setJsonError(check.message);
      setValidationResult(null);
      return;
    }

    if (typeof check.value !== 'object' || check.value === null || Array.isArray(check.value)) {
      setJsonError('The configuration must be a JSON object ({ … }).');
      setParsed(false);
      setValidationResult(null);
      return;
    }
    setJsonError(null);
    setParsed(true);
    setValidationResult(null);
    const seq = ++checkSeq.current;
    setChecking(true);
    api
      .validate(check.value as AgentConfig)
      .then((report) => seq === checkSeq.current && setValidationResult(report))
      .catch((err: unknown) => seq === checkSeq.current && setJsonError(`The server’s checks could not be run: ${err instanceof Error ? err.message : 'unknown error'}`))
      .finally(() => seq === checkSeq.current && setChecking(false));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleTextChange(content);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = () => {
    if (!parsed) return;
    const check = checkJson(importJson);
    if (!check.ok) return;

    const imported = check.value as AgentConfig;
    onConfigImported(imported);
    toast.success(`Imported configuration for ${agent.name}`, {
      description: 'The draft now holds the imported JSON. It saves in a moment; Undo puts back what was there.',
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Configuration Import & Export · ${agent.name}`}
      description="Export your draft or import a validated JSON configuration. All exports and imports are audited."
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-xs text-muted">Audited operation (FR-31)</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {tab === 'export' ? (
              <Button variant="primary" onClick={handleExport}>
                <DownloadIcon className="h-3.5 w-3.5 mr-1" />
                Download JSON
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleConfirmImport}
                disabled={!parsed || !can('edit')}
              >
                <UploadIcon className="h-3.5 w-3.5 mr-1" />
                Replace Draft
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Tab switcher */}
        <div className="flex border-b border-line gap-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setTab('export')}
            className={`pb-2 transition-colors border-b-2 flex items-center gap-1.5 ${
              tab === 'export'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export Draft JSON
          </button>
          <button
            type="button"
            onClick={() => setTab('import')}
            className={`pb-2 transition-colors border-b-2 flex items-center gap-1.5 ${
              tab === 'import'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <UploadIcon className="h-3.5 w-3.5" />
            Import & Validate JSON
          </button>
        </div>

        {tab === 'export' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-subtle/50 p-4 text-xs text-ink-soft space-y-2">
              <p className="font-semibold text-ink">Exporting working draft:</p>
              <div className="grid grid-cols-2 gap-2 text-muted">
                <div>Bot ID: <code className="font-mono text-ink">{agent.id}</code></div>
                <div>Revision: <code className="font-mono text-ink">rev {agent.draft.revision}</code></div>
                <div>Version: <code className="font-mono text-ink">{currentConfig.meta?.version ?? 'not set'}</code></div>
                <div>Size: <code className="font-mono text-ink">~{(JSON.stringify(currentConfig).length / 1024).toFixed(1)} KB</code></div>
              </div>
              <p className="pt-2 text-muted border-t border-line">
                The downloaded JSON contains full channels, agent roles, tool definitions, and guardrails. Sensitive keys are stored as secret references (<code className="font-mono">{"{\"secret\":\"NAME\"}"}</code>) and no raw credentials are ever exported.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">Paste JSON or select file</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
              >
                <FileJsonIcon className="h-3.5 w-3.5" />
                Choose .json file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <textarea
              rows={8}
              value={importJson}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={`{\n  "meta": { "id": "${agent.id}", ... }\n}`}
              className={`${inputClass} font-mono text-xs w-full`}
            />

            {jsonError && (
              <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-xs text-danger flex items-start gap-2">
                <XCircleIcon className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">JSON Syntax Error:</span>
                  <p className="mt-0.5">{jsonError}</p>
                </div>
              </div>
            )}

            {checking && <p className="text-xs text-muted" aria-live="polite">Asking the server to check it…</p>}
            {validationResult && (
              <div
                className={`rounded-lg border p-3.5 text-xs ${
                  validationResult.valid
                    ? 'border-success/30 bg-success-soft/30'
                    : 'border-danger/30 bg-danger-soft/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {validationResult.valid ? (
                      <CheckCircle2Icon className="h-4 w-4 text-success" />
                    ) : (
                      <XCircleIcon className="h-4 w-4 text-danger" />
                    )}
                    <span className="font-semibold text-ink">
                      {validationResult.valid
                        ? 'The server found no problems'
                        : `The server found ${validationResult.errors.length} ${validationResult.errors.length === 1 ? 'problem' : 'problems'}`}
                    </span>
                  </div>
                  {validationResult.warnings.length > 0 && (
                    <span className="text-warning flex items-center gap-1 text-[11px]">
                      <AlertTriangleIcon className="h-3 w-3" />
                      {validationResult.warnings.length} warnings
                    </span>
                  )}
                </div>

                {!validationResult.valid && (
                  <ul className="mt-2 space-y-1 list-disc list-inside text-danger">
                    {validationResult.errors.map((err, i) => (
                      <li key={i}>{err.message}</li>
                    ))}
                  </ul>
                )}

                <p className="mt-1 text-ink-soft">
                  Replace Draft puts this into the editor. Nothing is saved until you press Save{validationResult.valid ? '.' : ', and the server will not publish it until the problems are fixed.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
