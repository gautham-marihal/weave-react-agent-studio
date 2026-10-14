import { SCENARIOS, runScenarioChecks } from '../studio/scenarios.js';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { visibleCount } from '../studio/agents.js';
import { NAV, WORKSPACE_NAV, formatRelative, getInitials, makeRecordId } from './helpers.js';
import { Logo, NavItem, ProfileMenu, SHORTCUT_LABEL, ThemeToggle, openHelpDialog } from './shared.jsx';

// Scenario checks run against a version's configuration. They don't place real calls; each one
// checks that the configuration has what the scenario needs.
const CHECKS = SCENARIOS;

export function ReadinessPage({ runs = [], onRun, onTestVersion, onOpenSearch, profile, theme, onToggleTheme, onSignOut, onAccountOpen, workspaceName, initials, workspaces = [], currentWorkspaceId, workspaceOpen, setWorkspaceOpen, onSwitchWorkspace, onCreateWorkspace, onNavigate, agents = [] }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [range, setRange] = useState('Past 30 days');
  const [checkCount, setCheckCount] = useState(CHECKS.length);
  const [checkAgentId, setCheckAgentId] = useState(agents[0]?.id || '');
  const checkAgent = agents.find((item) => item.id === checkAgentId) || agents[0];
  // The versions come from the API: the saved draft plus every published version.
  const [checkVersions, setCheckVersions] = useState(null);
  const [checkVersion, setCheckVersion] = useState('');
  const [checkError, setCheckError] = useState('');
  useEffect(() => {
    if (!checkAgent) return undefined;
    let off = false;
    setCheckVersions(null);
    api.listVersions(checkAgent.id).then((list) => { if (!off) setCheckVersions(list); }, () => { if (!off) setCheckVersions([]); });
    return () => { off = true; };
  }, [checkAgent?.id]);
  const checkOptions = checkAgent
    ? [{ key: 'draft', label: 'Draft (saved working copy)' }, ...(checkVersions || []).map((item, index) => ({ key: item.version, label: `Version ${item.version}${index === 0 ? ' (latest)' : ''}` }))]
    : [];
  const effectiveVersion = checkOptions.some((option) => option.key === checkVersion) ? checkVersion : checkOptions[0]?.key || '';
  const [running, setRunning] = useState(false);
  const [openRun, setOpenRun] = useState(null);
  const runChecks = async () => {
    if (!checkAgent || running) return;
    const option = checkOptions.find((item) => item.key === effectiveVersion) || checkOptions[0];
    setRunning(true);
    setCheckError('');
    try {
      const config = option.key === 'draft' ? (await api.getDraft(checkAgent.id)).config : (await api.getVersion(checkAgent.id, option.key)).config;
      const results = runScenarioChecks(config, checkCount);
      const run = { id: makeRecordId('SIM'), agentId: checkAgent.id, agentName: checkAgent.name, versionKey: option.key, versionLabel: option.label.replace(' (latest)', ''), ranAt: new Date().toISOString(), total: results.length, passed: results.filter((item) => item.passed).length, results };
      onRun?.(run);
      setOpenRun(run.id);
    } catch (error) {
      setCheckError(`Couldn’t read that configuration: ${error.message}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className={`dashboard readinessDashboard ${sidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sideBrand">
          <Logo />
          <button className="collapse" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>◫</button>
        </div>

        <button className="workspaceSwitch" type="button" aria-label="Current workspace" aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen?.((value) => !value)}>
          <span className="workspaceAvatar">{getInitials(workspaceName).slice(0, 1)}</span>
          <span className="workspaceCopy"><small>WORKSPACE</small><strong>{workspaceName}</strong></span>
          <b className="buttonChevron">{workspaceOpen ? '⌃' : '⌄'}</b>
        </button>
        {workspaceOpen && (
          <div className="workspaceMenu" role="menu">
            <div className="workspaceMenuLabel">YOUR WORKSPACES</div>
            <div className="workspaceMenuList">
              {workspaces.map((workspace) => (
                <button key={workspace.id} type="button" className={`workspaceOption ${workspace.id === currentWorkspaceId ? 'current' : ''}`} onClick={() => onSwitchWorkspace?.(workspace.id)}>
                  <span className={`tinyDot ${workspace.id === currentWorkspaceId ? 'green' : ''}`} />
                  <span className="workspaceOptionName">{workspace.name}</span>
                  <span className="workspaceOptionMeta">{visibleCount(workspace.id)} {visibleCount(workspace.id) === 1 ? 'agent' : 'agents'}</span>
                  {workspace.id === currentWorkspaceId && <span className="workspaceCheck">✓</span>}
                </button>
              ))}
            </div>
            <p className="workspaceMenuNote">Workspaces group agents in this browser. They don’t control who can see an agent.</p>
            <button type="button" className="workspaceMenuAction" onClick={onCreateWorkspace}><span className="tinyDot" /> Create workspace <b>＋</b></button>
          </div>
        )}

        <nav className="sideNav">
          <div className="navLabel">WORKSPACE</div>
          {NAV.map((item) => (
            <NavItem key={item.id} item={item} active={item.id === 'runs'} onClick={() => onNavigate?.(item.id)} />
          ))}
          <div className="sideDivider" />
          <div className="navLabel">CONFIGURATION</div>
          {WORKSPACE_NAV.map((item) => (
            <NavItem key={item.id} item={item} active={false} onClick={() => onNavigate?.(item.id)} />
          ))}
        </nav>

        <div className="sideBottom">
          <button className="sideUtility" type="button" onClick={onOpenSearch}><span>⌕</span><span>Search</span><kbd>{SHORTCUT_LABEL}</kbd></button>
          <button className="sideUtility" type="button" onClick={openHelpDialog}><span>?</span><span>Help & docs</span><b className="buttonArrow">↗</b></button>
          <ProfileMenu profile={profile} initials={initials} onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
        </div>
      </aside>

      <main className="dashMain">
        <div className="dashTopbar readinessTopbar">
          <div className="topbarCrumb"><span>{workspaceName}</span><b>/</b><strong>Readiness checks</strong></div>
          <div className="topbarActions">
            <button className="quietButton" type="button" onClick={() => setRange(range === 'Past 30 days' ? 'Past 7 days' : 'Past 30 days')}><span className="buttonIcon">◷</span><span>{range}</span><span className="buttonChevron">⌄</span></button>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <ProfileMenu profile={profile} initials={initials} compact onAccountOpen={onAccountOpen} onSignOut={onSignOut} />
          </div>
        </div>

        <div className="readinessContent">
          <section className="readinessEmptyState">
            <div className="readinessVisual" aria-hidden="true">
              <div className="readinessTile">
                <span className="readinessPlay">▶</span>
              </div>
            </div>

            <h1>{runs.length ? 'Readiness checks' : 'No checks run yet'}</h1>
            <p>Look at an agent version’s configuration against everyday situations (a greeting, a way to end the call, reaching a person, a caller who goes quiet) before you make it live. These checks only read what is configured: no conversation is run and no call is placed. To really talk to the agent, use its Test tab.</p>

            {agents.length > 0 && (
              <div className="readinessRunner">
                <label><span>Agent</span><select value={checkAgent?.id || ''} onChange={(event) => { setCheckAgentId(event.target.value); setCheckVersion(''); }}>{agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span>Version</span><select value={effectiveVersion} onChange={(event) => setCheckVersion(event.target.value)}>{checkOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
                <label><span>Checks</span><select value={checkCount} onChange={(event) => setCheckCount(Number(event.target.value))}>{CHECKS.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
                <button type="button" className="primaryCta" onClick={runChecks} disabled={running}>{running ? 'Running…' : 'Run checks'}</button>
              </div>
            )}
            {agents.length > 0 && checkError && (
              <p className="stFErr" role="alert">{checkError}</p>
            )}

            {runs.length > 0 && (
              <div className="readinessRuns">
                {runs.map((run) => {
                  const open = openRun === run.id;
                  const allPassed = run.passed === run.total;
                  return (
                    <article key={run.id} className={`readinessRun ${open ? 'isOpen' : ''}`}>
                      <button type="button" className="readinessRunHeader" aria-expanded={open} onClick={() => setOpenRun(open ? null : run.id)}>
                        <span className={`simChip ${allPassed ? 'pass' : 'warn'}`}><b aria-hidden="true">{allPassed ? '✓' : '!'}</b>Passed {run.passed} of {run.total} checks</span>
                        <strong>{run.agentName}</strong><span className="readinessRunVersion">{run.versionLabel}</span>
                        <time>{formatRelative(run.ranAt)}</time>
                        <span className="readinessRunChevron" aria-hidden="true">⌄</span>
                      </button>
                      {open && (
                        <div className="readinessRunBody">
                          <ul>{run.results.map((result) => <li key={result.id} className={result.passed ? 'pass' : 'fail'}><b aria-hidden="true">{result.passed ? '✓' : '✕'}</b><span><strong>{result.name}</strong><small>{result.detail}</small></span></li>)}</ul>
                          <button type="button" className="textAction" onClick={() => onTestVersion?.(run.agentId, run.versionKey)}>Try it in the Test tab</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {agents.length === 0 && (
              <div className="readinessActions">
                <button type="button" className="primaryCta readinessPrimary" onClick={() => onNavigate?.('agents')}>Create an agent first</button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
