# Agent builder: guide for the front-end developer

You are building the UI of an **agent builder**: people design a voice or chat bot in a browser, try
it, publish it and put it live. This page is everything you need to talk to the back end. Run the API
locally and open its interactive docs at `http://localhost:8100/docs` for try-it-out buttons.

## 1. The idea in one minute

A bot is **one JSON document** (the *config*). The UI edits it; a separate generic runtime reads it and
behaves like that bot. There is no build step.

| Word | Meaning |
|---|---|
| **Draft** | The working copy. *Save* stores it (valid or not, you edit through invalid states). |
| **Version** | *Publish* freezes the draft as an immutable `x.y.z`. Only a valid config can be published. |
| **Environment** | `development`, `staging`, `production`. *Deploy* points one at a version. Instant; rolling back = deploying an older version. |
| **Session** | One conversation. Your Test panel and any chat widget start one with a join token (section 6). |

The UI therefore has these jobs: **(a)** edit the config with live validation, **(b)** publish and
deploy, **(c)** test a bot in a chat/voice panel, **(d)** show forms the bot asks for (section 7).

## 2. Running it

```
cd agent-builder
uv sync
uv run uvicorn builder_api.app:create_app --factory --port 8100
```

| Thing | Value |
|---|---|
| Base URL | `http://localhost:8100` (no `/api` prefix) |
| CORS | `http://localhost:5173` and `http://localhost:3000` are allowed. More: env `AGENT_BUILDER_CORS_ORIGINS` (comma separated) |
| Auth | None by default. If the server has `AGENT_BUILDER_API_KEY`, send `Authorization: Bearer <key>`. This is a placeholder for real SSO. |
| Who did it | Send `X-User: <name>` and saves, publishes and deploys are attributed to it |
| Data | Stored as files under `agent-builder/data/` |
| Sessions need | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in the server's environment (or in the file named by `AGENT_RUNTIME_ENV_FILE`). Without them `POST .../sessions` answers 503. |

**Errors** are JSON. Almost always `{ "detail": "text" }` (400 bad id/version, 401 wrong key, 404 not
found, 409 conflict, 503 LiveKit not configured). Two shapes to handle:
- *Cannot publish / cannot try a draft*: `422 { "detail": "...", "errors": [ {path, message} ] }`. The same shape comes back from `PUT /bots/{id}/draft` and `POST /validate` when the JSON text repeats a key inside one object (a hand-edited or pasted config; `path` is the object that repeats it, and nothing is saved). A UI that builds the JSON from its own state never produces this, but a "paste JSON" box can.
- *You sent a malformed request*: `422 { "detail": [ {loc, msg, type} ] }` (FastAPI's own, `detail` is an array). That is a bug in the UI, not something to show a user.

## 3. Endpoints

All paths are relative to the base URL. `{id}` is a bot id: lowercase letters, digits, `_` `-`, starting with a letter, up to 64 characters.

| Method and path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ok: true}` (no auth) |
| `GET /schema` | | The JSON Schema of a config (about 70 KB). Build the editor from it, section 4 |
| `GET /environments` | | `["development","staging","production"]` |
| `GET /providers` | | The model providers the runtime can run: `{providers: [{name, stages: ["stt","llm","tts","realtime","vad"], installed, realtime_runnable, plugin, default_secret, key_available}], stages: {...labels}, turn_detectors: [...]}`. Build the speech-to-text / language-model / text-to-speech pickers from it (a provider is offered for a stage only if `stages` has it; show `installed: false` as disabled, and `key_available: false` as "key not set on the server"). A config that names any other provider is refused by `/validate`. Model ids are not listed: keep a free-text field |
| `POST /validate` | a config | Validation report (section 5), for any config, saved or not |
| `GET /bots` | | `[{id, name, draft_revision, draft_saved_at, latest_version, deployed: {env: version}}]`. Only real bots (a folder counts only if it has a draft); you no longer need to filter out `transcripts` or `metrics` |
| `POST /bots` | `{id, name}` | `201` a new bot with a minimal valid draft. `409` if the id is taken; `400` if the id is reserved (`transcripts`, `metrics`, `logs`, `sessions`, `tmp`) |
| `GET /bots/{id}` | | One summary (as above) |
| `GET /bots/{id}/draft` | | `{bot_id, revision, saved_at, saved_by, config}` |
| `PUT /bots/{id}/draft` | `{config, base_revision?}` | `{draft: {...as above}, validation: {...}}`. Saves even if invalid |
| `POST /bots/{id}/publish` | `{bump?: "major"\|"minor"\|"patch"}` | `201 {bot_id, version, published_at, published_by, checksum, warnings, secrets_required}`. `422` with `errors` if invalid |
| `GET /bots/{id}/versions` | | Newest first: `[{version, published_at, published_by, checksum}]` |
| `GET /bots/{id}/versions/{x.y.z}` | | `{bot_id, version, published_at, published_by, checksum, config}` |
| `GET /bots/{id}/diff?a=0.1.0&b=draft` | | `{from, to, changes: [{op: "add"\|"remove"\|"change", path: [...], before?, after?}]}`. `a` and `b` are versions or `draft`. Items of id-lists appear in `path` as `"id=billing"` |
| `POST /bots/{id}/deploy` | `{version, environment, note?}` | `{deployment: {id, status, environment, version, previous_version, deployed_at, deployed_by, note}, preflight: {secrets_required, secrets_missing, unsupported, knowledge}}` |
| `GET /bots/{id}/deployments` | | `{current: {env: {id, version, deployed_at, deployed_by}}, history: [deployment, ...]}` |
| `GET /bots/{id}/deployments/{deployment_id}` | | One deployment (to poll its `status`) |
| `POST /bots/{id}/sessions` | `{ref?, identity?}` | `201` a join token, section 6 |
| `POST /preview/prompt` | `{config \| bot+ref, agent?, channel?, state?, caller_phone?, now?}` | The exact instructions an agent would get, section 10.1 |
| `POST /preview/result` | `{config \| bot+ref, tool, args?, response?, state?, channel?, ...}` | What one tool would send and what the model would be shown, section 10.1 |
| `GET /bots/{id}/knowledge` | `?ref=draft` | Every knowledge base with its state, section 10.2 |
| `GET /bots/{id}/knowledge/files` | | `[{name, size, modified, used_by[]}]` |
| `PUT /bots/{id}/knowledge/files/{name}` | the file itself (raw body) | `201` the file's row. `400` type not allowed, `413` too big |
| `DELETE /bots/{id}/knowledge/files/{name}` | `?force=true` | `204`; `409` if a base reads it |
| `POST /bots/{id}/knowledge/{base}/build` | `{ref?}` | `202` a build job to poll, section 10.2 |
| `GET /bots/{id}/knowledge/{base}/status` | `?ref=` | `{index, build, problems[]}` |
| `POST /bots/{id}/knowledge/{base}/search` | `{query, top_k?, previous_reply?, ref?}` | Hits with scores and what the model would be shown |
| `GET /bots/{id}/calls` | `?limit&cursor&since&until&caller&channel&status` | `{calls: [...], next}`, section 10.3 |
| `GET /bots/{id}/calls/{call_id}` | `?after&limit&kinds` | One call: events, counts, final state |
| `GET /bots/{id}/calls/{call_id}/transcript` | | `{call, turns: [{role, text, at}]}` |
| `GET /bots/{id}/calls/{call_id}/download` | | The log file (NDJSON) |
| `GET /bots/{id}/calls/{call_id}/stream` | `?after&kinds&wait` | Server-sent events of a call in progress |
| `GET /bots/{id}/tests` | `?ref=` | The scenarios, each with its last result, section 10.4 |
| `POST /bots/{id}/tests/run` | `{ref?, config?, scenarios?, live?, judge?, allow_network?}` | `202` a run to poll |
| `GET /bots/{id}/tests/runs` | `?limit` | Recent runs, headlines only |
| `GET /bots/{id}/tests/runs/{run_id}` | | One run with every scenario's checks and trace |

Not for the UI (the runtime uses it): `GET /bots/{id}/resolve/{ref}`.

### Behaviours worth knowing

- **Optimistic locking.** `GET draft` gives a `revision`. Send it back as `base_revision` on `PUT`; if someone saved in between you get `409` instead of overwriting them. Omit it to overwrite.
- **Saving never blocks on errors.** Show the returned `validation` next to the editor. *Publish* is the gate.
- **Publish moves the draft on.** After publishing `0.1.0` the draft's `meta.version` becomes `0.1.1`, so the next publish does not collide. Re-read the draft after a publish.
- **Restore a version** = `PUT` the old version's `config` as the draft (set `meta.version` to something unused).
- **Deploy is a state machine.** Today it returns `status: "active"` at once. Later it can include slow steps (building a knowledge index, creating a phone number) and will return `202` with `"pending"`, then you poll `GET .../deployments/{id}` until `active` or `failed`. Until `active` the previous version keeps serving. Build the button as pending / active / failed now.
- **`preflight.secrets_missing`** lists secret names the server cannot find. It is advice to show, not a blocker. `unsupported` is the same kind of advice (section 5).

## 4. Building the editor from the schema

`GET /schema` is a JSON Schema (draft 2020-12). Two custom keywords tell you how to draw it:

- **`x-ref`**: a string field that must name something declared elsewhere in the same config. Render a **dropdown of those ids**. The value names the collection:

| `x-ref` | Options come from |
|---|---|
| `agents`, `tools`, `tasks`, `knowledge`, `forms`, `wrapups`, `messages`, `notifications`, `channels`, `transfers` | the `id` of each item of that top-level list (`transfers` lives at `telephony.transfers`) |
| `schedules` | the keys of `schedules` |
| `state_vars` | the keys of `state.variables` |
| `http_connections`, `mcp_connections`, `notifiers` | the keys of `connections` whose `type` is `http`, `mcp`, `notifier` |
| `tool_names` | tool ids plus every agent's `handoffs[].tool` |

- **`x-ui`**: a hint. `{"widget": "textarea"}` = a multi-line box. `{"widget": "secret-picker"}` = a field that holds `{"secret": "NAME"}` (pick or type a secret name; **never** a raw key).

Other things to expect: `oneOf` (for example a tool is one of several types, switch on `type`), `if/then` (a field required only for some values), and descriptions on most fields: show them as help text.

**Secrets.** The config never contains credentials. A secret is the object `{"secret": "OPENAI_API_KEY"}`. There is no endpoint to *set* secrets yet (the server reads them from its environment); the UI can only let people pick or type the name, and show `secrets_required` / `secrets_missing`.

**Template text.** Many strings may contain `{{state.name}}`, `{{const.x}}`, `{{args.x}}`, `{{form.x}}` and filters such as `{{x | default('y')}}`. Treat these as plain text in inputs; do not try to evaluate them.

**The sections of a config** (top-level keys), as a suggested set of screens:

| Section | What it is |
|---|---|
| `meta` | id, name, version, status. `id` must equal the bot id. |
| `runtime` | provider mode (`plugins` or `inference`), timezone, hangup behaviour |
| `defaults` | models (STT, LLM, TTS, VAD, turn detector), language, conversation behaviour (turn-taking, inactivity, sounds, pronunciation), reliability |
| `persona` | the bot's name, company, tone, rules shared by every agent, the recording notice |
| `channels` | where the bot is reachable: phone, web chat, web voice. Each has modalities, greeting, per-channel overrides |
| `agents` | the agents (a front desk and specialists): instructions, tools, handoffs, `on_enter` actions. `agents.entry` is who answers first |
| `tools`, `tasks`, `connections` | what the bot can do, and the APIs and notifiers it uses |
| `messages`, `state`, `constants`, `schedules` | fixed lines, per-call variables, fixed values, business hours |
| `forms`, `notifications`, `wrapups` | structured input, emails/SMS, "close if no reply" |
| `knowledge`, `guardrails`, `events`, `post_call`, `identity`, `telephony`, `observability`, `tests`, `builder` | the rest |

`agent-config-guide.md` explains every section in plain language with examples; section 3.27 is the one on placing forms, messages and notifications at any step ("Add step: say / generate / show a form / send a notification" is a good UI for every trigger point). `agent-config.example.json` and `examples/voice-bot.config.json` are complete configs to load while you build.

## 5. Validation

`POST /validate` (or the `validation` returned by `PUT draft`):

```json
{
  "valid": false,
  "errors": [
    { "path": ["agents", "items", 0, "tools", 2], "message": "'x' is not a declared tools id (declared: a, b)" },
    { "path": null, "message": "duplicate agent id 'billing' (2 times)" }
  ],
  "warnings": [ { "path": null, "message": "tool 'lookup' is not used by any agent, task or guardrail" } ],
  "secrets_required": ["OPENAI_API_KEY"],
  "unsupported": [ { "feature": "MCP server tools", "where": "tools[3]" } ]
}
```

- `path` is a list of object keys and array indexes: **highlight that field**. Cross-field rules carry a path too (the template with the unknown variable, the second use of a duplicate id, the channel whose models cannot do audio, an unreachable agent, an unused tool, a provider name), and it always points at something that exists in the config you sent, so "jump to" works for them. `null` is left for the few that span several places: show it as a general message. Provider errors name the fix, for example `provider 'whisper' ... use provider 'openai' with model 'whisper-1'`.
- `warnings` never block publishing.
- `unsupported` appears only for a valid config. It lists parts of the config the runtime **cannot run yet**; show them as an amber notice ("this bot uses X, which is not available yet"). The list shrinks as features are built, so do not hard-code it. An entry with `"severity": "security"` (a `sensitive` variable or redaction that is configured but **not enforced yet**) must be shown **prominently, in red**, and ideally block deploying to production: the bot would look protected and is not.
- `schema_version` is `"1.1"` or `"1.2"`. A config that uses a 1.2 feature but says 1.1 gets an error telling the author to say 1.2. New bots created by `POST /bots` start at 1.2.
- Validate on a debounce (say 500 ms after the last keystroke). It is cheap.

### Multi-stage flows (schema 1.2): hold the Stages view for now

A flow such as card activation is a chain of **tasks**, each with typed **steps** (`collect` a value by speech or keypad, `call` an API, `say` a line), gated by `requires`, with attempts and `on_exhausted`. The schema, validator and a complete example (`examples/card-activation.config.json`) exist, so you can already build the generic form editor for these fields. The runtime does not run tasks yet, so a "Stages" visual editor can be designed now and tested when that lands. Mark a state variable `sensitive` for PINs, one-time codes and card numbers; the schema's descriptions explain each field.

## 6. Trying a bot, and the chat widget

`POST /bots/{id}/sessions` returns what the browser needs to join a LiveKit room and get the right bot:

```json
// request
{ "ref": "draft", "identity": "asha" }   // both optional; ref defaults to "draft"

// 201
{
  "livekit_url": "wss://...",
  "token": "<JWT>",
  "room": "test-first-call-5f5916bc",
  "identity": "visitor-b4a0cd28",
  "expires_in_s": 900,
  "bot": "first-call", "ref": "draft", "version": "draft",
  "channel": { "id": "web-chat", "type": "web_chat", "input": ["text"], "output": ["text"] }
}
```

- `ref`: `"draft"` (the Test panel: the saved working copy, before it is published), `"latest"`, a version, or an environment name. An environment nothing is deployed to gives `404`; a draft with errors gives `422` with `errors`; a bot with no web channel (phone only) gives `422`.
- The **token already asks LiveKit to send the bot** (no second call). It is valid 15 minutes; get a new one for a new conversation.
- `channel.type` tells you what to draw: `web_chat` (text box) or `web_voice` (microphone).
- The token is a secret for that one session; never log it.

Connect with the LiveKit JS client (`livekit-client`, or `@livekit/components-react`). Check the calls against the version you install; what the back end does is fixed, the client method names are LiveKit's:

```ts
import { Room, RoomEvent, Track } from "livekit-client";

const s = await (await fetch(`${API}/bots/${id}/sessions`, { method: "POST", headers, body: JSON.stringify({ ref: "draft" }) })).json();
const room = new Room();

// the bot's chat replies arrive as text streams on this topic (one stream per reply, text arrives in pieces)
room.registerTextStreamHandler("lk.transcription", async (reader) => {
  let text = "";
  for await (const chunk of reader) { text += chunk; render(text); }   // show it growing
});

await room.connect(s.livekit_url, s.token);
await room.localParticipant.sendText("When is my bill due?", { topic: "lk.chat" });   // what the visitor types

// voice: switch the microphone on and play the bot's audio
if (s.channel.type === "web_voice") {
  await room.localParticipant.setMicrophoneEnabled(true);
  room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach()); });
}
```

Notes: the bot speaks first (its greeting arrives right after you connect, after a second or two while the bot starts). A bot can end the conversation: you will see the room disconnect (`RoomEvent.Disconnected`); show "the bot ended the chat". For your own debugging, `tools/chat_client.py` (text) and `tools/voice_client.py` (voice) are working Python versions of exactly this.

## 7. Forms

Whether and when a form appears is decided by the bot's config, never by the widget. When the bot wants one, a message arrives on the LiveKit topic `agent-builder.form`; you render it and send the answers back on `agent-builder.form.submit`. The server validates again and answers with errors or "accepted". The exact messages are in **`agent_runtime/FORM_PROTOCOL.md`**: read it before building the widget (it is short). The shapes, briefly:

```
bot -> you    {"type":"form", "request_id":"f_3c4c9741", "title":"Leave your details", "submit_label":"Send",
               "fields":[{"name":"phone","label":"Phone","type":"phone","required":true,"options":null,"pattern":null}, ...]}
you -> bot    {"request_id":"f_3c4c9741", "values":{"phone":"+234 803 123 4567", ...}}     or   {"request_id":..., "cancelled":true}
bot -> you    {"type":"form_errors","request_id":"...","errors":{"phone":"Enter a valid phone number."}}    (stay open, fix, resend)
          or  {"type":"form_accepted","request_id":"..."}                                                   (close it)
```

Field types: `text`, `email`, `phone`, `number`, `textarea`, `select` (uses `options`), `checkbox`.

## 8. What is not there yet (stub or hide these)

| Wanted screen | State |
|---|---|
| Call history and transcripts | **Built**, section 10.3. Metrics (counts and averages across calls) are not: there is no aggregate endpoint yet |
| Setting secrets | No endpoint (write-only secret store not built). Show names only |
| Phone numbers (SIP trunk and dispatch rule) | Done by a command-line tool for now (`tools/sip_setup.py`); no endpoint yet. A phone channel config has `entry.dnis` |
| Running a config's `tests` scenarios | **Built**, section 10.4 |
| Knowledge files and indexes | **Built**, section 10.2. Re-building on a timer (`refresh`) is not |
| Who may see or do what | Not built: anyone with the key can read every call's transcript, upload files, start test runs. Do not imply otherwise in the UI |
| AI "draft my bot" assistant | Not built (planned: it would produce a config and run it through `/validate`) |
| Real sign-in | Only the optional API key and `X-User` header |
| A public, rate-limited endpoint for a website's visitors | `POST .../sessions` is behind the API key; a public one with limits is not built |
| Dropdown lists of providers and models | The schema has them as free text with examples; the UI needs its own catalogue |

## 9. Where to read more

| File | For |
|---|---|
| `builder_api/README.md` | the API in the order of the buttons |
| `agent_runtime/FORM_PROTOCOL.md` | forms between the widget and the bot |
| `agent-config-guide.md` | every config section, in plain language, with examples |
| `agent-config.schema.json` | the schema itself (you also get it from `GET /schema`) |
| `examples/voice-bot.config.json`, `agent-config.example.json` | complete example configs |

## 10. Knowledge, call records, previews and test runs

All of these answer errors in the usual shapes: `{detail}` for a problem with the request, `{detail, errors:[{path,message}]}` (422) for a config that is too broken to work on. 404 for an unknown bot, call, run or base.

### 10.1 Previews: "what will the model actually see?"

Two POSTs that need no saved bot: send the config as it is in the editor (`config`), or name a saved one (`bot`, `ref` defaulting to `draft`). They call nothing, spend nothing and read no secrets.

- **`POST /preview/prompt`** `{config|bot, agent?, channel?, state?, caller_phone?, now?}` returns `instructions` (the exact text), `sections` (`[{kind, label, text, active, when?}]`: show each conditional block and whether it is in right now), `opening`, `greeting`, `on_enter` (what runs when the agent takes over), `tools` (`[{name, description, parameters, offered, reason}]` as the model sees them; `offered: false` means the runtime cannot run it, with `reason`), `knowledge` (what is searched before each reply and which tools search), `models` (layered, secret *names* only), `state` (sensitive values masked) and `stats` (words, tokens, tools). `state` and `now` are what-ifs ("what if verified were true", "what if it were 3 a.m."): a "Preview as..." bar with a channel picker, a few state fields and a time picker. It is the right place to show the "prompt too long" and "too many tools" advice.
- **`POST /preview/result`** `{config|bot, tool, args?, response?, state?, channel?, now?}` for one tool: `request` (method, rendered URL, query, headers without credentials, body, and `auth: {type, secrets[]}` naming which secrets it would use), `preconditions` (`holds` and the message the model would be told otherwise), `args_problems` (the arguments against the tool's schema), and, **if `response` is sent** (even `null`), `result`: `model_sees` (what `to_llm` keeps), `model_sees_text` (what the model literally reads: Python-style text such as `{'found': True}`, not JSON), `stored_in_state` (what `to_state` would set), `kept_from_the_model` (fields that go straight to the caller), and `effects` (which fire, and what each does in a sentence). Build the tool editor's "Try it" panel on this: sample arguments on the left, a pasted sample response, and the three outcomes on the right.

### 10.2 Knowledge

A bot's `knowledge` bases come in two types. A `rag_api` asks a search service you already run; nothing to build. A `vector_store` is searched from an **index built from the base's files and web pages** before calls, so it needs a screen:

1. `GET /bots/{id}/knowledge` lists the bases: `type`, `mode`, who uses them (`used_by: {agents, tools}`), and for a `vector_store` its `sources` (a file source says `uploaded: true/false`), `index` (`null` or `{built_at, passages, embedding, documents[]}`), the last `build` and `problems[]` (`{problem, fix}`: "no index has been built", "the file X is not uploaded", "the file X changed after the index was built"). `embedding_key_available: false` means this server cannot build until an operator sets the key: show it, and expect `503` from build.
2. **Upload** with `fetch(url, {method: 'PUT', body: file})`: the body is the file, not a form. Allowed: text, markdown, HTML, PDF, CSV, JSON. A file the draft's base reads cannot be deleted without `?force=true` (409 says which base).
3. **Build** with `POST .../build` (returns `202` and a `build` job `{id, status: running, log[]}` at once). Poll `GET .../status` every second or two: `build.status` goes `running` → `done` (`result.passages`) or `failed` (`error`, readable); `build.log` is a short progress log. One build per base at a time (`409`). The old index keeps serving until the new one is ready, so a failed build costs nothing.
4. **Test a search** with `POST .../search` `{query, top_k?, previous_reply?}`: `hits: [{text, source, score}]`, `ms`, and `the_model_is_shown` (for an inject base the exact message the model gets, for a tool base the tool's result). Show the scores: they are how an author chooses `retrieval.min_score` (with the default OpenAI embeddings related text scores about 0.5 to 0.75, unrelated below 0.25). `previous_reply` shows how a follow-up question would be searched.

`POST .../deploy` responses now also carry `preflight.knowledge` (the same `problems`, for every base the deployed version uses): show it next to `secrets_missing`.

### 10.3 Call records

The runtime writes one log per call; these endpoints read them. A call is identified by `id` (its file name without `session_`); the **room name** from `POST .../sessions` also works and means the newest call in that room.

- **List**: `GET /bots/{id}/calls?limit=25&cursor=` returns `{calls: [{id, room, channel, caller, dialled, started_at, status, duration_s, caller_turns, agent_turns, handoffs, version, ref}], next}`. Page by passing `next` as `cursor`. Filters: `since`, `until` (ISO times with a zone), `caller` (part of a number), `channel`, `status`. `status` is `ended`, `in_progress` (written to in the last two minutes) or `unfinished` (the log stops without an ending: the worker died, or the call was cut off).
- **One call**: `GET .../calls/{id}` gives `events` (the records exactly as in the file: `user_said`, `agent_said`, `tool_called`, `http_request`, `knowledge_search`, `state_changed`, `error`, ...), `counts` per kind, and once it has ended `final_state` and `usage`. Follow a call by passing the last `seq` you have as `after` (`next_after` is returned), or filter with `kinds=user_said,agent_said`. `GET .../transcript` is just the conversation. `GET .../download` is the file.
- **Live trace for the Test tab**: after `POST .../sessions` returns `room`, open `new EventSource('/api/bots/{id}/calls/{room}/stream')`. Events: `open` (the call), the default `message` for each record (`id` is its `seq`, so the browser resumes after a drop), `end` when the call ends, and `error` if no call appeared within `wait` seconds. `EventSource` cannot set headers, so this relies on your proxy adding the key (it does today); if your dev proxy buffers responses, turn that off for this path. Render the records with the same component as a finished call: they are the same records.

These logs hold what callers said. Treat the pages as sensitive even though the API cannot yet restrict them.

### 10.4 Test runs

A config's `tests` section holds **scenarios**: a channel, what the caller says, and what must be true afterwards. The schema has them (so the generated form already edits them); this runs them.

- A scenario has **`model_script`** (the model replaced by a script: the real runtime, no model, no cost, the same result every time) or it is **live** (a real model: costs money, can differ run to run, and is *skipped* unless the run asks for `live: true`). Show the `mode` on each scenario and put a clear cost warning on the live switch.
- Scenarios **never call real APIs**: their **`http_mocks`** answer the bot's API calls (match by method, path with `*`, query, body fields; answer a status and JSON; `times` limits how often). A call no mock matches is answered 404 and listed in the result's `unmocked`: surface it ("the bot called GET /x and nothing answered it: add a mock") as it is the most common reason a scenario fails. `allow_network: true` lets calls through to real APIs and is refused unless an operator allows it on the server.
- **Expectations**: `tool_called`, `tool_not_called`, `tool_called_with`, `state_equals`, `said_matches`, `agent_is`, `http_called`, `http_not_called` (the way to prove that a guarded action did *not* happen), and `judge` (graded by the model; skipped in a scripted scenario).

Flow: `GET /bots/{id}/tests` lists the scenarios with their last result, `POST .../tests/run` `{ref?, config?, scenarios?, live?, judge?}` answers `202` with a run, and you poll `GET .../tests/runs/{run_id}` until `status` is not `running` (`passed`, `failed`, `error`, `skipped`). Scenarios **appear in the run as they finish**, so the list can turn green one by one. Send `config` to test what is in the editor without saving it (the run's `ref` is `"unsaved"`). One run per bot at a time (`409`).

A scenario in a run: `status`, `checks: [{kind, expect, passed, detail}]` (`detail` says why, for example "not called; the model called: go_billing"; `passed: null` is "could not be checked here", such as a judge in a scripted scenario), `transcript`, `tools` (`{tool, args, output, error}`), `http` (`{method, path, status, mocked}`), `unmocked`, `final_agent`, `final_state`, `notes` and `events`: **the same records as a call's log**, so one trace component shows both. The run also carries `config_checksum`, the checksum of the config it tested: compare it with a version's `checksum` to say "this exact version passed".
