/**
 * Guard test: ChatInput must keep its core structural nodes.
 *
 * IMPORTANT: ChatInput uses a useEffect that depends on the `slashCommands`
 * prop. Always pass a stable (module-level) reference to avoid infinite
 * render loops caused by new `[]` on each render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { installMockSai } from '../helpers/ipc-mock';

// Must be hoisted before the component import
vi.mock('../../src/terminalBuffer', () => ({
  getTerminalContent: vi.fn().mockReturnValue(''),
  getTerminalLastCommand: vi.fn().mockReturnValue(''),
  getLastCommandName: vi.fn().mockReturnValue(null),
  getTerminalById: vi.fn().mockReturnValue(null),
  getTerminalByName: vi.fn().mockReturnValue(null),
  getTerminalByIndex: vi.fn().mockReturnValue(null),
  getTerminalLastCommandById: vi.fn().mockReturnValue(null),
  getTerminalLastCommandByIndex: vi.fn().mockReturnValue(null),
}));

import ChatInput from '../../src/components/Chat/ChatInput';

/** Stable empty array — prevents infinite-render from new `[]` on each render */
const STABLE_SLASH_COMMANDS: string[] = [];

const MINIMAL_PROPS = {
  onSend: vi.fn(),
  permissionMode: 'default' as const,
  onPermissionChange: vi.fn(),
  effortLevel: 'medium' as const,
  onEffortChange: vi.fn(),
  modelChoice: 'sonnet' as const,
  onModelChange: vi.fn(),
  slashCommands: STABLE_SLASH_COMMANDS,
};

describe('ChatInput structure preserved', () => {
  beforeEach(() => {
    installMockSai();
    vi.clearAllMocks();
  });

  it('renders the textarea, input-box, and toolbar', () => {
    const { container } = render(<ChatInput {...(MINIMAL_PROPS as any)} />);
    expect(container.querySelector('.chat-textarea')).not.toBeNull();
    expect(container.querySelector('.input-box')).not.toBeNull();
    expect(container.querySelector('.input-toolbar')).not.toBeNull();
  });
});
