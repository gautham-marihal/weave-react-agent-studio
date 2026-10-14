# Weave React Agent Studio

React + Vite frontend for Weave Agent Studio. It is frontend only: agents, drafts, versions, deployments and
test sessions live on the **Agent Builder API**, which this app calls.

## Run locally

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

| Tab | What you can do |
|---|---|
| **Config** | Edit the draft in **Simple** (four cards), **All settings** (a form built from the API's JSON Schema, `GET /schema`) or raw JSON, with an optional **preview** beside it. Validation runs as you type (`POST /validate`); an error jumps to its field. Save uses revision locking and handles a conflict. |
| **Versions** | List published versions, compare any two (or the draft) with `GET /diff`, restore one as the draft. |
| **Deploy** | See what runs in each environment, check a version before deploying it, deploy it (production asks twice), roll back, follow a `pending` deployment, read the history. |
| **Scenarios** | Write test conversations (what the caller says, what must be true afterwards), run them and see which fail. They are the draft's `tests`. Runs are **simulated** today (see below). |
| **Test** | Start a real conversation (`POST /sessions`, then LiveKit): chat, voice, camera/screen/picture input when the channel has it, and the forms the agent asks for. Only web chat and web voice channels can be tried here; a phone-only agent says so instead of failing. |

**Publish** (header) freezes the saved draft as a version. The dialog lists the validator's warnings first.

### The Simple view (the default)

The Config tab opens on four cards: **Instructions** (name, what it should do, what it says first, tone, style rules, and the prompt
preview), **Voice & Language** (main language and the others it speaks, its voice, the channels it talks on, the recording notice),
**AI Model** (provider and model for listening, thinking and speaking) and **Connections** (connections, tools and the secrets it
needs). A closed card sums itself up in one line; an open one shows the everyday settings; **Detailed settings** reveals everything the
configuration holds about that part (the ordinary form, limited to the right sections). Everything else (guardrails, events, after the
call, telephony…) is one click away under "Everything else". It edits the same draft as **All settings** and the JSON, so the three
always agree (`src/studio/simple/`).

### The preview beside the editor

An optional, collapsible panel beside the settings (the **Preview** button) lets you talk to the agent while you edit it, with its state
always visible: not started, connecting, live, reconnecting, ended, and errors with a way to retry. It talks to either the **real agent**
(a live conversation on the saved draft; it says so when you have unsaved edits) or a **simulated** one (made-up replies from simple
rules, using your current edits, no server). The two are never confused: the panel says which, and every simulated reply carries a
"Simulated" tag. Demo mode has no real agent, so it is simulated only (`src/studio/preview/`, `src/demo/simulatedAgent.js`).

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
  model, not the caller) and timeouts. Kinds the runtime can't run yet (task, MCP, knowledge, code) are marked in the **Add tool** menu.
- **Steps everywhere.** Wherever the schema asks for actions (a tool's effects, an agent's on-enter steps, an event's `do`, a transfer's
  before/closed/success/failure, what to do when a caller goes quiet, a form's submit, a task step, a notification failure, a wrap-up)
  they are numbered steps: pick what each does from a plain-language menu (say a line, have the model say something, change state, hand
  off, end the call, show a form, send a notification…), reorder, delete with Undo, and each step reads back as a sentence. A tool's
  effects are rules: each applies always or only when a condition holds. The details of a step are the ordinary form for that kind of
  action (`form/EffectsEditor.jsx`, `form/effects.js`).
- **Templates and prompts.** Text the runtime reads as a template (`{{state.x}}`, `{{args.x}}`, `{{const.x}}`, filters) is highlighted,
  has an **Insert a value** helper, and flags a name that points at nothing. Prompts show a word count, and each agent has a **Preview the prompt** panel that puts the persona, role, opening, rules, conditional blocks, channel addition and tools together in order. It is **approximate** (built in the browser from the fields as they are now; the runtime's own wording and ordering decide what the model really receives) and says so.
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
- **Remove from my list** hides the agent **in this browser only** (the API has no delete); hidden agents can be restored.

## The other pages

All pages read the same agent list (`src/studio/agents.js`): the API's agents, minus the ones you removed from your list.

| Page | What it does |
|---|---|
| **Overview**, search, workspace menu | Counts, rows and results come from the API. |
| **Sessions** | Lists the test conversations started from this browser's Test tab, with transcripts. Real calls aren't listed (the API doesn't expose them yet). |
| **Readiness checks** | Looks at an agent's saved draft or any published version against 12 everyday situations (`src/studio/scenarios.js`). No conversation is run and no call is placed. |
| **Voices** | "Use in an agent" puts the voice on that agent's draft, unsaved, for you to review. "Used by" is read from the agents' configurations. |
| **Integrations** | "Add to an agent" adds the saved connection to that agent's draft as an HTTP connection, unsaved. |
| **Telephony** | **A preview, not connected**: numbers, trunks and dispatch rules are kept in this browser and route nothing. The page, the dialogs and the SIP address say so. |
| **Settings** | Shows API status, counts, and what runs in each environment. |

Telephony, readiness-check runs, Sessions and Integrations details are **kept in this browser only** (the API has no
endpoints for them), so two people see different lists.

On a phone the sidebar opens from a menu button (`src/studio/MobileNav.jsx`).

Sections that wait on something not built yet say so where you work: **Tests** (nothing runs the scenarios), **Tasks** (the runtime
doesn't run multi-stage flows yet; the ordinary form edits them and a visual stage editor can follow) and **Telephony** (numbers are
not connected from the studio). A new agent's id can't be one the runtime reserves (`transcripts`, `metrics`, `logs`, `sessions`, `tmp`).

## Test scenarios

The configuration has a `tests` section: conversations to check, each with a channel, the caller's turns, and what must hold afterwards
(a tool was or wasn't called, a state variable ended up a certain way, something the agent said matches a pattern, or a criterion a
model would grade). The Scenarios tab writes them (into the draft, so they are saved and versioned with it), accepts pasted JSON,
runs them, records each outcome in this browser and shows failures with the reason and the conversation.

**Runs are simulated.** The runner plays each scenario against a simulated agent (simple rules), so a pass means the scenario is well
formed and can be met by the simulation, **not** that the real agent would pass; "a reviewer agrees that…" criteria are never checked.
The screen says so, labels every result with the runner that made it, and shows the real runner as unavailable: the API has no
endpoint that runs test scenarios yet. When it has, add a runner in `src/studio/scenarios/runner.js` with the same signature
(`src/studio/scenarios/`).

## Waiting for the API

These need endpoints that don't exist yet; the UI is honest about it and will use them when they do:

| Wanted | Today |
|---|---|
| Real phone numbers (a numbers page over `builder_api/sip.py`) | Telephony is labelled a preview. |
| An endpoint that runs test scenarios | The Scenarios tab runs them in a simulation and says so. |
| An AI assistant that drafts a configuration from a description | "Describe it" uses a rule-based demo assistant and says so. |
| `POST /preview-result`, `POST /preview-prompt` | The response panel works on a pasted sample in the browser; the prompt preview is an approximation built in the browser, not the runtime's exact prompt. |
| Call records and a live trace | Sessions lists only this browser's tests; the Test tab's log is client-side. |
| Archive/delete a bot | "Remove from my list" hides it locally. |
| `label` on channels and list items | Cards are titled by id. |
| A trusted identity header and roles | The proxy sets the identity; see docs/PRODUCTION.md. |
| The server blocking a production deploy over `severity: "security"` | The UI asks for a typed confirmation. |

## Layout

```
src/main.jsx, src/App.jsx   entry, sign-in state, error boundary
src/pages/                  one file per page: Landing, Login, Dashboard (the shell and Overview), Sessions, Readiness,
                            Telephony, Voices, Integrations; shared.jsx (sidebar pieces, dialogs), helpers.js
src/api/client.js           one function per API endpoint, error classification (JSDoc-typed)
src/api/types.js            JSDoc types of the API's answers; agentConfig.d.ts is generated from the schema
src/studio/                 the Agents area (list, workspace, Config, Versions, Deploy, Test)
src/studio/form/            schema engine, the form, and the tool / channel / message / template editors
src/studio/simple/          the Simple view (four cards) and the helpers that read and write it
src/studio/preview/         the preview beside the editor
src/studio/scenarios/       test scenarios: editing, the (simulated) runner, history
src/studio/models/          provider and model pickers, and the model catalogue
src/demo/                   demo mode: the imitation API, its validator, the simulated agent, the draft assistant
src/studio/test/            LiveKit session hook, Test tab, form prompt
e2e/                        the end-to-end smoke test and its mock API
scripts/                    sync-fixtures (refresh the schema), schemaTypes (generate the types)
tests/                      unit tests (node:test) and the schema/example fixtures
docs/PRODUCTION.md          how to run it for real: sign-in, proxy, identity
```

`jsconfig.json` gives editors type hints; a few pure modules opt in to checking with `// @ts-check`.

## Test and build

```bash
npm test          # unit tests (schema engine, references, presets, tools, templates, messages, starters, publish, demo API,
                  # scenarios, assistant, catalogue, drift ...) and component tests (tests/*.component.test.js: the real
                  # form and screens mounted in jsdom)
npm run build
npm run dev:demo   # the whole app with no backend (demo mode)
npm run e2e       # needs the dev server running: signs in, creates an agent from a starter, edits, saves, publishes,
                  # deploys to development and has a (mocked) test conversation. E2E_MODE=live uses a real local API.
npm run sync-fixtures   # fetch GET /schema and update every copy: the test fixture, public/config (the download) and the generated types
npm run sync-public     # propagate what is already in tests/fixtures to public/config and the types, without asking the server
npm run types           # regenerate src/api/agentConfig.d.ts from the fixture only
```

`tests/fixtures/` holds the schema the API served and the example config. `tests/schema-copies.test.js` fails when the public download, the generated types or a built `dist/config` copy differ from it (`npm run build` refreshes dist). `tests/schema-drift.test.js` fails when the
fixture differs from what the server serves (when `AGENT_BUILDER_URL` and a key are set), so the form engine's tests can't pass
against an old schema. The end-to-end test needs `playwright-core` (a dev dependency) and an installed Chrome or Edge
(or `E2E_BROWSER`); in the default `mock` mode no backend is needed. In `live` mode it **writes** (it creates an agent), so point it at a local API.

The component tests use `jsdom` (a dev dependency) and bundle the screens with esbuild (`tests/component/`).

`src/studio/form/Node.jsx` and the tool, channel and effects editors import each other (they render each other); that is fine because
the imports are only used while rendering.
