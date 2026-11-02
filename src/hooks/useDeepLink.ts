import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Path, StageId } from '../types/studio';
import type { DraftEditor } from './useDraftEditor';
import { PANEL_ELEMENT, readDeepLink, targetPath, type BuildSection, type DeepLink } from '../models/agentPages';
import { requestSettingFocus } from './useSettingFocus';
import { fieldId } from '../utils/path';
import { flash } from '../utils/focusField';
import { flashField } from '../utils/flashField';

/** Tells the JSON view which place to open at (it listens for this once it is shown). */
export const JSON_AT_EVENT = 'weave:json-at';

/** Shows what a link asked for, once its page is on the screen. */
function show(agentId: string, link: DeepLink, onAllSettings: () => void) {
  if (link.problems) {
    const panel = document.getElementById('checks-panel');
    if (panel) flash(panel, 'start');
  }
  const path: Path | null = link.path;
  if (!path) {
    const panel = link.target?.panel ? PANEL_ELEMENT[link.target.panel] : null;
    const el = panel ? document.getElementById(panel) : null;
    if (el) flash(el, 'start');
    return;
  }
  if (link.target?.view === 'json') {
    window.dispatchEvent(new CustomEvent(JSON_AT_EVENT, { detail: { path } }));
    return;
  }
  // the field itself, when the page asks for it above its settings
  const exact = document.getElementById(fieldId(path));
  if (exact) {
    flashField(exact);
    return;
  }
  // the settings form on this page, when the place is in its part
  if (requestSettingFocus(agentId, path)) return;
  // the block of the Agent section that holds it
  const panel = link.target?.panel ? PANEL_ELEMENT[link.target.panel] : null;
  const block = panel ? document.getElementById(panel) : null;
  if (block) {
    flash(block, 'start');
    return;
  }
  // else every setting: the request waits for the "All settings" form that opens now
  onAllSettings();
}

/**
 * Opens what an agent's address asks for: `?setting=a.b.c` (a setting), `?tool=id`, `?open=voice` (a panel of the
 * Agent section) and `?show=problems|json`. It goes to the page that holds it, takes the request off the address, and
 * shows the field. Used by the search, the Problems panel, and links from anywhere. `?publish=1` opens Publish.
 */
export function useDeepLink(editor: DraftEditor, stage: StageId, section: BuildSection, onPublish?: () => void) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const agentId = editor.agent?.id ?? '';
  const ready = !!editor.config;
  const query = params.toString();

  // ?publish=1 (the search's "Publish a version"): the publish dialog, which asks to save first
  useEffect(() => {
    if (!ready || !onPublish || params.get('publish') !== '1') return;
    const rest = new URLSearchParams(params);
    rest.delete('publish');
    setParams(rest, { replace: true });
    onPublish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ready]);

  useEffect(() => {
    if (!ready || !agentId) return undefined;
    const link = readDeepLink(params, editor.config);
    if (!link) return undefined;
    const target = link.target ?? { stage: 'build' as const, section };
    const rest = new URLSearchParams(params);
    // a page outside Build: go there and nothing more is to be shown
    if (target.stage !== 'build') {
      link.consumed.forEach((k) => rest.delete(k));
      const to = targetPath(agentId, target);
      const more = rest.toString();
      navigate(more ? `${to}${to.includes('?') ? '&' : '?'}${more}` : to, { replace: true });
      return undefined;
    }
    // the right Build section first (the JSON view and the whole agent's views are on any of them)
    if (stage !== 'build' || (target.section && target.section !== section && !target.view)) {
      navigate(`${targetPath(agentId, { stage: 'build', section: target.section ?? section })}?${query}`, { replace: true });
      return undefined;
    }
    link.consumed.forEach((k) => rest.delete(k));
    if (target.view) rest.set('view', target.view);
    else if (!link.problems) rest.delete('view');
    setParams(rest, { replace: true });
    // shown once the page has drawn (taking the link off the address must not cancel it)
    window.setTimeout(
      () =>
        show(agentId, link, () => {
          requestSettingFocus(agentId, link.path ?? []);
          const next = new URLSearchParams(window.location.search);
          next.set('view', 'all');
          setParams(next, { replace: true });
        }),
      160,
    );
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ready, agentId, stage, section]);
}
