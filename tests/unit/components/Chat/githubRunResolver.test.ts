import { describe, it, expect } from 'vitest';
import {
  parseRunUrl,
  watchTargetFromToolCall,
  watchTargetsFromMessage,
} from '../../../../src/components/Chat/githubRunResolver';

describe('parseRunUrl', () => {
  it('parses a real run URL', () => {
    expect(parseRunUrl('https://github.com/darkharasho/sai/actions/runs/123456')).toEqual({
      kind: 'run', owner: 'darkharasho', repo: 'sai', runId: '123456',
      url: 'https://github.com/darkharasho/sai/actions/runs/123456',
    });
  });

  it('strips trailing path segments like /job/789', () => {
    const t = parseRunUrl('https://github.com/o/r/actions/runs/42/job/789');
    expect(t).toMatchObject({ owner: 'o', repo: 'r', runId: '42' });
    expect(t!.url).toBe('https://github.com/o/r/actions/runs/42');
  });

  it('parses dev fake-run URLs', () => {
    expect(parseRunUrl('sai://fake-run/demo1?outcome=failure&speed=fast')).toEqual({
      kind: 'run', owner: 'fake', repo: 'fake', runId: 'demo1',
      url: 'sai://fake-run/demo1?outcome=failure&speed=fast',
    });
  });

  it('rejects non-run URLs', () => {
    expect(parseRunUrl('https://github.com/o/r/pull/5')).toBeNull();
    expect(parseRunUrl('not a url')).toBeNull();
  });
});

describe('watchTargetFromToolCall', () => {
  it('ignores tool calls with other names', () => {
    expect(watchTargetFromToolCall({ name: 'sai_render_html', input: '{}', output: '{}' })).toBeNull();
  });

  it('builds a target from the resolved tool output (MCP-prefixed name)', () => {
    const out = JSON.stringify({
      owner: 'o', repo: 'r', runId: '99',
      url: 'https://github.com/o/r/actions/runs/99', status: 'in_progress',
    });
    expect(watchTargetFromToolCall({
      name: 'mcp__swarm__sai_watch_github_run',
      input: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }),
      output: out,
    })).toEqual({
      kind: 'run', owner: 'o', repo: 'r', runId: '99',
      url: 'https://github.com/o/r/actions/runs/99',
    });
  });

  it('falls back to parsing the input url when there is no output yet', () => {
    expect(watchTargetFromToolCall({
      name: 'mcp__swarm__sai_watch_github_run',
      input: JSON.stringify({ url: 'https://github.com/o/r/actions/runs/7' }),
      output: undefined,
    })).toMatchObject({ owner: 'o', repo: 'r', runId: '7' });
  });

  it('returns null for branch-mode input with no output yet', () => {
    expect(watchTargetFromToolCall({
      name: 'sai_watch_github_run',
      input: JSON.stringify({ owner: 'o', repo: 'r', branch: 'main' }),
      output: undefined,
    })).toBeNull();
  });

  it('tolerates unparseable output by falling back to input', () => {
    expect(watchTargetFromToolCall({
      name: 'sai_watch_github_run',
      input: JSON.stringify({ url: 'https://github.com/o/r/actions/runs/7' }),
      output: 'Error: kaboom',
    })).toMatchObject({ runId: '7' });
  });
});

describe('watchTargetsFromMessage', () => {
  it('collects targets from watch tool calls, deduped by url', () => {
    const out = JSON.stringify({ owner: 'o', repo: 'r', runId: '5', url: 'https://github.com/o/r/actions/runs/5' });
    const tc = { id: 'a', type: 'mcp' as const, name: 'mcp__swarm__sai_watch_github_run', input: '{}', output: out };
    const msg = { toolCalls: [tc, { ...tc, id: 'b' }] };
    const targets = watchTargetsFromMessage(msg);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ owner: 'o', repo: 'r', runId: '5' });
  });

  it('returns [] for messages without watch tool calls', () => {
    expect(watchTargetsFromMessage({ toolCalls: [] })).toEqual([]);
    expect(watchTargetsFromMessage({})).toEqual([]);
  });
});
