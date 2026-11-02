# API Discovery Findings (Step 0)

Captured on 22 Oct 2026 against `AGENT_BUILDER_URL`.

---

## 1. Authentication Check

**Command:**
```bash
curl.exe -s -i <AGENT_BUILDER_URL>/health
curl.exe -s -i <AGENT_BUILDER_URL>/environments
```

**Captured Response (`/health`):**
```http
HTTP/1.1 200 OK
content-type: application/json

{"ok":true}
```

**Captured Response (`/environments` without Authorization header):**
```http
HTTP/1.1 401 Unauthorized
content-type: application/json

{"detail":"missing or wrong API key: send the header 'Authorization: Bearer <AGENT_BUILDER_API_KEY>'"}
```

**Answer to Q1:**
The server **requires a Bearer key** for all non-public endpoints. `GET /health` is unauthenticated (200 OK), but `GET /environments` (and other API routes) returns **401 Unauthorized** with `{"detail":"missing or wrong API key: send the header 'Authorization: Bearer <AGENT_BUILDER_API_KEY>'"}`. When called with `-H "Authorization: Bearer <KEY>"`, it returns 200 OK: `["development","staging","production"]`.

---

## 2. Providers Check

**Command:**
```bash
curl.exe -s -H "Authorization: Bearer <KEY>" <AGENT_BUILDER_URL>/providers
```

**Captured Response:**
```json
{
  "providers": [
    {
      "name": "anthropic",
      "stages": ["llm"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-anthropic",
      "default_secret": "ANTHROPIC_API_KEY",
      "key_available": false
    },
    {
      "name": "assemblyai",
      "stages": ["stt"],
      "realtime_runnable": false,
      "installed": false,
      "plugin": "livekit-plugins-assemblyai",
      "default_secret": "ASSEMBLYAI_API_KEY",
      "key_available": false
    },
    {
      "name": "cartesia",
      "stages": ["stt", "tts"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-cartesia",
      "default_secret": "CARTESIA_API_KEY",
      "key_available": false
    },
    {
      "name": "deepgram",
      "stages": ["stt", "tts"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-deepgram",
      "default_secret": "DEEPGRAM_API_KEY",
      "key_available": false
    },
    {
      "name": "elevenlabs",
      "stages": ["stt", "tts"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-elevenlabs",
      "default_secret": "ELEVEN_API_KEY",
      "key_available": true
    },
    {
      "name": "google",
      "stages": ["stt", "llm", "tts", "realtime"],
      "realtime_runnable": false,
      "installed": false,
      "plugin": "livekit-plugins-google",
      "default_secret": "GOOGLE_API_KEY",
      "key_available": false
    },
    {
      "name": "groq",
      "stages": ["stt", "llm", "tts"],
      "realtime_runnable": false,
      "installed": false,
      "plugin": "livekit-plugins-groq",
      "default_secret": "GROQ_API_KEY",
      "key_available": false
    },
    {
      "name": "openai",
      "stages": ["stt", "llm", "tts", "realtime"],
      "realtime_runnable": true,
      "installed": true,
      "plugin": "livekit-plugins-openai",
      "default_secret": "OPENAI_API_KEY",
      "key_available": true
    },
    {
      "name": "openai_compatible",
      "stages": ["stt", "llm", "tts"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-openai",
      "default_secret": "OPENAI_API_KEY",
      "key_available": true
    },
    {
      "name": "silero",
      "stages": ["vad"],
      "realtime_runnable": false,
      "installed": true,
      "plugin": "livekit-plugins-silero",
      "default_secret": null,
      "key_available": false
    }
  ],
  "stages": {
    "stt": "speech-to-text",
    "llm": "language model",
    "tts": "text-to-speech",
    "realtime": "realtime (speech-to-speech) model",
    "vad": "voice-activity detection"
  },
  "turn_detectors": ["livekit-multilingual", "livekit-english"]
}
```

**Answer to Q2:**
- `stt` providers: `cartesia` (installed: true, key_available: false), `deepgram` (installed: true, key_available: false), `elevenlabs` (installed: true, key_available: true), `openai` (installed: true, key_available: true), `openai_compatible` (installed: true, key_available: true), `assemblyai` (installed: false), `google` (installed: false), `groq` (installed: false).
- `llm` providers: `anthropic` (installed: true, key_available: false), `openai` (installed: true, key_available: true), `openai_compatible` (installed: true, key_available: true), `google` (installed: false), `groq` (installed: false).
- `tts` providers: `cartesia` (installed: true, key_available: false), `deepgram` (installed: true, key_available: false), `elevenlabs` (installed: true, key_available: true), `openai` (installed: true, key_available: true), `openai_compatible` (installed: true, key_available: true), `google` (installed: false), `groq` (installed: false).
- `realtime` providers: `openai` (installed: true, key_available: true, realtime_runnable: true), `google` (installed: false).
- `vad`: `silero` (installed: true).
- **elevenlabs**: listed with name `"elevenlabs"` (installed: true, key_available: true).
- **cartesia**: listed with name `"cartesia"` (installed: true, key_available: false).

---

## 3. Session Creation Check

**Command:**
```bash
curl.exe -s -i -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" -X POST <AGENT_BUILDER_URL>/bots/voice-test/sessions -d "{}"
```

**Captured Response:**
```http
HTTP/1.1 201 Created
content-type: application/json

{
  "livekit_url": "wss://mxbot.cimbpoc.tetherfi.cloud",
  "token": "eyJhbGciOi...",
  "room": "test-voice-test-c8e25d44",
  "identity": "visitor-a480f02b",
  "expires_in_s": 900,
  "bot": "voice-test",
  "ref": "draft",
  "version": "draft",
  "channel": {
    "id": "web-voice",
    "type": "web_voice",
    "input": ["audio"],
    "output": ["audio"]
  },
  "channels": [
    {
      "id": "web-voice",
      "type": "web_voice",
      "input": ["audio"],
      "output": ["audio"]
    }
  ]
}
```

**Answer to Q3:**
`POST /bots/{id}/sessions` on an existing bot (`voice-test`) returns **201 Created** (not 503). LiveKit credentials (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) are present and working on the server.

---

## 4. Web Voice Channel Check

**Answer to Q4:**
**Yes**, existing bots such as `voice-test` have a web voice channel configured: `channel.type` equals `"web_voice"` in the session response (`channel: { id: "web-voice", type: "web_voice", input: ["audio"], output: ["audio"] }`).

---

## 5. OpenAPI Paths vs PRD Endpoints

Paths in `openapi.json`:
- [x] 1. `GET /health`
- [x] 2. `GET /schema`
- [x] 3. `GET /environments`
- [x] 4. `GET /providers`
- [x] 5. `POST /validate`
- [x] 6. `GET /bots`
- [x] 7. `POST /bots`
- [x] 8. `GET /bots/{bot_id}`
- [x] 9. `GET /bots/{bot_id}/draft`
- [x] 10. `PUT /bots/{bot_id}/draft`
- [x] 11. `POST /bots/{bot_id}/publish`
- [x] 12. `GET /bots/{bot_id}/versions`
- [x] 13. `GET /bots/{bot_id}/versions/{version}`
- [x] 14. `GET /bots/{bot_id}/diff`
- [x] 15. `POST /bots/{bot_id}/deploy`
- [x] 16. `GET /bots/{bot_id}/deployments`
- [x] 17. `GET /bots/{bot_id}/deployments/{deployment_id}`
- [x] 18. `POST /bots/{bot_id}/sessions`
- [x] 19. `POST /preview/prompt`
- [x] 20. `POST /preview/result`
- [x] 21. `GET /bots/{bot_id}/knowledge`
- [x] 22. `GET /bots/{bot_id}/knowledge/files`
- [x] 23. `PUT /bots/{bot_id}/knowledge/files/{name}`
- [x] 24. `DELETE /bots/{bot_id}/knowledge/files/{name}`
- [x] 25. `POST /bots/{bot_id}/knowledge/{base_id}/build`
- [x] 26. `GET /bots/{bot_id}/knowledge/{base_id}/status`
- [x] 27. `POST /bots/{bot_id}/knowledge/{base_id}/search`
- [x] 28. `GET /bots/{bot_id}/calls`
- [x] 29. `GET /bots/{bot_id}/calls/{call_id}`
- [x] 30. `GET /bots/{bot_id}/calls/{call_id}/transcript`
- [x] 31. `GET /bots/{bot_id}/calls/{call_id}/download`
- [x] 32. `GET /bots/{bot_id}/calls/{call_id}/stream`
- [x] 33. `GET /bots/{bot_id}/tests`
- [x] 34. `POST /bots/{bot_id}/tests/run`
- [x] 35. `GET /bots/{bot_id}/tests/runs`
- [x] 36. `GET /bots/{bot_id}/tests/runs/{run_id}`

**Runtime blocked route:**
- `GET /bots/{bot_id}/resolve/{ref}`

**Additional Verified Routes:**
- `GET /channel-types`
- `GET /numbers/settings`
- `GET /numbers`
- `GET /numbers/check`
- `GET /bots/{bot_id}/numbers`
- `POST /bots/{bot_id}/numbers`
- `PATCH /bots/{bot_id}/numbers/{number}`
- `DELETE /bots/{bot_id}/numbers/{number}`
- `POST /preview/guardrails`
- `POST /preview/redaction`
- `POST /preview/speech`
- `POST /preview/task`
- `GET /redaction/entities`

---

## 6. Root Causes of Current Fake Data

1. **`src/contexts/StudioContext.tsx:79-80`**:
   - `const [agents, setAgents] = useState<Agent[]>(seedAgents);` imports and loads hardcoded `seedAgents` from `src/data/seedAgents.ts`.
   - `const [activity, setActivity] = useState<ActivityItem[]>(seedActivity);` loads fake activity items.
   - `notifications` (lines 119-150) are initialized with fake mock items.
2. **`src/contexts/AuthContext.tsx:36-39, 41-47`**:
   - Hardcoded user `"Asha Bello"` (`asha.bello@northwind.example`) and fake delay login (`setTimeout 900ms`) instead of talking to a real session / auth endpoint or gateway.
3. **`src/pages/Calls.tsx:4` & `src/pages/CallDetail.tsx:5`**:
   - Import and render hardcoded calls from `src/data/calls.ts`.
4. **`src/pages/Knowledge.tsx:22`**:
   - Imports hardcoded mock knowledge bases, index details, and documents from `src/data/knowledgeData.ts`.
5. **`src/pages/Library.tsx:3`**:
   - Imports hardcoded `connectionSecrets`, `serverSecrets`, `ttsProviders` from `src/data/providers.ts`.
6. **`src/components/agent/test/ScenariosRunner.tsx:17, 30`**:
   - Imports and filters hardcoded `seedScenarios` from `src/data/seedScenarios.ts`.
7. **`src/components/agent/ReleaseStage.tsx:14` & `src/components/agent/MonitorStage.tsx:6`**:
   - Imports and displays fake metric numbers from `src/data/healthMetrics.ts`.
8. **`vite.config.ts`**:
   - Missing proxy configuration for `/api` that points to `AGENT_BUILDER_URL`, rewrites `/api`, and injects the `Authorization: Bearer <KEY>` header.
9. **`src/api` directory**:
   - Was completely empty; no HTTP client existed to call the backend.
