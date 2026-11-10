// Where each of Connections' settings shows in its workspace (canvas page "5 · Connections, redesigned"). Each list's
// item opens on a page of its own, in these sections; the rarer settings are under "more". Pure data, so the tests can
// check that every setting has exactly one place.

// the parts of the sentence: each opens the list of its kind, with the way to add one
export const TOKENS = {
  sys: { title: 'The systems it reaches', blank: 'a system of yours', list: 'connections' },
  tr: { title: 'Where it passes callers on to', blank: 'a phone transfer', list: 'transfers' },
  form: { title: 'The forms it shows', blank: 'a form', list: 'forms' },
  msg: { title: 'The messages it sends', blank: 'a message to send', list: 'notifications' },
  task: { title: 'Its multi-step tasks', blank: 'a multi-step task', list: 'tasks' },
};

// an item's page: its sections (each with its rows, by the list's own row ids) and what is under "more"
export const PAGES = {
  connections: {
    word: 'system',
    sections: [
      { key: 'what', title: 'What it is', ids: ['kind'] },
      { key: 'where', title: 'Where it is', ids: ['address', 'timeout', 'transport'] },
      { key: 'sends', title: 'What it sends', ids: ['sends', 'provider', 'from'] },
      { key: 'signin', title: 'How it signs in', ids: ['auth'] },
      { key: 'uses', title: 'What uses it', ids: [], uses: true },
    ],
    more: ['name', 'headers'],
  },
  transfers: {
    word: 'transfer',
    path: true,
    sections: [
      { key: 'when', sub: 'it passes callers on only while this schedule is open', ids: ['hours', 'closed', 'about'] },
      { key: 'before', sub: 'for example, tell another system the call is coming', ids: ['before', 'delay'] },
      { key: 'moves', sub: '', ids: ['method', 'target', 'request'] },
      { key: 'connected', sub: 'once the call has moved', ids: ['success'] },
      { key: 'fails', sub: 'when the call can’t be moved', ids: ['failed'] },
    ],
    more: ['tone', 'uri', 'headers', 'name'],
  },
  forms: {
    word: 'form',
    preview: true,
    sections: [
      { key: 'questions', title: 'Its questions', ids: ['fields'] },
      { key: 'words', title: 'Its words', ids: ['title', 'button'] },
      { key: 'sent', title: 'When it is sent', ids: ['keep', 'sent'] },
    ],
    more: ['otherwise', 'description', 'name'],
  },
  notifications: {
    word: 'message',
    sections: [
      { key: 'how', title: 'How it is sent', ids: ['strategy', 'deliver'] },
      { key: 'fails', title: 'If it can’t be sent', ids: ['failed'] },
      { key: 'about', title: 'What it is for', ids: ['about'] },
    ],
    more: ['name'],
  },
  tasks: {
    word: 'task',
    sections: [
      { key: 'kind', title: 'What it does', ids: ['kind'] },
      { key: 'steps', title: 'Its steps', sub: 'in order; code checks each answer, not the model', ids: ['steps', 'attempts', 'scope'] },
      { key: 'ends', title: 'How it ends', ids: ['outcomes'] },
      { key: 'try', title: 'Try it', ids: ['tryTask'] },
    ],
    more: ['instructions', 'prior', 'skip', 'history', 'quiet', 'about', 'name'],
  },
};
// the one setting for the whole agent: its phone system, on the "Passing callers on" chapter
const CHAPTER = { pbx: ['transfers', 'pbx'] };

// every row id the workspace shows, per list, once each
export const placedIds = (list) => [
  ...PAGES[list].sections.flatMap((s) => s.ids),
  ...PAGES[list].more,
  ...(Object.values(CHAPTER).some(([l]) => l === list)
    ? Object.values(CHAPTER)
        .filter(([l]) => l === list)
        .map(([, id]) => id)
    : []),
];
