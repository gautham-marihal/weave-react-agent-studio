export type FormFieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'checkbox';

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
}

export interface FormRequest {
  request_id: string;
  title: string;
  fields: FormField[];
}

export interface ChatMessage {
  id: string;
  from: 'agent' | 'user' | 'system';
  text: string;
  via?: 'voice' | 'text';
  /** Still being spoken or streamed; the text will change. */
  partial?: boolean;
  form?: FormRequest;
  formStatus?: 'open' | 'accepted';
  /** Made up in this browser by Sandbox's imitation, not said by the agent. */
  sandbox?: boolean;
}

export type TraceKind = 'session' | 'agent' | 'llm' | 'tool' | 'handoff' | 'form' | 'end' | 'error';

export interface TraceEvent {
  id: string;
  at_ms: number;
  kind: TraceKind;
  label: string;
  detail?: string;
  status?: 'ok' | 'error' | 'info';
  /** The call record this row was read from, when it came from the call's stream (shown as its raw fields). */
  raw?: unknown;
}
