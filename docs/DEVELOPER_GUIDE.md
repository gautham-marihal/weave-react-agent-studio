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
                         links and each page's address); shared.jsx (pieces the pages share)
  studio/                the Agents area
    Studio.jsx           the list of agents or one agent, by the address
    AgentsPage.jsx       the list of agents and the Create dialog
    AgentWorkspace.jsx   one agent, open: its draft, test conversation and dialogs, handed to agent/AgentLayout.jsx
    agent/               one agent's screens: AgentLayout.jsx (what is drawn), the menu (AgentNav), the top bar,
                         pages.js (the agent's pages and where each setting lives), readiness.js (the steps to get
                         ready), pages/ (Overview, Agent, list pages, section pages), pickers/ (voice, language,
                         model), blocks/ (the plain-words blocks of Guardrails and After the call)
    form/                the settings form, built from the schema: FormEditor.jsx, Node.jsx (draws any part of the
                         schema), engine.js (reads the schema), plainLanguage.js (every label in plain words)
    simple/              helpers that read and write the everyday settings (simpleModel.js)
    workflow/, knowledge/, test/, scenarios/, calls/, trace/, release/, monitoring/, speed/, live/, insights/, ...
                         one folder per feature: its components, its logic (`*Model.js`) and its stylesheet
tests/                   unit and component tests (node:test; components are mounted in jsdom by tests/component/)
e2e/                     end-to-end scripts that drive a real browser (Playwright) against a running dev server
scripts/                 keep the schema copies in step (sync-fixtures, schemaTypes, schemaCopies)
mock-bank/               a made-up bank API and the six OCBC business-banking agents that call it (see mock-bank/README.md)
docs/                    this guide, PRODUCTION.md, USABILITY_STUDY.md, COLLABORATION_API.md
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
- The agent's own pages (`studio/agent/pages/`) show the everyday settings in plain words and write ordinary fields of the
  same configuration (`studio/simple/simpleModel.js`), so the pages, the form and the JSON always agree.
- Logic that does not draw anything lives in plain modules (`*Model.js`, `engine.js`, `readiness.js`...) with no React,
  so it is easy to read and is unit-tested directly.

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
  `mn` monitoring, `tm` team, `rp` replay, `rl` relations, `vx` validation, `pv` preview, `pk` pickers, `as` the assistant.
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

## Common changes

- **A new workspace page**: add it to the sidebar list in `src/pages/helpers.js` (its id, label, icon and address), then
  show it in `pages/Dashboard.jsx` where the other pages are chosen, loaded with `lazy` like them.
- **A new page of an agent**: add it to `PAGE_GROUPS` in `src/studio/agent/pages.js`, then draw it in
  `studio/agent/AgentLayout.jsx`.
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

## Good to know

- **Kept in the browser**: workspaces, test sessions, the Telephony pages (a local mock: nothing reaches a phone system),
  integration details and preferences (`studio/usePref.js`). Clearing the site's data clears them.
- **Generated file**: `src/api/agentConfig.d.ts` is made from the schema (`npm run types`); do not edit it by hand.
- **Schema copies**: the schema lives in `tests/fixtures`, `public/config` (the download on the landing page) and the types.
  `npm run sync-fixtures` refreshes all of them from the API; a test fails when they drift apart.
