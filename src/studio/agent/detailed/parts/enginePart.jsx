import React from 'react';
import { getAtPath } from '../../schemaPath.js';
import EngineWorkspace from '../engineWorkspace/EngineWorkspace.jsx';
import ConstantsTable from '../engineWorkspace/ConstantsTable.jsx';

// 11 · Engine and details: what runs it underneath, and what is left of Settings once everything else moved to the
// part it changes: its version and status (set by Release), the engine, fixed values every text can use, and the
// studio's own checks, and the logs for your team (the log of each call is After the call's). The workspace
// (EngineWorkspace) draws these rows as a nameplate and three chapters; All settings shows the cards below. The whole
// configuration as JSON is one button away (its header's "Edit as JSON").

const when = (config) => {
  const created = getAtPath(config, ['meta', 'created_at']);
  const changed = getAtPath(config, ['meta', 'updated_at']);
  const day = (v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  // the server writes these when it saves a version; a draft may not have them yet
  if (!created && !changed) return 'Not recorded yet: the server adds them when a version is saved';
  return [created && `Created ${day(created)}`, changed && `changed ${day(changed)}`].filter(Boolean).join(' · ');
};

export const engineForm = {
  id: 'settings',
  num: '12',
  title: 'Engine and details',
  question: 'What runs it underneath: its version, the engine, fixed values and the studio’s checks. Mostly for technical people.',
  cols: [
    [
      {
        id: 'version',
        title: 'Version and status',
        lead: 'Shown here, set by Release.',
        rows: [
          {
            id: 'id',
            label: 'Id',
            hint: 'Fixed once created',
            tags: 'r',
            kind: 'note',
            text: (c) => getAtPath(c, ['meta', 'id']) || '—',
            errPath: ['meta', 'id'],
          },
          {
            id: 'version',
            label: 'Version number',
            hint: 'Set when a version is published',
            kind: 'note',
            text: (c) => getAtPath(c, ['meta', 'version']) || 'Not published yet',
          },
          { id: 'env', label: 'Intended environment', path: ['meta', 'environment'] },
          {
            id: 'status',
            label: 'Status',
            hint: 'Set by the server',
            kind: 'note',
            text: (c) => ({ draft: 'Draft', published: 'Published', archived: 'Archived' })[getAtPath(c, ['meta', 'status'])] || 'Draft',
          },
          { id: 'when', label: 'Created · last changed', hint: 'Set by the server', kind: 'note', text: when },
        ],
      },
      {
        id: 'constants',
        title: 'Fixed values',
        rows: [
          {
            id: 'values',
            label: 'Values',
            hint: 'Use them in any text as {{const.name}}',
            errPath: ['constants'],
            render: (c) => <ConstantsTable ctx={c} id={c.id} />,
          },
        ],
      },
    ],
    [
      {
        id: 'engine',
        title: 'Engine',
        rows: [
          { id: 'engine', label: 'Voice engine', kind: 'pick', path: ['runtime', 'engine'] },
          { id: 'mode', label: 'Where models come from', path: ['runtime', 'provider_mode'] },
          { id: 'vault', label: 'Where secrets are kept', kind: 'text', path: ['runtime', 'secrets_vault'] },
          { id: 'tz', label: 'Time zone', kind: 'text', placeholder: 'Asia/Singapore', path: ['runtime', 'timezone'] },
          { id: 'close', label: 'Close the connection when it ends', path: ['runtime', 'hangup', 'delete_room_on_close'] },
          { id: 'drain', label: 'Finish speaking before hanging up', path: ['runtime', 'hangup', 'drain'] },
        ],
        adv: [
          {
            id: 'worker',
            label: 'Worker process',
            // agent config guide 3.3: one worker runs every agent, so these are set on the worker, not read from here
            hint: 'Not read from here: one worker runs every agent, so these are set on the worker itself.',
            kind: 'form',
            path: ['runtime', 'worker'],
          },
          { id: 'dispatch', label: 'Dispatch name (old)', kind: 'text', path: ['runtime', 'dispatch_name'] },
        ],
      },
      {
        id: 'logs',
        title: 'Logs and monitoring',
        rows: [
          { id: 'metrics', label: 'Collect metrics', path: ['observability', 'metrics'] },
          { id: 'level', label: 'Log detail', path: ['observability', 'log_level'] },
          { id: 'tracing', label: 'Tracing', path: ['observability', 'tracing'] },
          { id: 'otelOn', label: 'Send to OpenTelemetry', hint: 'Traces and metrics to a collector of your own', path: ['observability', 'otel', 'enabled'] },
          {
            id: 'otelEndpoint',
            label: 'Collector address',
            kind: 'text',
            placeholder: 'https://otel.example.com:4318',
            disabled: (c) => c?.observability?.otel?.enabled !== true,
            path: ['observability', 'otel', 'endpoint'],
          },
          {
            id: 'otelName',
            label: 'Service name',
            kind: 'text',
            disabled: (c) => c?.observability?.otel?.enabled !== true,
            path: ['observability', 'otel', 'service_name'],
          },
        ],
        adv: [
          {
            id: 'logFile',
            label: 'A rotating log file',
            // agent config guide 3.26: kept in the configuration, but the runtime does not write it yet
            hint: 'Not applied yet: the runtime keeps this setting but doesn’t write the file.',
            kind: 'form',
            path: ['observability', 'log_file'],
          },
        ],
      },
      {
        id: 'lint',
        title: 'Studio checks',
        // the server's check warns only when a limit is set (no default); the agent config guide's example uses 450 and 8
        lead: 'Warnings the server’s check gives while you build. Each is off until it has a number: the agent config guide suggests 450 words and 8 tools.',
        rows: [
          { id: 'words', label: 'Most words in one agent’s instructions', path: ['builder', 'lint', 'max_prompt_words_per_agent'] },
          { id: 'tools', label: 'Most tools per agent', path: ['builder', 'lint', 'max_tools_per_agent'] },
          { id: 'mono', label: 'Warn when one agent does everything', path: ['builder', 'lint', 'warn_on_monolith'] },
        ],
      },
    ],
  ],
};

export const enginePart = { ...engineForm, render: (ctx) => <EngineWorkspace ctx={ctx} form={engineForm} /> };
