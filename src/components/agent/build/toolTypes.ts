import type { ToolDefinition, ToolType } from '../../../types/studio';

const typeLabel: Record<ToolType, string> = {
  builtin: 'Built in',
  task: 'Runs a task',
  http: 'Calls an API',
  mcp: 'MCP server',
  knowledge: 'Searches documents',
  code: 'Runs code',
};

const builtinLabel: Record<string, string> = {
  end_call: 'Ends the conversation',
  transfer_or_callback: 'Passes to a person',
  return_to_entry: 'Goes back to the first agent',
  send_dtmf: 'Presses phone keys',
  collect_dtmf: 'Reads phone keys',
  send_form: 'Shows a form',
  noop: 'Runs its effects',
};

/** What a tool does, in words. */
export const toolLabel = (tool: Pick<ToolDefinition, 'type' | 'builtin'>): string =>
  (tool.type === 'builtin' && tool.builtin && builtinLabel[tool.builtin]) || typeLabel[tool.type] || String(tool.type);
