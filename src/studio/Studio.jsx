import React from 'react';
import { setApiUser } from '../api/client.js';
import BotsPage from './BotsPage.jsx';
import BotWorkspace from './BotWorkspace.jsx';
import { useRoute } from './route.js';
import './studio.css';

// The agents area: the list, and one agent's workspace. Mounted inside the dashboard shell.
export default function Studio({ profile, onRecordSession }) {
  const route = useRoute();
  // Saves, publishes and deploys are attributed to this name. Set during render (it is idempotent) so it
  // is in place before any child sends its first request; an effect would run too late.
  setApiUser(profile?.fullName || profile?.email || '');
  return route.view === 'bot'
    ? <BotWorkspace key={route.botId} botId={route.botId} tab={route.tab} params={route.params} onRecordSession={onRecordSession} />
    : <BotsPage route={route} />;
}
