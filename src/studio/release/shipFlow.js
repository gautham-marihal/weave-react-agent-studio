// "Where am I on the way to live?": the five things between a draft and callers, in order (save it, it is valid, it is tested, it is published, it is deployed),
// each done, to do, blocked or optional, with the one thing to do next. Built only from what the studio already knows. It informs; it does not decide:
// nothing here stops a publish or a deploy.
// Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);

// dirty: unsaved edits. parseError: the JSON cannot be read. report: the validator's answer for the draft (or null while unknown).
// scenarioCount / latestRun: the draft's test scenarios and the newest finished run of them (or null). published: { version, changes } for the newest
// published version, `changes` being how many differences the draft has from it, or null when nothing is published. deployed: { development: '0.1.0', ... }.
export function shipSteps({ dirty = false, parseError = '', report = null, scenarioCount = 0, latestRun = null, published = null, deployed = {} } = {}) {
  const steps = [];
  const add = (step) => steps.push(step);

  // 1. saved
  if (parseError) add({ id: 'save', label: 'Saved', state: 'blocked', text: 'The configuration cannot be read yet.', action: { label: 'Fix it in Config', tab: 'config' } });
  else if (dirty) add({ id: 'save', label: 'Saved', state: 'todo', text: 'You have unsaved edits.', action: { label: 'Go to Config to save', tab: 'config' } });
  else add({ id: 'save', label: 'Saved', state: 'done', text: 'The draft is saved.' });

  // 2. valid
  const errors = list(report?.errors).length;
  if (!report) add({ id: 'valid', label: 'Valid', state: 'todo', text: 'Not checked yet.' });
  else if (errors) add({ id: 'valid', label: 'Valid', state: 'blocked', text: `${errors} ${errors === 1 ? 'error' : 'errors'} to fix first.`, action: { label: 'Open Config', tab: 'config' } });
  else add({ id: 'valid', label: 'Valid', state: 'done', text: 'The draft passes the checks.' });

  // 3. tested (optional: an agent with no scenarios can still be published, and says so)
  if (scenarioCount === 0) add({ id: 'tested', label: 'Tested', state: 'optional', text: 'No test scenarios written, so nothing has checked its behaviour.', action: { label: 'Write scenarios', tab: 'scenarios' } });
  else if (!latestRun) add({ id: 'tested', label: 'Tested', state: 'todo', text: 'The scenarios have not been run.', action: { label: 'Run the scenarios', tab: 'scenarios' } });
  else if (latestRun.status === 'passed') add({ id: 'tested', label: 'Tested', state: 'done', text: `The latest run passed (${latestRun.passed} of ${latestRun.total}).` });
  else add({ id: 'tested', label: 'Tested', state: 'blocked', text: `The latest run ${latestRun.status === 'error' ? 'broke' : latestRun.status === 'skipped' ? 'skipped everything' : 'failed'}.`, action: { label: 'See the results', tab: 'scenarios' } });

  // 4. published: the newest version is the draft as it stands
  if (!published) add({ id: 'published', label: 'Published', state: 'todo', text: 'Nothing is published yet.', action: { label: 'Publish', publish: true } });
  else if (published.changes === 0) add({ id: 'published', label: 'Published', state: 'done', text: `v${published.version} is the draft as it stands.` });
  else add({ id: 'published', label: 'Published', state: 'todo', text: `The draft has ${published.changes} ${published.changes === 1 ? 'change' : 'changes'} since v${published.version}.`, action: { label: 'Publish', publish: true } });

  // 5. deployed: somewhere is running the newest version
  const live = Object.entries(deployed || {}).filter(([, version]) => !!version);
  if (!published) add({ id: 'deployed', label: 'Deployed', state: 'todo', text: 'Publish first, then choose where it runs.' });
  else if (live.some(([, version]) => version === published.version)) {
    const where = live.filter(([, version]) => version === published.version).map(([env]) => env);
    add({ id: 'deployed', label: 'Deployed', state: 'done', text: `v${published.version} runs in ${where.join(' and ')}.` });
  } else add({ id: 'deployed', label: 'Deployed', state: 'todo', text: live.length ? `Callers get an older version. v${published.version} is not deployed.` : 'Not deployed anywhere.', action: { label: 'Deploy', tab: 'deploy' } });

  const required = steps.filter((s) => s.state !== 'optional');
  const done = required.filter((s) => s.state === 'done').length;
  // what to do next: whatever is blocked comes before what is merely not done yet
  const next = steps.find((s) => s.state === 'blocked') || steps.find((s) => s.state === 'todo') || null;
  return { steps, done, total: required.length, next, ready: done === required.length };
}
