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
import userEvent from '@testing-library/user-event';
import { installMockSai } from '../../../helpers/ipc-mock';
import type { UsageLimitView } from '../../../../src/lib/composerTelemetry';

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

/** Stable base props for the shared-telemetry ring/popover tests below. */
const baseProps = () => ({ ...defaultProps });

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
      expect(onQueue).toHaveBeenCalledWith('queued message', 'queued message', undefined, undefined);
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

    it('opens the @ autocomplete immediately on a bare @', async () => {
      render(<ChatInput {...defaultProps} slashCommands={STABLE_SLASH_COMMANDS} />);
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '@' } });
      expect(await screen.findByText('@terminal')).toBeTruthy();
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

  describe('capability-gated toolbar controls', () => {
    it('never refreshes Codex models when opening the Claude model selector', () => {
      const onCodexModelsRefresh = vi.fn();
      render(<ChatInput {...defaultProps} aiProvider="claude" onCodexModelsRefresh={onCodexModelsRefresh} />);
      fireEvent.click(screen.getByText('Sonnet').closest('button')!);
      expect(onCodexModelsRefresh).not.toHaveBeenCalled();
    });

    it('refreshes Codex models when opening the Codex model selector', () => {
      const onCodexModelsRefresh = vi.fn();
      render(<ChatInput {...defaultProps} aiProvider="codex" codexModel="gpt-5" codexModels={[]} onCodexModelsRefresh={onCodexModelsRefresh} />);
      fireEvent.click(screen.getByText('gpt-5').closest('button')!);
      expect(onCodexModelsRefresh).toHaveBeenCalledTimes(1);
    });

    it('renders effort mode button for claude', () => {
      const { container } = render(
        <ChatInput {...defaultProps} aiProvider="claude" />
      );
      expect(container.querySelector('.effort-btn')).toBeTruthy();
    });

    it('hides effort mode button for gemini', () => {
      const { container } = render(
        <ChatInput {...defaultProps} aiProvider="gemini" />
      );
      expect(container.querySelector('.effort-btn')).toBeNull();
    });

    it('cycles Codex effort independently through ultra and minimal', () => {
      const onCodexEffortChange = vi.fn();
      const { rerender } = render(
        <ChatInput {...defaultProps} effortLevel="max" aiProvider="codex" codexEffort="ultra" onCodexEffortChange={onCodexEffortChange} />
      );
      fireEvent.click(screen.getByLabelText('Codex effort: ultra'));
      expect(onCodexEffortChange).toHaveBeenCalledWith('minimal');
      rerender(<ChatInput {...defaultProps} effortLevel="max" aiProvider="codex" codexEffort="minimal" onCodexEffortChange={onCodexEffortChange} />);
      fireEvent.click(screen.getByLabelText('Codex effort: minimal'));
      expect(onCodexEffortChange).toHaveBeenLastCalledWith('low');
    });

    it('cycles only efforts supported by the selected Codex model', () => {
      const onCodexEffortChange = vi.fn();
      render(<ChatInput {...defaultProps} aiProvider="codex" codexModel="no-min" codexEffort="minimal"
        codexModels={[{ id: 'no-min', name: 'No Minimal', supportedReasoningEfforts: ['low', 'high', 'xhigh'], defaultReasoningEffort: 'high' }]}
        onCodexEffortChange={onCodexEffortChange} />);
      const button = screen.getByLabelText('Codex effort: high');
      fireEvent.click(button);
      expect(onCodexEffortChange).toHaveBeenCalledWith('xhigh');
    });

    it('hides reasoning effort when the selected Codex model explicitly supports none', () => {
      render(<ChatInput {...defaultProps} aiProvider="codex" codexModel="none"
        codexModels={[{ id: 'none', name: 'None', supportedReasoningEfforts: [] }]} />);
      expect(screen.queryByLabelText(/Codex effort:/)).toBeNull();
    });

    it('renders conversation mode toggle for gemini', () => {
      render(
        <ChatInput {...defaultProps} aiProvider="gemini" geminiConversationMode="planning" />
      );
      expect(screen.getByTitle('Conversation mode: planning')).toBeTruthy();
    });

    it('hides conversation mode toggle for claude', () => {
      render(
        <ChatInput {...defaultProps} aiProvider="claude" />
      );
      expect(screen.queryByTitle(/Conversation mode/)).toBeNull();
    });

    it('hides conversation mode toggle for codex', () => {
      render(
        <ChatInput {...defaultProps} aiProvider="codex" />
      );
      expect(screen.queryByTitle(/Conversation mode/)).toBeNull();
    });

  });

  it('calls onBeforeSend with a DOMRect immediately before onSend on Enter', () => {
    const order: string[] = [];
    const onSend = vi.fn(() => { order.push('send'); });
    const onBeforeSend = vi.fn((rect: DOMRect) => {
      order.push('before');
      expect(rect).toBeDefined();
      expect(typeof rect.left).toBe('number');
    });

    render(
      <ChatInput
        {...defaultProps}
        onSend={onSend}
        onBeforeSend={onBeforeSend}
      />
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(onBeforeSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['before', 'send']);
  });

  describe('provider-neutral context ring', () => {
    it('renders a read-only Codex context ring only when a total is known', async () => {
      const onSend = vi.fn();
      const { rerender } = render(<ChatInput {...baseProps()} aiProvider="codex" onSend={onSend}
        contextUsage={{ used: 2_000, total: 10_000, inputTokens: 1_700, cachedInputTokens: 500, cacheCreationTokens: 0, outputTokens: 300, reasoningOutputTokens: 100 }} />);
      const ring = screen.getByRole('button', { name: /Context 20%/i });
      expect(ring).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(ring);
      expect(onSend).not.toHaveBeenCalledWith('/compact');

      rerender(<ChatInput {...baseProps()} aiProvider="codex" onSend={onSend}
        contextUsage={{ used: 2_000, total: null, inputTokens: 1_700, cachedInputTokens: 500, cacheCreationTokens: 0, outputTokens: 300 }} />);
      expect(screen.queryByRole('button', { name: /Context \d+%/i })).not.toBeInTheDocument();
    });

    it('keeps the Claude ring clickable', async () => {
      const onSend = vi.fn();
      render(<ChatInput {...baseProps()} aiProvider="claude" onSend={onSend}
        contextUsage={{ used: 20, total: 100, inputTokens: 10, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 10 }} />);
      await userEvent.click(screen.getByRole('button', { name: /Click to compact/i }));
      expect(onSend).toHaveBeenCalledWith('/compact');
    });

    it('renders no context ring and no usage popover when telemetry is entirely absent (e.g. Gemini)', () => {
      const { container } = render(<ChatInput {...baseProps()} aiProvider="gemini" />);
      expect(container.querySelector('.toolbar-usage')).toBeNull();
      expect(screen.queryByRole('button', { name: /Context \d+%/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Click to compact/i })).not.toBeInTheDocument();
    });
  });

  describe('shared usage popover', () => {
    const now = Math.floor(Date.now() / 1000);
    const usageLimits: UsageLimitView[] = [
      {
        id: 'codex-primary', label: 'Current session', group: 'session',
        usedPercent: 42, resetsAt: now + 3_600, windowDurationMins: 300,
        updatedAt: Date.now(), stale: false,
      },
      {
        id: 'codex-secondary', label: 'All models', group: 'weekly',
        usedPercent: 73, resetsAt: now + 86_400, windowDurationMins: 10_080,
        updatedAt: Date.now(), stale: false,
      },
    ];

    it('renders inline usage from the highest usedPercent limit and the full breakdown', () => {
      const { container } = render(<ChatInput {...baseProps()} aiProvider="codex"
        usageLimits={usageLimits}
        sessionUsage={{ inputTokens: 5_000, outputTokens: 1_200 }}
        contextUsage={{ used: 2_000, total: 10_000, inputTokens: 1_700, cachedInputTokens: 500, cacheCreationTokens: 0, outputTokens: 300, reasoningOutputTokens: 100 }}
      />);

      // Inline label picks the highest usedPercent across all limits (73%, not the 42% primary).
      const inline = container.querySelector('.toolbar-usage');
      expect(inline?.textContent).toContain('73% used');

      // Both limit groups render with their shared labels and reset sublabels.
      expect(screen.getByText('Current session')).toBeTruthy();
      expect(screen.getByText('All models')).toBeTruthy();
      expect(screen.getAllByText(/Resets/i).length).toBeGreaterThanOrEqual(2);

      // Context totals.
      expect(screen.getByText('2.0K / 10.0K')).toBeTruthy();
      // Cached / new input / output / reasoning-output rows.
      expect(screen.getByText('Cache hit')).toBeTruthy();
      expect(screen.getByText('New input')).toBeTruthy();
      expect(screen.getAllByText('Output').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Reasoning output')).toBeTruthy();
      // Session totals.
      expect(screen.getByText('Session totals')).toBeTruthy();
    });

    it('marks a stale limit with the stale sublabel', () => {
      const staleLimits: UsageLimitView[] = [
        { ...usageLimits[0], stale: true },
        usageLimits[1],
      ];
      render(<ChatInput {...baseProps()} aiProvider="codex" usageLimits={staleLimits} />);
      expect(screen.getByText('Data may be stale')).toBeTruthy();
    });

    it('never renders a misleading 0% used label for an empty limits list', () => {
      render(<ChatInput {...baseProps()} aiProvider="codex" sessionUsage={{ inputTokens: 0, outputTokens: 0 }} usageLimits={[]} />);
      expect(screen.queryByText('0% used')).toBeNull();
    });
  });
});
