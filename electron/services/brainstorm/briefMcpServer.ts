import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { applyBriefUpdate, type ProjectBrief } from './brief';

export const BRIEF_MCP_SERVER_NAME = 'brief';

export interface BriefMcpDeps {
  getBrief(): ProjectBrief;
  setBrief(brief: ProjectBrief): void;
}

const UPDATE_BRIEF_SHAPE = {
  projectName: z.string().optional().describe('kebab-case, ≤ 40 chars'),
  summary: z.string().optional().describe('2–4 sentences, CLAUDE.md-ready'),
  goals: z.array(z.string()).optional(),
  nonGoals: z.array(z.string()).optional().describe('explicitly out of scope'),
  stack: z.array(z.object({ name: z.string(), rationale: z.string() })).optional(),
  openQuestions: z.array(z.string()).optional(),
  ready: z.boolean().optional().describe('set true once the brief is complete'),
};

/**
 * In-process MCP server exposing `update_brief`. Fields are merged into the
 * session's brief via applyBriefUpdate; validation failures come back as tool
 * errors so the model self-corrects. `setBrief` is the single write path —
 * the service layer wraps it to emit the IPC brief event.
 */
export function buildBriefMcpServer(deps: BriefMcpDeps): McpSdkServerConfigWithInstance {
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const handler = async (args: Record<string, unknown>) => {
    const result = applyBriefUpdate(deps.getBrief(), args);
    if (!result.ok) {
      return { content: [{ type: 'text', text: `Invalid update_brief call: ${result.errors.join('; ')}` }], isError: true };
    }
    deps.setBrief(result.brief);
    return { content: [{ type: 'text', text: JSON.stringify(result.brief) }] };
  };
  handlersForTest.set('update_brief', handler);

  const tools = [tool(
    'update_brief',
    'Update the project brief with everything learned so far. Call after every user message. Provided fields replace existing values; omitted fields are kept.',
    UPDATE_BRIEF_SHAPE,
    handler as Parameters<typeof tool>[3],
  )];

  const server = createSdkMcpServer({ name: BRIEF_MCP_SERVER_NAME, version: '1.0.0', tools });
  Object.defineProperty(server, '__handlersForTest', { value: handlersForTest, enumerable: false });
  return server;
}
