# Developer guide

How Weave Agent Studio is put together, where things live, and how to change it safely. Read this first; the README describes
what each feature does for the people who use it.

## What the app is

A web studio for building voice and chat agents on the Agent Builder API: create an agent, describe what it does, give it tools,
knowledge and channels, test it, publish versions and put them live, then watch its calls. It is a React single-page app with
no server of its own: it talks to the Agent Builder API through a small proxy that the dev server provides.

## Run it

Needs Node 22.15 or newer (the component tests need it; see `engines` in `package.json`).

```bash
npm install
npm run dev:demo   # the whole app with no backend: a fake API in the browser (demo mode)
npm run dev        # the real API, through the dev server's proxy (needs .env.local, see below)
```

Open the address Vite prints and sign in with any work email and password: the studio does not check passwords (who is signed
in is kept in the browser; `docs/PRODUCTION.md` says what goes in front of it for real).

**Settings for the real API** go in `.env.local` (copy `.env.example`; never commit it). The names:

| Name                                                           | What it is                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `AGENT_BUILDER_URL`                                            | the API's address                                                                    |
| `AGENT_BUILDER_API_KEY`                                        | the API key; the dev server adds it to each request, so it never reaches the browser |
| `AGENT_BUILDER_USER`                                           | optional: who the API records as the user, instead of the person signed in           |
| `ANTHROPIC_API_KEY`, `LLM_MODEL`, `LLM_MODELS`, `LLM_BASE_URL` | optional: the model behind "Describe it" (`llmRoute.js`)                             |
| `API_PASS_TARGETS`                                             | optional: the APIs Integrations may test through `/api-pass` (`apiPass.js`)          |
| `VITE_DEMO_MODE`                                               | `true` forces demo mode (`.env.demo`, used by `npm run dev:demo`)                    |

The proxy is in `vite.config.js`: the browser only ever calls `/api/...`, and the dev server forwards it with the key.

## Demo mode or the real API

`src/demo/` is a fake of the whole API (`demoApi.js`) that runs in the browser, with sample agents, calls, test runs and
knowledge. It is on in a demo build (`npm run dev:demo`) or when switched on in Settings (remembered in the browser);
`src/demo/demoMode.js` decides. Every screen still calls the same `api.*` functions; in demo mode they are answered by the fake.
When you add an API call, add its answer to `demoApi.js` too, or the demo breaks.

## The tools it is built with

| Library                | Used for                                                                                         | Where to look                        |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| React 19 + Vite        | the app and its dev server                                                                       | `src/main.jsx`, `vite.config.js`     |
| TypeScript (gradually) | `.ts`/`.tsx` files are checked strictly; `.js`/`.jsx` only where they opt in with `// @ts-check` | `tsconfig.json`                      |
| TanStack Query         | the data cache for reads that several pages share                                                | `src/api/queryClient.ts`             |
| Radix UI               | menus, pop-overs, dialogs, tabs, choice boxes, tooltips (keyboard and screen reader behaviour)   | the wrappers in `src/ui/`            |
| Zod                    | checking the API's answers                                                                       | `src/api/schemas.ts`                 |
| CodeMirror             | the JSON editor                                                                                  | `src/studio/json/CodeJsonEditor.tsx` |
| React Flow + dagre     | the Workflow canvas                                                                              | `src/studio/workflow/`               |
| dnd-kit                | dragging list items into order                                                                   | `src/ui/Sortable.jsx`                |
| cmdk                   | the search (Ctrl K)                                                                              | `src/pages/SearchPalette.jsx`        |
| Lucide                 | icons, chosen by name                                                                            | `src/ui/icons.js`, `src/ui/Icon.jsx` |
| Motion                 | movement: panels and dialogs sliding out, pages settling in, parts fading in, cards settling in  | `src/ui/motion.ts`                   |

## Where things live

```
src/
  main.jsx, App.jsx      start-up, sign-in state, the error boundary, the style and theme on <html>
  tokens.css … accents.css   the global look (see "Styles" below)
  api/                   client.ts (one function per API endpoint), queryClient.ts, schemas.ts, types.ts,
                         agentConfig.d.ts (generated from the schema: do not edit by hand)
  demo/                  the fake API for demo mode
  ui/                    shared parts used everywhere: Icon, Select, Tip, OneOf, Parts (tabs), dialogs (askConfirm),
                         Skeleton, Sortable, the style picker, scroll-edge fades
  pages/                 the workspace: Dashboard.jsx (the shell: sidebar, top bar, which page shows), Home, Calls
                         (Sessions.jsx), Voices, Integrations, Telephony, Settings, the search; helpers.js (the sidebar's
                         links and each page's address); shared.jsx (pieces the pages share); site/ (the public
                         site before sign-in, loaded on its own: Site.jsx, the product window in its hero HeroProduct.jsx, and
                         siteMotion.jsx, its Motion for React vocabulary); Login.jsx (sign-in and the first-time
                         profile, in the site's look: auth.css)
  studio/                the Agents area
    Studio.jsx           the list of agents or one agent, by the address
    AgentsPage.jsx       the list of agents and the Create dialog
    AgentWorkspace.jsx   one agent, open: its draft, test conversation and dialogs, handed to agent/AgentLayout.jsx
    agent/               one agent's screens: AgentLayout.jsx (what is drawn), the menu (AgentNav), the top bar,
                         pages.js (the agent's pages and where each setting lives), readiness.js (the steps to get
                         ready), detailed/ (Build › Detailed: the parts of building an agent, see below), pages/
                         (Overview, section pages), pickers/ (voice, language, model), blocks/ (the plain-words
                         models of Guardrails and After the call)
    form/                the settings form, built from the schema: FormEditor.jsx, Node.jsx (draws any part of the
                         schema), engine.js (reads the schema), plainLanguage.js (every label in plain words)
    simple/              helpers that read and write the everyday settings (simpleModel.js)
    pictures/            pictures the agent asks for (MEDIA_PROTOCOL.md, guide 7.1): pictureProtocol.js (the
                         agent-builder.ui messages and the open request), PictureRequest.jsx (the card in any test
                         conversation), PictureSteps.jsx + pictureSteps.js (the four picture steps in Build), measure.js
                         (sharpness and brightness, as the runtime measures them, for the simulated agent)
    workflow/, knowledge/, test/, scenarios/, calls/, trace/, release/, monitoring/, speed/, live/, insights/, ...
                         one folder per feature: its components, its logic (`*Model.js`) and its stylesheet
tests/                   unit and component tests (node:test; components are mounted in jsdom by tests/component/)
e2e/                     end-to-end scripts that drive a real browser (Playwright) against a running dev server
scripts/                 keep the schema copies in step (sync-fixtures, schemaTypes, schemaCopies)
docs/                    this guide, PRODUCTION.md, USABILITY_STUDY.md, COLLABORATION_API.md
mock-api/                mock bank services for the agents (cheques, cards, payments…): `npm run mock`, published on Vercel (see mock-api/README.md)
```

Note on names: the API calls an agent a "bot" (`/bots`, `botId`), and so does code that talks to it. The screens always say
"agent".

## How a screen is reached

1. `src/main.jsx` mounts `App.jsx`, which shows the landing page, sign-in, the first-time profile, or the dashboard.
2. `src/pages/Dashboard.jsx` is the shell for everything after sign-in: the sidebar, the top bar, the search and the page that
   is open. Each workspace page's code is loaded when it is first opened (`lazy`).
3. The address decides the page. Addresses are hash routes, so a link or a refresh keeps you where you were:
   - `#/home`, `#/calls`, `#/voices`, `#/telephony/numbers`, ... are workspace pages (`src/pages/helpers.js`).
   - `#/bots` is the list of agents; `#/bots/{id}/{page}` is one agent's page (`src/studio/route.js`). The agent's pages
     are listed in `src/studio/agent/pages.js`; old addresses still open the page that now holds them.
4. `#/bots...` hands over to `src/studio/Studio.jsx`, which shows `AgentsPage` or `AgentWorkspace`.

## The agent's configuration: one source of truth

An agent is a JSON configuration described by the API's schema (`GET /schema`; a copy is in
`tests/fixtures/agent-config.schema.json`, and its types in `src/api/agentConfig.d.ts`).

- `src/studio/useDraftEditor.js` holds the draft as JSON text. Every page reads the parsed value and writes back with
  `editor.setValue(next)`; saving, the "someone else saved" case and live validation (`POST /validate`) are handled there.
- The settings form (`studio/form/`) is generated from the schema, so a new field in the schema shows up without code.
  Labels and explanations come from `form/plainLanguage.js`; how fields are grouped from `form/layout.js`.
- The parts of Build › Detailed (`studio/agent/detailed/`) show the settings in plain words and write ordinary fields of
  the same configuration (through `studio/simple/simpleModel.js` and the other `*Model.js` setters), so the parts, the
  Guided view, the Workflow canvas, the form and the JSON always agree.
- Logic that does not draw anything lives in plain modules (`*Model.js`, `engine.js`, `readiness.js`...) with no React,
  so it is easy to read and is unit-tested directly.

### Build › Guided

The agent in nine steps, one at a time (`workspace/GuidedBuild.jsx`, styles in `workspace/guided.css`): the steps down
the left with each one's answer, the step in the middle with Back and Next, and "Your agent so far" on the right (its orb,
greeting, what it speaks, knows and can do, the checks, and how many steps are done). The last step lists every answer
with a way back to it. The step is in the address (`#/bots/<id>/build?step=voice`), changed with `replaceRoute`.

- What each step asks and where the draft stands on it is pure: `workspace/guidedSteps.js` (`GUIDED_STEPS`,
  `guidedSteps(config)` → `{ steps, todo, done, next }`), unit-tested in `tests/guidedSteps.test.js`.
- Every control writes through the same setters as the Detailed parts (`simpleModel.js`, `setupActions.js`,
  `guardrailModel.js`, `afterCallModel.js`, `workflowOps.addSubagent`), so Guided never asks anything in its own way.
  Each step links to its Detailed part for every other setting.

### Build › Detailed

Each part of building an agent (Agent, Conversation, Knowledge, Tools, Connections, Channels, Subagents and hand-overs,
Guardrails, After the call, Engine and details; the Workflow canvas is its own page) is a plain object in
`detailed/parts/<name>Part.jsx`, drawn by `detailed/Detailed.jsx`:

- **A part** is `{ id, num, title, question, cols: [[card…], [card…]] }`; its `id` is the page id in `pages.js`.
- **A card** is `{ id, title, lead?, rows, adv? }`. `adv` rows fold under "Advanced". A card can hold a **list** of the
  draft (`list: { id, path, label, nameOf, add? or renderAdd? }`), shown as chips; a card with `of: <listId>` is the chosen
  item's card, and works its rows out with `rowsFor(ctx)` from `ctx.chosen(listId).base`. The chosen item is kept in the
  address (`?item=list:key`), so a link, "show me" and a reload open the same one.
- **A row** is either a place in the draft (`path`, or `pathFor(config)` when it depends on the draft) or a pair of
  `get(config)` / `put(config, value)` that call the existing setters. Its kind (text, number, switch, choice…), its
  choices, its default and whether it is required come from the schema (`detailed/schemaFacts.js`), unless the row says
  otherwise. Choices that point at another part (a transfer's business hours, a hand-over's agent) are read from the
  draft, never typed in.
- **The header counts** (fields, required, under Advanced) are worked out from the spec and the schema.
- **Deleting** an item asks first when something points at it (`form/references.js`), takes those pointers out, and offers
  Undo. **Problems** show under their row; "show me" and the search bring the row into view by its `data-field` or
  `data-path`.

**A part with its own workspace.** Agent, Conversation, Knowledge, Tools, Connections and Channels set `render(ctx)` on
their part, so they open on a page of their own instead of the cards. The pages work the same way:

- a sentence whose bold parts open small editors in place;
- chapters of lines that open under themselves;
- the less-used settings under "N more settings", which names them;
- a switch to "All settings", which shows the part's own cards with every fold open, plus a search box. "/" (or the
  "find a setting" hint beside the switch) opens it with the search box ready to type in.

The pieces are shared in `detailed/workspaceKit.jsx`. Each person's choice of view is remembered by
`detailed/workspaceView.js`. Every editor in a workspace is one of the part's own rows (`DetailedRow`), so a setting is
the same control, saved in the same place, wherever it shows.

- **Agent:** `detailed/agentProfile/` (the agent as a profile).
- **Conversation:** `detailed/conversationView/`.
  - `ConversationWorkspace.jsx` is the page, "The call", in one format for every agent. A part not set yet is a blank to
    click and fill. An agent that only chats is told which parts take effect once a voice channel is on.
  - `CallDrawing.jsx` draws an example call from the agent's own settings, and lights the moment an open editor shapes.
  - `RememberSheet.jsx` is "What it remembers": every detail in a table (kind, how it starts, kept secret), searched and
    filtered by kind, with one editor card beside it ("A new detail", or the one chosen). `rememberWords.js` is pure:
    the plain words and its writes to `state.variables`.
  - `conversationEditors.jsx` holds the part's own editors, used as rows: how long it waits, the quiet-caller script, and
    the retries per service.
  - `conversationWords.js` is pure: the plain words, and those editors' writes.
  - `conversationLayout.js` says where each row shows. A test checks that every row has exactly one place.
- **Knowledge:** `detailed/knowledgeWorkspace/`.
  - `KnowledgeWorkspace.jsx` is the page, "What it knows".
    - **The sentence:** what it answers from, when it searches, how many passages.
    - **The shelf:** the index row and every document and page, drawn by `parts/KnowledgeIndex.jsx`.
    - **Three chapters:** what it reads, how it searches, try it.
  - `knowledgeEditors.jsx` holds "When it searches" (two ways) and "How close a match" (a line on the score scale).
  - `lastSearch.js` keeps the passages the last try-out found, so the scale can place them.
  - `knowledgeWords.js` is pure (the plain words); `knowledgeLayout.js` says where each row shows.
- **Tools:** `detailed/toolsWorkspace/`.
  - `ToolsWorkspace.jsx` is the page, "What it can do".
    - **The sentence:** the quick abilities that are on, the tools of its own, and "Not yet:" blanks for the others.
      Each ability opens its switch and details in place.
    - **The tiles:** one per ability and tool, saying only its state; the switches live once, on the chapter's lines.
    - **Three chapters:** quick abilities, your tools (with "Add a tool" by what it does, from `useAddChoices` in
      `AddItem.jsx`), try it (`parts/ToolTry.jsx`).
  - `ToolPage.jsx` opens one tool as the steps of one run (asked for, may it run, the call, what comes back, then, if it
    fails), with the tool card's own rows. Its address is `?item=tools:<id>`, so a link or a reload opens the same tool.
  - `toolsWords.js` is pure (the plain words, and each step in a few words); `toolsLayout.js` says where each row shows.
- **Connections:** `detailed/connectionsWorkspace/`, designed for any agent and any use case.
  - `ConnectionsWorkspace.jsx` is the page, "What it reaches".
    - **The sentence:** the systems it reaches, where it passes callers on, and the forms, messages and tasks it has;
      what it has none of is a grey blank after "Not yet:". Each part opens the list of its kind, with the way to add one.
    - **The picture:** `ReachMap.jsx` draws the agent, what reaches out (tools, transfers, forms, messages, tasks,
      reactions, a search service) and the systems they reach, the busiest first; the lines are measured from the nodes.
    - **Three chapters:** systems it reaches (search and filters once there are many; "Add a system" runs the guided
      steps on the page: `AddConnectionSteps`), passing callers on (with the agent's phone system), what it shows and sends.
  - `ItemPage.jsx` opens one item on a page of its own, in the sections `connectionsLayout.js` names: a system (with
    what uses it), a transfer as the path of the call, a form beside a preview of it, a message, a task. Rows that don't
    apply to the item's kind are left out; a long list of steps reads as one line until opened. Its address is
    `?item=<list>:<id>`.
  - `SignIn.jsx` is the "Sign-in" row: no sign-in, a token, a key in a header, a username and password; only a secret's
    name is saved.
  - `connectionsWords.js` is pure (the plain words, what reaches what, a transfer's path).
- **Channels:** `detailed/channelsWorkspace/`, designed for any agent and any use case.
  - `ChannelsWorkspace.jsx` is the page, "How people reach it".
    - **The sentence:** the ways in that are on, the working ones that aren't as grey blanks after "Not yet:" (each
      opens the part's own switches, `ReachPills`), when its team is in, and how it knows who is calling.
    - **The pictures:** `ChannelPictures.jsx` draws a door per way in (first words, what it carries, what it can do) and
      the week of a set of hours, with "open now" by that schedule's own clock.
    - **Three chapters:** ways in, when your team is in, who is calling.
  - `ChannelPage.jsx` opens a way in (its On switch at the top, what doesn't fit it first) or a set of hours on a page of
    its own, in the sections `channelsLayout.js` names. Its address is `?item=<list>:<key>`.
  - `channelEditors.jsx` holds the part's own editors, used as rows in both views: what a way in carries (only what its
    kind may carry, never none), a week of hours, and closed days.
  - `channelsWords.js` is pure. Hours don't close a channel: a schedule is read by a transfer and by steps that check it.
- **Subagents and hand-overs:** `detailed/subagentsWorkspace/`, designed for any agent and any use case. It edits the
  same draft the Workflow canvas draws; the canvas itself is not changed.
  - `SubagentsWorkspace.jsx` is the page, "Who answers".
    - **The sentence:** who answers first (its own setting, in place), who it passes callers to, how many can send them
      back, and who is beyond this agent (another agent's number, a person). One agent alone reads "answers every call
      itself", with grey blanks after "Not yet:".
    - **A notice** when agents are missing the hand-over rules (`handoffRules.js`), with the button that adds them.
    - **The picture:** `RelayMap.jsx` draws the first agent, up to six subagents and who is beyond; a line per hand-over,
      dashed lines for the ways back, and a line leaving the agent over the top. The lines are measured from the nodes.
    - **Three chapters:** its agents (search and filter once there are many), hand-overs (with "Add a hand-over" by
      where the caller should go, and "Try a line"), coming back and limits (only with subagents).
  - `SubagentPage.jsx` opens an agent, a hand-over (its path: when, while it hands over, who takes over) or a
    hand-over to another agent on a page of its own, in the sections `subagentsLayout.js` names. An agent's page also has
    its way back (the back card's switch for that agent). Its address is `?item=<list>:<key>`.
  - All settings keeps the part's strip of hand-overs (`form.top`), which chooses the hand-over cards' item.
  - `subagentsWords.js` is pure. A new subagent's starting words (`DEFAULT_ROLE`) count as no job yet.
- **Guardrails:** `detailed/guardrailsWorkspace/`, designed for any agent and any use case.
  - `GuardrailsWorkspace.jsx` is the page, "What it guards".
    - **The sentence:** what it checks before it hears a caller and before it speaks, the topics it keeps to, when it
      hands over or ends, its own rules and its longest call; what is not set is a grey blank after "Not yet:".
    - **The picture:** `CallPath.jsx` draws the path of one line: the caller, the checks on what callers say, the agent,
      the checks on what it says, and what the caller hears; under it, what watches the whole call (moments, rules of its
      own, limits). Every check says what really happens to it: checked every time, told to the agent, or kept but not
      run yet.
    - **Three chapters:** checks (search and filters once there are many; "Add a check" by which words it checks, then
      by kind, from `useAddChoices`), topics and when to hand over or end, limits ("Most moves between agents" points to
      Subagents through `ctx.goPart`).
  - `GuardrailPage.jsx` opens a check or a rule of its own on a page of its own, in the sections
    `guardrailsLayout.js` names. Renaming a check (its id) on its page keeps the page on it and moves the address.
  - `guardrailsWords.js` is pure. What is not run comes from the server's report (`unsupported`); before it has answered,
    the guide's list stands in (topics, escalation, checks on what it says other than a rule in words). `gapOf` names
    what a check plainly lacks (no kinds, patterns, fields or words; blocking in silence on a voice agent), since the
    demo validator does not check the schema's minimums.
  - In the part, checks on what the agent says are a list with the same rows as those on what callers say (ids end in
    `Out`), and a rule of its own is a list card (`rules`) with real rows instead of a raw form.
- **After the call:** `detailed/afterCallWorkspace/`, designed for any agent and any use case.
  - `AfterCallWorkspace.jsx` is the page, "After a call".
    - **The sentence:** what it writes when a call ends (a summary, answers to questions), what it keeps and for how
      long, what it hides, and how a call closes; a summary, questions and hiding are grey blanks after "Not yet:".
    - **The picture:** `CallRecord.jsx` draws one call's record as these settings keep it (its summary, the answers to
      its questions, what was said with the hidden details replaced), beside what it keeps (with bars for the days) and
      what it hides. It is built from the settings, never a real call. A dot says what really happens: done after
      every call, kept but not done by the server yet, off, or needs a look.
    - **Three chapters:** how it closes and what it writes (each question opens in place on its own line, its row
      `questions.q<index>`), what it keeps, what it hides. Lines stay in their order; one that needs a look says so
      where it is, so a line being typed in never moves.
  - `afterCallWords.js` is pure. What is not done comes from the server's report; before it has answered, the guide's
    list stands in (summaries, questions, keeping the audio and transcript). The log of each call is on unless switched
    off; the exact values of secret variables are hidden even with no hiding set up.
  - Metrics, the log level and tracing moved to Engine and details (`locate` sends those paths there); logging
    personal details and full model requests stay here, as privacy settings.
- **Engine and details:** `detailed/engineWorkspace/`, designed for any agent and any use case.
  - `EngineWorkspace.jsx` is the page, "Its details". The page's "Edit as JSON" (`ctx.actions`) stays beside the view
    switch in both views.
    - **The sentence:** its id, version and status, the environment it is meant for, the engine, where models come from,
      its time zone, where secrets are found, its fixed values and the studio's checks. Its name, description and tags
      stay on Build › Agent.
    - **The picture:** `Nameplate.jsx`, each detail with who sets it (a lock on the id, the version and the status), the
      time there now for its time zone, how it hangs up, then its fixed values with how many places use each.
    - **Three chapters:** who it is (Copy the id; "Release" opens Release through `ctx.goPart`), how it runs (the
      worker and the old dispatch name under "more"), fixed values, checks and logging (a rotating log file under
      "more", said not to be applied yet).
  - `ConstantsTable.jsx` is the fixed values' row in both views: a table edited in place. A number stays a number, and
    a name is written only once the schema takes it (lower case, digits and _), so a half-typed name never makes the
    draft invalid.
  - `engineWords.js` is pure. The logs card gained the OpenTelemetry export (on, collector address, service name).
- **Images & Videos:** `detailed/mediaWorkspace/`, designed for any agent and any use case.
  - `MediaWorkspace.jsx` is the page, "Its pictures".
    - **The sentence:** which ways in take photos and the camera, what it asks for and where, what it reads and with
      which model, what it compares, what it forgets, and how picky the checks are; grey blanks after "Not yet:".
    - **The picture:** `Journey.jsx`, one picture's journey: a lane per picture (the value a request keeps it in; a
      request asked again joins its lane), asked → checked in code → read by the AI, meeting where they are compared
      and forgotten. A missing station is dashed and adds a step.
    - **Three chapters:** where pictures come in (each way in and each agent's way of seeing open in place), what it
      asks for and how it checks (steps grouped by where they run, filters once there are more than 8; "how picky" for
      all at once; "Add a picture step"), privacy, honesty and trying it (forgetting with a one-click fix, the pictures
      to try with and your camera, live, each on a page).
  - `StepPage.jsx` opens a picture step on a page of its own (`?item=requests|reads|compares|forgets:<path>`), in the
    sections `mediaLayout.js` names. A reading offers "Add a second reading" (`addSecondReading`).
  - `pictureEditors.jsx` holds the part's own editors, rows in both views: how picky (reuses `PictureSteps.jsx`'s
    strictness and sharpness scale), which pictures, the details table, the pairs table and its try-out (the demo's
    `compareValues`, the server's rules), how picky for all, and adding a step or a starting point.
  - `pictureRecipes.js` is pure: the four starting points (ask, read, forget, with their values declared; the website
    ways in are let to take that picture), the second reading, `markSeeing`, `forgetKept`.
  - `mediaWords.js` is pure. Picture steps run on the server; an agent's `vision` is kept but not run (its report, else
    the guide's list).
  - One place each: photos, the camera and the picture details of a way in moved here from Channels (its "What it
    carries" now offers typing and talking, and says pictures with a link here); an agent's `vision` moved here from
    Subagents. `locate` sends `channels[].inputs` and `agents.items[].vision` here.
- The old "At a glance" tiles (`Glance.jsx`) were removed: every part now has its own workspace.

`tests/detailed.component.test.js` checks every part: each row names a place the schema has, no setting is a row of two
parts, ids are unique, and the parts write the draft and point at each other's lists.

Some cards carry a whole panel as their `body(ctx, entry)` instead of rows, or a row draws one with `render`:

- **Knowledge** (guide 10.2): `parts/KnowledgeIndex.jsx` is the "Search index" row (its state from
  `knowledge/model.js` `readingState`, Build now or Save and build, the build followed with `useBuilds` until it ends,
  then the knowledge read again) and "What it has read" (each file and page as a card with its state and fix; × asks
  whether to delete the file too, and a 409 from the server is explained before `?force=true` is sent).
  `parts/KnowledgeSearch.jsx` is "Try a search": any base, a follow-up's reply before, every passage on one 0-to-1 scale
  with the saved `min_score` line and a what-if line that saves nothing. The pure helpers (`docBase`, `buildStep`,
  `canSearch`, `searchProblem`) are in `parts/knowledgeView.js`; styles in `parts/knowledge.css`.
- **Tools** (guide 10.1): `parts/ToolTry.jsx` is the chosen tool's "Try it" card (`POST /preview/result`): sample
  arguments and a pasted answer in; the request, whether it may run, and the answer split three ways out. Nothing is
  called. Styles in `parts/toolTry.css`.

Elsewhere from the same round: Monitor › Calls has "Choose dates…" (`calls/DateRange.jsx`, the days worked out by
`callModel.js` `datesQuery`, `since` and `until` sent to the server), and Preview prompt has a chip per agent
(`form/WhatIfBar.jsx` `AgentChips`). `tests/section10.test.js`, `tests/knowledge10.component.test.js` and
`npm run e2e:section10` check them.

## Styles

Plain CSS, no CSS framework.

- **Global look**, loaded in this order by `src/main.jsx`: `tokens.css` (colours of both themes, type scale, spacing),
  `styles.css` (the base rules), `appLook.css` (the Simple style), `saas.css` (the product finish: controls, cards, badges),
  `themes.css` (the other five styles, each in light and dark), `accents.css` (each style's colour options).
  Later files override earlier ones, so to change a look, find the last rule that applies.
- **Feature styles** sit next to their components (`studio/calls/calls.css`...). Most are imported from
  `pages/Dashboard.jsx` in one fixed order, so the order does not depend on which page was opened first; the few that belong
  to code loaded later (the Workflow canvas, Knowledge, the test panel...) are imported by that code.
- **Six styles** (Simple, Professional, Calm, Premium, Futuristic, Vibrant) are chosen by `data-style` on `<html>`, and the
  theme by `data-theme` (light or dark). A change to the look must be checked in all of them.
- **Class names** start with a short prefix for their feature: `st` the agents area, `nl` an agent's pages (from the folder's
  old name), `wf` workflow, `su` setup, `sc` scenarios, `cs` speed, `kw` knowledge, `in` alerts and questions, `lv` live,
  `mn` monitoring, `tm` team, `rp` replay, `rl` relations, `vx` validation, `pv` preview, `pk` pickers, `as` the assistant,
  `dt` Build › Detailed.
- **Sizes and colours** come from tokens (`--fs-md`, `--accent`, `--line`...), never from bare numbers; a test checks that
  every font size is one of the scale's.

## The rules the code follows

- **Comments say why**, in plain sentences. A file starts with what it is for; a function's comment says what it is for and
  what its arguments mean.
- **Plain words on screen**: sentence case, no technical terms where a plain one exists (`form/plainLanguage.js`).
- **One strong (ink) button per view**; the rest are quiet.
- **Ask in the studio's own dialog** (`askConfirm`, `showNotice` in `ui/dialogs.js`), never `window.confirm` or `alert`.
- **Keyboard and screen readers**: menus and pop-overs use the Radix wrappers in `src/ui/`; a dialog keeps the keyboard
  (`FocusBox`, `useDialogFocus`) and gives it back when it closes. `e2e/a11y.mjs` checks the main screens with axe.
- **Nothing is cut off**: text wraps or the box scrolls; scroll areas fade at the edge that has more (`ui/scrollEdges.js`).
  `e2e/fit.mjs` checks it.
- **Each input is asked in one place**: a setting has one home page; other places show it and link there.
- **Icons by name**: add a Lucide icon to `src/ui/icons.js` and use `<Icon name="..." />`.
- **Movement goes through `ui/motion.ts`**: `exitThen` for a panel's way out (Escape, the shade, its close button),
  `useSettleOnChange` for a new page (its blocks settle in one after another), `useFadeOnChange` for content that
  changes in place, `useRiseInOnce` for a list's first showing. Openings stay in CSS. The chosen item's highlight in
  tab rows, switches and side lists slides on its own (`ui/slideMarks.ts`, watching from the shell): a new row of that
  kind joins by adding its class to `GROUPS` there.
  Nothing moves for reduced motion or in the unit tests, and a panel whose screen has already gone is not closed again.
  An e2e step that closes something and moves on waits for it to go (`e2e/a11y.mjs`).

## Common changes

- **A new workspace page**: add it to the sidebar list in `src/pages/helpers.js` (its id, label, icon and address), then
  show it in `pages/Dashboard.jsx` where the other pages are chosen, loaded with `lazy` like them.
- **A new page of an agent**: add it to `PAGE_GROUPS` in `src/studio/agent/pages.js`, then draw it in
  `studio/agent/AgentLayout.jsx`. A new part of Build › Detailed is a spec in `detailed/parts/` (see above), drawn with
  `<DetailedPage part={…} editor={editor} />`; give it a hue in `workspace/look.js`, a line in `buildSections.js`, and
  the sections it holds in `PAGE_SECTIONS`, so `locate` sends its settings there.
- **A new setting on a part**: add a row with its `path`; the schema gives it its kind, choices and label.
- **A label or explanation of a setting**: `src/studio/form/plainLanguage.js`.
- **A new API call**: add the function to `src/api/client.ts`, its answer to `src/demo/demoApi.js`, and (when its answer is
  checked) a schema to `src/api/schemas.ts`.
- **A new colour or size**: add a token to `tokens.css` and give it a value in each style in `themes.css`.

## Check your change

```bash
npm run check          # lint (ESLint with SonarJS rules), types (tsc) and all unit and component tests
npm run format:check   # Prettier (npm run format fixes it)
npm run build
```

End-to-end scripts drive Microsoft Edge or Chrome against a running dev server; most expect the demo one:

```bash
npm run dev:demo      # in one terminal
npm run e2e:setup     # in another (each e2e:* script is in package.json; E2E_BASE if the server is not on :5173)
```

Set `E2E_BROWSER` to the browser's path if it is not found. `npm run e2e` (the smoke test) runs against a mocked API by
default; `E2E_MODE=live` points it at a real API and creates and deploys an agent there, so only use that against a
test server.

The scripts sign in by typing a made-up email and password. Sign-in is checked against a credentials file
(`authRoute.js`): `npm run dev:demo` reads `e2e/credentials.txt`, which lists those test logins (`.env.demo` points
at it), and `npm run dev` reads `credentials.txt`. A new script signing in with a new login adds it to
`e2e/credentials.txt`. The smoke test takes `E2E_EMAIL` and `E2E_PASSWORD` for the `npm run dev` case.

## Good to know

- **Kept in the browser**: workspaces, test sessions, the Telephony pages (a local mock: nothing reaches a phone system),
  integration details and preferences (`studio/usePref.js`). Clearing the site's data clears them.
- **Generated file**: `src/api/agentConfig.d.ts` is made from the schema (`npm run types`); do not edit it by hand.
- **Schema copies**: the schema lives in `tests/fixtures`, `public/config` (the download on the landing page) and the types.
  `npm run sync-fixtures` refreshes all of them from the API; a test fails when they drift apart.
