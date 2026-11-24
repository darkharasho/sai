import { describe, it, expect } from 'vitest';
import {
  isCanvasFile,
  canvasRelPath,
  canvasKey,
  closeDeletedCanvas,
  findOpenCanvasPath,
} from '../../../src/canvas/canvasFiles';
import type { OpenFile } from '../../../src/types';

const tab = (path: string): OpenFile => ({ path, viewMode: 'editor', content: '' });

describe('isCanvasFile', () => {
  it('matches .sai/canvas/<name>.md', () => {
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.md')).toBe(true);
    expect(isCanvasFile('/var/home/u/p/.sai/canvas/my-plan.md')).toBe(true);
  });
  it('rejects nested, non-md and non-canvas paths', () => {
    expect(isCanvasFile('/home/u/p/.sai/canvas/sub/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.txt')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/plan.md.bak')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/canvas/plan.md')).toBe(false);
    expect(isCanvasFile('/home/u/p/.sai/canvas/')).toBe(false);
  });
});

describe('canvasRelPath', () => {
  it('strips the project prefix across the /home vs /var/home symlink', () => {
    expect(canvasRelPath('/home/u/p', '/var/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
    expect(canvasRelPath('/var/home/u/p', '/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
    expect(canvasRelPath('/home/u/p/', '/home/u/p/.sai/canvas/plan.md')).toBe('.sai/canvas/plan.md');
  });
  it('returns the absolute path for files outside the project', () => {
    expect(canvasRelPath('/home/u/p', '/home/u/other/.sai/canvas/plan.md')).toBe('/home/u/other/.sai/canvas/plan.md');
    expect(canvasRelPath('/home/u/p', '/home/u/p2/.sai/canvas/plan.md')).toBe('/home/u/p2/.sai/canvas/plan.md');
  });
});

describe('canvasKey', () => {
  it('gives both spellings one key', () => {
    expect(canvasKey('/var/home/u/p/.sai/canvas/a.md')).toBe(canvasKey('/home/u/p/.sai/canvas/a.md'));
  });
});

describe('closeDeletedCanvas', () => {
  it('closes tab on delete', () => {
    const files = [tab('/home/u/p/a.ts'), tab('/home/u/p/.sai/canvas/plan.md')];
    expect(closeDeletedCanvas(files, '/var/home/u/p/.sai/canvas/plan.md')).toEqual([files[0]]);
  });
  it('keeps the same array when nothing matches', () => {
    const files = [tab('/home/u/p/a.ts')];
    expect(closeDeletedCanvas(files, '/home/u/p/.sai/canvas/plan.md')).toBe(files);
  });
});

describe('findOpenCanvasPath', () => {
  it('finds an open tab under either spelling', () => {
    const files = [tab('/home/u/p/.sai/canvas/plan.md')];
    expect(findOpenCanvasPath(files, '/var/home/u/p/.sai/canvas/plan.md')).toBe('/home/u/p/.sai/canvas/plan.md');
    expect(findOpenCanvasPath(files, '/home/u/p/.sai/canvas/other.md')).toBeNull();
  });
});

import { canvasWatchSet, workspaceAgentLive, isTextEntry, closeDeletedCanvasTabs } from '../../../src/canvas/canvasFiles';

describe('canvasWatchSet', () => {
  it('watches every store workspace still open, plus the active one', () => {
    expect(canvasWatchSet(['/b', '/a', ''], ['/a', '/b', '/c'], '/a')).toEqual(['/a', '/b']);
  });
  it('drops closed workspaces but never the active one', () => {
    expect(canvasWatchSet(['/a', '/b'], ['/a'], '/a')).toEqual(['/a']);
    expect(canvasWatchSet(['/a', '/b'], [], '/b')).toEqual(['/b']);
    expect(canvasWatchSet(['/a'], ['/a'], null)).toEqual(['/a']);
  });
});

describe('workspaceAgentLive', () => {
  const live = (t: { done: boolean }) => !t.done;
  it('is live for a streaming workspace or a live task in any of its scopes', () => {
    expect(workspaceAgentLive('/a', new Set(['/a']), new Map(), live)).toBe(true);
    expect(workspaceAgentLive('/a', new Set(), new Map([['/a:s1', [{ done: false }]]]), live)).toBe(true);
  });
  it('ignores finished tasks and other workspaces (including prefix lookalikes)', () => {
    const tasks = new Map([['/a:s1', [{ done: true }]], ['/ab:s1', [{ done: false }]], ['/b:s1', [{ done: false }]]]);
    expect(workspaceAgentLive('/a', new Set(['/b']), tasks, live)).toBe(false);
  });
});

describe('isTextEntry', () => {
  const mk = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  };
  it('counts textareas (also inside a canvas view), text inputs, contenteditable and Monaco', () => {
    const host = mk(`<div class="canvas-view"><textarea id="t"></textarea></div><input id="i"><input id="s" type="search">
      <div id="ce" contenteditable="true"></div><div class="monaco-editor"><div id="m"></div></div>`);
    for (const id of ['t', 'i', 's', 'm']) expect(isTextEntry(host.querySelector(`#${id}`))).toBe(true);
    expect(isTextEntry(document.createElement('iframe'))).toBe(true);
    const ce = host.querySelector('#ce') as HTMLElement;
    Object.defineProperty(ce, 'isContentEditable', { value: true });
    expect(isTextEntry(ce)).toBe(true);
    host.remove();
  });
  it('does not count checkboxes, buttons or the body', () => {
    const host = mk('<input id="c" type="checkbox"><button id="b">x</button><input id="r" type="radio">');
    for (const id of ['c', 'b', 'r']) expect(isTextEntry(host.querySelector(`#${id}`))).toBe(false);
    expect(isTextEntry(document.body)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    host.remove();
  });
});

describe('closeDeletedCanvasTabs', () => {
  it('moves the active tab off a deleted canvas', () => {
    const files = [tab('/home/u/p/.sai/canvas/plan.md'), tab('/home/u/p/a.ts')];
    expect(closeDeletedCanvasTabs({ openFiles: files, activeFilePath: files[0].path }, '/var/home/u/p/.sai/canvas/plan.md'))
      .toEqual({ openFiles: [files[1]], activeFilePath: '/home/u/p/a.ts' });
    const w = { openFiles: files, activeFilePath: files[1].path };
    expect(closeDeletedCanvasTabs(w, '/home/u/p/.sai/canvas/other.md')).toBe(w);
  });
});
