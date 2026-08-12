import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';
import { getSaiToolDispatch, type SaiToolDispatch } from '../saiToolBridge';

const PREFIX = 'sai_swarm_';
const MAX_DEPTH = 4;
const MAX_FIELDS = 20;
const MAX_ITEMS = 20;
const MAX_TEXT = 2_000;
const MAX_RESULT_TEXT = 8_000;
const SENSITIVE_KEY = /(?:secret|token|password|authorization|api[_-]?key|credential)/i;

type Schema = Record<string, unknown>;

export interface SaiSwarmDynamicToolCall {
  tool: string;
  arguments: unknown;
}

export interface ValidSaiSwarmDynamicToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface AppServerDynamicToolResponse {
  success: boolean;
  contentItems: Array<{ type: 'inputText'; text: string }>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined;
}

function schemaFor(name: string): Schema | undefined {
  return SWARM_TOOL_SCHEMA.find((tool) => tool.name === name)?.input_schema as Schema | undefined;
}

function isSchemaValue(schema: Schema, value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  const type = schema.type;
  if (type === 'string') {
    if (typeof value !== 'string' || value.length > MAX_TEXT) return false;
    return !Array.isArray(schema.enum) || schema.enum.includes(value);
  }
  if (type === 'array') {
    return Array.isArray(value) && value.length <= MAX_ITEMS && record(schema.items) !== undefined
      && value.every((item) => isSchemaValue(schema.items as Schema, item, depth + 1));
  }
  if (type !== 'object') return false;
  const input = record(value);
  const properties = record(schema.properties) ?? {};
  if (!input || Object.keys(input).length > MAX_FIELDS || Object.keys(input).some((key) => !(key in properties))) return false;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.some((key) => typeof key !== 'string' || !(key in input))) return false;
  return Object.entries(input).every(([key, item]) => isSchemaValue(properties[key] as Schema, item, depth + 1));
}

/** Validates an experimental wire call against SAI's fixed main-process catalogue. */
export function validateSaiSwarmDynamicToolCall(value: unknown): ValidSaiSwarmDynamicToolCall | undefined {
  const call = record(value);
  if (!call || typeof call.tool !== 'string' || !call.tool.startsWith(PREFIX)) return undefined;
  const tool = call.tool.slice(PREFIX.length);
  const schema = schemaFor(tool);
  const input = record(call.arguments);
  if (!schema || !input || !isSchemaValue(schema, input)) return undefined;
  return { tool, input };
}

function safeResult(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '[invalid number]';
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((entry) => safeResult(entry, depth + 1));
  const input = record(value);
  if (!input) return '[unsupported result]';
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input).slice(0, MAX_FIELDS)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : safeResult(entry, depth + 1);
  }
  return output;
}

/** Creates the bounded protocol result shape; errors never echo host exception text. */
export function dynamicToolResponse(value: unknown, failed = false): AppServerDynamicToolResponse {
  if (failed) return { success: false, contentItems: [{ type: 'inputText', text: 'Dynamic tool failed' }] };
  let text: string;
  try { text = JSON.stringify(safeResult(value)); } catch { text = '"[unserializable result]"'; }
  if (text.length > MAX_RESULT_TEXT) text = `${text.slice(0, MAX_RESULT_TEXT)}…[truncated]`;
  return { success: true, contentItems: [{ type: 'inputText', text }] };
}

/** Executes only a validated Swarm operation through the existing main-process renderer bridge. */
export async function dispatchSaiSwarmDynamicTool(
  call: ValidSaiSwarmDynamicToolCall,
  ownership: { workspace: string; scope: string },
  dispatch: SaiToolDispatch | null = getSaiToolDispatch(),
): Promise<AppServerDynamicToolResponse> {
  if (!dispatch) return dynamicToolResponse(undefined, true);
  try {
    const result = await dispatch({
      tool: call.tool,
      input: call.input,
      workspace: ownership.workspace,
      scope: ownership.scope,
      suppressSyntheticCard: true,
    });
    return dynamicToolResponse(result);
  } catch {
    return dynamicToolResponse(undefined, true);
  }
}
