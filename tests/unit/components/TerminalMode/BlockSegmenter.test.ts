import { describe, it, expect } from 'vitest';
import { BlockSegmenter } from '../../../../src/components/TerminalMode/BlockSegmenter';

describe('BlockSegmenter', () => {
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
    const seg = new BlockSegmenter();
    const blocks: any[] = [];
    seg.onBlock((block) => blocks.push(block));

    seg.feed('user@host:~$ sleep 1\n');
    seg.feed('user@host:~$ ');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].duration).toBeGreaterThanOrEqual(0);
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
});
