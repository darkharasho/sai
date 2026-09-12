import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';
import { resetHomeInfo, setHomeInfo } from '../../../src/lib/homeWorkspace';

import CommandPalette from '../../../src/components/CommandPalette';

const HOME = '/var/home/tester';

const baseProps = {
  onClose: vi.fn(),
  fileIndex: ['src/app.ts'] as any[],
  slashCommands: [] as any[],
  workspaces: [{ projectPath: '/opt/other', status: 'active' }] as any[],
  projectPath: '/var/home/tester/code/app',
  onFileOpen: vi.fn(),
  onCommand: vi.fn(),
  onWorkspaceSwitch: vi.fn(),
};

const placeholder = () =>
  (document.querySelector('.cp-input') as HTMLInputElement).placeholder;

describe('CommandPalette initialMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockSai();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
    resetHomeInfo();
    setHomeInfo({ path: HOME, aliases: [HOME] });
  });

  it('opens on the Files tab by default', () => {
    render(<CommandPalette {...baseProps} open />);
    expect(placeholder()).toBe('Search files...');
  });

  it('opens directly on the Sessions tab when asked', () => {
    render(<CommandPalette {...baseProps} open initialMode="sessions" />);
    expect(placeholder()).toBe('Switch session...');
    expect(screen.getByText('other')).toBeTruthy();
  });

  it('lands on Sessions when reopened with the sessions hotkey', () => {
    const { rerender } = render(<CommandPalette {...baseProps} open />);
    expect(placeholder()).toBe('Search files...');

    rerender(<CommandPalette {...baseProps} open={false} initialMode="sessions" />);
    rerender(<CommandPalette {...baseProps} open initialMode="sessions" />);
    expect(placeholder()).toBe('Switch session...');
  });
});
