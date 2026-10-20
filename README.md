# Weave React Agent Studio

React + Vite frontend for Weave Agent Studio. It is frontend only: agents, drafts, versions, deployments and
test sessions live on the **Agent Builder API**, which this app calls.

## Run locally

Needs **Node 22.15 or newer** (`engines` in `package.json`: the component tests use `jsdom@30`, whose dependency `undici` needs the zstd support that arrived in Node 22.15; on 22.14 those ten test suites fail to load).

```bash
npm install
cp .env.example .env.local     # then set AGENT_BUILDER_URL and AGENT_BUILDER_API_KEY
npm run dev                    # http://localhost:5173
```

The browser only ever calls `/api`. The Vite dev and preview server forwards that to `AGENT_BUILDER_URL` and adds
the `Authorization: Bearer` header itself, so the key is never part of the browser code. `.env.local` is
git-ignored.

**No backend? Use demo mode.** `npm run dev:demo` runs the whole app on an imitation of the API that lives in the browser: sample
agents, and creating, editing, saving, publishing and deploying all work, kept in this browser (localStorage). It is plainly labelled:
a DEMO badge is on every screen, the publish and deploy screens say nothing is live, the checks are a few simple rules and not the
real validator, and replies in the preview are made up. You can also switch from the app (Settings → Data source, the DEMO badge, or
"Use demo data" on the sign-in screen) and back to the real API. Nothing in demo mode is sent anywhere (`src/demo/`).

**Sign-in is a demo.** The login screen accepts any email and password and says so; it only decides which screen a
refresh opens. Who the API records for a save, publish or deploy is **not** taken from the browser (anyone can set a
header): the proxy sets it (`AGENT_BUILDER_USER` in development, the verified sign-in in production). A real deployment
needs SSO in front of the app and a proxy that adds the key and the identity: see [docs/PRODUCTION.md](docs/PRODUCTION.md).

## What it does

The **Agents** area (`src/studio`) covers the four jobs of the front-end guide:

The agent's tabs follow the order of the work, in four stages (`src/studio/journey.js`): **Build** it, **Test** it, **Release** it, **Monitor** it.
Each stage says what question it answers, the line under the agent's name says where it stands (state, tests, where it is live, calls today),
and every tab ends with a **Next: …** bar, so the whole path can be walked with that button. Every old link (`#/bots/{id}/deploy`) still works.

| Stage       | Tab           | What you can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build**   | **Config**    | Edit the draft in **Simple** (six cards in the customer's words), **All settings** (the whole schema, grouped by task, with plain labels) or raw JSON (offered once **Technical names** is on, so a customer's first screen has no jargon), with an optional **preview** beside it. Validation runs as you type (`POST /validate`); every problem names the setting by its label and offers a fix where one is certain. Save uses revision locking and handles a conflict.                                                  |
|             | **Knowledge** | Upload the files a knowledge base reads, build its index (a job you can watch), try a search and see each passage's score and what the model would be shown. See "Knowledge" below.                                                                                                                                                                                                                                                                                                                                         |
| **Test**    | **Test**      | Start a real conversation (`POST /sessions`, then LiveKit): chat, voice, camera/screen/picture input when the channel has it, and the forms the agent asks for, with a **live trace** of what the agent did beside it. "Save as a scenario" turns a conversation into a test. Only web chat and web voice channels can be tried here; a phone-only agent says so. An agent that offers chat and voice side by side gets a **Try it as** button for each, and the choice is sent to the server with the session (`channel`). |
|             | **Scenarios** | Write test conversations, run them on the **server's real runner** and see which fail and why. See "Test scenarios" below.                                                                                                                                                                                                                                                                                                                                                                                                  |
|             | **Checks**    | The readiness checks: the saved draft or a published version read against everyday situations (a greeting, a way to end the call, reaching a person). No conversation is run. Kept in this browser.                                                                                                                                                                                                                                                                                                                         |
| **Release** | **Versions**  | List published versions, see whether the tests passed on each **exact** version, compare any two (or the draft) with `GET /diff`, restore one as the draft.                                                                                                                                                                                                                                                                                                                                                                 |
|             | **Deploy**    | See what runs in each environment; the **release checklist** ("is it safe to put this live?") for the version, including where conversations are processed, what is kept about each call and whether callers are told they may be recorded; deploy it (production asks twice), roll back, follow a `pending` deployment, read the history.                                                                                                                                                                                  |
| **Monitor** | **Calls**     | This agent's calls (real callers and test conversations) with filters, and a trace of what happened in each.                                                                                                                                                                                                                                                                                                                                                                                                                |

The sidebar holds workspace-level things only: **Home** (the next step for the agent you were last working on, what is live, recent activity), **Agents**,
**Calls** (every agent), the **Library** (Voices, Integrations, Telephony) and **Settings**.

**Publish** (header) freezes the saved draft as a version. The dialog lists the validator's warnings first.

### Inside an agent (the default layout)

The table above is the classic layout. The default layout (`src/studio/newlayout/`) gives an agent its own menu in the sidebar, in the order the work is done:

- **Overview**; **Build**: Agent, Knowledge, Tools, Workflow, Channels, Guardrails, After the call; **Test and launch**: Tests, Releases; **Monitor**: Calls,
  Monitoring, Questions, Cost and speed; then **Settings** below a line. The whole menu fits on a 900 px high screen in every style.
- At the top of the menu: **‹ All agents**, and the agent's name with where it stands. Clicking the name lists the workspace's other agents (moving to one
  keeps the page you are on, so going from one agent's Tools to the next one's is one click; unsaved edits are asked about first), **All agents** and
  **Create an agent**.
- While the agent is not ready, a **Getting it ready** card under the name shows how many of the steps are done (what it should do, what it says
  first, its language and voice, its model, tools or knowledge, the checks, tests, a published version, live) and opens the next one. A ring beside a page says a step is still to do there; a number says the
  checks found problems there.
- **The bar across the top** of every page: the name, where it stands, whether the draft is saved, and how many changes are not published yet (a click
  shows them). On the right only what is reached for from any page: what the checks found (when they found something), **Describe**, **Test**, **Save**
  (only when there is something to save), **Publish**, and **More** (run the checks, what changed, share, publish, deploy, roll back, all versions,
  rename, export, save as template, move, remove from my list).
- **Test** opens the test conversation beside the page on a screen 1280 px wide or more, and it stays there as you move between pages, so you can change
  a setting and try it straight away; on a narrower screen it opens as a panel over the page.
- **Overview** is the agent's dashboard: calls in the last 7 days (with a small chart and the change on the week before), the share handled without a
  person, the typical answer time and the share cut off, each opening the page that explains it; the steps to get ready (folded away once it is ready);
  where it runs; and its latest calls. It lays itself out by its own width, so it reads well beside the test panel too.
- Pages with settings beyond their main job list them under a heading that says what they are ("Connections, forms, messages and tasks" under Tools,
  "Hand-overs, hours and callers" under Channels).

**Creating an agent** asks for a name and how it starts: **Describe it** (say what it should do, and a draft is made to check) or one of the starters
(Customer care, Front desk, Knowledge guide, Lead concierge, Booking concierge, Feedback collector, or Blank), each a card with a picture and a line; templates
saved in the workspace are listed under them.

### The Simple view (the default)

The Config tab opens on six cards, worded for the customer: **Personality and instructions** (name, what it should do, what it says first, tone, style
rules, where conversations are processed and a way to change it, and the prompt preview), **Voice and language**, **AI model** (provider and model for
listening, thinking and speaking), **What it can do** (connections, tools, the secrets it needs), **Where it is available** (the channels, each switched
on or off, added from a picker; adding a voice channel asks whether callers should be told they may be recorded) and **Call records** (the per-call log,
recordings, how long they are kept, the recording notice, and a button that hides sensitive details in what is saved). A closed card sums itself up in one
line; an open one shows the everyday settings; **Detailed settings** reveals everything the configuration holds about that part. Below the cards, **More**
(safety rules, business hours, multi-step tasks, closing messages, events, test scenarios, name/tags/owner) and an **Advanced** fold (caller identity,
fixed values, the engine, studio notes) put every other section one click away. It edits the same draft as **All settings** and the JSON, so the three
always agree (`src/studio/simple/`). A test walks the schema and fails if a section is on no card, under More or under Advanced.

### Describe it (build and change an agent in plain English)

**Build → Describe** is a conversation: write what the agent should be and do (who it talks to, what it helps with, how it should sound, what it must never do), and later
ask for changes ("add a Spanish greeting", "let it transfer to a person"). The answer is a **proposal**, never a surprise: a plain summary, what it **assumed**, what it
still **needs from you** (answer in the same box), **what changes** compared with the draft (grouped by part of the agent), **how a call would move**, and whether the checker
found problems. It goes into the draft only when you press **Apply**, and **Undo** puts the draft back exactly; it is the same draft as Config, Workflow and the JSON.

How it works: the request goes to the server's `/llm/v1/messages` route (`llmRoute.js`, also on `vite preview`) with the settings schema and the current draft; the model answers
through one tool, `submit_config`, with the whole configuration; that is run through the same `POST /validate` as a hand-made draft, and what the validator finds is handed back to
the model to fix (up to twice) before anything is shown. The studio's own notes (`builder`, where blocks are drawn) are never lost.

To turn it on, set `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`; `LLM_MODELS` and `LLM_BASE_URL` are optional) and restart. The key stays on the server like the Agent
Builder key: the browser can only ask for `/llm/status` and post a messages request, the model is limited to the listed ones, and the size of an answer is capped. **What you write and
the current draft are sent to the provider**, and the first use asks you to confirm that (secrets are never in a draft, only their names). With no key, and always in demo mode (which keeps
everything in the browser), only the simple built-in rules are offered, labelled "not AI": they look for keywords and make a first draft that replaces what is there. Tests:
`tests/assistant.test.js` (route, prompt, check-and-repair loop, diff) and `tests/assistant.component.test.js` (the screen). Like the other proxy routes it is a development convenience:
anyone who can open the app can use the key through it, so production puts real sign-in in front (docs/PRODUCTION.md).

### The Workflow

**Build → Workflow** draws how a call moves through the agent as a canvas you can edit: a **Start** block, an agent block (a "Subagent") for each agent, and what goes
with them: lines an agent says and state it sets as it takes over (`on_enter`), and what it can do (its tools: end the call, hand over to a phone number, any other
tool). An arrow is a way the caller is passed on: an agent's own hand-over (`handoffs`), or one made by a tool's rules or a safety rule (each can be pointed at another agent or taken away from its panel). Select an agent and press **＋** under it to add a **Subagent**, **Say**, **Update state**, **Agent transfer**, **Phone number transfer**, **Tool** or
**End**; each writes ordinary settings (a new agent with a hand-over to it, an `on_enter` step, a transfer and the built-in tool that uses it…), so the form, the JSON and
the runtime all read the same thing. Select a block or an arrow for its panel (name, what it does, when to pass the caller on, the number to transfer to…); the panel ends with **In the configuration**: the path the block lives at (for example `agents.items[1]`), its JSON as it is right now, and buttons to open it in All settings or in the file. It is one draft: what is changed in the Workflow is in All settings, Simple and the JSON at once, and what is changed there is what the Workflow draws.

Blocks are moved by dragging them (or with the arrow keys once selected; Shift moves further). Where each block sits is saved in the draft under
`builder.ui.graph_positions`, the place the schema keeps for it, and the blocks that go with an agent follow it unless they have a place of their own. **Tidy up**
forgets the saved places; **Undo/Redo** step through everything done here (kept while the page is open, even after a visit to another tab, and dropped if the draft is changed elsewhere) (and the draft is saved with **Save draft**, Ctrl+S, like every other tab). Zoom with the
buttons or Ctrl and the wheel, drag the empty space to move around; tools can be hidden when there are many. "As a list" says the same in sentences. The model is in
`src/studio/workflow/workflowModel.js` and the edits in `workflowOps.js` (both pure, tested in `tests/workflow.test.js`); the screen is covered by
`tests/workflow.component.test.js`.

### Changes since published, and the way to live

- **Changes**, in the Config toolbar once a version is published, lists what the draft changes compared with the newest published version, by part of the agent and in plain words. Server bookkeeping and Workflow block positions are left out. Each part has **Put back as published**; it is an ordinary edit of the draft with an **Undo** beside it, and nothing is saved until you save.
- At the top of **Versions**, five steps show where the draft stands on the way to callers: saved, valid, tested, published, deployed. Each is done, to do, blocked or (for tests, when no scenarios are written) optional, and the button is the one thing to do next. It informs; it never stops a publish or a deploy. The logic is `src/studio/release/shipFlow.js`, the comparison `src/studio/changes/sinceRelease.js`; both are pure and have unit tests.

### Replay a call, and keep it as a test

Open a call from an agent's **Calls** tab (the same call opened from the Calls page offers to open it in the agent, because replays and tests belong to one agent's draft).

- **Replay** plays the caller's words, turn by turn, to the draft (unsaved edits included) or to a published version, and lays the result beside what happened in the call. What the agent _did_ (its tools, its hand-overs, how it ended, what it remembered) is compared exactly; what it _said_ is compared loosely, because a language model never words things the same twice. Changes are said in plain sentences above the table.
  - **In the browser** is free and instant, but it is a simulation: simple rules for tools, hand-overs and goodbyes, with no language model. Trust it for what the agent does, not how it says it.
  - **On the real runtime** sends the replay through the scenario runner with the editor's contents (nothing is saved). It uses the live model, so it asks first, and the agent's API calls are never made for real: only mocks answer them. In demo mode this button is an imitation too, and says so.
- **Keep as a test** turns the call into a scenario of the draft (`tests`): the caller's words (phone numbers and e-mail addresses are hidden, and every turn can be edited, because a test is published with the agent), checks suggested from what the agent did (a tool that worked, a hand-over, a value it remembered) with the plain facts ticked and its exact wording offered unticked, and an optional "what should have happened". It is an ordinary edit of the draft with an **Undo**; nothing is saved until you save.

The logic is in `src/studio/replay/` (`callFacts.js` reads a call, `replayRun.js` plays it, `compareReplay.js` compares, `callToTest.js` makes the test), pure and covered by `tests/replay.test.js`.

### Fix this call, simulated callers, and the test gate

**Fix this call** (a button on a call, when opened from the agent's own Calls) closes the loop from a bad call to a fix. It reads the call's records and lists what went wrong with the evidence: a tool that failed, a call cut off, an agent that said nothing, a long wait (4 s or more), a spoken answer too long to listen to, the agent repeating itself, the caller having to repeat themselves, a hand-over. For each it suggests small changes from a checklist of well-known remedies (a rule under Tone and style, or a faster model), shown as sentences before anything changes. Tick the ones you want, replay the call with them, then put them in the draft; the notice that follows has **Undo**, **Save draft** and **Keep this call as a test** (with what should have happened already written). The suggestions are rules, not an AI, and the panel says so. The browser replay cannot show a change of wording, because the simulated agent does not read instructions; it says that too, and points to the runtime replay and to the test. Logic in `src/studio/fixcall/` (`diagnose.js`, `fixes.js`, pure, `tests/fixcall.test.js`).

**Simulated callers** (Tests, new layout) are scripted callers that phone the draft: straight to the point, rambling, one-word answers, frustrated, asks for a person, off topic, changes their mind, doesn't follow, tries to break the rules, speaks another language. Their words are written from the agent's own tools. Beside them are checks made from what the agent has (it greets, uses each tool when asked, offers a person, ends the call when thanked). They are scenarios in the usual shape, run on the usual runner (the real runtime, or the demo's imitation), played from the editor's contents so nothing is saved by trying; a real run is on the live model and asks for a tick first. A caller whose only real check is a reviewer's judgement says "Basic checks passed" until the reviewer is switched on. The ones that did well can be **kept as tests**. The callers are scripted, not played by a model, and the screen says so. Logic in `src/studio/callers/personas.js` (pure, `tests/callers.test.js`).

**Tests must pass before publishing** is a switch per agent (Tests page, kept in this browser). When it is on, the release flow marks Tested as blocked and the publish panel is held until the newest run passed and nothing was saved or edited after it; "Publish anyway" remains, on purpose. Logic in `src/studio/release/gateCheck.js` (`tests/gate.test.js`).

### Monitoring

**Monitoring** (in the sidebar) reads the calls of every agent for the last 7, 14 or 30 days (and the same length before, to compare) and shows: calls per day, how often calls were handed over or cut off, the time to answer, the share of tool calls that failed, the calls that need attention (cut off, a tool failed, an error, a caller who had to repeat themselves, a slow answer) each with **Open** and **Replay**, what goes wrong most, each agent's numbers, and each agent's versions side by side.

- A version that does clearly worse than the one before it (more calls cut off, handed over or failed tool calls, by a margin, on at least 5 calls of each) raises an alert with **Roll back to vX…**, which opens Deploy with that version ready. It is a pattern in the numbers, not a verdict, and the alert says how many calls it rests on.
- Times and tool failures come from the records of the newest 15 calls of each agent; the other numbers from every call listed. The page says how many calls that is. It only reads: nothing is written. In demo mode the calls are generated (two weeks of them, with one agent whose newest version is rough, so there is something to find); `weave_demo_history = off` in local storage leaves the earlier ones out.

The logic is in `src/studio/monitoring/monitorModel.js` (pure, `tests/monitor.test.js`).

### Alerts: when something breaks

**Alerts** (in the sidebar, and the bell in the top bar) checks the recent calls of every agent while the studio is open: about 1.5 s after it opens, every 3 minutes, and when the tab comes back after more than a minute away. It raises an alert when:

- a tool fails on 3 or more calls in 30 minutes (critical), with **Open “tool”**, which opens that tool's panel on the agent's Tools page;
- calls are cut off, or handed over to a person, far more than usual for that agent (over enough calls, and at least twice its usual share when it has a week of history);
- nobody has called for hours where there usually are calls; answers are slow; the runtime records errors; or a new version does clearly worse than the one before (**Roll back to vX…**).

Each alert says what it rests on (the calls, listed, each one link away), since when, and why it matters. **I’m on it** takes it off the count and shows who; **Snooze** (an hour, 4 hours, until 9:00 tomorrow) hides it until then; **Copy** puts it on the clipboard to paste into a chat. An alert that stops holding moves to **Earlier**; if it comes back, it is new again. The thresholds are sentences with numbers in them under **What to watch for**, with a way back to the recommended ones. An agent with an alert shows it on its Overview and Monitoring pages.

**Where to send:** browser notifications, while the studio is open in a tab. Email, Slack and Teams need the Weave server to watch the calls when nobody has the studio open; it can’t yet, and the page says so. Everything here only reads calls; the thresholds, acknowledgements and history are kept in this browser (`weave_insights_v1`). The logic is in `src/studio/insights/alertsModel.js` (pure, `tests/insights.test.js`). In demo mode, Acme Support’s hand-over to a person is failing and Front Desk answers slowly, so there is something to find.

### Questions it couldn’t answer

An agent's **Questions** page (Monitor › Questions in the agent's menu) reads its calls of the last 7, 14 or 30 days and lists what callers asked that it didn’t answer: it said it didn’t know, passed the caller to a person, a lookup came back empty, the caller had to ask again, or the call ended first. Small talk, asking for a person and a tool that broke (that is an alert) don’t count. Wordings of one question are grouped (“Do you deliver on Sundays?”, “Is Sunday delivery available?”), counted by calls, and the most asked come first; questions asked once wait behind a line.

**Answer it** takes a sentence, shows the rule it will add to the agent’s instructions, and adds it to the **draft** (nothing is saved or published until you do), with a test that asks the question and looks for the answer, and, when callers used to be passed on, checks they no longer are. **Undo** takes both out again. An answered question says whether it was still asked unanswered since. **Dismiss** (it shouldn’t answer this, already taken care of, not a real question) keeps it off the list; **Bring it back** undoes that. The logic is in `src/studio/insights/questionsModel.js` (pure, `tests/insights.test.js`); decisions are kept in this browser.

### Live

**Live** (in the sidebar) shows every call going on right now across the workspace's agents, as it happens: a card per call with the agent, the channel, the caller (a phone number only by its last four digits), who has the call after a hand-over, how long it has run, and its last lines as they are said (with dots while the agent is answering). What needs a look is marked and comes first: a caller waiting 8 s or more, nothing said for 45 s, a tool that failed, an error, a call limit, a caller who asked for a person (until the call is passed to one), a caller repeating themselves, a safety rule stepping in, a slow answer. The top shows how many calls now, how many need a look (a click shows only those) and how many ended in the last 10 minutes (listed below, with how they ended).

**Watch** opens a call in a side panel that follows it record by record; **Open in Calls** opens it in its agent. Filters for agent and channel; **Hide what callers say** (remembered in this browser) for a screen others can see; **Pause**. It only reads: every 5 s it asks each agent for its calls in progress, reads a new call once and then follows it through the call stream (up to 12 at once; the others are read again each round), and reads a call that leaves the list once more to learn how it ended. Watching stops while the tab is hidden. Durations are counted on this computer's clock from when each record arrived, so a server clock that differs does not matter. Screen readers hear new calls, calls that need a look and calls that end. Taking over or joining a call needs the runtime and is not offered. The logic is in `src/studio/live/liveModel.js` and `liveBoard.js` (pure, `tests/live.test.js`). In demo mode the calls are made up from the clock (`src/demo/demoLive.js`): a few always going on, two to three minutes each, some with something to see.

### Cost and speed

**Cost and speed** (in the sidebar for every agent, and Monitor › Cost and speed in each agent's menu; the Overview shows the typical answer time) works out from the calls of the last 7, 14 or 30 days what a call costs, a minute, and a month at the recent number of calls, and how fast the agent answers: half the answers, 1 in 10, and the share within a target you set (2 s to start).

- **Where the money goes:** the language model, from the tokens each call reports, at the price of the model it names; listening, from a voice call's minutes; speaking, from the characters the agent said. Each model with its calls, tokens a call and cost a call. Phone line charges are not included.
- **Where the time goes:** answers by how long they took, how soon the model starts (when calls record it), the slowest answers (each opens its call), and tools by how long they take.
- **Another language model** (on an agent): what a call would cost on each model with a price, the same conversations assumed, with the saving and the month; one of the same provider can be put in the draft (**Use in the draft**, with Undo), and the page says to run the tests, as a smaller model can follow instructions less well. On the workspace page, **By agent** compares the agents.
- **Prices:** the providers' public list prices, checked on the date the page shows, for the models where one price applies; a price that depends on a plan or contract (ElevenLabs, Cartesia, the newest Anthropic and OpenAI models) is left empty rather than guessed. A part with no price, or a call that didn't report its model use (a call cut off before its end never does), is named on the page and left out of the sum; **Add a price** goes straight to it. Every price can be changed or added, and is kept in this browser.

The logic is in `src/studio/cost/costModel.js` and `prices.js` (pure, `tests/cost.test.js`). It only reads (the calls, their records, and on the workspace page each agent's draft for its speech models). In demo mode Front Desk also answers the phone, with an ElevenLabs voice, so the speaking part and a missing price have something to show.

### The preview beside the editor

An optional, collapsible panel beside the settings (the **Preview** button; **Test** in the top bar of the default layout) lets you talk to the agent while you edit it, with its state
always visible: not started, connecting, live, reconnecting, ended, and errors with a way to retry. It talks to either the **real agent**
(a live conversation on the saved draft; it says so when you have unsaved edits) or a **simulated** one (made-up replies from simple
rules, using your current edits, no server). The two are never confused: the panel says which, and every simulated reply carries a
"Simulated" tag. Demo mode has no real agent, so it is simulated only (`src/studio/preview/`, `src/demo/simulatedAgent.js`).

What the box offers follows the channel's own settings (`modalities.input`, and `inputs.image` for pictures), so the preview never offers what the
channel would refuse: a **microphone** when the channel takes audio (with the real agent it switches the call's microphone on; with the simulated one
the browser's speech recognition types what you say into the message box, and the button says so where the browser has none), a **paperclip** when it
takes pictures (checked against the channel's accepted types and size limit before anything is sent; the simulated agent answers and says its reply is made up),
and a **camera** when it takes video (real agent only). A text-only channel shows none of them (`src/studio/preview/useDictation.js`).

### All settings: grouped by task, in plain words

"All settings" is the complete schema, but it is arranged by what a person came to do, not by the shape of the file (`form/layout.js`): **About this
agent**, **How it talks** (fixed lines, language, AI models, conversation flow), **What it can do** (tools, knowledge, forms, messages it sends, tasks,
connections), **How it behaves** (agents, safety rules, business hours, events, things it remembers), **Where it is available** (channels, phone
transfers, caller identity), **After the call**, **Quality and records**, and last, marked advanced, **Engine and operator settings** (the engine, reliability,
fixed values, studio notes). It opens on "About this agent". `tests/layout.test.js` fails if any property of the schema is on no screen or on two, so
regrouping can never lose a setting; `tests/density.component.test.js` fails if a screen opens with more than 40 inputs.

Every setting has a hand-written label, a one-sentence purpose and, where it helps, an example (`form/plainLanguage.js`), so `timeout_s` reads "Give up after
(seconds)" and `stt` reads "Listening (speech-to-text)". The catalogue is checked against the schema: every setting name must have an entry, every
place-specific entry must exist in the schema, and a name that means different things in different places (`type`, `name`, `enabled`) gets its own wording per
place. The schema's own technical description is one click away ("Technical detail"). **Technical names** (a switch in the Config toolbar and in Settings,
off by default) shows the key the file uses beside every label, in All settings and in Simple alike, as its whole path (for example `channels[0].modalities.input`), with **Copy path** and **In JSON**; with it off no raw key is on screen
(`tests/techNames.component.test.js` walks every screen of the sample agents to prove it). Settings meant for experts sit under **Advanced** in their place;
the catalogue is read as a fallback behind the schema's own `x-ui` hints (`label`, `help`, `example`, `audience`, `advanced`), so a server that starts
sending them takes over without a release.

Adding things is a choice of **jobs on cards** (`form/AddPicker.jsx`, `form/pickerOptions.js`): "Hand over to a person", "Look something up in your systems",
"Search your knowledge", "End the call"… for tools, the ways to be reached for channels, "Refuse tricks to change its instructions" for safety rules, each with a
sentence on what it is for, grouped, searchable, and with what the runtime can't run yet marked on its card.

**Relationship views** (`src/studio/relations/`): an **agent map** above the agents (boxes and arrows for who hands the caller to whom, the first agent marked,
stranded agents called out, click to open), a **tool × agent grid** above the tools (tick to give or take a tool, with Undo), a week bar for each **schedule**,
the **steps of a task** read top to bottom, and **Used by** on every tool, line, value and connection (chips that go there).

**Problems in plain words** (`src/studio/validation/`): each message from the checks names the setting by its labels (`Agents › Who answers first`), says what is
wrong in plain words, and offers one-click fixes where one is certain (use one of the ids that exist, add the missing setting, remove a setting that isn't there,
raise `schema_version`, rename an id everywhere, offer an unused tool to an agent, hide sensitive details…). They are grouped by what to do (fix these first,
then these which need you, worth a look), applied as ordinary undoable edits, and checked against the real validator
(every fix was tried on a deliberately broken copy of the example agent and sent to the real `POST /validate`: 20 of 21 cleared their message without adding an error; the other adds a missing setting empty and takes you to it to be filled in). The server's own sentence
is in a fold. **Search** (Ctrl K) also finds a setting of the open agent by what it is called, what it is for or its key, and takes you to it.

### The Config form

The form is generated, not hand-written: `src/studio/form/engine.js` reads the schema (`$ref`, `allOf`, `if/then`,
`oneOf`, `x-ref`, `x-ui`), so new schema fields appear without code changes. On top of that, the parts authors spend
their time in have purpose-built editors:

- **Ids and references.** An id is a permanent key other parts of the config point at, so it is shown as a locked chip with
  **Rename…** (which rewrites every reference: `x-ref` fields and `{{state.x}}` in templates). Deleting something that is used
  lists where, and offers to remove those references (`form/references.js`). Map keys (state variables, connections) rename the same way.
- **Channels.** **Add channel** offers presets (phone line, web voice, web chat, WhatsApp, SMS, email) that start valid;
  only the fields that apply to the chosen type are shown, and changing the type clears the other type's fields. The
  `entry` fields are labelled as documentation only: the runtime doesn't read them (`form/presets.js`, `form/ChannelBody.jsx`).
- **Tools** (`form/ToolBody.jsx`). A parameter builder (name, type, description, required, allowed values) that writes the JSON
  Schema, with a "What the model sees" preview; the request editor (connection with **＋ New HTTP connection**, a call preview,
  `{{args.x}}` chips, a warning when a header looks like a credential, "build the body from the parameters"); the response panel
  (paste a sample response, click a field to show it to the model or keep it in a state variable, paths checked against the
  runtime's small grammar, a warning when nothing is chosen because the model then sees the whole response); `reply` explained
  with examples; effects as readable rules and preconditions through a condition builder; advice on descriptions, `on_error` (it is read by the
  model, not the caller) and timeouts. Kinds the runtime can't run yet (MCP, code; task and keypad tools run now) are marked in the **Add tool** menu.
- **Steps everywhere.** Wherever the schema asks for actions (a tool's effects, an agent's on-enter steps, an event's `do`, a transfer's
  before/closed/success/failure, what to do when a caller goes quiet, a form's submit, a task step, a notification failure, a wrap-up)
  they are numbered steps: pick what each does from a plain-language menu (say a line, have the model say something, change state, hand
  off, end the call, show a form, send a notification…), reorder, delete with Undo, and each step reads back as a sentence. A tool's
  effects are rules: each applies always or only when a condition holds. The details of a step are the ordinary form for that kind of
  action (`form/EffectsEditor.jsx`, `form/effects.js`).
- **Templates and prompts.** Text the runtime reads as a template (`{{state.x}}`, `{{args.x}}`, `{{const.x}}`, filters) is highlighted,
  has an **Insert a value** helper, and flags a name that points at nothing. Prompts show a word count, and each agent has a **Preview the prompt** panel that puts the persona, role, opening, rules, conditional blocks, channel addition and tools together in order. It asks the server, so it is **exact** (see “What the model will be told” below); only when the server can't be asked does it fall back to an approximate copy built in the browser, and it says so.
- **Messages** can be one text or one per language; every language the agent speaks gets a row, a missing one is badged and one click adds it.
- **State variables.** `sensitive` shows a shield and what it means, and offers to raise `schema_version` to 1.2 (which it needs).
- **`x-ui` hints** the schema may carry are honoured: `widget` (`textarea`, `template`, `jsonpath`, `phone`, `url`, `duration`,
  `secret-picker`), `label`, `help`, `group`, `order`, `advanced` (`form/xui.js`).
- **Duplicate keys.** The JSON view (and any pasted JSON) reports a key repeated in one object, with its path, instead of silently
  keeping the last one; Save is blocked until it is fixed (`jsonDuplicates.js`).
- Wherever something can be added there is a labelled way to delete it, and every deletion shows an **Undo** bar; focus returns
  into the form afterwards.

### Models

The Config tab's **Models** mode picks how the agent listens, thinks and speaks. The providers come from the server
(`GET /providers`): a provider is offered for a stage only if the runtime can run it there, one whose plugin isn't installed is
shown but can't be chosen, and one whose usual key isn't set is flagged. Choosing a provider sets its first model, the
conventional name of the vault secret and, for speech, one of its voices. `openai_compatible` also needs a **Base URL**
(that is how Mistral or a local server is reached). A provider name the runtime can't run (`whisper`, `mistral`, …) is explained
with a one-click fix. The choice is written to `defaults.models`, so the **Test** tab runs the same models and warns when they
aren't saved yet. The model lists in `src/studio/models/catalog.js` are a **catalogue** kept in the studio and reviewed by hand (the date is shown), not a live check of what a provider or your account offers: each entry has a label, a note and tags, the table records which stages each provider can do, providers without a list (OpenAI-compatible) are free text, a model that isn't listed is accepted and said so, and `catalogueProblems()` (run by the tests) checks the table is consistent. The server doesn't check model ids.

### Around it

- **Rename** (row and header ⋯ menus) changes `meta.name` on the draft; the id never changes.
- **Export configuration** downloads or copies the draft, the unsaved editor contents, or a published version. Secrets are only names.
- **Starting points.** The Create dialog offers starters (Customer care, Front desk, Knowledge guide, Lead concierge, Booking
  concierge, Feedback collector, Blank). The chosen one is written into the new draft: persona, greeting, instructions, goodbye
  and `end_call`, a nudge-then-goodbye for a silent caller, a recording notice when voice is used, and for the starters that may
  need a person a callback tool with a transfer to fill in. They live in `src/studio/starters.js` and each passes `POST /validate`.
- **Describe it.** The Create dialog can also take a description of the agent instead of a template: write who it talks to, what it
  helps with and what it must never do, and get a draft to review (what it picked and assumed, an editable role and greeting, and
  what is left for you to decide). **The assistant is rule-based, not an AI model**: it reads keywords to choose a starter, channels,
  languages and tone, turns sentences with "never" or "always" into rules, and keeps your description in the role; the screens say so
  and the agent opens with its assumptions listed. A real assistant would be another `generateDraft` behind the same shape
  (`src/demo/draftAssistant.js`).
- **Deploy checks.** Before a version is deployed, the validator's view of it is shown: secrets it needs (and which the server
  knows are missing) and what the runtime can't do yet. Items marked `severity: "security"` (a protection declared but not
  enforced, such as `sensitive` variables or `post_call.redaction`) are shown in red, first, and deploying to production
  then needs the word "production" typed. **Roll back** only fills in the form with the previous version.
- **Workspaces own agents.** The API has no workspaces, so which workspace an agent is in is kept in this browser. They group
  agents; they are **not access control**. **Move to workspace…** changes it.
- **Remove from my list** hides the agent **in this browser only** (the API has no delete); hidden agents can be restored. In “Removed from your list”, **Restore** brings one back and **Delete** (after a question) forgets it here for good: still only this browser, the agent stays on the server, and “Bring them back” undoes it.

## The other pages

All pages read the same agent list (`src/studio/agents.js`): the API's agents, minus the ones you removed from your list.

| Page                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**, search, workspace menu                          | The next step for the agent you last worked on (build, test, release, monitor), the agents, recent activity; counts, rows and results come from the API.                                                                                                                                                                                                                                                                                                                                                              |
| **Calls**                                                 | Every conversation your agents have had (`GET /bots/{id}/calls`): who called, when, how long, how it ended, with filters, paging, "All agents" (it asks each agent, a few at a time) and a trace of what happened in each. The records hold what callers said, and the page says so.                                                                                                                                                                                                                                  |
| **Voices**                                                | "Use in an agent" puts the voice on that agent's draft, unsaved, for you to review. "Used by" is read from the agents' configurations.                                                                                                                                                                                                                                                                                                                                                                                |
| **Integrations**                                          | "Add to an agent" adds the saved connection to that agent's draft as an HTTP connection, unsaved.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Telephony** (phone numbers, dispatch rules, SIP trunks) | **Phone numbers are real** when the server has them (`GET /numbers`): the list (ours, and the ones set up by hand, read-only), a form that checks a number as it is typed (`GET /numbers/check`), and changing or releasing one of ours. Setting up, changing and releasing change the phone system, so each is sent only on a click. **Dispatch rules, SIP trunks and simulated calls are still a preview** kept in this browser, and say so. A server without the numbers feature gets the preview for numbers too. |
| **Settings**                                              | The workspace, and what is running where. A collapsed **For developers** section holds the data source (real API or demo data) and the connection status.                                                                                                                                                                                                                                                                                                                                                             |

Readiness-check runs, Integrations details, dispatch rules and SIP trunks are **kept in this browser only** (the API has no
endpoints for them), so two people see different lists. Saved templates and the workspaces are in this browser too.

On a phone the sidebar opens from a menu button (`src/studio/MobileNav.jsx`).

Sections that wait on something not built yet say so where you work: **Tasks** (the runtime
runs them, keypad steps included; the ordinary form edits them, “Try this task” shows one step by step, and a visual stage editor can follow) and **Telephony** (dispatch rules and trunks are
not connected from the studio). A new agent's id can't be one the runtime reserves (`transcripts`, `metrics`, `logs`, `sessions`, `tmp`).

## Channels follow their kind

What a channel can carry and offer depends on its kind, and the server refuses the impossible, so the screens do not offer it. The studio reads `GET /channel-types` once
(with a built-in copy of the answer if the server cannot be asked, held against the real one by `CONFORMANCE_SERVER=1 npm test`) and uses it so that: a phone line can only carry
audio, has the keypad switch and no form switch, and a web chat the other way round; only the entry fields of that kind are shown; the voice-only settings (sounds, pronunciation,
noise cancellation, speech models) are not offered on a channel with no voice, and a text channel that already has some says they do nothing; WhatsApp, SMS and email are marked
"not available yet" because nothing connects them to the runtime; a web chat that also carries audio is called out, with one click to make it a web voice channel; and changing a
channel's kind drops what the new kind cannot have, naming it first. The microphone is drawn by what the session carries, not only by its kind. Logic in
`src/studio/form/channelTypes.js` (`tests/channelTypes.test.js`).

## Test scenarios

The configuration has a `tests` section: conversations to check, each with a channel, the caller's turns, and what must hold afterwards
(a tool was called, with what, or wasn't; a state variable ended up a certain way; something the agent said matches a pattern; the
conversation ended with a given agent; an API request was or wasn't made; a multi-step task ended a certain way; a safety rule did or didn't catch what the
caller said; a call limit ended the call; or a criterion a model would grade). On a phone line a turn can be **keys pressed on the keypad** (`{"keys": "4821#"}`):
the digits are never repeated on screen or in a result. A scenario can also carry
a description, a pretend clock (`now`), starting `state`, answers for the bot's API calls (`http_mocks`) and a `model_script`.

The Scenarios tab writes them (into the draft, so they are saved and versioned with it) and runs them on the **server's real runner**
(`POST /bots/{id}/tests/run`, polled until it is over; results appear as scenarios finish). A scenario with a `model_script` runs the real
runtime with a scripted model: free and the same every time. One without is **live**: it uses a real model, costs money, and runs only
when you tick "Include live scenarios" (which asks first). Runs never call a real API: the mocks answer, and a request no mock answered
is shown with an **Add a mock** button. A run says which exact configuration it tested, so a version can show "tests passed on this exact
version". What the form doesn't know (a new kind of expectation) is kept and never blocks Save. In demo mode an imitation plays the
scenarios and every result says so (`src/studio/scenarios/`, `src/demo/demoTests.js`).

## Knowledge

A `vector_store` base is searched from an index built before calls. The Knowledge tab uploads the files (`PUT` with the file as the body),
builds the index (`POST .../build`, then polls `.../status` while it runs and shows its log), and tests a search with scores and what the
model would be shown. It works from the **saved** draft, because that is what the server builds and searches, and says so when you have
unsaved changes. A base that asks your own search service has nothing to build (`src/studio/knowledge/`).

## Calls and the trace

One trace component (`src/studio/trace/`) shows what happened in a call, a Test conversation and a scenario run, because they are the same
records: what was said, which tool ran with what, which API answered, what a knowledge search found, what changed, what went wrong, with
filters by kind and every raw record one click away. A call still in progress is followed live (`GET .../calls/{id}/stream`; the proxy must
not buffer that path). The call log's text currently arrives with the wrong character encoding (`Iâ€™m` for `I’m`); the trace repairs
that pattern, and the transcript endpoint is fine.

## What the model will be told

The prompt preview and the tool "Try it" panel ask the server (`POST /preview/prompt`, `POST /preview/result`), which runs the runtime's
own code on what is in the editor, so they are exact: the real instructions, which conditional blocks are in right now, the tools as the
model sees them, how big it all is (with advice when it is too long), "Preview as…" a channel, a what-if state and a pretend time, and for a
tool: the request that would go out and what the model would read of a sample answer. If the server can't be asked the prompt preview falls
back to an approximate copy built in the browser and says so.

**Try a line** (under the setting it answers for; each asks only when its button is pressed): _how a line is said_ under the pronunciation rules
(`POST /preview/speech`: what the voice is given, rule by rule, and what is spoken as text streams in), _what redaction hides_ under the redaction
settings (`POST /preview/redaction`, with `GET /redaction/entities` for how each kind is recognised), _what the safety rules do_ with a line
(`POST /preview/guardrails`) and _a task step by step_ under each multi-step task (`POST /preview/task`: what each question tells the AI, how an answer is
checked, what is skipped or held back for a caller, and what each ending does). In demo mode they are answered by a simple imitation and say so.

### Team and sharing (preview)

**Team** (in the sidebar) is where a workspace decides who can work in it. Each person is given a **role** (Owner, Admin, Editor, Viewer: what they may do) and a **scope**: the **whole workspace** (every agent, including the ones made later) or **only some agents** you tick. The invite panel asks for the addresses, then the role, then which agents, and says in a sentence what that gives before anything is sent. The list can be filtered to "who can open" one agent, and access can be changed or removed afterwards. Rules that protect the team: there is one owner, an admin always has the whole workspace, a role that is limited to some agents needs at least one, and someone has to be able to manage people.

Inside an agent, **Share** (in the top bar) shows who can open that agent and why (the whole workspace, or shared with them), and shares just this one agent with someone by address, or from the people already on the team.

It is a **preview**: the team is kept in this browser, no email is sent, and nothing limits anyone yet because the server does not know who is calling. What the server needs is in `docs/COLLABORATION_API.md`; the rules are in `src/studio/team/teamModel.js` (pure, `tests/team.test.js`), and the screens are tested in `tests/team.component.test.js`.

## Waiting for the API

These need endpoints that don't exist yet; the UI is honest about it and will use them when they do. (Test runs, call records, knowledge,
previews and the call stream are all served now and used.)

| Wanted                                                                 | Today                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /capabilities` (which tool kinds the runtime can run)             | The Add-tool menu uses a short list in `toolInfo.js` that can go stale.                                                                                                                      |
| `GET /status` (API, LiveKit, which keys are set)                       | The Home card says only "API reachable".                                                                                                                                                     |
| Cross-agent call list and per-agent statistics                         | "All agents" asks each agent; the Telephony cards show no numbers.                                                                                                                           |
| Tags and owner in `GET /bots`                                          | They are read from each draft, a page at a time, or for all on request.                                                                                                                      |
| Dispatch rules and SIP trunks as endpoints                             | Those two Telephony sections are labelled a preview. (Phone numbers are real: `GET/POST/PATCH/DELETE /numbers…`.)                                                                            |
| An AI assistant that drafts a configuration from a description         | "Describe it" uses a rule-based demo assistant and says so.                                                                                                                                  |
| Alerts sent by the server (email, Slack, Teams) when no studio is open | Alerts are checked in the open studio and shown there and as browser notifications; the page says so.                                                                                        |
| `GET /templates` (and templates an organisation publishes)             | Templates are saved in this browser and shared as files.                                                                                                                                     |
| `x-ui` for every setting (label, help, example, level)                 | The studio keeps its own catalogue, `form/plainLanguage.js`; the tests check it covers every setting in the schema.                                                                          |
| Validation messages with a `code` and a `fix`                          | Messages are shown with the field's label and a "show me" jump.                                                                                                                              |
| A release policy per environment                                       | The release checklist is advice only, and says so.                                                                                                                                           |
| Archive/delete a bot                                                   | "Remove from my list" hides it locally.                                                                                                                                                      |
| `label` on channels and list items                                     | Cards are titled by id.                                                                                                                                                                      |
| A trusted identity header and roles                                    | The proxy sets the identity; see docs/PRODUCTION.md. The Team page and Share panel work on a team kept in this browser (a preview); see docs/COLLABORATION_API.md for what the server needs. |
| The server blocking a production deploy over `severity: "security"`    | The UI asks for a typed confirmation.                                                                                                                                                        |
| Worker and `builder` settings marked ignored in the schema             | The studio files them under "Engine and operator settings".                                                                                                                                  |

## Themes

Two choices, both kept in this browser and applied to every page (the landing and sign-in pages too):

- **Light or dark**: the button at the top of every page.
- **Design style**: pick it from **Theme** at the top of every page, or in **Settings › How it looks and reads**. Each style is a whole look, in light
  and in dark, not just a colour:
  - **Simple** (the default): black and white, quiet, nothing in the way.
  - **Professional**: enterprise and trustworthy. A navy top bar with a blue line, a clean white sidebar with a blue edge on the open page, crisp
    sans type with semibold titles, small capital labels, tabular figures, neat 6 px corners, flat surfaces, a blue line along the top of number
    cards, solid blue buttons, underlined tabs, tables with a grey head.
  - **Calm**: soft and natural, for long days. Sage and sand (deep forest at night) with a soft blur of colour behind, humanist type with airy line
    spacing, round 16 px corners, diffuse warm shadows, soft green pills, slow gentle transitions, a live dot that breathes.
  - **Premium**: tailored and editorial. Ivory paper (warm black at night), an espresso sidebar with champagne type, serif display titles with a gold
    rule under them, small capitals for labels, old-style figures, crisp corners with a gold hairline, espresso buttons with champagne letters (metallic
    gold at night), underlined tabs.
  - **Futuristic**: a heads-up display. A glowing grid and scanlines behind glass panels with corner brackets, titles in a technical display face in
    capitals with a neon gradient, monospace "readout" labels and glowing numbers, angled gradient buttons, fields and tabs that light up, a light that
    sweeps under the page title. Light mode is a clean lab version of the same.
  - **Vibrant**: playful. Soft colour blobs behind the page, rounded heavy type with a candy gradient on titles, a colour of its own for every place in
    the menu, colourful number cards, candy pill buttons and tabs that lift under the pointer, big soft corners.

- **Colour**: under the styles, five colours for the style in use, each one that suits it, remembered for each style on its own:
  - Simple: Black and white, Slate, Navy, Forest, Wine (quiet, deep tones, so it stays understated).
  - Professional: Blue, Teal, Indigo, Graphite, Green (the bar across the top takes a deep shade of it).
  - Calm: Sage, Sea, Lavender, Terracotta, Slate (the whole page takes the hue gently).
  - Premium: Gold, Rose gold, Platinum, Emerald, Sapphire (the metal of the sidebar, the buttons and the rules).
  - Futuristic: Neon, Matrix, Synthwave, Ice, Amber (the neon, the grid and the readouts; Matrix, Synthwave and Amber tint the dark
    surfaces green, purple and warm black).
  - Vibrant: Candy, Sunset, Ocean, Fresh, Berry (the candy gradient of buttons, titles and the open page).

A style is the attribute `data-style` on `<html>` (set before the first paint by `index.html`, then by `App.jsx`). `src/themes.css` holds, for each style,
its colours for light and for dark and its personality: type, surfaces (one list of the app's cards gets each style's treatment), buttons, fields, tabs,
chips, the menu, numbers, the page behind, and motion (which stops for people who ask for less). It uses fonts already on the computer (Bahnschrift or DIN
for Futuristic, Palatino or Iowan for Premium, a rounded face where there is one for Vibrant, Segoe UI or Plex for Professional, Candara or Avenir for Calm), so nothing is downloaded. Every text colour a style defines
is at least 4.5:1 on its backgrounds, which `tests/themes.test.js` checks; `npm run e2e:typing` takes `E2E_STYLE` and `E2E_THEME` to time a style. To add
a style: add it to `STYLES` in `src/studio/usePref.js` and to the list in `index.html`, give it a light and a dark block and its details in
`src/themes.css`, and a preview in the picker's swatch rules. Colour options are in `src/accents.css` (one block per style, option and mode, over
the style's palette; the first option of each style is the palette itself) and `ACCENTS` in `src/studio/usePref.js`; `tests/themes.test.js` holds every
option to 4.5:1, including text on the surfaces an option tints.

## Layout

```
src/main.jsx, src/App.jsx   entry, sign-in state, error boundary
src/tokens.css              the design tokens: both themes' colours, the type scale, spacing and density (loaded before styles.css)
src/appLook.css             the look of the whole app (the Simple style): palette, buttons, sidebar, pages, panels (loaded after styles.css)
src/themes.css              the other design styles (Premium, Futuristic, Vibrant, Professional, Calm), each for light and dark, and the style picker
src/accents.css             the colour options of each style (generated)
src/ui/                     the icon set (Icon.jsx, iconPaths.js)
src/pages/                  one file per page: Landing, Login, Dashboard (the one shell, and Home), Calls (Sessions.jsx), Telephony, Voices,
                            Integrations; HomeJourney.jsx; shared.jsx (sidebar pieces, dialogs), helpers.js (the navigation)
src/api/client.js           one function per API endpoint, error classification (JSDoc-typed)
src/api/types.js            JSDoc types of the API's answers; agentConfig.d.ts is generated from the schema
src/studio/                 the Agents area (list, workspace, Config, Versions, Deploy, Test); journey.js (the four stages and "Next"), status.js (one name for each state)
src/studio/newlayout/       an agent in the default layout: its menu (AgentNav), the agent switcher, the top bar, the pages and the steps to get ready (readiness.js)
src/studio/form/            schema engine, the form, layout.js (the groups), plainLanguage.js (the labels), the pickers, and the tool / channel / message / template editors
src/studio/simple/          the Simple view (six cards) and the helpers that read and write it
src/studio/relations/       the agent map, tool grid, schedule strip, task steps and "used by"
src/studio/validation/      the checks described for a person: labels, plain sentences, one-click fixes
src/studio/records/         what is kept about each call, where it is processed, the recording notice
src/studio/checks/          the Checks tab (readiness checks of one agent)
src/studio/preview/         the preview beside the editor
src/studio/workflow/        the Workflow canvas: the model, the edits, the canvas, the panel
src/studio/assistant/       Describe it: the prompt, the check-and-repair loop, the diff, the screen (and llmRoute.js: the server's /llm route)
src/studio/scenarios/       test scenarios: editing, the run hook, results (runs are the server's)
src/studio/knowledge/       the Knowledge tab: files, index builds, test searches
src/studio/calls/           the call list and one call's detail
src/studio/trace/           one trace component for calls, test conversations and scenario runs
src/studio/release/         the release checklist
src/studio/health/          per-agent health for the Agents list
src/studio/SmartSelect.jsx  the shared selector: a native select for a few choices, a searchable list for many
src/studio/settingsSearch.js  find a setting by name (Ctrl K)
src/studio/models/          provider and model pickers, and the model catalogue
src/demo/                   demo mode: the imitation API (agents, test runs, calls, knowledge, previews), its validator, the simulated agent, the draft assistant
src/studio/test/            LiveKit session hook, Test tab, form prompt
e2e/                        the end-to-end smoke test, the typing-speed budget, the first-run click counter, and the mock API
scripts/                    sync-fixtures (refresh the schema), schemaTypes (generate the types)
tests/                      unit and component tests (node:test), the schema/example fixtures, and corpus/ (the configs the conformance tests run over)
docs/PRODUCTION.md          how to run it for real: sign-in, proxy, identity
docs/USABILITY_STUDY.md     the study to run with real people: tasks, measures, what good looks like
```

`jsconfig.json` gives editors type hints; a few pure modules opt in to checking with `// @ts-check`.

## Test and build

```bash
npm test          # unit tests (schema engine, references, presets, tools, templates, messages, starters, publish, demo API,
                  # scenarios, assistant, catalogue, drift ...) and component tests (tests/*.component.test.js: the real
                  # form and screens mounted in jsdom)
npm run build
npm run dev:demo   # the whole app with no backend (demo mode)
npm run e2e:typing  # typing speed on a 100-tool agent in a real browser (see e2e/typing.mjs: measure a PRODUCTION build)
npm run e2e:firstrun # clicks and fields from the workspace to the first test conversation, and any technical term on the way (demo build; see e2e/firstRun.mjs)
npm run e2e:legibility # no text under 12 px or below 4.5:1 contrast, on the main screens, in both themes and both layouts (demo; see e2e/legibility.mjs)
npm run e2e:tryline  # "Try a line" under pronunciation, redaction, safety rules and a task (demo; see e2e/tryline.mjs)
npm run e2e:numbers  # phone numbers: list, check as typed, set up, change, release (demo; see e2e/numbers.mjs)
npm run e2e:channels # what a channel offers follows its kind; Try it as chat or voice (demo; see e2e/channels.mjs)
npm run e2e:voices   # every voice shows its id and plays its own recording (demo; see e2e/voices.mjs)
npm run e2e:insights # alerts found, counted, acknowledged and snoozed; questions grouped, answered, undone (demo; see e2e/insights.mjs)
npm run e2e:live    # the Live board: calls found, counting up, flagged, filtered, hidden, paused, watched (demo; see e2e/live.mjs)
npm run e2e:cost    # Cost and speed: priced, a missing price added, a target, a cheaper model in the draft and undone (demo; see e2e/cost.mjs)
npm run e2e       # needs the dev server running: signs in, creates an agent from a starter, edits, saves, publishes,
                  # deploys to development and has a (mocked) test conversation. E2E_MODE=live uses a real local API.
npm run sync-fixtures   # fetch GET /schema and update every copy: the test fixture, public/config (the download) and the generated types
npm run sync-public     # propagate what is already in tests/fixtures to public/config and the types, without asking the server
npm run types           # regenerate src/api/agentConfig.d.ts from the fixture only
```

**Conformance.** `tests/conformance.test.js` and `tests/conformance.component.test.js` run over a corpus of configs (the API's example, every
starter, a 30-tool agent, an agent with every kind of tool and channel; add your own folder with `CONFORMANCE_DIR`): every id and key is
renamed and renamed back, and every section is opened with everything expanded, failing on any red mark the studio draws on a config the
server calls valid, on any logged error, and on any setting that can't be reached. `CONFORMANCE_SERVER=1` also sends each config to the
server's `POST /validate` (a read) and holds the corpus to its word. This is what would have caught the false alarms found by the review.

**Look and wording.** `tests/typeScale.test.js` reads every stylesheet and fails on a font size that is not one of the eight tokens (six interface sizes, none
below 12 px, and two display sizes). `tests/plainLanguage.test.js` checks the label catalogue against the schema; `tests/layout.test.js` that no setting is lost
by the grouping; `tests/techNames.component.test.js` that no raw key is on screen with technical names off.

**Look and feel, in one place.** `src/tokens.css` holds the colours of both themes, the type scale (12, 13, 14, 16, 20, 28 and two display sizes) and the
spacing that **Comfortable** and **Compact** (Settings) change. Icons are one set of inline SVGs (`src/ui/Icon.jsx`). An agent has one status vocabulary,
Draft, Tested, Live in Development, Live in Staging, Live in Production and Needs attention, wherever it is shown (`src/studio/status.js`).

`tests/fixtures/` holds the schema the API served and the example config. `tests/schema-copies.test.js` fails when the public download, the generated types or a built `dist/config` copy differ from it (`npm run build` refreshes dist). `tests/schema-drift.test.js` fails when the
fixture differs from what the server serves (when `AGENT_BUILDER_URL` and a key are set), so the form engine's tests can't pass
against an old schema. The end-to-end test needs `playwright-core` (a dev dependency) and an installed Chrome or Edge
(or `E2E_BROWSER`); in the default `mock` mode no backend is needed. In `live` mode it **writes** (it creates an agent), so point it at a local API.

The component tests use `jsdom` (a dev dependency) and bundle the screens with esbuild (`tests/component/`).

`src/studio/form/Node.jsx` and the tool, channel and effects editors import each other (they render each other); that is fine because
the imports are only used while rendering.
