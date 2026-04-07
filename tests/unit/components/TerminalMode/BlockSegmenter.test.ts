import { describe, it, expect, vi, afterEach } from 'vitest';
import { BlockSegmenter } from '../../../../src/components/TerminalMode/BlockSegmenter';

describe('BlockSegmenter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a block when prompt is detected after command output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ ls\n');
    seg.feed('file1.txt  file2.txt\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ls');
    expect(blocks[0].output).toContain('file1.txt');
  });

  it('detects the initial prompt without creating a block', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(0);
    expect(seg.currentPrompt).toBe('user@host:~$ ');
  });

  it('handles prompt changes during SSH', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@local:~$ ssh deploy@prod\n');
    seg.feed('Welcome to Ubuntu\n');
    seg.feed('deploy@prod:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ssh deploy@prod');
    expect(seg.currentPrompt).toContain('deploy@prod');
  });

  it('tracks block duration from prompt to prompt', () => {
    vi.useFakeTimers();

    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ sleep 1\n');

    // Advance time by 500ms before the second prompt arrives
    vi.advanceTimersByTime(500);

    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].duration).toBeGreaterThanOrEqual(500);
  });

  it('detects alternate screen buffer entry', () => {
    const seg = new BlockSegmenter();
    let altScreen = false;
    seg.onAltScreen((entered) => { altScreen = entered; });

    seg.feed('user@host:~$ vim file.txt\n');
    seg.feed('\x1b[?1049h');

    expect(altScreen).toBe(true);
  });

  it('detects alternate screen buffer exit', () => {
    const seg = new BlockSegmenter();
    let altScreen = false;
    seg.onAltScreen((entered) => { altScreen = entered; });

    seg.feed('\x1b[?1049h');
    expect(altScreen).toBe(true);

    seg.feed('\x1b[?1049l');
    expect(altScreen).toBe(false);
  });

  it('suppresses segmentation while in alt-screen mode', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ vim file.txt\n');
    seg.feed('\x1b[?1049h');
    // These would look like prompts if parsed, but should be ignored
    seg.feed('user@host:~$ some command\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(0);
  });

  it('resumes segmentation after alt-screen exit', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ ');
    seg.feed('\x1b[?1049h');
    seg.feed('\x1b[?1049l');
    seg.feed('user@host:~$ ls\n');
    seg.feed('file.txt\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('ls');
  });

  it('handles empty commands (bare Enter)', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ \n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('');
    expect(blocks[0].output).toBe('');
  });

  it('handles commands with no output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ cd /tmp\n');
    seg.feed('user@host:/tmp$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('cd /tmp');
    expect(blocks[0].output).toBe('');
  });

  it('strips ANSI codes from command and output', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ echo hi\n');
    seg.feed('hi\n');
    seg.feed('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe('echo hi');
    expect(blocks[0].output).toBe('hi');
  });

  it('does not emit a spurious empty block on double-prompt (e.g. terminal resize)', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    // First prompt sets up state
    seg.feed('user@host:~$ ');
    // Second prompt arrives immediately with no pending lines (resize scenario)
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(0);
  });

  it('uses isRemote based on initial prompt comparison', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    // Initial prompt (no @ needed)
    seg.feed('$ ');
    seg.feed('$ ssh user@remote\n');
    seg.feed('output\n');
    seg.feed('user@remote:~$ ');

    expect(blocks).toHaveLength(1);
    // Prompt changed from initial '$' — should be isRemote
    expect(blocks[0].isRemote).toBe(true);
  });

  it('isRemote is false when prompt stays the same as initial', () => {
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ ');
    seg.feed('user@host:~$ ls\n');
    seg.feed('file.txt\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].isRemote).toBe(false);
  });

  it('idCounter is instance-scoped (two instances do not share state)', () => {
    const seg1 = new BlockSegmenter();
    const seg2 = new BlockSegmenter();
    const blocks1: any[] = [];
    const blocks2: any[] = [];
    seg1.onBlock((b) => blocks1.push(b));
    seg2.onBlock((b) => blocks2.push(b));

    seg1.feed('user@host:~$ cmd\n');
    seg1.feed('user@host:~$ ');

    seg2.feed('user@host:~$ cmd\n');
    seg2.feed('user@host:~$ ');

    // Both should start their own id sequences from 1
    expect(blocks1[0].id).toBe('seg-block-1');
    expect(blocks2[0].id).toBe('seg-block-1');
  });
});
