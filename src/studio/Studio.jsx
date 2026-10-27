import React from 'react';
import { setApiUser } from '../api/client.ts';
import AgentsPage from './AgentsPage.jsx';
import AgentWorkspace from './AgentWorkspace.jsx';
import { useRoute } from './route.js';
import './studio.css';
// The form's inputs, buttons and notes appear on every agent page, so their styles load with the studio, not with the
// lazily loaded form editor.
import './form/form.css';
import './form/formLook.css';

// The agents area: the list, and one agent's workspace. Mounted inside the dashboard shell.
export default function Studio({ profile, onRecordSession, readinessRuns, onRecordReadiness }) {
  const route = useRoute();
  // Saves, publishes and deploys are attributed to this name. Set during render (it is idempotent) so it is in place
  // before any child's first request; an effect would run too late.
  setApiUser(profile?.fullName, profile?.email);
  return route.view === 'bot' ? (
    <AgentWorkspace
      key={route.botId}
      botId={route.botId}
      tab={route.tab}
      bare={route.bare}
      params={route.params}
      onRecordSession={onRecordSession}
      readinessRuns={readinessRuns}
      onRecordReadiness={onRecordReadiness}
    />
  ) : (
    <AgentsPage route={route} />
  );
}
