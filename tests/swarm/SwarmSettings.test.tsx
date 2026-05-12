// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SwarmSettings from '@/components/Settings/SwarmSettings';

type SettingsStore = Record<string, any>;

function installSai(initial: SettingsStore = {}) {
  const store: SettingsStore = { ...initial };
  const settingsGet = vi.fn(async (key: string, def: any) => {
    return key in store ? store[key] : def;
  });
  const settingsSet = vi.fn(async (key: string, value: any) => {
    store[key] = value;
  });
  (window as any).sai = { settingsGet, settingsSet };
  return { store, settingsGet, settingsSet };
}

describe('SwarmSettings', () => {
  beforeEach(() => {
    delete (window as any).sai;
  });

  it('renders all 7 fields with defaults from settingsGet', async () => {
    installSai();
    render(<SwarmSettings />);

    await waitFor(() => {
      expect(screen.getByLabelText(/concurrency cap/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/default approval policy/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/orchestrator provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/orchestrator model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default task provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default task model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/worktree root/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notify on complete/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notify on approval/i)).toBeInTheDocument();
  });

  it('persists edits via settingsSet with swarm.<key> namespace', async () => {
    const { settingsSet } = installSai();
    render(<SwarmSettings />);

    await waitFor(() => {
      expect(screen.getByLabelText(/concurrency cap/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/concurrency cap/i), { target: { value: '8' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.concurrencyCap', 8);

    fireEvent.change(screen.getByLabelText(/default approval policy/i), { target: { value: 'always-ask' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.defaultApprovalPolicy', 'always-ask');

    fireEvent.change(screen.getByLabelText(/orchestrator provider/i), { target: { value: 'codex' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.orchestratorProvider', 'codex');

    fireEvent.change(screen.getByLabelText(/orchestrator model/i), { target: { value: 'gpt-5' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.orchestratorModel', 'gpt-5');

    fireEvent.change(screen.getByLabelText(/default task provider/i), { target: { value: 'gemini' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.defaultTaskProvider', 'gemini');

    fireEvent.change(screen.getByLabelText(/default task model/i), { target: { value: 'opus' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.defaultTaskModel', 'opus');

    fireEvent.change(screen.getByLabelText(/worktree root/i), { target: { value: '/tmp/.sai-swarm' } });
    expect(settingsSet).toHaveBeenCalledWith('swarm.worktreeRoot', '/tmp/.sai-swarm');

    fireEvent.click(screen.getByLabelText(/notify on complete/i));
    expect(settingsSet).toHaveBeenCalledWith('swarm.notifyOnComplete', true);

    fireEvent.click(screen.getByLabelText(/notify on approval/i));
    expect(settingsSet).toHaveBeenCalledWith('swarm.notifyOnApproval', true);
  });

  it('loads existing values from settings', async () => {
    installSai({
      'swarm.concurrencyCap': 9,
      'swarm.defaultApprovalPolicy': 'always-ask',
      'swarm.orchestratorProvider': 'gemini',
      'swarm.notifyOnComplete': true,
    });
    render(<SwarmSettings />);

    await waitFor(() => {
      expect((screen.getByLabelText(/concurrency cap/i) as HTMLInputElement).value).toBe('9');
    });
    expect((screen.getByLabelText(/default approval policy/i) as HTMLSelectElement).value).toBe('always-ask');
    expect((screen.getByLabelText(/orchestrator provider/i) as HTMLSelectElement).value).toBe('gemini');
  });
});
