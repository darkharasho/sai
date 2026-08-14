import type {
  ApprovalMode,
  CodexOptions,
  Input,
  ModelReasoningEffort,
  SandboxMode,
  ThreadOptions,
} from '@openai/codex-sdk';
import type { CodexPermission } from './types';
import type { CodexReasoningEffort } from './types';

const EFFORTS: ReadonlySet<unknown> = new Set<ModelReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max' as ModelReasoningEffort,
  'ultra' as ModelReasoningEffort,
]);

export interface CodexSdkOptionInput {
  cwd: string;
  permission?: CodexPermission;
  effort?: CodexReasoningEffort;
  model?: string;
  metaPreamble?: string;
  additionalDirectories?: readonly string[];
  /** Process-scoped configuration supplied by SAI (for example its chat MCP server). */
  clientConfig?: NonNullable<CodexOptions['config']>;
}

export interface BuiltCodexSdkOptions {
  thread: ThreadOptions;
  clientConfig: NonNullable<CodexOptions['config']>;
}

function permissionOptions(permission: CodexPermission | undefined): {
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalMode;
} {
  switch (permission) {
    case undefined:
    case 'auto':
      return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' };
    case 'read-only':
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
    case 'full-access':
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
    default:
      return { sandboxMode: 'read-only', approvalPolicy: 'never' };
  }
}

function isModelReasoningEffort(effort: unknown): effort is CodexReasoningEffort {
  return EFFORTS.has(effort);
}

export function buildCodexSdkOptions(input: CodexSdkOptionInput): BuiltCodexSdkOptions {
  const thread: ThreadOptions = {
    workingDirectory: input.cwd,
    ...permissionOptions(input.permission),
  };

  if (input.model) thread.model = input.model;
  // The bundled native CLI advertises newer dynamic values (currently max and
  // ultra) before the SDK's TypeScript union catches up; the runtime forwards
  // this field as model_reasoning_effort config without narrowing it.
  if (isModelReasoningEffort(input.effort)) thread.modelReasoningEffort = input.effort as ModelReasoningEffort;
  if (input.additionalDirectories?.length) {
    thread.additionalDirectories = [...input.additionalDirectories];
  }

  const clientConfig = { ...(input.clientConfig ?? {}) };
  const suppliedInstructions = typeof clientConfig.developer_instructions === 'string'
    ? clientConfig.developer_instructions.trim()
    : '';
  const metaPreamble = input.metaPreamble?.trim() ?? '';
  const developerInstructions = [suppliedInstructions, metaPreamble].filter(Boolean).join('\n\n');
  if (developerInstructions) clientConfig.developer_instructions = developerInstructions;

  return { thread, clientConfig };
}

export function buildCodexInput(message: string, imagePaths?: string[]): Input {
  if (!imagePaths?.length) return message;

  return [
    { type: 'text', text: message },
    ...imagePaths.map((path) => ({ type: 'local_image' as const, path })),
  ];
}
