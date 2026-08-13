// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrchestratorModelPicker from '../../src/components/Swarm/OrchestratorModelPicker';

describe('OrchestratorModelPicker', () => {
  it('renders the current provider/model label', () => {
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={vi.fn()} />);
    const btn = screen.getByTestId('orch-model-picker-button');
    expect(btn.textContent).toMatch(/claude/i);
    expect(btn.textContent).toMatch(/opus/i);
  });

  it('opens the dropdown on click and lists model options', () => {
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={vi.fn()} />);
    expect(screen.queryByTestId('orch-model-picker-dropdown')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('orch-model-picker-button'));
    expect(screen.getByTestId('orch-model-picker-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('orch-model-picker-model-sonnet')).toBeInTheDocument();
    expect(screen.getByTestId('orch-model-picker-model-opus')).toBeInTheDocument();
    expect(screen.getByTestId('orch-model-picker-model-haiku')).toBeInTheDocument();
    expect(screen.getByTestId('orch-model-picker-model-default')).toBeInTheDocument();
  });

  it('clicking a model fires onChange with (provider, model)', () => {
    const onChange = vi.fn();
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('orch-model-picker-button'));
    fireEvent.click(screen.getByTestId('orch-model-picker-model-sonnet'));
    expect(onChange).toHaveBeenCalledWith('claude', 'sonnet');
  });

  it('codex and gemini provider buttons are disabled', () => {
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('orch-model-picker-button'));
    const codex = screen.getByTestId('orch-model-picker-provider-codex') as HTMLButtonElement;
    const gemini = screen.getByTestId('orch-model-picker-provider-gemini') as HTMLButtonElement;
    expect(codex.disabled).toBe(true);
    expect(gemini.disabled).toBe(true);
    // Tooltip explains the selected transport cannot run the bridge.
    expect(codex.getAttribute('title')).toMatch(/app server.*selected/i);
  });

  it('enables Codex only when the App Server Swarm bridge has negotiated', () => {
    const onChange = vi.fn();
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={onChange} codexSwarm={{ available: true }} />);
    fireEvent.click(screen.getByTestId('orch-model-picker-button'));
    const codex = screen.getByTestId('orch-model-picker-provider-codex') as HTMLButtonElement;
    expect(codex.disabled).toBe(false);
    fireEvent.click(codex);
    expect(onChange).toHaveBeenCalledWith('codex', 'gpt-5.6');
  });

  it('clicking a disabled provider does not fire onChange', () => {
    const onChange = vi.fn();
    render(<OrchestratorModelPicker provider="claude" model="opus" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('orch-model-picker-button'));
    const codex = screen.getByTestId('orch-model-picker-provider-codex');
    fireEvent.click(codex);
    expect(onChange).not.toHaveBeenCalled();
  });
});
