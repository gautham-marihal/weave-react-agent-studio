# Running the Studio in production

The Studio is a static React app. Everything it does goes through `/api`, which something in front of it forwards to the
Agent Builder API. **That something has to do two jobs the app can't do for itself.**

## 1. Real sign-in

The sign-in screen in the app is a demo: it accepts any email and password and keeps them in the browser, so it protects
nothing. Put real sign-in in front of the whole site (SSO / OIDC, for example oauth2-proxy, Caddy or nginx with auth) so
that no request reaches the app or `/api` without a verified user.

## 2. The proxy adds the key and the identity

The API key must never reach the browser, and "who did this" must come from the verified sign-in, not from anything the
browser says (a browser can send any header). So the proxy, after it has verified the user:

- sets `Authorization: Bearer <AGENT_BUILDER_API_KEY>` on every `/api` request,
- sets `X-User: <the verified user>` (the email or name from the sign-in), replacing anything the browser sent.

The API then records that name as `saved_by`, `published_by` and `deployed_by`. The Studio sends no `X-User` of its own.

### Example: nginx with oauth2-proxy

```nginx
location /oauth2/ { proxy_pass http://127.0.0.1:4180; }
location = /oauth2/auth { internal; proxy_pass http://127.0.0.1:4180; }

location /api/ {
    auth_request /oauth2/auth;
    auth_request_set $user $upstream_http_x_auth_request_email;

    proxy_set_header Authorization "Bearer ${AGENT_BUILDER_API_KEY}";   # from the proxy's environment, never the browser
    proxy_set_header X-User $user;                                       # replaces whatever the browser sent
    proxy_pass http://agent-builder:8100/;                               # the trailing slash strips /api
}

location / {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;
    root /srv/studio;                                                    # the output of `npm run build`
    try_files $uri /index.html;
}
```

Build with `npm run build`; serve `dist/`. Don't use `vite preview` in production.

## 3. What the API side should do (not part of this app)

- Accept `X-User` only from the trusted proxy (for example by network rule or a shared secret), and later add roles.
- Treat the audit fields as the proxy's word, not the browser's.

## Development

`npm run dev` forwards `/api` with the key from `.env.local` and the user from `AGENT_BUILDER_USER`. That is a convenience:
anyone who can open the dev server can use the key through it. Keep it on your own machine.

## The Describe assistant's route (`/llm`)

"Describe it" talks to an AI model through `/llm/v1/messages` (and asks `/llm/status` whether one is set up). In development `llmRoute.js` serves both and adds `ANTHROPIC_API_KEY`
on the server side. In production this is one more thing for the proxy to do, and it needs the same care as `/api`:

- Sign-in goes in front of it too: anyone who can reach `/llm` spends your key.
- Keep the limits `llmRoute.js` applies: only `POST /v1/messages` and `GET /status`; the model chosen from a short list; the size of an answer capped; nothing the browser sends as
  headers is passed on.
- Add a per-user rate limit and a spending cap at the provider.
- Decide what may leave: the request carries the current draft (it holds only secret *names*) and what the person typed. Say so wherever the Studio is used; the screen asks for confirmation on first use.
