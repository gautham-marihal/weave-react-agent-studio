// The banking gateway, whole, inside the browser: its own server routes (http/server.ts), its rehearsal routes
// (mock/rehearsal.ts) and its mock bank (mock/adapters.ts), behind a fetch-shaped door. Built into
// src/sandbox/banking/gatewayInBrowser.js by scripts/build-sandbox-gateway.mjs; Sandbox uses it when no gateway
// server answers. Nothing here is a second implementation: every answer comes from the gateway's code.

import { createGateway } from '../../services/banking-gateway/src/app.ts';
import { createGatewayServer } from '../../services/banking-gateway/src/http/server.ts';
import { createMockPorts } from '../../services/banking-gateway/mock/adapters.ts';
import { rehearsalRoutes } from '../../services/banking-gateway/mock/rehearsal.ts';
import { randomBytes } from './shims.mjs';

export interface BrowserGatewayAnswer {
  status: number;
  body: string;
}

export interface BrowserGatewayRequest {
  method: 'GET' | 'POST' | 'OPTIONS';
  /** The gateway path with its query, as the server sees it ("/v1/tools/get_balance"). */
  path: string;
  headers?: Record<string, string>;
  /** A JSON body, already serialised. */
  body?: string;
}

type Listener = (...args: unknown[]) => void;

/** A request as node:http hands it to a handler: headers, an async iterator over the body, and a close event. */
function fakeRequest({ method, path, headers = {}, body }: BrowserGatewayRequest) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  if (body !== undefined && !lower['content-type']) lower['content-type'] = 'application/json';
  const listeners = new Map<string, Listener[]>();
  return {
    method,
    url: path,
    headers: lower,
    on(event: string, fn: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      (listeners.get(event) ?? []).forEach((fn) => fn(...args));
    },
    async *[Symbol.asyncIterator]() {
      if (body) yield new TextEncoder().encode(body);
    },
  };
}

/** A response as node:http gives it: setHeader, writeHead, write and end. JSON answers resolve on end; an event stream
 *  resolves as soon as its head is written and then passes each write on. */
function fakeResponse(onHead: (status: number, stream: boolean) => void, onWrite: (chunk: string) => void, onEnd: () => void) {
  let status = 200;
  let sent = false;
  return {
    get headersSent() {
      return sent;
    },
    // headers matter to a browser on the wire, not to this in-page door
    setHeader: () => undefined,
    writeHead(code: number, headers?: Record<string, string>) {
      status = code;
      sent = true;
      onHead(status, /event-stream/.test(headers?.['Content-Type'] ?? ''));
      return this;
    },
    write(chunk: string) {
      if (!sent) this.writeHead(status);
      onWrite(String(chunk));
      return true;
    },
    end(chunk?: string) {
      if (!sent) this.writeHead(status);
      if (chunk !== undefined) onWrite(String(chunk));
      onEnd();
      return this;
    },
  };
}

/** Starts a gateway on mock bank systems in this page. The runtime token is made here and never leaves it. */
export function createBrowserGateway() {
  const gatewayToken = randomBytes(32).toString('base64url');
  const channelSecret = randomBytes(32).toString('base64url');
  const { ports, controls } = createMockPorts(Date.now);
  // audit records stay in this page (the server writes them as JSON lines to its log)
  const audit: unknown[] = [];
  const { orchestrator, registry } = createGateway({ ports, hosts: 'mock', auditSinks: [(record) => void audit.push(record)] });
  const server = createGatewayServer(orchestrator, registry, { gatewayToken, liveKitApiSecret: channelSecret, channelOrigins: [] }) as unknown as {
    emit: (event: string, req: unknown, res: unknown) => void;
  };
  const rehearsals = rehearsalRoutes(orchestrator, controls, { gatewayToken, mintSecret: channelSecret });

  // Studio's dev server adds the runtime token to the routes it lets the browser use; here the door does the same.
  const withToken = (request: BrowserGatewayRequest): BrowserGatewayRequest => {
    const headers = { ...(request.headers ?? {}) };
    const channel = request.path.startsWith('/v1/channel/');
    if (!channel && !headers.Authorization && !headers.authorization) headers.Authorization = `Bearer ${gatewayToken}`;
    return { ...request, headers };
  };

  function dispatch(req: ReturnType<typeof fakeRequest>, res: ReturnType<typeof fakeResponse>) {
    void rehearsals(req as never, res as never).then((handled) => {
      if (!handled) server.emit('request', req, res);
    });
  }

  /** One request; resolves with the status and the body text. */
  function request(input: BrowserGatewayRequest): Promise<BrowserGatewayAnswer> {
    return new Promise((resolve) => {
      let status = 200;
      let body = '';
      const req = fakeRequest(withToken(input));
      const res = fakeResponse(
        (code) => {
          status = code;
        },
        (chunk) => {
          body += chunk;
        },
        () => resolve({ status, body })
      );
      dispatch(req, res);
    });
  }

  /** An event stream: `onText` gets the raw server-sent text as it is written. Resolves with the status once the
   *  head is written (200 for a stream); stop() ends it as a closed connection would. */
  function stream(input: BrowserGatewayRequest, onText: (text: string) => void): { opened: Promise<{ status: number; body: string }>; stop: () => void } {
    const req = fakeRequest(withToken(input));
    let stopped = false;
    let opened!: (value: { status: number; body: string }) => void;
    const openedPromise = new Promise<{ status: number; body: string }>((resolve) => {
      opened = resolve;
    });
    let isStream = false;
    let status = 200;
    let body = '';
    const res = fakeResponse(
      (code, eventStream) => {
        status = code;
        isStream = eventStream;
        if (eventStream) opened({ status, body: '' });
      },
      (chunk) => {
        if (stopped) return;
        if (isStream) onText(chunk);
        else body += chunk;
      },
      () => {
        if (!isStream) opened({ status, body });
      }
    );
    dispatch(req, res);
    return {
      opened: openedPromise,
      stop: () => {
        stopped = true;
        req.emit('close');
      },
    };
  }

  return { request, stream, hosts: orchestrator.hosts, audit };
}
