import React from 'react';
import { navigate, routeHref } from '../../route.js';
import { PAGES, STAGES, stageOf, tabFor } from '../pages.js';
import { RELEASE_PARTS, TEST_PARTS } from '../pageLists.js';
import { ChecksChip } from './BuildStage.jsx';

// The row under the stage tabs: the open stage's own views, so every stage is found the same way. Build: the draft's
// four views (Guided, Detailed, Workflow, JSON) with the checks on the right; Test and Release: their parts; Monitor:
// its pages. Overview has none. Each view is an address, so a link, a reload and Back reach the same one.
//   page: the open page; part: the open part of Test or Release; jsonOpen: the JSON view is open
//   checks: { checked, problems } for the checks chip; counts: { [part id]: { text, tone } } a part's latest result ("2 fail"), tone good | warn | bad
//   right: what sits at the row's right instead (Test's publishing gate)
const BUILD_VIEWS = [
  { id: 'guided', label: 'Guided', page: 'build' },
  { id: 'detailed', label: 'Detailed', page: 'agent' },
  { id: 'workflow', label: 'Workflow', page: 'workflow' },
];
const MONITOR = STAGES.find((stage) => stage.id === 'monitor').pages.map((id) => PAGES.find((p) => p.id === id));

export default function StageViews({ botId, page, part, jsonOpen = false, onJson, checks = null, onChecks, counts = {}, right = null }) {
  const stage = stageOf(page)?.id;
  const go = (target) => navigate(routeHref(botId, target), { guard: false });
  const count = (id) => (counts[id] ? <b className={`nlViewCount ${counts[id].tone || ''}`}>{counts[id].text}</b> : null);
  // one view button: pressed (and the current page) when open
  const view = (key, on, label, onClick, attrs = {}) => (
    <button key={key} type="button" aria-pressed={on} aria-current={on ? 'page' : undefined} onClick={onClick} {...attrs}>
      {label}
      {count(key)}
    </button>
  );

  let views = null;
  let side = right;
  if (stage === 'build') {
    const open = page === 'build' ? 'guided' : page === 'workflow' ? 'workflow' : jsonOpen ? 'json' : 'detailed';
    views = (
      <nav className="segmented" aria-label="How to see the draft" title="One draft, four views: a change in one is in all of them.">
        {BUILD_VIEWS.map((v) => view(v.id, open === v.id, v.label, () => go(v.page), { 'data-view': v.id }))}
        {view('json', open === 'json', 'JSON', onJson, { 'data-view': 'json' })}
      </nav>
    );
    side = checks ? <ChecksChip status={checks} onOpen={onChecks} /> : null;
  } else if (stage === 'test' || stage === 'release') {
    const [id, parts, label] = stage === 'test' ? ['tests', TEST_PARTS, 'Parts of testing'] : ['releases', RELEASE_PARTS, 'Parts of releasing'];
    views = (
      <nav className="segmented" aria-label={label}>
        {parts.map((p) => view(p.id, part === p.id, p.label, () => go(tabFor(id, p.id)), { 'data-part': p.id }))}
      </nav>
    );
  } else if (stage === 'monitor') {
    views = (
      <nav className="segmented" aria-label="Monitor">
        {MONITOR.map((p) => view(p.id, page === p.id, p.label, () => go(p.id), { 'data-page': p.id }))}
      </nav>
    );
  }
  if (!views) return null;
  return (
    <div className="nlViews">
      {views}
      {side && <div className="nlViewsSide">{side}</div>}
    </div>
  );
}
