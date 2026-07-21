import type {
  ApprovalMode,
  CodexOptions,
  Input,
  ModelReasoningEffort,
  SandboxMode,
  ThreadOptions,
} from '@openai/codex-sdk';
import type { CodexPermission } from './types';

const EFFORTS: ReadonlySet<unknown> = new Set<ModelReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export interface CodexSdkOptionInput {
  cwd: string;
  permission?: CodexPermission;
  effort?: ModelReasoningEffort;
  model?: string;
  metaPreamble?: string;
  additionalDirectories?: readonly string[];
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

function isModelReasoningEffort(effort: unknown): effort is ModelReasoningEffort {
  return EFFORTS.has(effort);
}

export function buildCodexSdkOptions(input: CodexSdkOptionInput): BuiltCodexSdkOptions {
  const thread: ThreadOptions = {
    workingDirectory: input.cwd,
    ...permissionOptions(input.permission),
  };

  if (input.model) thread.model = input.model;
  if (isModelReasoningEffort(input.effort)) thread.modelReasoningEffort = input.effort;
  if (input.additionalDirectories?.length) {
    thread.additionalDirectories = [...input.additionalDirectories];
  }

  return {
    thread,
    clientConfig: input.metaPreamble
      ? { developer_instructions: input.metaPreamble }
      : {},
  };
}

export function buildCodexInput(message: string, imagePaths?: string[]): Input {
  if (!imagePaths?.length) return message;

  return [
    { type: 'text', text: message },
    ...imagePaths.map((path) => ({ type: 'local_image' as const, path })),
  ];
}
