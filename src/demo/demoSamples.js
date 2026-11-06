// Sample agents the browser demo adds beside its three starters, so every Build part has real settings to show:
// the Tetherfi Unbound onboarding agent (demos/unbound/use-case-1), with its connections, forms, picture and video
// steps, a transfer to a person, subagents, guardrails and after-call settings. It is a draft in the demo only.
// Its test scenarios are added here, each with sample pictures drawn from made-up lines of text (schema 1.2 `tests`
// `images`), so Images & Videos has a library to show. Nothing in them is real data.
import unboundOnboarding from '../../demos/unbound/use-case-1/onboarding.config.json' with { type: 'json' };

const CARD = {
  title: 'SAMPLE BANK DEBIT CARD',
  lines: ['Name: JANE A SAMPLE', 'Card: 4000 1234 5678 9010', 'Valid thru: 08/31'],
  colour: 'blue',
  width: 960,
  height: 600,
};
// the full sample card number must never be read back to the customer
const NEVER_SAYS_NUMBER = { said_not_matches: '4000 ?1234 ?5678 ?9010' };

const SCENARIOS = [
  {
    id: 'clear-card',
    description: 'A clear photo of the card, then the same card at the camera: accepted without a person.',
    channel: 'web-chat',
    images: { clear_card: CARD, card_at_camera: { ...CARD, width: 1280, height: 720, colour: 'grey' } },
    turns: [{ say: 'I would like to open the account.' }, { upload: 'clear_card' }, { camera: 'card_at_camera' }],
    expect: [NEVER_SAYS_NUMBER],
  },
  {
    id: 'blurry-then-clear',
    description: 'A blurred photo is turned down and asked for again; the second, clear one is used.',
    channel: 'web-chat',
    images: { blurry_card: { ...CARD, blur: 6 }, clear_card: CARD },
    turns: [{ say: 'Here is my card.' }, { upload: 'blurry_card' }, { upload: 'clear_card' }],
    expect: [NEVER_SAYS_NUMBER],
  },
  {
    id: 'glare-and-cut-off',
    description: 'Glare over the details, then an edge cut off: each is asked for again in plain words.',
    channel: 'web-voice',
    images: {
      glare_card: { ...CARD, glare: 0.8, colour: 'sand' },
      cut_off_card: { ...CARD, crop: 0.35, colour: 'green' },
      dim_card: { ...CARD, brightness: 0.35 },
    },
    turns: [{ upload: 'glare_card' }, { upload: 'cut_off_card' }, { upload: 'dim_card' }],
    expect: [NEVER_SAYS_NUMBER],
  },
  {
    id: 'not-a-picture',
    description: 'A file that is not a picture is refused, and the customer is told why.',
    channel: 'web-chat',
    images: { meeting_notes: { text: 'Notes from Tuesday’s meeting. This is not a picture.' } },
    turns: [{ say: 'Sending it now.' }, { upload: 'meeting_notes' }],
    expect: [NEVER_SAYS_NUMBER],
  },
];

// version 2 added the test scenarios with their sample pictures
export const DEMO_SAMPLES = [{ id: 'unbound-onboarding', name: 'Unbound Bank onboarding', version: 2, config: { ...unboundOnboarding, tests: SCENARIOS } }];
