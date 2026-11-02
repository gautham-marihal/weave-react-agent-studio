// Types for the banking gateway built for the browser (gatewayInBrowser.js, from scripts/sandbox-gateway/entry.ts).

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

export interface BrowserGateway {
  /** One request, answered by the gateway's own routes. */
  request: (input: BrowserGatewayRequest) => Promise<BrowserGatewayAnswer>;
  /** An event stream: raw server-sent text as it is written; `opened` resolves once the head is written. */
  stream: (input: BrowserGatewayRequest, onText: (text: string) => void) => { opened: Promise<BrowserGatewayAnswer>; stop: () => void };
  /** Always 'mock': this gateway runs on the mock bank systems. */
  readonly hosts: 'mock';
  /** The audit records the gateway wrote, kept in this page. */
  readonly audit: unknown[];
}

export function createBrowserGateway(): BrowserGateway;
