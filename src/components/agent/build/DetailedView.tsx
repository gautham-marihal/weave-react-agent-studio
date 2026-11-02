import React, { useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';
import type { Path } from '../../../types/studio';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import type { SettingGroupId } from '../../../data/settingsCatalog';
import { useStudio } from '../../../contexts/StudioContext';
import { useSchema } from '../../../hooks/useSchema';
import { requestSettingFocus } from '../../../hooks/useSettingFocus';
import { JSON_AT_EVENT } from '../../../hooks/useDeepLink';
import { buildSettingsIndex, searchSettings, type SettingEntry } from '../../../models/schemaForm/settingsSearch';
import { capSameLabel } from '../../../models/agentPages';
import { Toggle } from '../../ui/Toggle';
import { SchemaForm } from './form/SchemaForm';
import { cn, inputClass } from '../../../utils/styles';

interface DetailedViewProps {
  editor: DraftEditor;
  /** The group a guided block's "More settings" asked for. */
  initialGroup: SettingGroupId | null;
  onOpenJson: () => void;
  /** Only these groups, without the group menu and the search (a Build section's "All settings for this part"). */
  only?: SettingGroupId[];
}

// The guided blocks and Build sections still name their part by the old groups; each is these sections of the config.
const GROUP_SECTIONS: Record<SettingGroupId, string[]> = {
  about: ['meta', 'persona'],
  talks: ['messages', 'defaults'],
  behaves: ['agents', 'state', 'events'],
  engine: ['runtime', 'constants', 'builder'],
  available: ['channels', 'identity', 'schedules', 'telephony'],
  can_do: ['tools', 'connections', 'forms', 'notifications', 'tasks'],
  after: ['post_call', 'wrapups'],
  records: ['observability', 'tests'],
};
// The screen a group's "More settings" opens on.
const GROUP_SCREEN: Record<SettingGroupId, string> = {
  about: 'persona',
  talks: 'defaults.models',
  behaves: 'agents',
  engine: 'runtime',
  available: 'channels',
  can_do: 'tools',
  after: 'post_call',
  records: 'observability',
};

/**
 * "All settings": every setting of the agent, drawn from the server's schema and grouped by what it is for, with a
 * search over all of them. In a Build section it shows only that part's settings.
 */
export function DetailedView({ editor, initialGroup, onOpenJson, only }: DetailedViewProps) {
  const { technicalNames, setTechnicalNames } = useStudio();
  const { schema } = useSchema();
  const [query, setQuery] = useState('');
  const agentId = editor.agent?.id ?? '';
  const sections = useMemo(() => (only ? only.flatMap((g) => GROUP_SECTIONS[g] ?? []) : null), [only]);
  const index = useMemo(() => buildSettingsIndex(schema), [schema]);
  const results = useMemo(() => capSameLabel(searchSettings(index, query, 24), 2).slice(0, 8), [index, query]);

  const openJsonAt = (path: Path) => {
    onOpenJson();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(JSON_AT_EVENT, { detail: { path } })), 120);
  };
  const open = (entry: SettingEntry) => {
    setQuery('');
    requestSettingFocus(agentId, entry.jump);
  };

  if (!editor.config) return null;

  const form = (
    <SchemaForm editor={editor} sections={sections} embedded={!!only} initialView={initialGroup ? GROUP_SCREEN[initialGroup] : null} onOpenJson={openJsonAt} />
  );
  if (only) return form;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="relative min-w-[240px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) open(results[0]);
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Find any setting, e.g. “silence”, “voice” or timeout_s"
            className={cn(inputClass, 'pl-9')}
          />
          {query.trim().length >= 2 && (
            <ul role="listbox" aria-label="Settings found" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-overlay">
              {results.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No setting matches “{query.trim()}”.</li>}
              {results.map((entry) => (
                <li key={entry.trail.join('.')} role="option" aria-selected={false}>
                  <button type="button" onClick={() => open(entry)} className="w-full rounded-md px-3 py-2 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none">
                    <span className="block text-sm font-medium text-ink">
                      {entry.label}
                      {entry.level === 'expert' && <span className="ml-1.5 text-[11px] font-normal text-muted">advanced</span>}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{entry.where}</span>
                    {technicalNames && <span className="block truncate font-mono text-[11px] text-muted">{entry.trail.join('.')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Toggle checked={technicalNames} onChange={setTechnicalNames} label="Show technical names" />
          Technical names
        </label>
      </div>
      {form}
    </div>
  );
}
