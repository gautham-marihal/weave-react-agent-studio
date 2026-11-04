// The words for what a reference points at, and what "Add …" calls one item: shared by the reference box and the
// lists and maps of the form.

// What "this collection lives in" for the hint under an empty reference list, and where Go there leads.
export const REF_TARGET = {
  agents: ['agents', 'Agents'],
  tools: ['tools', 'Tools'],
  tool_names: ['tools', 'Tools'],
  tasks: ['tasks', 'Tasks'],
  knowledge: ['knowledge', 'Knowledge'],
  forms: ['forms', 'Forms'],
  wrapups: ['wrapups', 'Wrap-ups'],
  messages: ['messages', 'Messages'],
  notifications: ['notifications', 'Notifications'],
  channels: ['channels', 'Channels'],
  transfers: ['telephony', 'Telephony'],
  input_guardrails: ['guardrails', 'Safety rules'],
  schedules: ['schedules', 'Schedules'],
  state_vars: ['state', 'State'],
  http_connections: ['connections', 'Connections'],
  mcp_connections: ['connections', 'Connections'],
  notifiers: ['connections', 'Connections'],
};
export const REF_WORD = {
  agents: 'agents',
  tools: 'tools',
  tool_names: 'tools',
  tasks: 'tasks',
  knowledge: 'knowledge bases',
  forms: 'forms',
  wrapups: 'closing messages',
  messages: 'fixed lines',
  notifications: 'notifications',
  channels: 'channels',
  transfers: 'transfers',
  input_guardrails: 'safety rules',
  schedules: 'schedules',
  state_vars: 'state variables',
  http_connections: 'HTTP connections',
  mcp_connections: 'MCP connections',
  notifiers: 'SMS/email connections',
};

// What "Add …" calls one item where its key's own word would read oddly ("Add notification" for the messages it sends).
export const ADD_WORDS = {
  notifications: 'message',
  wrapups: 'closing message',
  artifacts: 'file to save',
  variables: 'variable',
  constants: 'value',
  http: 'connection',
  mcp: 'MCP connection',
  notifiers: 'SMS or email connection',
};
