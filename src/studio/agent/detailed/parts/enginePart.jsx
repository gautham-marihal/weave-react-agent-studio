import React from 'react';
import { getAtPath } from '../../schemaPath.js';
import { InlineItems } from '../Detailed.jsx';

// 11 · Engine and details: what runs it underneath, and what is left of Settings once everything else moved to the
// part it changes: its version and status (set by Release), the engine, fixed values every text can use, and the
// studio's own checks. The whole configuration as JSON is one button away (its header's "Edit as JSON").

const when = (config) => {
  const created = getAtPath(config, ['meta', 'created_at']);
  const changed = getAtPath(config, ['meta', 'updated_at']);
  const day = (v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  // the server writes these when it saves a version; a draft may not have them yet
  if (!created && !changed) return 'Not recorded yet: the server adds them when a version is saved';
  return [created && `Created ${day(created)}`, changed && `changed ${day(changed)}`].filter(Boolean).join(' · ');
};
const constantName = (value, key) => `${key} = ${typeof value === 'string' ? value : JSON.stringify(value)}`;

export const enginePart = {
  id: 'settings',
  num: '11',
  title: 'Engine and details',
  question: 'What runs it underneath? What is left of Settings once everything else has moved to where it belongs.',
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
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={['constants']} word="value" label="Fixed values" collection="constants" nameOf={constantName} />
            ),
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
          { id: 'worker', label: 'Worker process', kind: 'form', path: ['runtime', 'worker'] },
          { id: 'dispatch', label: 'Dispatch name (old)', kind: 'text', path: ['runtime', 'dispatch_name'] },
        ],
      },
      {
        id: 'lint',
        title: 'Studio checks',
        lead: 'Warnings the studio gives while you build.',
        rows: [
          { id: 'words', label: 'Most words in one agent’s instructions', path: ['builder', 'lint', 'max_prompt_words_per_agent'] },
          { id: 'tools', label: 'Most tools per agent', path: ['builder', 'lint', 'max_tools_per_agent'] },
          { id: 'mono', label: 'Warn when one agent does everything', path: ['builder', 'lint', 'warn_on_monolith'] },
        ],
      },
    ],
  ],
};
