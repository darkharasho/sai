import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMockSai } from '../../helpers/ipc-mock';
import { setHomeInfo, resetHomeInfo } from '../../../src/lib/homeWorkspace';

import CommandPalette from '../../../src/components/CommandPalette';

const HOME = '/var/home/tester';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  fileIndex: [] as any[],
  slashCommands: [] as any[],
  projectPath: '/var/home/tester/code/app',
  onFileOpen: vi.fn(),
  onCommand: vi.fn(),
  onWorkspaceSwitch: vi.fn(),
};

/** Enter the sessions ("@") mode of the palette. */
const openSessions = () => {
  const input = document.querySelector('.cp-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '@' } });
};

describe('CommandPalette Home workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockSai();
    resetHomeInfo();
    setHomeInfo({ path: HOME, aliases: ['/home/tester', HOME] });
  });

  it('labels the home workspace "Home" instead of the folder basename', () => {
    render(
      <CommandPalette
        {...baseProps}
        workspaces={[{ projectPath: HOME, status: 'active' }] as any}
      />,
    );
    openSessions();

    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.queryByText('tester')).toBeNull();
  });

  it('finds the home workspace when searching for "home"', () => {
    render(
      <CommandPalette
        {...baseProps}
        workspaces={[
          { projectPath: HOME, status: 'active' },
          { projectPath: '/opt/other', status: 'active' },
        ] as any}
      />,
    );
    openSessions();
    const input = document.querySelector('.cp-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'home' } });

    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.queryByText('other')).toBeNull();
  });
});
