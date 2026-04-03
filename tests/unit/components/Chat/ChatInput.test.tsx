/**
 * ChatInput unit tests.
 *
 * IMPORTANT: ChatInput uses a useEffect that depends on the `slashCommands`
 * prop.  If `slashCommands` is not passed (triggering the default `[]` param),
 * React sees a new array reference on every render and creates an infinite
 * render loop.  Always pass `STABLE_SLASH_COMMANDS` so the reference stays
 * constant across renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

// Must be hoisted before the component import
vi.mock('../../../../src/terminalBuffer', () => ({
  getTerminalContent: vi.fn().mockReturnValue(''),
  getTerminalLastCommand: vi.fn().mockReturnValue(''),
  getLastCommandName: vi.fn().mockReturnValue(null),
  getTerminalById: vi.fn().mockReturnValue(null),
  getTerminalByName: vi.fn().mockReturnValue(null),
  getTerminalByIndex: vi.fn().mockReturnValue(null),
}));

import ChatInput from '../../../../src/components/Chat/ChatInput';

/** Stable empty array to prevent infinite-render caused by new `[]` on each render */
const STABLE_SLASH_COMMANDS: string[] = [];

const defaultProps = {
  onSend: vi.fn(),
  permissionMode: 'default' as const,
  onPermissionChange: vi.fn(),
  effortLevel: 'medium' as const,
  onEffortChange: vi.fn(),
  modelChoice: 'sonnet' as const,
  onModelChange: vi.fn(),
  // Always provide a stable reference so the slashCommands useEffect
  // dependency doesn't change every render.
  slashCommands: STABLE_SLASH_COMMANDS,
};

describe('ChatInput', () => {
  beforeEach(() => {
    installMockSai();
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('renders a textarea for input', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('updates value when user types', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello Claude' } });
    expect(textarea.value).toBe('Hello Claude');
  });

  it('calls onSend with message when Enter is pressed', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    // Images array is omitted (undefined) when no images attached
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('does not call onSend on Shift+Enter (newline)', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not call onSend when message is empty', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears textarea after sending', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(textarea.value).toBe('');
  });

  it('shows approval panel when pendingApproval is provided', () => {
    const pendingApproval = {
      toolName: 'Bash',
      toolUseId: 'tu-1',
      command: 'rm -rf /tmp/test',
      description: 'Remove temp files',
      input: {},
    };
    render(
      <ChatInput
        {...defaultProps}
        pendingApproval={pendingApproval}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onAlwaysAllow={vi.fn()}
      />
    );
    expect(screen.getByText('Bash')).toBeTruthy();
  });

  it('renders without pendingApproval (no approval panel)', () => {
    render(<ChatInput {...defaultProps} pendingApproval={null} />);
    expect(screen.queryByText('Approve')).toBeNull();
  });

  it('shows streaming state correctly', () => {
    const { container } = render(
      <ChatInput {...defaultProps} isStreaming={true} onStop={vi.fn()} />
    );
    expect(container).toBeTruthy();
  });

  describe('message queueing', () => {
    it('calls onQueue on Ctrl+Enter when streaming and queue not full', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).toHaveBeenCalledWith('queued message');
    });

    it('clears input after queueing', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(textarea.value).toBe('');
    });

    it('does not queue when at max capacity (5)', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={5}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });

    it('does not queue when not streaming (Ctrl+Enter is no-op)', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={false}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'queued message' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });

    it('does not queue when input is empty', () => {
      const onQueue = vi.fn();
      render(
        <ChatInput
          {...defaultProps}
          isStreaming={true}
          onQueue={onQueue}
          queueCount={0}
        />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onQueue).not.toHaveBeenCalled();
    });
  });

  describe('@terminal:last autocomplete', () => {
    it('shows @terminal:last suggestion when typing @t', async () => {
      render(<ChatInput {...defaultProps} slashCommands={STABLE_SLASH_COMMANDS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@t' } });
      expect(await screen.findByText('@terminal')).toBeTruthy();
      expect(await screen.findByText('@terminal:last')).toBeTruthy();
    });

    it('shows only @terminal:last when typing @terminal:', async () => {
      render(<ChatInput {...defaultProps} slashCommands={STABLE_SLASH_COMMANDS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@terminal:' } });
      expect(await screen.findByText('@terminal:last')).toBeTruthy();
      expect(screen.queryByText('@terminal')).toBeNull();
    });
  });

  describe('terminalTabs prop', () => {
    const STABLE_TERMINAL_TABS = [
      { uid: 1, id: 1, name: null, order: 1 },
      { uid: 2, id: 2, name: 'server', order: 2 },
    ];

    it('accepts terminalTabs prop without errors', () => {
      render(<ChatInput {...defaultProps} terminalTabs={STABLE_TERMINAL_TABS} />);
      expect(screen.getByRole('textbox')).toBeTruthy();
    });

    it('shows tab-number suggestion when typing @terminal:1', async () => {
      const { container } = render(<ChatInput {...defaultProps} terminalTabs={STABLE_TERMINAL_TABS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@terminal:1' } });
      // Wait for the autocomplete dropdown to appear with the tab suggestion
      const dropdown = await screen.findByText('Tab 1 — full buffer');
      expect(dropdown).toBeTruthy();
      // Also verify the label is in the dropdown
      const labels = container.querySelectorAll('.ac-label');
      const labelTexts = Array.from(labels).map(el => el.textContent);
      expect(labelTexts).toContain('@terminal:1');
    });

    it('shows tab-name suggestion when typing @terminal:se', async () => {
      const { container } = render(<ChatInput {...defaultProps} terminalTabs={STABLE_TERMINAL_TABS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@terminal:se' } });
      // Wait for the description to appear as a unique identifier
      const desc = await screen.findByText('Tab "server" — full buffer');
      expect(desc).toBeTruthy();
      const labels = container.querySelectorAll('.ac-label');
      const labelTexts = Array.from(labels).map(el => el.textContent);
      expect(labelTexts).toContain('@terminal:server');
    });

    it('shows :last variant for tab number', async () => {
      render(<ChatInput {...defaultProps} terminalTabs={STABLE_TERMINAL_TABS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@terminal:1:' } });
      expect(await screen.findByText('@terminal:1:last')).toBeTruthy();
    });
  });
});
