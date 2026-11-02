# Review of the Weave React Agent Studio, round 2

For: the React developer. Written 2026-10-14, after the first review (`UI_REVIEW.md` of the same day) was acted on.
This file **replaces** the first one: everything you finished is now one table (section 1), and the rest is what is
still open or new. It has two tracks:

- **Track A, fix and connect (sections 1 to 8):** bugs found by running the studio on six different bots, and the new backend features the studio does not use yet.
- **Track B, product direction (sections 9 to 11):** the product owner's brief, **"simple to start, powerful when needed"**: progressive disclosure, a task-based structure, plain language, relationship views, searchable pickers, actionable errors and a polished enterprise look. It is assessed against the real app, turned into work packages with acceptance measures, and merged with Track A into one plan (section 11). **Start with section 9.1.**

Priorities: **P0** = wrong or misleading now, fix first. **P1** = clearly improves the product. **P2** = polish.
Sizes (S/M/L) are rough.

## How this was checked (so you know what to trust)

I copied your project to a scratch folder, ran `npm install` there, and did **not** touch your folder.

| What I did | Result |
|---|---|
| `npm test` | 204 pass, 2 skipped. **2 suites could not run** here: `node.component.test.js` and `screens.component.test.js` crash on import (`jsdom@30` needs Node 22.14 or newer, this machine has 22.13.1). That is my machine, not your code, but see 5.3. |
| `npm run build` | Passes. Main chunk 737 kB, `livekit-client` 587 kB (see 5.5). |
| Your `npm run e2e` in **live** mode against a real local API | Sign-in, create from a starter, edit, save, publish, deploy all PASS. The last step (a test conversation) fails only because my local API has no LiveKit keys; the UI said so clearly. The script also fails on an **empty** server (see 5.2). |
| The studio in a real browser (Playwright, Chrome) against a real local API holding **six structurally different bots** (see "Is any of this specific to one bot?" below) | Agents list, Simple view, All settings, every form section of every bot with everything expanded, Tools list, an HTTP tool, the response panel, Scenarios (run and edit), Deploy (production gate), AI Model card, Sessions, Telephony, Overview, Voices, a phone-width viewport. No console errors anywhere. |
| What your code produces, fed to the real validator | All 7 starters: 0 errors, 0 warnings. All channel presets: see 5.1. Renaming each of 128 ids and map keys (two bots), one at a time, with your `renameEverywhere`: the validator found **nothing worse** in every case. |
| Your hand-copied logic against the server, over every bot and every agent | The path grammar and the prompt preview disagree with the runtime in most cases (2.1, 3.2). |
| Typing speed with a big bot fully expanded | Gets slower as bots grow (5.6). |

**Not checked** (needs a LiveKit server or was not reached): a live Test conversation, voice, forms in the Test tab,
the Versions diff, the Create dialog's "Describe it", the Integrations, Settings and Readiness pages in detail, and
the two component test suites above.

## Is any of this specific to one bot? No

The studio is an enterprise builder for **any** bot, so every finding below was checked on more than one. The six configs
that exist today differ a lot, and all six are valid in the real API:

| Bot | Shape |
|---|---|
| `acme-support` (the generic example) | phone and web chat, 4 agents, 14 tools including MCP, knowledge and task tools |
| `nigeria-energy-bot` (a real production-style bot) | phone and web chat, 7 agents, 21 tools |
| `aira-website-bot` (a real bot) | web chat only, 1 agent, 3 built-in tools, no HTTP |
| `voice-bot-example` | web voice and phone, 2 agents, 1 tool |
| `nimbus-care` | 6 agents, 27 tools of every kind, 7 scenarios (the biggest; used for most screenshots) |
| `card-activation` | schema 1.2, typed task steps, sensitive variables, 6 security items |

I opened every section of every bot, expanded everything, and counted the red marks the studio draws on a config the server
calls **valid**. On a valid config every such mark is a false alarm.

| Bot | False "required, not set" tags | Inputs marked invalid | Red messages |
|---|---|---|---|
| `acme-support` | 5 | 15 | 17 |
| `nigeria-energy-bot` | 14 | 58 | 63 |
| `aira-website-bot` | 0 | 0 | 0 |
| `voice-bot-example` | 0 | 0 | 0 |
| `nimbus-care` | 15 | 61 | 75 |
| `card-activation` | 4 | 9 | 9 |

So the bugs in section 2 hit **every bot that has HTTP tools or typed task steps**, not one example. Bots without them are clean.
Nothing in section 3 (the new backend features) depends on a bot's domain, language or tools either: a test run, a call record, a knowledge
index and a preview exist for any config. Where I give a number from Nimbus it is only because it is the largest.

Between them they use schedules, post-call settings, guardrails, forms, notifications and knowledge, and three languages
(English, Spanish, Nigerian Pidgin). What they do **not** cover, so what I could not test: WhatsApp, SMS and email channels (only
phone, web chat and web voice appear), non-Latin or right-to-left languages, realtime speech-to-speech models, MCP and code tools
actually running (the runtime does not run them yet), and bots with hundreds of tools or agents. The form is generated from the
schema, so these should render, but the hand-written editors (tools, channels, effects, conditions) are where a bot with an
unusual shape would break first. Section 7 lists what to add so those are caught by a test and not by a customer.

---

## 1. First review: what is done (verified)

Nothing here needs more work unless a note says so.

| First-review item | State | Evidence |
|---|---|---|
| 1.1 Sign-in and the proxy giving everyone the key | **Done as far as the app can.** The proxy drops the browser's `X-User` and sets its own; the login says it is a demo; `docs/PRODUCTION.md` explains the real setup. | `vite.config.js`, `api/client.js`. Production still needs the real SSO proxy (an ops task, see 6). |
| 1.2 Providers the runtime cannot run | **Done.** Pickers come from `GET /providers`; a provider with no plugin is disabled; a missing key is flagged per stage. | Seen live: "The server doesn't have OPENAI_API_KEY set". |
| 1.3 "More settings" that did nothing | **Done.** Removed. | No `legacy_settings` anywhere in `src`. |
| 1.4 Telephony as a mock | **Done (honestly labelled).** "PREVIEW, NOT CONNECTED" at the top. Real numbers still need a backend endpoint (6). | Seen live. |
| 1.5 JSON view hides repeated keys | **Done.** Typed a repeated key: headline "A key is repeated", the path is shown, Save is disabled, Publish refuses. | Seen live. |
| 1.6 Security-severity items | **Done.** Red panel in Config, in "What will happen if you deploy this version", and in Publish; production needs the typed word. | Seen live on `card-activation` (6 items, button disabled until "production" is typed). The gate is only in the browser (6). |
| 2.1 Ids: rename and delete safely | **Done and solid.** | 128 renames, 0 regressions (above). |
| 2.2, 2.3 Channel presets, fields per type | **Done.** One gap: 5.1. | |
| 3.1 Unsupported tool kinds marked | **Done, but one entry is now stale:** 4.4. | |
| 3.2 Parameter builder, "What the model sees" | **Done.** | Seen live. |
| 3.3 Request editor, call preview, `{{args.x}}` chips, credential warning | **Done.** | Seen live: `CALL GET http://localhost:8200/orders/{{args.order_id}}`. |
| 3.4 Response panel with a pasted sample | **Done, but it has two bugs:** 2.1 and 2.2. | |
| 3.5, 3.6, 3.7 Advice on errors, timeouts, descriptions, built-ins, "not used by any agent" | **Done.** | |
| 4 Starters set inactivity, recording notice, callback tool | **Done.** | All 7 validate with 0 errors and 0 warnings. |
| 4 Template highlighting and "Insert a value", `x-ui` hints, `sensitive` shield, messages per language | **Done** (read in code and the README; I did not test the shield or languages in the browser). | |
| 5 Bots list filter, "Simulations" renamed "Readiness checks", Rollback shortcut, schema sync script | **Done.** | `npm run sync-fixtures` exists; see 5.4. |
| 6 Dead code, `main.jsx` split, `.gitignore`, types, e2e test, component tests | **Done.** `main.jsx` is 10 lines; pages are under `src/pages/`. | |
| New: demo mode (`npm run dev:demo`) | Good and clearly labelled. Keep it out of production builds (5.5). | |

---

## 2. Bugs found by running it

### 2.1 P1, S: the response panel calls valid paths wrong and previews nothing
The runtime accepts **bare field names** in `result.to_llm` (`"found"`) as well as `"$.found"`
(`agent_runtime/toolspec.py: shown_to_llm`), and **every bot we have uses bare names**. I fed all 138 result paths of the four
bots with HTTP tools to your `validatePath` and to the runtime's own parser: **the studio wrongly rejects 117 of 138 (85%)**
(`acme-support` 13 of 17, `nigeria-energy-bot` 54 of 59, `nimbus-care` 45 of 57, `card-activation` 5 of 5). Every one is a `to_llm`
or `out_of_band.fields` entry; the `to_state` paths, which start with `$.`, are all fine. On `find_order` your panel:
- shows a **red error** "A path starts with $" under `found` and `summary` on the `find_order` tool, a tool that validates and publishes;
- after pasting a sample response, says **"What the model would see: {}. Not found in the sample: found, summary"**. The real
  answer for the same sample, from `POST /preview/result`, is `{'found': True, 'summary': 'Order NB-1003, shipped'}`.

Cause: `form/jsonPaths.js: parsePath` requires a leading `$`. Fix: treat `name` as `$.name` (the runtime does the same).
It also rejects `$.a-b` (a hyphen after a dot) with advice to use brackets, while the runtime accepts it; harmless, but
another sign that the grammar is copied by hand. **The better fix is section 3.2**: stop re-implementing the grammar and
ask the server.

### 2.2 P1, S: "required, not set" on fields that are optional
`form/Node.jsx:324`: a missing object is always drawn with a red **"required, not set"** tag. `ToolBody.jsx:110` passes
`missing` for `result.out_of_band`, which is optional (the schema's `result` has no `required`; only the fields *inside*
`out_of_band` are required once it exists). Every HTTP tool without direct delivery shows a pink alarm box: 5 on
`acme-support`, 14 on `nigeria-energy-bot`, 15 on `nimbus-care`, 4 on `card-activation`.
Fix: show the tag only when `required` is true; otherwise a plain "＋ Set …" button.

### 2.3 P0, M: the Scenarios tab gives wrong verdicts and refuses to save valid scenarios
This applies to any scenario that uses the newer fields, in any bot. The one I tried: `nimbus-care` has four scripted
scenarios the **real runner passes** (I ran `POST /bots/nimbus-care/tests/run`: all four passed in seconds). In the studio:
- `a_hazard_reaches_the_emergency_line` shows **Failed** in the simulated run, with "Unknown kind of expectation" twice
  and "ticket_id is null, expected TK-5001". An author would try to fix a bot that is fine.
- Opening it for edit shows "Choose what to check…" for those two expectations, and **Save is blocked** ("Expectation 1:
  choose what to check"). So any scenario using the newer expectations cannot be edited in the form.
- The form knows five expectation kinds. The backend now has nine: `tool_called_with`, `agent_is`, `http_called` (with
  `times`), `http_not_called`, plus the old five. Scenarios also gained `description`, `now`, `state`, `http_mocks`
  and `model_script`; the editor shows none of them. (Saving would keep them, because `ScenarioForm` spreads the old
  object: read in the code, not tested, since these scenarios cannot be saved from the form at all.)

This is what section 3.1 replaces. Until then, at minimum: do not mark a scenario red for a kind you do not know, show
it as "not checked here", and let Save through.

### 2.4 P1, S: valid template names are flagged as unknown
The server accepts these configs, but the template checker in the form draws red **"“x” isn't something a template can read. Use state,
const, args, result…"** on names that are correct **where they sit**: 32 times on `nimbus-care` (20 different names) and 4 times on
`card-activation`. Where each one is used (found by searching the config):
- `{{value}}`: the answer just collected, in a task step's `validate.args`;
- `{{with.name}}`, `{{with.phone}}`, `{{with.ticket_id}}` and others: the details a **notification** is given, in its subject, body and failure message;
- `{{pbx.host}}`, `{{pbx.transport}}`, `{{target}}`: in a **transfer's address template**;
- `{{error}}`, `{{reason}}`, `{{tool}}`, `{{transfer}}`, `{{from}}`, `{{to}}`: in an **event's** `do` messages, where the event supplies them;
- `{{link}}`, `{{order_id}}`: in a tool's **direct-delivery template** (`result.out_of_band`).

So which names exist depends on the **place** in the config. The list is hard-coded in `form/templates.js`, so it is wrong in many
places today and goes stale whenever the runtime adds a root. Do not keep a second copy: the server already reports unknown
placeholders **with a path** in `POST /validate`, so show those and drop the client-side "unknown name" error, or keep it only as
a hint that never draws a red error. Better still, take the names per place from the schema once it carries them (a backend request, see 6).

---

## 3. Backend features the studio does not use yet

The API gained a lot after the first review (`FRONTEND_GUIDE.md` section 10 has the shapes). **No code in `src/` calls any
of these endpoints today** (I searched). The README's "Waiting for the API" table is therefore out of date: every row
except phone numbers, `label`, delete/archive, the AI assistant, roles and the server-side production block is now available.

### 3.1 P0/P1, L: Scenarios tab runs on the real runner
- `GET /bots/{id}/tests` (scenarios with the last result of each), `POST /bots/{id}/tests/run`, then poll
  `GET .../tests/runs/{run_id}` until `status` is not `running`. Scenarios **appear as they finish**.
- Send `{config}` to test what is in the editor without saving (the run's `ref` is `"unsaved"`). One run per bot at a time (409).
- Each scenario is **scripted** (`model_script`: the real runtime with a scripted model, free and repeatable) or **live**
  (a real model: costs money, skipped unless the run asks `live: true`). Show the mode on every row and put a clear
  cost warning on the live switch.
- Scenarios never call real APIs: their `http_mocks` answer. A call no mock matches comes back in `unmocked`. **Show it
  prominently** ("the bot called GET /x and nothing answered it") with an **"Add a mock"** button that fills in a stub;
  it is the most common reason a scenario fails.
- A scenario's result has `checks[{kind, expect, passed, detail}]` (`passed: null` means "could not be checked here"),
  `transcript`, `tools`, `http`, `final_agent`, `final_state`, `events`. The `events` are the same records as a call's log, so
  one trace component can show both (3.3).
- The run carries `config_checksum`. Compare it with a version's `checksum` to say **"this exact version passed"** (3.5).
- Keep the simulated runner for **demo mode only**; in real mode remove it, or label it "A quick shape check, not a test".
- Extend the editor: the four new expectation kinds, `description`, `now` (a date-time with a zone, for "what if it were 3 a.m."),
  `state` (starting values), an `http_mocks` editor (connection, method, path with `*`, query, `body_contains`, status, JSON, `times`) and a
  `model_script` view (read-only is fine at first). Anything the form does not know must show as "edit in JSON", never block Save.
- Fix the stale note on the Tests section (`form/FormEditor.jsx`, `SECTION_NOTES.tests`: "not run by anything yet: neither the studio nor the API can run them").

### 3.2 P1, M: previews from the server instead of copies in the browser
Two pure endpoints that need no saved bot and spend nothing: send `config` (what is in the editor) or `bot` + `ref`.

**`POST /preview/prompt`** replaces `form/promptPreview.js`. I compared your preview with the runtime's exact instructions for
**all 21 agents of the six bots**: yours is within 10% for 2 of them and **more than 25% too long for 16** (for example the Nimbus
front desk: 449 words against the runtime's 273; Ada's router: 337 against 208; the telecom example's tech support: 205 against 129).
It is never too short. The cause is structural, not bot-specific: yours adds the tool list and the opening to the text (the runtime
sends tools as function definitions and the opening separately), words things differently ("Your name is Nova, from Nimbus Home"
against "You are Nova, the assistant for Nimbus Home") and misses the guardrails section the runtime adds. An author sizing a prompt
from it would be misled by about 60%. The endpoint returns:
`instructions` (the exact text), `sections` (`kind, label, text, active, when`: show every conditional block and whether it
is in right now), `opening`, `greeting`, `on_enter`, `tools` (as the model sees them; `offered: false` with a `reason` when the runtime cannot run one),
`knowledge`, `models` (secret *names* only), `state` (sensitive values masked) and `stats` (`words`, `approx_tokens`, `tools_offered`).
- Build a **"Preview as…" bar**: channel picker, a few state fields ("what if `verified` were true"), a time picker ("what if it were 3 a.m.").
- Use `stats` for "prompt too long" and "too many tools" advice. Debounce about 400 ms.

**`POST /preview/result`** (one tool: `tool`, `args`, `response`, `state`, `channel`, `now`) replaces the path grammar and
"what the model sees" in `form/jsonPaths.js` / `RequestResponse.jsx`. It returns `request` (rendered URL, query, body, headers
without credentials, `auth.secrets`), `preconditions` (does it hold, and the message the model would be told), `args_problems`, and, when you send `response`
(even `null`): `model_sees`, `model_sees_text` (what the model literally reads: Python-style text, not JSON), `stored_in_state`,
`kept_from_the_model`, `effects` (which fire, in a sentence). Build a **"Try it" panel** in the tool editor: sample arguments on the
left, a pasted response, those outcomes on the right. This removes bug 2.1 for good and keeps the studio from drifting from the runtime.

### 3.3 P1, L: call records (Sessions page, Overview, Test tab)
Today the Sessions page lists only conversations started from this browser's Test tab, and says "Calls from real callers
aren't listed here yet". The API now serves them, per bot:
- `GET /bots/{id}/calls?limit&cursor&since&until&caller&channel&status` (`status`: `ended`, `in_progress`, `unfinished`),
  `GET .../calls/{id}` (events, counts, `final_state`, `usage`; page with `after`), `.../transcript`, `.../download`, and
  `.../stream` (Server-Sent Events).
- **Sessions page:** a table (started, caller, channel, duration, turns, handoffs, status, version/ref) with those filters and
  a bot selector. The API is per bot, so an "all agents" view needs either one request per agent or a backend endpoint (6).
- **Call detail:** a timeline of the records (`user_said`, `agent_said`, `tool_called` with arguments and result and duration,
  `http_request` with status and ms, `knowledge_search` with scores, `state_changed`, `error`, `session_closed`), filter chips by
  kind, the model and speech timings the records carry, errors highlighted, a Download button. **Build one trace component** and use it in
  Sessions, the Test tab and a failed scenario (3.1): they are the same records.
- **Test tab:** after `POST .../sessions` returns `room`, open `new EventSource('/api/bots/{id}/calls/{room}/stream')`.
  Events: `open`, a default `message` per record (`id` is its sequence number, so the browser resumes after a drop), `end`, `error`
  (nothing appeared within `wait` seconds). `EventSource` cannot set headers, so this relies on your proxy adding the key; **turn
  response buffering off** for this path (nginx: `proxy_buffering off`; Vite's proxy is fine in dev).
- These logs hold **what callers said**. Show a plain notice on the pages ("contains caller speech") and do not imply access
  control: there is none yet.

### 3.4 P1, M: a Knowledge screen
A `vector_store` knowledge base is searched from an **index built before calls**, so the author needs a place to manage it.
The form already renders the settings (it is schema-driven); there are no buttons to act. Today an author has to use a command line.
- `GET /bots/{id}/knowledge?ref=draft`: each base with `type`, `mode`, `used_by`, `sources` (a file source says `uploaded`), `index`
  (`null` or `{built_at, passages, embedding, documents}`), the last `build`, and `problems[{problem, fix}]`
  ("no index has been built", "the file X is not uploaded", "the file X changed after the index was built").
  `embedding_key_available: false` means the server cannot build: say so.
- **Upload:** `fetch(url, {method: 'PUT', body: file})`: the body *is* the file, not a form. Types: text, markdown, HTML, PDF,
  CSV, JSON. 413 too big, 400 wrong type. Delete answers 409 if a base reads the file (`?force=true` overrides).
- **Build:** `POST .../{base}/build` answers 202 with a job; poll `GET .../{base}/status` every 1 to 2 s: `build.status` is
  `running`, then `done` (`result.passages`) or `failed` (`error`). `build.log` is a short progress log. One build per base at a time (409).
  The old index keeps serving until the new one is ready.
- **Test a search:** `POST .../{base}/search {query, top_k, previous_reply}` returns hits with **scores**, `ms`, and `the_model_is_shown`
  (the exact message the model would get). The scores are how an author chooses `retrieval.min_score` (related text scores about
  0.5 to 0.75 with the default embeddings, unrelated below 0.25). `previous_reply` shows how a follow-up question would be searched.
- Where: a "Knowledge" tab on the agent, or a card under Connections in the Simple view; link it from a knowledge tool and from the deploy check.

### 3.5 P1, S/M: Deploy and Publish use the new checks
- `POST .../deploy` now returns `preflight.knowledge` (the same `problems`). `DeployTab.jsx` `Preflight` reads only
  `secrets_missing` and `unsupported`: add it. Better: show it **before** deploying, from `GET .../knowledge` on that version.
- Add a **release checklist** in the Deploy tab and the Publish dialog: valid; **tests passed on this exact version** (latest
  run whose `config_checksum` equals the version's `checksum`); knowledge indexes built and current; secrets present
  (`providers[].key_available`, `secrets_missing`); security items acknowledged. One screen that answers "is it safe to put this live?" from endpoints that exist.
- **Keep it generic.** Not every bot has scenarios, a knowledge base or a phone channel, so each line must **appear only when it
  applies** and say "none written" (amber), never "failed", for something the bot does not use. Do not hard-code which lines
  block a deploy: show them all as information, and let a **policy** decide what is required per environment (for example "production
  needs tests passing"). Policy belongs on the server (section 6) so it cannot be skipped from a browser; until it exists, the checklist is advice only.
- Versions tab: a column "tests" (passed/failed/not run) from the same checksum match.

### 3.6 P2, S: a few smaller uses
- The Add tool menu and `toolInfo.js` hard-code which kinds the runtime cannot run, and the list went stale (4.4). Prefer
  asking the server (6, `GET /capabilities`).
- `GET /bots/{id}/tests` gives each scenario's last result: show it on the Scenarios tab on load instead of "Not run".

---

## 4. Wording that is no longer true

These say a feature or endpoint is missing, and it exists now. Authors will believe them.

| Where | Says | Now |
|---|---|---|
| 4.1 Config → Operations → Tests (`form/FormEditor.jsx`, `SECTION_NOTES.tests`) | "not run by anything yet: neither the studio nor the API can run them" | The API runs them. |
| 4.2 Sessions page | "Calls from real callers aren't listed here yet … the studio can't read it yet" | The API serves them (3.3). |
| 4.3 Scenarios tab and `scenarios/runner.js` | "The API has no endpoint that runs test scenarios yet" | It has (3.1). |
| 4.4 **Add tool** menu (`form/toolInfo.js`, `UNSUPPORTED_KINDS`) | "Knowledge search (not available yet)" | Knowledge tools run; remove `knowledge` from the list. Tasks, MCP and code are still not run. |
| 4.5 `form/promptPreview.js` header | "a `POST /preview-prompt` the API doesn't have yet" | It is `POST /preview/prompt` and exists (3.2). |
| 4.6 README "Waiting for the API" and the Sessions/Scenarios rows | the whole table | Update after 3.1 to 3.4. |
| 4.7 Overview, "System health: All services operational" | | It only reflects `GET /health`, that is, **the API answers**. It says nothing about the worker, LiveKit or provider keys. Say "API reachable", or use a real status endpoint (6). |

---

## 5. Smaller findings

### 5.1 P2, S: voice presets do not start valid
Your README says presets "start valid". `phone` and `web_voice` fail `POST /validate` on a bot with no speech models (a new bot has none):
"audio input needs an stt (or realtime) model" and "audio output needs a tts … model", each with a path to the channel's modalities.
The other four presets are valid. When adding a voice channel to a bot with no speech models, offer **"Add default speech models"**
(the Models editor already has the logic; choose from `GET /providers` a provider that is installed and has a key).

### 5.2 P2, S: the e2e script fails on an empty server
`e2e/smoke.mjs` waits for `.agentRow` after opening Agents; a fresh live API has none and shows the empty state. Wait for
either `.agentRow` or `.emptyPanel`, or seed one agent first. (It then passed every step but the conversation.)

### 5.3 P2, S: pin the Node version
`jsdom@30` needs Node 22.14 or newer; on 22.13.1 two component suites crash on import. Add `"engines": {"node": ">=22.14"}` to
`package.json` and a line in the README, so nobody reads "2 suites failed" as a code problem.

### 5.4 P2, S: the schema copies are behind the server
`tests/fixtures/agent-config.schema.json` and `public/config/agent-config.schema.json` differ from `GET /schema` in **23 places**
(the scenario fields `description`, `now`, `state`, `http_mocks`, `model_script`; four new expectation kinds; `knowledgeRetrieval`;
knowledge tool `on_error`; `top_k` text). Run `npm run sync-fixtures` now (it also regenerates `agentConfig.d.ts` and
`public/config`), commit, and run the drift test against a freshly started API in CI. The form itself reads `/schema` at run time, so authors already see the new fields.

### 5.5 P2, M: bundle and demo code
`vite build` warns that `demo/demoApi.js` is imported both statically (by `studio/AssistantPanel.jsx`) and dynamically, so the
split does nothing and demo code ships in the main chunk (737 kB). Make that import dynamic too, and `import()` the Test tab
(`livekit-client`, 587 kB) so people who never test do not download it. Consider building demo mode only with `--mode demo`.

### 5.6 P1, M: typing slows down as the bot grows
Enterprise bots will be bigger than ours, so I measured it. With the Tools section fully expanded I typed into a description and
timed each keystroke until the second animation frame (headless Chrome; the worst case, since everything is open):

| Bot | DOM nodes | median | slowest 5% | slowest |
|---|---|---|---|---|
| `aira-website-bot` (3 tools) | 742 | 20 ms | 29 ms | 31 ms |
| `acme-support` (14 tools) | 3,989 | 33 ms | 93 ms | 260 ms |
| `nigeria-energy-bot` (21 tools) | 7,278 | 58 ms | 167 ms | 239 ms |
| `nimbus-care` (27 tools) | 10,256 | 78 ms | 185 ms | 283 ms |

Past about 100 ms typing feels sticky, and a bot with a hundred tools would likely be well past it (my extrapolation from the rows above; not measured). Every edit re-serialises the whole
config and re-renders the form (the first review noted this as a future risk; it is now a measured one). Do, in this order:
keep the parsed config as the source of truth and build the JSON text only for the JSON view; wrap each card in `React.memo` keyed on its own value so
a keystroke re-renders one card and not all of them; render a card's body only when it is open (you mostly do) and render the list
in pages or with windowing once it passes about 30 items. Re-measure with a config of 100 generated tools and set a budget (for example median under 30 ms).

### 5.7 P2, S: a leftover file
`public/config/config.xml` (the XML-era configuration, 9 KB) is served to the public and nothing in `src` uses it. No secrets
in it, but delete it.

### 5.8 P2, S: phone width
At 390 px nothing overflows horizontally (good). On the Config page the tab row shows Config, Versions, Deploy and Test; I did not
see Scenarios: check that the row scrolls or wraps.

---

## 6. What the backend side can provide next

**Ready today** (use them: section 3): previews (`/preview/prompt`, `/preview/result`), call records (list, one, transcript, download,
stream), knowledge (files, build jobs, status, search), test runs, `preflight.knowledge` on deploy, `GET /providers`, rule messages with paths,
repeated-key refusal. Full shapes: `FRONTEND_GUIDE.md` section 10.

**Still proposed, not built.** Tell me which you want first; each changes the API, not just the UI:

| Item | Why the UI wants it |
|---|---|
| `GET /capabilities` (what tool kinds, built-ins, guardrails the runtime can run) | replaces hard-coded "not available yet" lists that go stale (4.4) |
| `GET /status` (API up, LiveKit configured, which provider keys are set; worker if it can be known) | an honest health card (4.7) |
| Cross-agent call list and per-agent call statistics (counts, average duration, handoffs, tool error rate) | Sessions "all agents", Overview, and the Telephony "Calls" cards that now show zeros |
| Numbers endpoints wrapping `builder_api/sip.py` | a real Phone numbers page instead of the preview |
| `label` on channels and list items | friendlier card titles |
| Archive/delete a bot | replaces "Remove from my list" |
| `x-ui` vocabulary in the schema (you already read it) | steer the form without UI releases |
| `GET /templates` (channel presets, starters), including templates an organisation saves itself | one source for what you keep in `presets.js` / `starters.js`; today the starting points are a fixed list of seven written for customer-care style bots |
| The names a template may use, **per place** in the schema (for example under `x-ui`: `{"template_roots": ["with", "state", "const"]}`) | removes the hard-coded list behind 2.4 |
| Trusted identity header and roles (who may deploy to production, who may read call records) | permissions; today anyone with the key can read every transcript |
| A release **policy** per environment (which checks must pass before a deploy: valid, tests passed, knowledge built, security items acknowledged) | the release checklist (3.5) can then be enforced, not only shown |
| The server refusing a production deploy while a `severity: "security"` item stands | the typed word is only in the browser |
| An audit/history list (who saved, published, deployed, changed what, when) across bots | the fields exist (`saved_by`, `published_by`, `deployed_by`, and the diff endpoint); an enterprise needs one place to read them |
| A secrets-write endpoint | today names only |
| **`x-ui` for every setting**: `label`, `help` (its purpose), `example`, `advanced` or a level (guided, detailed, expert), and `audience` (customer or operator) | lets the form show plain wording and the right level for all 332 settings, and new settings arrive already described; the engine already reads `label`, `help`, `group`, `order`, `advanced` (Track B, WP2 and WP3) |
| **Validation messages with a `code` and a `fix`** (for example `{code: "audio_needs_stt", fix: {action: "open", path: ["defaults","models","stt"]}}`) | one-click fixes without matching sentences (WP7) |
| Mark `runtime.worker.*` (`http_port`, `num_idle_processes`, `initialize_process_timeout_s`) and the `builder` section as **ignored** in the schema | the studio shows them as ordinary settings today, and the runtime reads none of them (WP2). Cheap, and I can do it |
| A short "what is stored about each call" note in `GET /status` or the schema (call log on by default, retention unset) | one source for the privacy statement the studio must show (WP8) |
| "Save this Test conversation as a scenario" | see 7.5 |

---

## 7. Improvements worth making

1. **A release checklist** (3.5). The studio has every piece of evidence for "ready to go live" and shows it in five places. One panel, green or amber.
2. **One trace viewer** (3.3) used in Test, Sessions and scenario failures. It is the biggest debugging aid an author can get: what was said, which tool ran with what, which API answered, what the model was shown from the knowledge base, how long each step took.
3. **Fold the "not available yet" count into the folded checks header.** In the Simple view the checks panel is folded by default, so for Nimbus the header says only "Valid. Ready to publish" and the **15 parts that will not run** are hidden one click away. Show "Valid · 15 not available yet · 3 secrets" on the folded line.
4. **Tools list at scale.** Nimbus has 27 tools in one flat list. Add a search box, filter by kind, and a "used by agents" chip on each card (the data exists: `agentsUsingTool`).
5. **Scenario from a conversation.** A "Save as scenario" button on a finished Test conversation: turns from the transcript, `tool_called` for each tool in the trace, `state_equals` for the final state. It is a starting point the author edits. (The trace is already on the client; a server endpoint is optional.)
6. **A failing scenario should say what to do next.** `unmocked` becomes "Add a mock" (3.1); a `judge` skipped in a scripted scenario says "needs a live run"; a failed `http_not_called` shows the request that happened.
7. **Cost visibility for live runs and live tests.** A confirm step on the live switch ("this calls a paid model") and, if the run reports usage, show it afterwards.
8. **Per-agent health badges in the agents list**: invalid, N parts not available, tests failing, knowledge needs a build. The data comes from `/validate`, `/tests`, `/knowledge`; fetch lazily for visible rows.
9. **Roles in the UI** when the backend adds them: hide Publish and Deploy-to-production for people who may not.
10. **A conformance test over a corpus of bots, run in CI.** This is how I found most of section 2, and it is what keeps the studio generic as it
    grows. For every config in a folder (start with `agent-config.example.json`, `acceptance/*.json` and `examples/*.json`; add every bot a
    customer brings, anonymised): load it into a real local API, open every form section with everything expanded, and **fail if the studio draws any red
    mark on a config the server calls valid**; run `renameEverywhere` on every id and validate the result; compare your hand-copied logic
    (path checks, template names, prompt size) with the server's answer. Add generated stress configs (100 tools, 30 agents, every channel type,
    every tool kind) and a typing-speed budget (5.6). A new schema feature or a new kind of bot then cannot quietly break an editor that only
    ever saw one shape. I can hand over the scripts I used; they are about 150 lines.
11. **Starting points as data.** `starters.js` is seven templates written for customer-care style bots. An enterprise has its own: let an author **save a bot
    as a template** and let an organisation publish templates (needs `GET /templates`, section 6). Keep the built-in seven as a default set only.
12. **Many bots.** The agents list should stay usable at hundreds of bots: search, filter by tag (`meta.tags` and `meta.owner` already exist in the schema),
    sort, page the list, and show per-bot health (item 8). Test it with 300 generated bots.
13. **Not covered by this review, and not bot-specific, for later:** real tenants and workspaces (today a workspace is only a list kept in one browser),
    audit view, approvals before a production deploy, secrets management, translating the studio's own screens, and an accessibility audit against a standard (the form already uses labels and roles well).

---

## 8. Suggested order

1. **P0, now:** Scenarios must not mark a valid scenario Failed or block Save (2.3); at minimum treat unknown kinds as "not checked here".
2. **P1, small, same day:** the three form bugs (2.1, 2.2, 2.4), the stale wording (section 4), `npm run sync-fixtures` (5.4).
3. **P1, the big three, in this order:** the real test runner in Scenarios (3.1), the Sessions page and trace viewer (3.3), the server previews (3.2). They share the trace component and the "unmocked → add a mock" idea.
4. **P1:** the Knowledge screen (3.4), then the release checklist with the deploy and publish additions (3.5), then typing speed on big bots (5.6).
5. **Right after step 2, so it guards everything after it:** the multi-bot conformance test (7.10). It would have caught 2.1, 2.2 and 2.4 on day one.
6. **P2:** 5.1 to 5.5, 5.7, 5.8, then the other improvements in 7.
7. **Ask me** for the backend items in section 6 that block you (the cross-agent call list and statistics, `GET /capabilities` and `GET /status` are the cheapest and remove the most hand-written code).

This list is **Track A** (fix and connect). The product-experience work in sections 9 to 11 is **Track B**; section 11 shows how the two fit into one plan.

---

## 9. Product direction: simple to start, powerful when needed

This section carries the product owner's brief for the next round of changes. Sections 9.2 to 9.6 are my assessment of the studio against it, measured on the real app with the six bots; section 10 turns it into work packages with acceptance criteria.

### 9.1 The brief

> **Goal.** An advanced AI Agent Builder that creates and configures agents for simple use cases as well as highly complex tasks. The platform is powerful and must stay capable of sophisticated use. But the UI must not make customers feel the product is complicated or hard to learn. The goal is **not** to remove functionality or oversimplify. The goal is to **manage complexity intelligently and reveal it only when the user needs it.**
>
> **What good looks like**
> - A new customer can create a basic agent without understanding the underlying technology.
> - An experienced developer can reach detailed controls when required.
> - Complex agent configurations remain possible without cluttering the default experience.
> - Customers can understand what each setting does and why they might need it.
> - The product feels modern, intuitive, professional and enterprise-ready.
> - Users move naturally from creating an agent to configuring, testing, publishing and monitoring it.
>
> **Constraints.** Preserve the existing business logic, backend integrations, APIs, data models and working functionality. Do not replace the application with a generic dashboard template, and do not introduce a different product concept.
>
> **A. Progressive disclosure** (the primary principle). Show the most important settings first. Group related settings into meaningful sections. Put advanced settings in expandable sections, drawers, contextual panels or a dedicated advanced area. Do not present every option on one screen. Keep advanced capabilities **discoverable**, not buried so deep that users cannot find them. Preserve access to every important existing capability.
>
> **B. Two kinds of user.** Support non-technical customers and advanced technical users without making two disconnected products.
>
> **C. Simplify the information architecture.** Reorganise navigation around the customer's **tasks**, not the product's internal technical components.
>
> **D. Complex configuration.** Group settings by purpose. Explain unfamiliar terms in plain language, with tooltips, short descriptions, examples and contextual documentation where useful. Use visual representations for relationships, workflows and dependencies where they help. Avoid unnecessary nested menus and excessive modal dialogs. Use **searchable selectors** for large lists of models, tools, integrations and options. Give validation and **actionable** error messages. Do not expose implementation details a customer does not need to make a decision. **Do not hide genuinely important decisions behind misleading defaults.**
>
> **Visual direction.** A polished, modern enterprise SaaS interface.

(The brief is lightly condensed, nothing dropped. Its first part also asked for an inspection of the app, its journeys and its clutter: that is answered in 9.2 to 9.5. The part that asks which advanced functionality should stay available but stop dominating the default is the level assignment in 9.5 and 9.6.)

How the rest of this review serves it: nothing here changes the schema, the API, the runtime or the data model. Every item is presentation, wording, grouping or navigation, plus a few small optional backend additions in section 6.

### 9.2 Scorecard: the studio against the brief

Measured on the real app (six bots, real API). **Strong** = meets it; **Partly** = a good start with a clear gap; **Not yet** = missing.

| The brief says | State | What I found |
|---|---|---|
| A new customer can create a basic agent without understanding the technology | **Strong, with leaks** | Seven starters, a Simple view of four cards and a live preview beside it. From a clean browser to pressing "Start a conversation": 9 clicks and 6 fields, of which the demo sign-in and profile screens are 4 clicks and 5 fields (about 5 clicks and 1 field once real sign-in replaces them; my arithmetic). Leaks: the Create dialog asks for an **Id** ("Permanent. Used in links and when a call asks for this agent"), a starter's text says "call end_call", and the first error a customer meets reads "this server has no LiveKit credentials (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET), so it cannot start sessions It needs LiveKit to be configured on the server" (raw variable names, and a missing full stop). |
| An experienced developer can reach detailed controls | **Strong** | "All settings" is the complete schema, generated, plus raw JSON, safe rename, and `x-ui` hints. Nothing is missing here. |
| Complex configurations without cluttering the default | **Partly** | The Simple view is well judged: each card shows 4 to 21 inputs (Instructions 4 to 6, Voice & Language 18 to 21, AI Model 6). But the step after it is a cliff: **All settings** opens on "Bot details" (id, status, created and updated times: fields the server owns), and one screen, Basics > Defaults, holds **30 inputs** on the small bot and **71 inputs and 107 buttons on 6,341 px** on Nimbus. Channels on Nimbus: 30 inputs, 130 buttons, 3,846 px. |
| Customers understand what each setting does and why they might need it | **Partly** | Across the six bots the form drew 3,902 rows, 332 distinct settings. Only **40%** of rows have an explanation. **33%** of settings (109) have a label that is just the technical key with underscores removed ("Timeout s", "Top k", "Http port", "Api key", "Voice id", "Num idle processes"). **28%** of rows print the raw key next to the label. 38 settings carry an abbreviation or jargon in the label (Stt, Tts, Llm, Dnis, Uri template, SIP trunk). "Why you might need it" is almost never said. |
| Modern, intuitive, professional, enterprise-ready | **Mostly strong** | Consistent teal system, dark mode that works, good empty states, honest "Simulated" and "Preview, not connected" labels, undo bars. Gaps: 17 agents' DEV/STG/PROD chips and several captions are 9 to 10 px; 13 different font sizes; the sidebar icons are text symbols (⌂ ✦ ◫ ◉ ◒ ⌁ ⌘ ⚙), not an icon set; sign-in is a demo; workspaces live in one browser; "All services operational" only means the API answers. |
| Natural movement: create → configure → test → publish → monitor | **Partly** | The agent tabs read **Config, Versions, Deploy, Test, Scenarios**: Test comes after Deploy, Scenarios after Test, and **there is no Monitor** inside the agent (Sessions is a separate global page showing only this browser's own tests). The Overview "Setup progress" ("Create your workspace", "Configure an agent", "Run readiness checks") is a workspace checklist, not the journey of an agent. |

### 9.3 What already works and should be kept

Do not redesign these; build on them.
- **The Simple view and its "Detailed settings" link.** It is the right idea (progressive disclosure) in the right place. Section 9.5 extends it.
- **Starters** and the **Describe it** path, and the live **Preview** beside the editor with its clear Real or Simulated switch.
- **Honesty cues:** "Simulated" tags, "Preview, not connected", the typed confirmation before a production deploy, "15 parts … aren't available in the runtime yet" on the Test tab.
- **Safe editing:** locked ids with Rename, delete-with-where-used, undo bars, repeated-key detection, revision locking.
- **Dark mode, empty states, error recovery** (Try again, Reload, Discard).

### 9.4 Findings, by principle in the brief

#### A. Progressive disclosure

1. **Settings that do nothing are shown as settings.** `runtime.worker` ("Http port", "Num idle processes", "Initialize process timeout s"): the runtime reads none of them (the worker takes its value from an environment variable); "Dispatch name" is deprecated and ignored; the **Builder** section is described by the schema as "ignored by the runtime". A customer who sets them believes something changed. They belong in an operator-only area, or nowhere. (Backend: mark them in the schema, section 6.)
2. **The first screen of "All settings" is the least useful one** (Bot details, mostly server-owned). Open on "About this agent" with name, description and persona, which is what people came to edit.
3. **"Defaults" is a 71-input page** that mixes four different jobs: the AI models, how the conversation flows (turn-taking, interruptions), what happens in silence, sounds and pronunciation, and reliability. Split by purpose (9.5).
4. **"Everything else" is 14 equal chips** in the Simple view: Guardrails, Events, After the call, Telephony, Tasks, Wrap-ups, Schedules, Constants, Identity, Tests, Runtime, About, Observability, Builder. Safety rules, what happens after a call, business hours and phone transfers are everyday decisions for a customer; Constants, Identity, Runtime, Builder and Observability are not. Rank them, do not flatten them.
5. **Advanced is discoverable but unlabelled.** Nothing says "this is an expert setting". Mark expert settings and keep them one click away (9.6).
6. **The Tools list does not scale as a flat list** (27 cards, 121 buttons on one screen on Nimbus; section 7.4).

#### B. Two kinds of user, one product
The three views (Simple, All settings, JSON) already edit the same draft, so the foundation is right. What is missing is **continuity between them**: a customer who needs one deeper setting should land on that exact field and be able to go back, and a developer should be able to see technical names without every customer seeing them. Make **"Show technical names"** a persistent switch (default off: plain labels only; on: the key and path beside every label, and a "Copy path / Open in JSON" action on every field). The three levels in 9.6 describe the rest.

#### C. Information architecture around tasks
Today's structure mirrors the config file. The sidebar mixes workspace admin with per-agent work, and the agent tabs follow no journey. 9.5 proposes the structure.

#### D. Complex configuration experiences

| Brief item | Observed | Do |
|---|---|---|
| Group by purpose | "All settings" is the 25 sections of the schema in 5 tabs, with equal weight | Regroup by task (9.5). The engine already supports `group`, `order`, `advanced` in `x-ui`; a UI-side map first, schema hints later |
| Plain language | 33% auto-made labels, 60% of rows with no explanation | A label and help catalogue (WP3). Terms to replace first: STT → "Listening", LLM → "Thinking", TTS → "Speaking", VAD → "Detects when someone is talking", Turn detector → "Decides when the caller has finished", Handoff → "Pass to another agent", Effects → "Then do…", Preconditions → "Only allow when…", State variables → "Things it remembers during a call", Guardrails → "Safety rules", Wrap-up → "Close politely if no reply", DTMF → "Keypad tones", `timeout_s` → "Give up after (seconds)", `top_k` → "How many passages to fetch", `min_score` → "How closely a passage must match" |
| Why you might need it | rarely said | One line of **purpose** and one **example** under each guided and detailed setting ("Give up after: how long a caller waits for a lookup. 5 to 8 seconds suits a phone call.") |
| Visual representations | none for relationships | An **agent map** (agents as boxes, handoffs as arrows, the first agent marked). The six bots have 1 to 7 agents and 0 to 5 handoffs, so it is small enough to draw. A **tool × agent grid** (Nimbus shares 9 tools between agents and assigns 4 to 13 per agent; a grid beats 6 separate lists). **"Used by"** on every tool, message, variable and connection (the data exists in `references.js`). A **weekly strip** for schedules. A **step list** for task flows. The call **timeline** (3.3) |
| Fewer nested menus and modals | 12 uses of `<Modal>` across 6 files; "Add tool" is a six-item dropdown ("Built-in, Task, HTTP, MCP server, Knowledge search, Custom code (escape hatch)") | Keep modals for create and delete. Turn the Publish modal into the release page (3.5). Replace the dropdown with a **picker of cards with plain descriptions** ("Look something up in your systems", "Search your knowledge", "Hand over to a person"), grouped, with a search box |
| Searchable selectors | on the Agents screen, **zero** searchable pickers: "Add tool" has 24 options, the condition "When" has 23, "Add state variable" 23, all native dropdowns. The model lists are short today (at most 6 per provider and stage) and will not stay short | One shared **SearchSelect** (combobox, keyboard, type to filter, grouped, shows a description) used for tools, state variables, messages, connections, voices, models and providers |
| Actionable validation | each message shows the raw path (`channels[0].modalities.input`) and the server's sentence ("audio input needs an stt (or realtime) model") | Show the **label path** ("Phone line › Audio in") and a **fix** button where one exists ("Choose a speech-to-text model" jumps to and opens the AI Model card). Group messages by what to do. Ask for structured `code` and `fix` from the server (section 6) rather than matching sentences |
| No unnecessary implementation detail | see the list below | Hide, rename or move behind "Technical names" and "Operator settings" |
| No important decision behind a misleading default | see the table below | Surface them (WP8) |

Implementation details a customer should not need, seen today: raw environment variable names in an error; "Id" in the Create dialog and the line "This is the role of `front_desk`" under the instructions; key chips such as `to_llm`, `to_state`, `out_of_band`, `on_error`, `timeout_s`; "Delete room on close", "Secrets vault", "Created at", "Http port"; **Settings → Data source (Real API / Demo data)** and "Agent Builder API: Connected", which are developer controls on a customer page; the starter text "call end_call" (use the tool's friendly name, or insert it with the existing "Insert a value" helper).

**Important decisions that sit behind defaults** (the brief's last rule). Each needs a visible, plain statement and a place to change it:

| Decision | Today's default | Who is affected | Treatment |
|---|---|---|---|
| Where conversations are processed | a new agent silently uses OpenAI's `gpt-4.1-mini` and keys from the server | everyone; data protection | Name the provider on the Instructions card and on the release page ("Conversations are processed by OpenAI"), with a link to change it |
| **What is stored about each call** | the per-call log is **on by default** and records what callers say, tool results and API calls; retention is unlimited unless set; free-speech redaction is not applied yet. **Nothing in the studio mentions it** (I searched the code) | callers' privacy; the customer's compliance | A "Call records" switch with retention and a sentence on what is kept, shown on the release page and in the Simple view; warn when sensitive fields exist and redaction is off |
| "Valid. Ready to publish" | shown while, for example, 15 parts of Nimbus will not run (hidden in a folded panel) | anyone publishing | Never say "ready" with unsupported parts: say "Valid, with 15 parts that will not run" (7.3) |
| Recording notice | a starter adds it only when voice is used; adding a phone channel later does not ask | legal consent | Ask when a phone channel is added ("Tell callers they may be recorded?") |
| Going live | production needs a typed word only when a security item stands | production | Show the release checklist (3.5) before every production deploy, not only on security items |

#### E. Visual design
The look is already close to the target: a calm teal system, rounded cards, good spacing, working dark mode. To reach "polished enterprise SaaS":
- **Icons.** Replace the sidebar's text symbols with one SVG icon set (for example Lucide) so icons look the same on every machine and carry meaning.
- **Type scale.** 13 distinct font sizes from 9 to 30 px is too many. Use about six (12, 13, 14, 16, 20, 28), never below 12 px for anything a person must read. The environment chips (DEV, STG, PROD: 51 of them on a list of 17 agents) and the "WORKSPACE" caption are 9 to 10 px.
- **Status language.** One vocabulary and colour per state across list, header and Deploy: Draft, Tested, Live in Development, Live in Production, Needs attention.
- **Density.** Offer Comfortable and Compact for people who live in the tool all day (WP9).
- **Contrast** on solid backgrounds passed in both themes (I could not measure text on gradients, such as the primary buttons; check those by eye).
- **No horizontal overflow at 390 px**; keep that in the conformance test (7.10).

### 9.5 Proposed information architecture

#### The sidebar: workspace-level things only
| Today | Proposed | Why |
|---|---|---|
| Overview | **Home** | what needs attention: agents with problems, recent calls, next step |
| Agents | **Agents** | unchanged |
| Sessions | **Calls** (all agents; real calls and test conversations, filter by agent) | monitoring is a daily task; "Sessions" is internal wording |
| Readiness checks (BETA) | **Move into each agent's Test stage** | it checks one agent's saved draft, so it belongs to that agent |
| Voices, Telephony, Integrations | **Library**: Voices, Integrations, Phone numbers | reusable things shared by agents, grouped as one place |
| Settings | **Settings** (workspace, members and access later; hide Real API / Demo data from customers) | |

#### The agent: tabs that follow the journey
The tabs become four stages. Each stage has a clear next step, and the old tabs live inside them, so nothing is lost.

| Stage | Contains (today's tab) | The question it answers |
|---|---|---|
| **Build** | Config: Simple, Detailed, JSON, preview, prompt preview, Knowledge (3.4) | What is it and what can it do? |
| **Test** | Test (Try it) and Scenarios, plus the agent's readiness checks and the trace (3.1, 3.3) | Does it behave? |
| **Release** | Versions, Deploy, the release checklist (3.5) | Is it safe to put live, and what is live where? |
| **Monitor** | Calls for this agent, health, knowledge status (3.3) | How is it doing? |

Show a one-line status under the agent name ("Draft saved · Tests 7 of 7 passing · Live in Development · 12 calls today") and a **"Next: Test it →"** bar at the bottom of each stage, so the journey is visible and the customer is never asked "what now?". Replace the Home page's "Setup progress" with this journey for the agent the customer last touched.

#### "All settings", regrouped by task (every one of the 25 schema sections keeps a home)
| Group (customer wording) | Schema sections | Level |
|---|---|---|
| **About this agent** | `meta` (name, description, tags, owner), `persona` (name, company, tone, style, shared rules, recording notice) | Guided |
| **How it talks** | `messages` (fixed lines), `defaults.language`, `defaults.conversation` (turn-taking, silence, sounds, pronunciation), voice | Guided / Detailed |
| **What it can do** | `tools`, `knowledge`, `forms`, `notifications`, `tasks` (multi-step flows), `connections` (the systems it reaches) | Guided / Detailed |
| **How it behaves** | `agents` (roles, who passes to whom), `guardrails` (safety rules), `schedules` (business hours), `events`, `state` (things it remembers) | Detailed |
| **Where it is available** | `channels`, `telephony` (transfers), `identity` (caller identity) | Guided / Detailed |
| **After the call** | `post_call` (summary, analysis, recording, redaction), `wrapups` | Detailed |
| **Quality and records** | `tests`, `observability` (call records and retention) | Detailed |
| **Engine and operator settings** | `runtime`, `defaults.models` provider internals, `defaults.reliability`, `constants`, `builder`, server-owned `meta` fields | Expert |

The Simple view's four cards keep their place, with task wording: **Personality and instructions**, **Voice and language**, **What it can do** (today's Connections), and **Where it is available** (new: channels and phone). Safety rules, After the call and Business hours move out of "Everything else" into a visible **More** row; Expert items go to an **Advanced** drawer at the bottom, labelled as such.

### 9.6 One product, three levels

| Level | For | Shows | Today's view |
|---|---|---|---|
| **Guided** | a customer building a basic agent | the decisions that matter, in plain words, with a recommended default marked, one example each | Simple view |
| **Detailed** | a customer building a complex agent, or a developer | every customer-meaningful setting, grouped by task, with explanations; relationship views | All settings, regrouped |
| **Expert** | developers and operators | technical names, operator settings, raw JSON, copy path | JSON, plus "Show technical names" and the Advanced drawer |

Rules that keep it one product: the three levels edit the **same draft**; a setting is **assigned one level once** (an `x-ui` hint, or a UI map until then) and appears in that level and all deeper ones; every Guided card ends in "More settings for this" that opens the **same field** in Detailed; the choice of level is remembered per person; the guarantee below holds.

**The no-loss guarantee.** A test (7.10) walks the schema and fails if any property cannot be reached from Detailed or Expert. This is how "preserve access to every important capability" stays true while the layout changes.

---

## 10. Work packages for Track B

Sizes are rough. Each package lists how to know it is done.

| # | Package | Size | Done when |
|---|---|---|---|
| **WP1** | **Journey navigation:** the sidebar and the four agent stages from 9.5, the status line, the "Next:" bar, per-agent journey on Home | M to L | An author can go from Build to Monitor using only the "Next" bar; no old screen is unreachable; deep links (`#/bots/{id}/test`) still work |
| **WP2** | **Regroup All settings by task** and hide operator-only settings; open on "About this agent"; split "Defaults" into purposes | M | No screen shows more than about 40 inputs before the user opens something; the first screen is not server-owned fields; `runtime.worker.*`, `dispatch_name` and `builder` are only in Advanced |
| **WP3** | **Plain-language layer:** a label, purpose and example for every guided and detailed setting; the glossary table in 9.4D; a "Show technical names" switch; term tooltips | M to L, then ongoing | Every setting above Expert has a hand-written label and a one-line purpose; no auto-made label ("Timeout s") is visible with the switch off; the schema-driven engine reads the catalogue so new fields fall back gracefully |
| **WP4** | **Pickers instead of dropdowns for "add":** card pickers for tool kinds, channels and guardrails with plain descriptions and search | M | "Add tool" offers jobs ("Look something up", "Hand over to a person"), not kinds ("HTTP", "MCP"); unsupported kinds say so in the picker |
| **WP5** | **SearchSelect** used for every list that can exceed 8 options | S to M | Zero native dropdowns with more than 8 options; keyboard and screen-reader behaviour tested |
| **WP6** | **Relationship views:** agent map, tool × agent grid, "Used by" panel, schedule strip, task step list | L | Agents and handoffs drawn for all six sample bots; clicking a node opens that agent; assigning a tool in the grid edits the same config |
| **WP7** | **Actionable validation:** label paths, grouped by action, a fix button where one exists, no raw keys | M (+ backend `code`/`fix`) | Every message names the setting by its label and offers a jump; the 10 most common errors have a one-click fix |
| **WP8** | **Surface the important defaults:** provider and data flow, call records and retention, recording notice, "valid but N parts will not run" | M | Each row of the decision table in 9.4D is visible in the Guided level and on the release page, in plain words |
| **WP9** | **Visual system:** SVG icons, a six-step type scale, minimum 12 px, one status vocabulary, density option, tokens in one file | M | No text under 12 px; one icon set; the type scale checked by a test over the stylesheet |
| **WP10** | **Quick wins on first use:** tuck "Id" under "Advanced" in Create (auto from the name); fix the LiveKit error wording and hide raw variable names (show a customer-safe message, keep the detail for developers); remove "call end_call" wording from starters or use the helper; hide **Real API / Demo data** from customers | S | The path from a clean browser to a first conversation has no technical term on screen |
| **WP11** | **Usability check with real people:** 5 non-technical customers and 3 developers, same tasks | S to M | Tasks: create a support agent; change its greeting and voice; add a lookup; try it; publish to Development; find yesterday's calls. Record time, wrong turns and "where did you look first". Target: the first task in under 3 minutes with no help; no one searches the whole app for a setting |

**Acceptance measures** (so progress can be judged without opinion):
1. New customer: sign-in to first test conversation in **8 clicks or fewer** with real sign-in, **no technical term** on the path.
2. **Controls per screen:** Guided card at most 20 inputs; Detailed page at most 40 with groups closed.
3. **Wording:** 100% of Guided and Detailed settings have a label and a purpose; with technical names off, no raw key is visible.
4. **Findability:** every schema property is reachable in Detailed or Expert (7.10 test).
5. **Selectors:** none with more than 8 options without search.
6. **Validation:** every message has a label path and a jump; the common ones have a fix.
7. **Visual:** no text under 12 px, at most 6 type sizes, one icon set.
8. **Speed:** the typing budget in 5.6 holds on the largest sample bot.

**Do not:** remove a capability to make a screen shorter (move it a level deeper instead); replace the app with a dashboard template; add a second editor with different behaviour; bury an advanced setting so deep that search cannot find it (add the global search, Ctrl K, to find **settings** by name as well as pages); hide a decision that changes cost, privacy, safety or what callers hear.

---

## 11. One plan: how Track A and Track B fit

The journey stages in 9.5 are where the Track A features land, so they are one plan, not two.

| Stage | Track A content | Track B shaping |
|---|---|---|
| **Build** | server prompt preview and "Try it" for tools (3.2); Knowledge screen (3.4); the three form fixes (2.1, 2.2, 2.4) | WP2, WP3, WP4, WP5, WP6, WP8 |
| **Test** | real test runner in Scenarios (3.1); the live trace (3.3); readiness checks moved here | WP1, WP7 |
| **Release** | release checklist and preflight (3.5); `preflight.knowledge` | WP1, WP8 |
| **Monitor** | call records (3.3); health; later statistics (section 6) | WP1 |

**Phases**
1. **This week (small, high value):** Track A P0 (Scenarios, 2.3), the three form bugs, stale wording (section 4); WP10 quick wins; hide operator settings; open All settings on "About this agent"; WP5 SearchSelect (it is reused by everything after).
2. **Next:** WP1 journey navigation together with the Track A screens it hosts (3.1, 3.3, 3.5): build each screen **inside** its stage, not in the old tab layout, so it is not built twice. The conformance test (7.10) lands here so it guards the regrouping.
3. **Then:** WP2 and WP3 (regroup and plain language; start with the 40 settings customers touch most), WP4, WP7, WP8.
4. **After that:** WP6 relationship views, WP9 visual system, then WP11 with real people. Use what they find to reorder the rest.
5. **In parallel on my side** (section 6): `x-ui` label, help, example, `advanced` and `audience` for every setting; `code` and `fix` on validation messages; mark `runtime.worker.*` and `builder` as ignored. Tell me to start and I will; it is what lets WP3 and WP7 scale without a UI release for each new setting.
