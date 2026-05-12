import { describe, expect, it } from 'vitest';
import {
  buildOrchestratorSystemPrompt,
  resolveOrchestratorPromptContext,
  ORCHESTRATOR_PROMPT_DEFAULTS,
  type OrchestratorPromptContext,
} from '../../src/lib/orchestratorSystemPrompt';

const sampleCtx: OrchestratorPromptContext = {
  workspaceName: 'sai',
  workspacePath: '/home/me/projects/sai',
  defaultProvider: 'claude',
  defaultModel: 'opus',
  defaultApprovalPolicy: 'auto-read',
  concurrencyCap: 5,
};

describe('buildOrchestratorSystemPrompt', () => {
  const prompt = buildOrchestratorSystemPrompt(sampleCtx);

  it('frames the model as the swarm orchestrator (not a coding assistant)', () => {
    expect(prompt).toMatch(/swarm orchestrator/i);
    expect(prompt).toMatch(/planner and dispatcher, not a coder/i);
  });

  it('explicitly forbids non-swarm tools', () => {
    expect(prompt).toContain('MUST NOT use any tool other than mcp__swarm__*');
  });

  it('forbids the model from doing the work itself', () => {
    expect(prompt).toContain('MUST NOT do the work yourself');
  });

  it('names every swarm tool at least once', () => {
    for (const tool of [
      'spawn_task',
      'spawn_tasks',
      'query_status',
      'pause_task',
      'resume_task',
      'approve_tool_call',
      'deny_tool_call',
      'land',
      'discard',
    ]) {
      expect(prompt, `expected tool name "${tool}" in prompt`).toContain(tool);
    }
  });

  it('interpolates workspace name and path', () => {
    expect(prompt).toContain('"sai"');
    expect(prompt).toContain('/home/me/projects/sai');
  });

  it('interpolates workspace defaults', () => {
    expect(prompt).toContain('claude');
    expect(prompt).toContain('opus');
    expect(prompt).toContain('auto-read');
    expect(prompt).toMatch(/Concurrency cap: 5/);
  });

  it('steers toward terse, action-oriented responses', () => {
    expect(prompt).toMatch(/Be terse|No apologies|Terse\./);
  });

  it('changes when context changes (workspace name interpolation actually works)', () => {
    const other = buildOrchestratorSystemPrompt({ ...sampleCtx, workspaceName: 'other-repo' });
    expect(other).toContain('"other-repo"');
    expect(other).not.toContain('"sai"');
  });
});

describe('resolveOrchestratorPromptContext', () => {
  it('returns defaults when given nothing', () => {
    expect(resolveOrchestratorPromptContext()).toEqual(ORCHESTRATOR_PROMPT_DEFAULTS);
    expect(resolveOrchestratorPromptContext(null)).toEqual(ORCHESTRATOR_PROMPT_DEFAULTS);
  });

  it('fills missing fields from defaults', () => {
    const merged = resolveOrchestratorPromptContext({ workspaceName: 'foo' });
    expect(merged.workspaceName).toBe('foo');
    expect(merged.defaultProvider).toBe(ORCHESTRATOR_PROMPT_DEFAULTS.defaultProvider);
    expect(merged.concurrencyCap).toBe(ORCHESTRATOR_PROMPT_DEFAULTS.concurrencyCap);
  });

  it('rejects non-positive concurrencyCap and falls back to default', () => {
    expect(resolveOrchestratorPromptContext({ concurrencyCap: 0 }).concurrencyCap)
      .toBe(ORCHESTRATOR_PROMPT_DEFAULTS.concurrencyCap);
    expect(resolveOrchestratorPromptContext({ concurrencyCap: -1 }).concurrencyCap)
      .toBe(ORCHESTRATOR_PROMPT_DEFAULTS.concurrencyCap);
  });
});
