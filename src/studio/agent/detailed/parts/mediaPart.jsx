import React from 'react';
import MediaLibrary from './MediaLibrary.jsx';
import LiveCamera from './LiveCamera.jsx';
import { setChannelInput } from '../../../pictures/mediaModel.js';
import { strictnessOf, withStrictness } from '../../../pictures/strictness.js';
import { DEFAULT_ACCEPT } from '../../../../demo/simulatedPictures.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import MediaWorkspace from '../mediaWorkspace/MediaWorkspace.jsx';
import { AddPictureStep, DetailsTable, ImagesPick, PairsTable, PairsTry, PickyAll, PickyEditor, SeesPreview } from '../mediaWorkspace/pictureEditors.jsx';
import { LIST_OF, stepKey, stepsIn, waysIn } from '../mediaWorkspace/mediaWords.js';

// 7 · Images & Videos: everything about photos and the camera in one place (canvas page "11 · Images & Videos,
// redesigned"). Which ways in take photos and the camera, and their picture details (asked here only; Channels says it
// and opens here); how each agent sees pictures during the conversation (kept, not run yet); every picture step wherever
// it runs (asked, checked in code, read by the AI, compared, forgotten), each a list of its own whose rows follow the
// chosen step; how picky every photo or camera check is at once; the pictures to try it with and your camera, live.
// The workspace (MediaWorkspace) draws these rows as one picture's journey and three chapters; All settings shows the
// cards below. Nothing new is stored: each row writes the channels', agents' and steps' own settings.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const speech = (v) => (typeof v === 'string' ? v : typeof v?.message === 'string' ? v.message : '');
const varChoices = (config) => Object.keys(isObj(config?.state?.variables) ? config.state.variables : {}).map((v) => ({ value: v, label: v }));

// a row of the chosen item, at a place inside it
const at = (entry, key, row) => {
  const where = () => [...entry.base, ...key];
  return {
    ...row,
    pathFor: where,
    errPath: row.errPath || where(),
    get: row.get || ((config) => getAtPath(config, where())),
    put: row.put || ((config, value) => setPath(config, where(), value === '' || (Array.isArray(value) && !value.length) ? undefined : value)),
  };
};
// a list of one kind of picture step, wherever they run
const stepList = (type, id, word) => ({
  id,
  word,
  label: `${word[0].toUpperCase()}${word.slice(1)}s`,
  entries: (config) =>
    stepsIn(config)
      .filter((s) => s.type === type)
      .map((s) => ({ key: s.key, name: `${s.name} · ${s.group.name}`, base: s.path, item: s.item })),
});
const removeStep = (c, entry) => {
  const listPath = entry.base.slice(0, -1);
  c.set(
    setPath(
      c.config,
      listPath,
      list(getAtPath(c.config, listPath)).filter((_, i) => i !== entry.base.at(-1)),
    ),
  );
};
const when = (entry, id) => at(entry, ['when'], { id, label: 'Only when…', hint: 'The step runs only while this holds', kind: 'form' });

// ---- each kind of step's rows
const requestRows = (e) => [
  at(e, ['kind'], {
    id: 'kind',
    label: 'Upload or camera',
    hint: 'A photo from their device, or a frame taken from their camera (the sharpest of a few)',
    kind: 'ch',
    options: [
      { value: 'upload', label: 'They upload a photo' },
      { value: 'camera', label: 'Their camera' },
    ],
    get: (config) => (getAtPath(config, [...e.base, 'kind']) === 'camera' ? 'camera' : 'upload'),
    // a standard chosen by its word moves with it (a camera needs a higher sharpness than an upload)
    put: (config, kind) => {
      const step = getAtPath(config, e.base) || {};
      const word = strictnessOf(step.kind === 'camera' ? 'camera' : 'upload', step.quality);
      const next = setPath(config, [...e.base, 'kind'], kind);
      return word && word !== 'custom' ? setPath(next, [...e.base, 'quality'], withStrictness(kind, step.quality, word)) : next;
    },
  }),
  at(e, ['prompt'], {
    id: 'prompt',
    label: 'Shown beside the button',
    hint: 'On their screen, not spoken: say what to do in a line of its own before this step',
    kind: 'text',
    placeholder: 'A clear photo of the front of your card',
    get: (config) => speech(getAtPath(config, [...e.base, 'prompt'])),
  }),
  { id: 'sees', label: 'What they see', tags: 'p', render: (c) => <SeesPreview ctx={c} base={e.base} /> },
  at(e, ['quality'], {
    id: 'picky',
    label: 'How picky',
    hint: 'Checked in code before anything reads it: a picture that falls short is turned down with how to retake it, and the request stays open',
    render: (c) => <PickyEditor ctx={c} base={e.base} id={c.id} />,
  }),
  at(e, ['timeout_s'], {
    id: 'timeout',
    label: 'Give up after',
    hint: 'How long they have to send it: 5 seconds to 10 minutes',
    kind: 'num',
    unit: 'seconds',
    placeholder: '120',
  }),
  at(e, ['on_timeout'], { id: 'onTimeout', label: 'Then, if nothing comes', hint: 'Instead of going on to the next step', kind: 'form' }),
  at(e, ['into'], {
    id: 'into',
    label: 'Kept in',
    hint: 'A picture id, never the picture: emptied first, so a retry never sees the last one',
    kind: 'pick',
    options: varChoices,
  }),
];
const readRows = (e, goSecret) => [
  at(e, ['images'], {
    id: 'readImages',
    label: 'Pictures it reads',
    hint: 'Up to 4, in this one request: they never join the conversation',
    render: (c) => <ImagesPick ctx={c} base={e.base} id={c.id} label="Pictures it reads" />,
  }),
  at(e, ['instructions'], {
    id: 'instructions',
    label: 'What to look for',
    hint: 'What the picture should show, and how to copy each value. {{…}} is filled in first',
    kind: 'long',
    rows: 3,
    placeholder: 'What the picture should show, and how to copy each value. If a value can’t be read, leave it empty.',
  }),
  at(e, ['fields'], {
    id: 'details',
    label: 'The details',
    wide: true,
    render: (c) => <DetailsTable ctx={c} base={e.base} id={c.id} onGoSecret={goSecret(c)} />,
  }),
  at(e, ['ok_into'], {
    id: 'okInto',
    label: '“Read it all” kept in',
    hint: 'True only when an answer came back and every detail that must be read was read',
    kind: 'pick',
    options: varChoices,
  }),
  at(e, ['model'], {
    id: 'model',
    label: 'Model that reads it',
    hint: 'As the agent unless set: a stronger vision model reads a card better and says more honestly when it can’t',
    kind: 'form',
  }),
  at(e, ['timeout_s'], {
    id: 'readTimeout',
    label: 'Give up after',
    hint: 'How long the model has to answer: up to 3 minutes',
    kind: 'num',
    unit: 'seconds',
    placeholder: '45',
  }),
];
const compareRows = (e) => [
  at(e, ['pairs'], { id: 'pairs', label: 'The pairs', wide: true, render: (c) => <PairsTable ctx={c} base={e.base} id={c.id} /> }),
  at(e, ['require'], {
    id: 'require',
    label: 'It passes when',
    hint: 'For identity, keep “every pair”: a different person often matches on one thing, such as a surname',
    kind: 'ch',
    options: [
      { value: 'all', label: 'Every pair matches' },
      { value: 'any', label: 'Any one matches' },
    ],
    get: (config) => (getAtPath(config, [...e.base, 'require']) === 'any' ? 'any' : 'all'),
    put: (config, v) => setPath(config, [...e.base, 'require'], v === 'any' ? 'any' : 'all'),
  }),
  at(e, ['into', 'matched'], {
    id: 'matched',
    label: 'Whether they matched, kept in',
    hint: 'A yes or no value, for the steps after it',
    kind: 'pick',
    options: varChoices,
  }),
  at(e, ['into', 'differences'], {
    id: 'differences',
    label: 'What differed, kept in',
    hint: 'The names of the pairs, never their values',
    kind: 'pick',
    options: varChoices,
  }),
  at(e, ['into', 'score'], { id: 'score', label: 'The lowest likeness, kept in', hint: '1 is identical', kind: 'pick', options: varChoices }),
  { id: 'tryPairs', label: 'Try it', tags: 'p', wide: true, render: (c) => <PairsTry ctx={c} base={e.base} id={c.id} /> },
];

// ---- a way in's picture rows (only ways in on the website take pictures)
const wayRows = (e) => {
  const index = e.base[1];
  const takes = (config, want) => list(getAtPath(config, ['channels', index, 'modalities', 'input'])).includes(want);
  const photoOff = (config) => !takes(config, 'image');
  return [
    {
      id: 'photo',
      label: 'Customers can send photos',
      hint: 'An upload button in the conversation',
      kind: 'sw',
      get: (c) => takes(c, 'image'),
      put: (c, on) => setChannelInput(c, index, 'image', on),
    },
    {
      id: 'camera',
      label: 'Customers can turn on their camera',
      hint: 'Only when a step asks for it',
      kind: 'sw',
      get: (c) => takes(c, 'video'),
      put: (c, on) => setChannelInput(c, index, 'video', on),
    },
    at(e, ['inputs', 'image', 'on_receive'], {
      id: 'onReceive',
      label: 'When a photo arrives',
      hint: 'A step that asks for a photo waits for one either way',
      kind: 'ch',
      options: [
        { value: 'attach', label: 'Wait for their next message' },
        { value: 'reply', label: 'Answer at once' },
      ],
      disabled: photoOff,
      get: (c) => (getAtPath(c, [...e.base, 'inputs', 'image', 'on_receive']) === 'reply' ? 'reply' : 'attach'),
      put: (c, v) => setPath(c, [...e.base, 'inputs', 'image', 'on_receive'], v === 'reply' ? 'reply' : undefined),
    }),
    at(e, ['inputs', 'image', 'max_bytes'], {
      id: 'maxSize',
      label: 'Largest photo',
      kind: 'num',
      unit: 'MB',
      placeholder: '8',
      disabled: photoOff,
      get: (c) => {
        const b = getAtPath(c, [...e.base, 'inputs', 'image', 'max_bytes']);
        return typeof b === 'number' ? Math.round((b / (1024 * 1024)) * 10) / 10 : undefined;
      },
      put: (c, mb) =>
        setPath(c, [...e.base, 'inputs', 'image', 'max_bytes'], typeof mb === 'number' && mb > 0 ? Math.max(1024, Math.round(mb * 1024 * 1024)) : undefined),
    }),
    at(e, ['inputs', 'image', 'accepted_mime'], {
      id: 'accept',
      label: 'Kinds of file',
      kind: 'multi',
      options: [
        { value: 'image/jpeg', label: 'JPEG' },
        { value: 'image/png', label: 'PNG' },
        { value: 'image/webp', label: 'WEBP' },
        { value: 'image/heic', label: 'HEIC' },
        { value: 'image/gif', label: 'GIF' },
      ],
      disabled: photoOff,
      get: (c) => {
        const now = list(getAtPath(c, [...e.base, 'inputs', 'image', 'accepted_mime']));
        return now.length ? now : DEFAULT_ACCEPT;
      },
      put: (c, v) => {
        const same = list(v).length === DEFAULT_ACCEPT.length && DEFAULT_ACCEPT.every((t) => list(v).includes(t));
        return setPath(c, [...e.base, 'inputs', 'image', 'accepted_mime'], same || !list(v).length ? undefined : v);
      },
    }),
  ];
};
const wayAdv = (e) => [
  at(e, ['inputs', 'video', 'screen_share'], {
    id: 'screen',
    label: 'Screen sharing',
    hint: 'They can share their screen as well as the camera',
    kind: 'sw',
    get: (c) => getAtPath(c, [...e.base, 'inputs', 'video', 'screen_share']) === true,
  }),
  at(e, ['inputs', 'video', 'camera'], {
    id: 'videoCamera',
    label: 'Camera stream (technical)',
    hint: 'How the browser sends the camera',
    kind: 'sw',
    get: (c) => getAtPath(c, [...e.base, 'inputs', 'video', 'camera']) === true,
  }),
  at(e, ['inputs', 'image', 'topic'], {
    id: 'topic',
    label: 'Upload topic (technical)',
    hint: 'The channel uploads travel on; leave it empty for the usual one',
    kind: 'text',
    placeholder: 'agent-builder.image',
  }),
];

// ---- how an agent sees pictures during the conversation (kept, not run yet)
const modeOf = (config, e) => getAtPath(config, [...e.base, 'vision', 'mode']) || 'off';
const seeingRows = (e) => [
  at(e, ['vision', 'mode'], {
    id: 'seeMode',
    label: 'How it sees pictures',
    hint: 'Every turn: the latest picture goes with what the caller says. A live feed needs a realtime model. Kept, but the server doesn’t do either yet',
    kind: 'ch',
    options: [
      { value: 'off', label: 'Only when a step reads one' },
      { value: 'turn_attach', label: 'Every turn' },
      { value: 'continuous', label: 'A live feed (realtime model)' },
    ],
    get: (c) => modeOf(c, e),
    put: (c, v) => (v === 'off' ? setPath(c, [...e.base, 'vision'], undefined) : setPath(c, [...e.base, 'vision', 'mode'], v)),
  }),
  at(e, ['vision', 'max_dimension'], {
    id: 'seeSize',
    label: 'Longest side sent to the AI',
    hint: 'A picture is made smaller to this before it is sent',
    kind: 'num',
    unit: 'px',
    disabled: (c) => modeOf(c, e) === 'off',
  }),
];
const seeingAdv = (e) => {
  const live = (c) => modeOf(c, e) !== 'continuous';
  return [
    at(e, ['vision', 'watch', 'sample_interval_s'], {
      id: 'watchEvery',
      label: 'Look again every',
      hint: 'How often a frame of the live feed is looked at',
      kind: 'num',
      unit: 'seconds',
      disabled: live,
    }),
    at(e, ['vision', 'watch', 'change_threshold'], {
      id: 'watchChange',
      label: 'A change worth a look',
      hint: 'How different two looks must be, 0 to 255',
      kind: 'num',
      disabled: live,
    }),
    at(e, ['vision', 'watch', 'min_seconds_between_prompts'], {
      id: 'watchGap',
      label: 'At most one nudge every',
      hint: 'So a moving picture doesn’t keep it talking',
      kind: 'num',
      unit: 'seconds',
      disabled: live,
    }),
    at(e, ['vision', 'watch', 'on_change'], {
      id: 'watchSay',
      label: 'What it does about a change',
      hint: 'What it says, in its own words, when the picture changes',
      kind: 'form',
      disabled: live,
    }),
  ];
};

const goSecret = (c) => () => c.goPart?.('conversation');

export const mediaForm = {
  id: 'media',
  num: '7',
  title: 'Images & Videos',
  question: 'The photos and camera checks it asks customers for, how picky they are, what it reads from them and what happens to the pictures.',
  cols: [
    [
      {
        id: 'ways',
        title: 'Where pictures come in',
        lead: 'Only on your website: a phone call carries no pictures.',
        empty: 'No way in on the website yet: add web chat or talk on your website on Channels.',
        list: {
          id: 'ways',
          label: 'Ways in',
          entries: (config) =>
            waysIn(config)
              .filter((w) => w.web)
              .map((w) => ({ key: w.key, name: `${w.name}${w.id ? ` (${w.id})` : ''}`, base: ['channels', w.index], item: config.channels[w.index] })),
        },
        of: 'ways',
        rowsFor: (c) => (c.chosen('ways') ? wayRows(c.chosen('ways')) : []),
        advFor: (c) => (c.chosen('ways') ? wayAdv(c.chosen('ways')) : []),
      },
      {
        id: 'seeing',
        title: 'Seeing during the conversation',
        lead: 'Kept, but the server doesn’t do it yet: the AI sees a picture only when a step reads it.',
        empty: 'No agents listed yet.',
        list: {
          id: 'seeing',
          label: 'Agents',
          entries: (config) =>
            list(config?.agents?.items)
              .map((a, i) => ({ a, i }))
              .filter(({ a }) => isObj(a))
              .map(({ a, i }) => ({ key: a.id || String(i), name: a.name || a.id || `Agent ${i + 1}`, base: ['agents', 'items', i], item: a })),
        },
        of: 'seeing',
        rowsFor: (c) => (c.chosen('seeing') ? seeingRows(c.chosen('seeing')) : []),
        advFor: (c) => (c.chosen('seeing') ? seeingAdv(c.chosen('seeing')) : []),
      },
      {
        id: 'picky',
        title: 'How picky, for all of them',
        lead: 'One choice sets every photo request, or every camera check, at once.',
        rows: [
          { id: 'pickyUpload', label: 'Every photo', render: (c) => <PickyAll ctx={c} kind="upload" id={c.id} /> },
          { id: 'pickyCamera', label: 'Every camera check', render: (c) => <PickyAll ctx={c} kind="camera" id={c.id} /> },
        ],
      },
      {
        id: 'library',
        title: 'Pictures to try it with',
        lead: 'The photos and sample cards your test conversations send, as a customer would.',
        rows: [{ id: 'library', label: 'Sample pictures', wide: true, render: (c) => <MediaLibrary ctx={c} /> }],
      },
    ],
    [
      {
        id: 'adding',
        title: 'Add a picture step',
        lead: 'A starting point (ask, read, forget) or one step, in a form’s steps. It opens in its card below.',
        body: (c) => (
          <AddPictureStep ctx={c} onAdded={(path, type) => c.choose(LIST_OF[type] || 'requests', stepKey(path))} onNoForm={() => c.goPart?.('connections')} />
        ),
      },
      {
        id: 'requests',
        title: 'Ask for a picture',
        empty: 'No step asks for a picture yet.',
        list: stepList('request_image', 'requests', 'request'),
        of: 'requests',
        word: 'step',
        remove: removeStep,
        rowsFor: (c) => (c.chosen('requests') ? requestRows(c.chosen('requests')) : []),
        advFor: (c) => (c.chosen('requests') ? [when(c.chosen('requests'), 'whenAsk')] : []),
      },
      {
        id: 'reads',
        title: 'Read a picture',
        lead: 'An AI reading a photo can misread, and can’t tell a real card from a copy: a first look, not proof.',
        empty: 'No step reads a picture yet.',
        list: stepList('analyze_image', 'reads', 'reading'),
        of: 'reads',
        word: 'step',
        remove: removeStep,
        rowsFor: (c) => (c.chosen('reads') ? readRows(c.chosen('reads'), goSecret) : []),
        advFor: (c) => (c.chosen('reads') ? [when(c.chosen('reads'), 'whenRead')] : []),
      },
      {
        id: 'compares',
        title: 'Compare in code',
        lead: 'The way a person would, with no AI: names forgive a small slip, codes compare by letters and digits, dates by the day.',
        empty: 'No step compares values yet.',
        list: stepList('compare_values', 'compares', 'comparison'),
        of: 'compares',
        word: 'step',
        remove: removeStep,
        rowsFor: (c) => (c.chosen('compares') ? compareRows(c.chosen('compares')) : []),
        advFor: (c) => (c.chosen('compares') ? [when(c.chosen('compares'), 'whenCompare')] : []),
      },
      {
        id: 'forgets',
        title: 'Forget pictures',
        lead: 'Everything is forgotten when the call ends in any case; a step forgets them as soon as they are used.',
        empty: 'No step forgets pictures yet.',
        list: stepList('discard_image', 'forgets', 'forget step'),
        of: 'forgets',
        word: 'step',
        remove: removeStep,
        rowsFor: (c) => {
          const e = c.chosen('forgets');
          return e
            ? [
                at(e, ['images'], {
                  id: 'forgetImages',
                  label: 'Pictures it forgets',
                  render: (x) => <ImagesPick ctx={x} base={e.base} id={x.id} max={99} label="Pictures it forgets" />,
                }),
              ]
            : [];
        },
        advFor: (c) => (c.chosen('forgets') ? [when(c.chosen('forgets'), 'whenForget')] : []),
      },
      {
        id: 'camera',
        title: 'Your camera, live',
        lead: 'What a camera check measures, on your own camera. Nothing is recorded or sent.',
        rows: [{ id: 'live', label: 'Your camera', tags: 'p', wide: true, render: (c) => <LiveCamera ctx={c} /> }],
      },
    ],
  ],
};

export const mediaPart = { ...mediaForm, render: (ctx) => <MediaWorkspace ctx={ctx} form={mediaForm} /> };
