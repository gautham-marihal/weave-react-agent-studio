# Weave React → Weave Studio: what came over

Weave Studio is the main app. This change brings every Weave React feature into it, each with tests: the ones that
use the Agent Builder API, and, behind a switch in the top bar, the ones React only simulated. It is based on Studio
commit 84c8307 and is left uncommitted for review.

## Before running it

- `npm install`: new packages are CodeMirror (`@codemirror/*`, `@lezer/highlight`) for the JSON editor, `zod` for
  the checks on the API's answers, and `playwright-core` (dev only) for the browser tests.
- Optional: `ANTHROPIC_API_KEY` in `.env` turns on "Describe it" (see `.env.example`). The key stays on the server:
  the browser calls the dev server's `/llm` route, which adds the key and allows only the listed models. With no key,
  "Describe it" says so and sends nothing.

## Checking it

| Check | Command | Result on 2026-11-02 |
|---|---|---|
| Types | `npm run typecheck` | passes |
| Unit tests | `npm test` | 115 files, 1137 tests pass |
| Lint | `npm run lint` | 0 errors (127 warnings, mostly `any`) |
| No fake data | `npm run check:no-fake` | clean |
| Build | `npm run build` | passes |
| Browser tests | `npm run e2e` | 29 of 29 suites pass |

The browser tests need Google Chrome installed. Each suite starts its own stand-in API (`e2e/support/`, built from
React's demo API, used by tests only) and a dev server on ports 8400/5400; `E2E_API_PORT`/`E2E_WEB_PORT` change them,
`E2E_HEADED=1` shows the browser, `E2E_SHOTS=<dir>` saves a screenshot when a step fails. `node e2e/run-all.mjs <word>`
runs only the suites whose names contain the word.

## What came over, by area (each line is a browser suite in `e2e/`)

- **Shell** (`shell`, `shell-home`, `shell-signin`, `smoke`): grouped sidebar that folds (and folds itself inside an
  agent) with counts; phone drawer; tab titles; "Page not found" / "Agent not found"; skip to content; help and
  shortcuts with Mac key names; per-page error boundary; offline and "can't reach the server" strips; profile menu and
  account; landing page, sign-in with "keep me signed in", forgot password, first-time profile step; Home greeting,
  counts, "Next step" agent chooser, library shortcuts, test conversations counted from real calls; Team page.
- **Styles** (`styles`, `styles-legibility`): the seven design styles and accent colours, in Settings and the top
  bar's Theme pop-over, remembered per style; every style measured for text contrast in light and dark.
- **Search** (`search`): Ctrl/⌘ K with grouped results, best match first, recent picks, an agent's pages, tasks and
  settings, per-agent Publish/Test/Deploy/Calls, phone numbers and calls.
- **Managing agents** (`manage`): status counts, "Furthest along", tag filter, remembered view, Move up/down;
  workspaces (create, rename, delete, move an agent, links open the right workspace, other tabs follow); each agent's
  "⋯" menu and the agent header's More menu (rename with the plain 409 wording, export draft or any version, save as
  template, remove/restore); the Create dialog's own templates.
- **Calls and Live** (`calls`, `live`, `replay`): Calls by server range with outcome, channel, caller digits and
  "Load more"; a call's full trace, followed live; the Live board (streaming lines, flags, Pause, Watch, hide callers'
  words, screen-reader announcements); replay a call against the draft or a version, keep it as a test, fix this call.
- **Insights and Speed** (`insights`, `speed`): monitoring, alerts with the bell and sidebar count, rules, "I'm on it",
  snooze, browser notifications; numbers on Home, the agents list and an agent's Overview; the Speed page and per-agent
  speed with suggestions that open the setting.
- **Library** (`library`): voices (used by, favourites, "Use in an agent" landing in that agent's draft unsaved),
  integrations ("Add to an agent" as a draft connection naming a server secret), phone numbers (edit with PATCH,
  advanced options, setup warnings).
- **Build** (`agentpage`, `agentpage-knowledge`, `build-channels`, `build-tools`, `build-extras`, `build-guardrails`,
  `build-messages`, `form`, `json`, `workflow`, `workflow-relations`, `workflow-describe`, `workflow-describe-off`):
  the Agent page and prompt preview, Build on one page, knowledge inside the agent, channels from GET /channel-types,
  business hours and caller identity, tools with "Try it", transfers/connections/forms/messages/tasks, guardrails and
  after-call settings, fixed lines and pronunciation, the schema-driven All settings form with technical names, deep
  links and the Problems panel, the CodeMirror JSON editor, workflow extras on the canvas (templates, on-enter steps,
  transfers, sticky notes), the agent map / tool grid / "used by", and "Describe it".
- **Test and Release** (`test`, `release`): the test panel beside other pages, scenarios (write, run unsaved edits,
  paid and real-request options asked first, "Add a mock", JSON, earlier runs), scripted callers, readiness checks;
  environments from the server, numbers per environment, Tests chip per version, release checklist, publish under the
  draft's own number and put it live in Development in one click.

Studio's own features (banking, providers, environment switcher, roles, audit log, React Flow canvas, Voice Readiness
and the rest) are kept.

## Live and Sandbox (the switch at the start of the top bar)

- **Live** (the default): agents are read from and saved to the Agent Builder API. Nothing is made up.
- **Sandbox**: sample agents, calls, numbers and a team, kept in this browser, with no server needed. Everything React
  did in its demo mode works, and every made-up thing says so ("Simulated", "Sandbox", "Sample").

Switching asks first and reloads; the choice holds for the page's lifetime, so nothing made in one is ever saved to
the other, and other open tabs follow. Settings › Data source explains both and can start the sample data again. A
build made with `VITE_SANDBOX=true` runs on sample data only. When the server can't be reached in Live, the strip
offers Sandbox. Only in Sandbox (`e2e/sandbox-*.mjs`):

- a test conversation with the agent without LiveKit, on the unsaved edits, with made-up replies by simple rules; it
  is kept as a call ("Test: simulated chat") with its trace. Replays, scripted callers and scenarios run on the same
  imitation, each labelled.
- **Telephony** (`/telephony`): simulated calls, dispatch rules, test numbers and SIP trunks. In Live the page shows
  the real phone numbers and says plainly that the API does not offer the rest yet.
- "Describe it" with built-in rules (not AI), the browser's own voice reading a line when a voice has no recording,
  "Sample" tags on the starting agents (Home can hide them), and a sample team.

How Live is kept free of it: all sample data and simulations are in `src/sandbox/`, loaded only when Sandbox is on
(they build into separate files the Live studio never loads). `npm run check:no-fake` still applies its rules to
everything outside `src/sandbox/`, and refuses a plain import of the sample data from there.
`src/sandbox/agentBuilderSandbox.js` (the imitation API, also the browser tests' stand-in) and
`src/sandbox/sandboxEngine.js` (the imitation agent, rule-based assistant, replay and browser voice) are bundled from
Weave React's own code at 7a0567a.

Checked in both: every answer the API gives to a read is checked against its expected shape (`src/api/schemas.ts`,
zod); an answer of another shape is an error that names the field.

Things React kept only in the browser are kept in the browser here too, and say so ("Kept in this browser"):
workspaces, the team list, alert rules, readiness-check history. They need server support to be shared.

## Banking, inside the agents

There is no separate Banking page. Build › Tools › Banking makes any agent a banking agent (the gateway's tools, the
six specialist roles and their instructions; Remove banking undoes it); Create agent offers a Banking assistant; Sandbox
has a sample, Weave Bank assistant. Testing a banking agent runs the whole workflow in its Test stage — sign-in on the
secure keypad, accounts, balances, transactions, cheques, rates, appointments, confirmations, hand-off — by chat or
browser voice, and the trace holds the gateway's timeline. Every banking call goes through `bankingSource()`
(`src/api/gateway.ts`): **Live** only to a gateway on the bank's real systems (none exists yet, so Live says banking is
not available and why); **Sandbox** to the gateway server when it runs, else to the same gateway built into the page
(`npm run sandbox:gateway`, from `services/banking-gateway`). Details: `docs/BANKING-FOUNDER-DEMO.md`.

## Layout

- **Top bar:** the data source (Live | Sandbox) on the left; search, notifications, theme and the account (your
  initials) on the right. The account menu has Account, Help & shortcuts (also the `?` key) and Sign out.
- **Sidebar:** the logo with an icon-only fold button at the top, then the pages in three groups set apart by a line
  (no headings, no search, no help, no account).
- **Moved to Settings:** the working environment (Development / Staging / Production; in Production a red bar on every
  page says so, with "Change") and the API's full status (the Agent Builder API section).
- **Every top-level page** uses one frame (`pageClass` in `src/utils/styles.ts`) and the same title; the breadcrumb
  trail shows only below the top level (inside an agent, a call, an Analytics tab).

## Fixed while putting the parts together

- Two quick changes to a page's address (a filter, then the sort) could undo the first. The router re-renders in a
  transition, so click handlers now start from the address as it is (`src/utils/searchParams.ts`).
- The sidebar's search button was named just "Search", the same as a page's own Search button; it is now "Search
  anything".
- Toasts inside an animation, the Live board's number of followed calls, and shortcut labels shared by two parts.
- Browser tests written for one part were brought in line with the whole: Build › JSON is the code editor (read
  through its `weaveJsonText` hook); Channels and Tools have their own pages instead of a part of All settings, so a
  link to a tool focuses its row there; pressing an agent on the map opens its settings on the same page.
