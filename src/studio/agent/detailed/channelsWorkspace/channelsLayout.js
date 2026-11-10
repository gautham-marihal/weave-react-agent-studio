// Where each of Channels' settings shows in its workspace (canvas page "6 · Channels, redesigned"). A way in and a set of
// hours each open on a page of their own, in these sections; the rarer settings are under "more". Pure data, so the
// tests can check that every setting has exactly one place.

// the parts of the sentence: a way in (all three open the same switches), the hours, how it knows who is calling
export const TOKENS = {
  web_chat: { title: 'Ways in', ids: ['reach.reach'], blank: 'chatting on your website', width: 560 },
  web_voice: { title: 'Ways in', ids: ['reach.reach'], blank: 'talking on your website', width: 560 },
  sip_voice: { title: 'Ways in', ids: ['reach.reach'], blank: 'calling a phone number', width: 560 },
  hours: { title: 'When your team is in', ids: [], blank: 'none set yet', width: 520 },
  who: { title: 'Who is calling', ids: ['caller.sources', 'caller.tidy', 'caller.country'], blank: 'not set yet', width: 640 },
};

// an item's page: its sections (by the item card's own row ids) and what is under "more". A row a channel's kind
// doesn't have (a phone line's route, a keypad on the web) is simply not there; the entry fields are its kind's own.
export const PAGES = {
  channels: {
    word: 'way in',
    switch: 'on',
    sections: [
      { key: 'fit', title: 'Needs a look', ids: ['fit'] },
      { key: 'later', title: 'Not connected yet', ids: ['notRunning'] },
      { key: 'first', title: 'Its first words', ids: ['greeting', 'interrupt'] },
      { key: 'carries', title: 'What it carries', sub: 'only what this kind of channel can carry is offered', ids: ['modalities'] },
      { key: 'can', title: 'What it can do here', ids: ['forms', 'person', 'dtmf'] },
      { key: 'route', title: 'How people get here', ids: ['route'] },
      { key: 'own', title: 'Just for this channel', ids: ['extra'] },
    ],
    more: ['type', 'overrides', 'match'],
    // its kind's entry fields (widget id, allowed websites, numbers…): for reference, under "more"
    morePrefix: 'entry_',
  },
  schedules: {
    word: 'hours',
    sections: [
      { key: 'week', title: 'Its week', ids: ['week'] },
      { key: 'closed', title: 'Closed days', sub: 'closed all day, whatever else is set', ids: ['closed'] },
      { key: 'once', title: 'One-off changes', sub: 'a different day, by date', ids: ['overrides'] },
      { key: 'where', title: 'Its clock and name', ids: ['tz', 'name'] },
    ],
    more: [],
  },
};

// every row id the workspace shows: the sentence's (part-level, "card.row") and an item page's (the item's own)
export const placedIds = () => [...new Set(Object.values(TOKENS).flatMap((t) => t.ids))];
export const placedItemIds = (list) => [
  ...PAGES[list].sections.flatMap((s) => s.ids),
  ...PAGES[list].more,
  ...(PAGES[list].switch ? [PAGES[list].switch] : []),
];
