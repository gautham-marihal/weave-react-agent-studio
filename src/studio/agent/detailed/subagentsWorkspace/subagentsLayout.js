// Where each of Subagents and hand-overs' settings shows in its workspace (canvas page "7 · Subagents and hand-overs,
// redesigned"). An agent, a hand-over and a hand-over to another agent each open on a page of their own, in these
// sections; the rarer settings are under "more". Pure data, so the tests can check every setting has exactly one place.

// the parts of the sentence: who answers first (its own setting), and the lists it names
export const TOKENS = {
  first: { title: 'Who answers first', ids: ['who.first'], width: 520 },
  subs: { title: 'Its subagents', ids: [], blank: 'a subagent to pass callers to', width: 560 },
  back: { title: 'The ways back', ids: [], width: 520 },
  others: { title: 'Other agents it transfers to', ids: [], width: 560 },
  person: { title: 'Passing callers to a person', ids: [], width: 520 },
};

// the settings for the whole team, on the "Coming back, and limits" chapter (the back card's own rows)
export const LIMITS = { pending: ['back.pending'], loops: ['back.loops'], moves: ['back.moves'], try: ['try.try'] };

// an item's page: its sections, by the item card's own row ids (plus, for an agent, its way back from the back card)
export const PAGES = {
  agents: {
    word: 'subagent',
    card: 'subagent',
    sections: [
      { key: 'job', title: 'Its job', ids: ['name', 'kind', 'same', 'does', 'opening'] },
      { key: 'uses', title: 'What it can use', ids: ['tools', 'knowledge', 'noKnowledge'] },
      {
        key: 'sounds',
        title: 'How it sounds and thinks',
        sub: 'anything not set here comes from the agent (Build › Agent)',
        ids: ['llm', 'voice', 'interrupt'],
      },
      { key: 'back', title: 'Coming back', ids: ['back'] },
      { key: 'passes', title: 'Who it passes callers to', ids: [], passes: true },
    ],
    more: ['rules', 'sometimes', 'channels', 'enter'],
  },
  handoffs: {
    word: 'hand-over',
    card: 'handover',
    path: true,
    sections: [
      { key: 'when', title: 'When', sub: 'the model reads this to decide', ids: ['when', 'also'] },
      { key: 'while', title: 'While it hands over', ids: ['say', 'remember'] },
      { key: 'who', title: 'Who takes over', ids: ['to', 'context'] },
    ],
    // said in the page's own words at the top ("Inside this agent…"), so not asked again
    header: ['kind'],
    more: ['name'],
  },
  agentTransfers: {
    word: 'hand-over',
    card: 'transfer',
    sections: [
      { key: 'which', title: 'Which agent, and when', ids: ['agent', 'when'] },
      { key: 'as', title: 'As it transfers', ids: ['say', 'delay', 'hours'] },
      { key: 'fails', title: 'If it can’t connect', ids: ['fails', 'summary'] },
    ],
    header: ['kind'],
    more: ['headers', 'uri', 'before', 'after'],
  },
};

// every row id the workspace shows: the sentence's and chapters' (part-level, "card.row") and a page's (the item's own)
export const placedIds = () => [...new Set([...Object.values(TOKENS).flatMap((t) => t.ids), ...Object.values(LIMITS).flat()])];
export const placedItemIds = (list) => [...PAGES[list].sections.flatMap((s) => s.ids), ...PAGES[list].more, ...(PAGES[list].header || [])];
