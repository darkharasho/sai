import { SWARM_TOOL_SCHEMA } from '../../../src/lib/swarmOrchestratorTools';
import type { CodexDynamicTool } from './types';

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const RESERVED_NAMES = new Set(['bash', 'computer', 'container', 'web_search']);

function staticTool(tool: typeof SWARM_TOOL_SCHEMA[number]): CodexDynamicTool {
  const name = `sai_swarm_${tool.name}`;
  if (!NAME.test(name) || RESERVED_NAMES.has(name)) {
    throw new Error(`Invalid SAI Swarm Dynamic Tool name: ${name}`);
  }
  if (!tool.description || !tool.input_schema || tool.input_schema.type !== 'object') {
    throw new Error(`Invalid SAI Swarm Dynamic Tool definition: ${name}`);
  }
  return Object.freeze({
    name,
    description: tool.description,
    inputSchema: Object.freeze({
      type: 'object',
      properties: { ...tool.input_schema.properties },
      ...('required' in tool.input_schema && Array.isArray(tool.input_schema.required)
        ? { required: [...tool.input_schema.required] }
        : {}),
      additionalProperties: false,
    }),
  });
}

/**
 * The only Dynamic Tools SAI advertises to an App Server orchestrator.
 * This catalogue is built from the existing Swarm taxonomy, never renderer
 * input, and intentionally excludes generic process, filesystem, and network
 * capabilities.
 */
export const SAI_SWARM_DYNAMIC_TOOLS: readonly CodexDynamicTool[] = Object.freeze(
  SWARM_TOOL_SCHEMA.map(staticTool),
);

export function isSaiSwarmDynamicTool(name: string): boolean {
  return SAI_SWARM_DYNAMIC_TOOLS.some((tool) => tool.name === name);
}
