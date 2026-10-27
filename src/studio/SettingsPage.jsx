import React, { useEffect, useMemo, useState } from 'react';
import Fold from '../ui/Fold.jsx';
import { api } from '../api/client.ts';
import { DEMO_NOTE, demoIsForced, isDemoMode, setDemoMode } from '../demo/demoMode.js';
import { navigate, routeHref } from './route.js';
import { envLabel } from './ui.jsx';
import { useAsync } from './useAsync.js';
import { DENSITIES, useDensity, useTechnicalNames } from './usePref.js';
import { StyleCards } from '../ui/StylePicker.jsx';
import { Choice, OneOf } from '../ui/OneOf.tsx';

// Workspace settings. Workspaces and which agent is in which are kept in this browser; the agents live on the Agent
// Builder API. The page says what is on the server and what is only local.
export default function SettingsPage({ workspace, workspaceCount, bots, removedCount, sessions, onRename, onDelete, onOpenAgents }) {
  const [name, setName] = useState(workspace?.name || '');
  const [savedName, setSavedName] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  useEffect(() => {
    setName(workspace?.name || '');
    setDeleteText('');
  }, [workspace?.id, workspace?.name]);

  const [density, setDensity] = useDensity();
  const [technical, setTechnical] = useTechnicalNames();
  const health = useAsync((signal) => api.health({ signal }), []);
  const envs = useAsync((signal) => api.environments({ signal }), []);

  const perEnv = useMemo(() => {
    const out = {};
    (envs.data || []).forEach((env) => {
      out[env] = [];
    });
    bots.forEach((bot) =>
      Object.entries(bot.deployed || {}).forEach(([env, version]) => {
        (out[env] ||= []).push({ name: bot.name || bot.id, version });
      }),
    );
    return out;
  }, [envs.data, bots]);

  if (!workspace) return null;
  const published = bots.filter((bot) => bot.latest_version).length;
  const deployed = bots.filter((bot) => Object.keys(bot.deployed || {}).length).length;
  const canDelete = workspaceCount > 1 && deleteText.trim() === workspace.name;
  const online = health.data?.ok === true;

  return (
    <>
      <section className="welcomeBlock pageHeaderBlock">
        <div>
          <h1>Settings</h1>
          <p>This workspace, and what is running where.</p>
        </div>
      </section>
      <div className="settingsGrid">
        {/* two columns that fill on their own, so a tall card never leaves a gap beside a short one */}
        <div className="settingsColumn">
          <section className="settingsCard" aria-labelledby="settings-general">
            <h2 id="settings-general">General</h2>
            <form
              className="settingsRow"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || name.trim() === workspace.name) return;
                onRename(name.trim());
                setSavedName(true);
                window.setTimeout(() => setSavedName(false), 1800);
              }}
            >
              <label>
                <span>Workspace name</span>
                <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
              </label>
              <button type="submit" className="secondaryCta" disabled={!name.trim() || name.trim() === workspace.name}>
                Save name
              </button>
              {savedName && (
                <span className="settingsSaved" role="status">
                  Saved
                </span>
              )}
            </form>
            <dl className="settingsFacts">
              <div>
                <dt>Agents</dt>
                <dd>{bots.length}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{published}</dd>
              </div>
              <div>
                <dt>Deployed</dt>
                <dd>{deployed}</dd>
              </div>
              <div>
                <dt>Test conversations</dt>
                <dd>{sessions.length}</dd>
              </div>
            </dl>
            <p className="stMuted">
              A workspace groups agents; it doesn’t limit who can open them (that is on the Team page). Workspaces are kept on this device, while the agents,
              their versions and their deployments are on the server.
            </p>
          </section>

          <section className="settingsCard" aria-labelledby="settings-running">
            <h2 id="settings-running">What is running where</h2>
            <div className="settingsEnvironments">
              <p>You choose this per agent, under Releases › Deploy.</p>
              {envs.loading && !envs.data ? (
                <p className="stMuted">Loading…</p>
              ) : (
                <ul className="stEnvList">
                  {Object.entries(perEnv).map(([env, items]) => (
                    <li key={env}>
                      <strong>{envLabel(env)}</strong>
                      <span>
                        {items.length === 0
                          ? 'Nothing deployed'
                          : items
                              .slice(0, 3)
                              .map((item) => `${item.name} v${item.version}`)
                              .join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="stMuted">
              {removedCount > 0 ? (
                <>
                  {removedCount} agent{removedCount === 1 ? ' is' : 's are'} removed from your list on this browser.{' '}
                  <button
                    type="button"
                    className="stLink"
                    onClick={() => {
                      onOpenAgents?.();
                      navigate(routeHref(), { guard: false });
                    }}
                  >
                    Manage them on the Agents page
                  </button>
                  .
                </>
              ) : (
                'Nothing is removed from your list.'
              )}
            </p>
          </section>
          {/* shown with technical names, and whenever the API can't be reached so nobody wonders why nothing loads */}
          {(technical || (!online && !health.loading)) && (
            <Fold className="settingsCard settingsDev" open={isDemoMode() || (!online && !health.loading)} aria-labelledby="settings-dev">
              <summary id="settings-dev">
                <strong>For developers</strong> <span className="stMuted">Data source and the connection to the Agent Builder API</span>
              </summary>
              <h3>Data source</h3>
              <p>
                {isDemoMode()
                  ? DEMO_NOTE
                  : 'Agents are read from and saved to the Agent Builder API. To try the studio without a backend, switch to demo data: sample agents kept in this browser, with simulated saving, publishing and deploying.'}
              </p>
              <div className="settingsSeg" role="group" aria-label="Data source">
                <button
                  type="button"
                  className={isDemoMode() ? '' : 'on'}
                  disabled={!isDemoMode()}
                  aria-pressed={!isDemoMode()}
                  onClick={() => setDemoMode(false)}
                >
                  Real API
                </button>
                <button
                  type="button"
                  className={isDemoMode() ? 'on' : ''}
                  disabled={isDemoMode()}
                  aria-pressed={isDemoMode()}
                  onClick={() => setDemoMode(true)}
                >
                  Demo data
                </button>
              </div>
              {demoIsForced() && <p className="stMuted">This copy of Weave is a demo, so it always uses demo data.</p>}

              <h3>{isDemoMode() ? 'Agent Builder API (demo)' : 'Agent Builder API'}</h3>
              <div className="stApiState" role="status">
                <i className={health.loading && !health.data ? 'wait' : online ? 'ok' : 'bad'} aria-hidden="true" />
                <div>
                  <strong>{isDemoMode() ? 'Demo, no server' : health.loading && !health.data ? 'Checking…' : online ? 'Connected' : 'Not reachable'}</strong>
                  <small>
                    {isDemoMode()
                      ? 'Nothing here talks to a server: it is an imitation kept in this browser.'
                      : online
                        ? 'Agents, drafts, versions and deployments are read from and saved to the server.'
                        : health.error?.message || 'The API did not answer. Pages that need it will show an error until it is back.'}
                  </small>
                </div>
                <button type="button" className="quietButton" onClick={health.reload}>
                  Check again
                </button>
              </div>
            </Fold>
          )}
        </div>
        <div className="settingsColumn">
          <section className="settingsCard" aria-labelledby="settings-look">
            <h2 id="settings-look">How it looks and reads</h2>
            <p className="stMuted">These are your own choices, kept in this browser.</p>
            <fieldset className="settingsChoice">
              <legend>Theme</legend>
              <StyleCards />
              <small className="stMuted">The look of the whole studio, in light and in dark. Light or dark is the button at the top of every page.</small>
            </fieldset>
            <fieldset className="settingsChoice">
              <legend>Spacing</legend>
              <OneOf className="settingsSeg" label="Spacing" value={density} onChange={setDensity}>
                {DENSITIES.map((option) => (
                  <Choice key={option} value={option}>
                    {option === 'compact' ? 'Compact' : 'Comfortable'}
                  </Choice>
                ))}
              </OneOf>
              <small className="stMuted">Compact fits more on a screen, for people who use the studio all day.</small>
            </fieldset>
            <label className="settingsCheck">
              <input type="checkbox" checked={technical} onChange={(event) => setTechnical(event.target.checked)} />
              <span>
                <strong>Show technical names</strong>
                <small className="stMuted">
                  Beside every setting, show the name the configuration file uses for it, with a way to copy its path, offer the raw JSON view of the
                  configuration, and show where the studio reads its data from.
                </small>
              </span>
            </label>
          </section>

          <section className="settingsCard settingsDanger" aria-labelledby="settings-danger">
            <h2 id="settings-danger">Delete workspace</h2>
            {workspaceCount <= 1 ? (
              <p>This is your only workspace, so it can’t be deleted. Create another workspace first.</p>
            ) : (
              <>
                <p>
                  Deletes {workspace.name} from this browser, with its test conversations, readiness-check runs and telephony settings. Its agents move to
                  another workspace; nothing is deleted on the server. This can’t be undone.
                </p>
                <label className="settingsField">
                  <span>
                    Type <b>{workspace.name}</b> to confirm
                  </span>
                  <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder={workspace.name} />
                </label>
                <button type="button" className="modalCreate dangerConfirm" disabled={!canDelete} onClick={onDelete}>
                  Delete workspace
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
