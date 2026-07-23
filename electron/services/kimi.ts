import { BrowserWindow } from 'electron';
import type { Workspace } from './workspace';
import {
  registerAcpProviderHandlers,
  ensureAcpTransport,
  ensureAcpCommitSession,
  promptAcpText,
  type AcpProviderConfig,
} from './acpProvider';

export const KIMI_CONFIG: AcpProviderConfig = {
  key: 'kimi',
  displayName: 'Kimi',
  label: 'Kimi ACP',
  command: 'kimi',
  args: ['acp'],
  models: [
    { id: 'kimi-k3', name: 'Kimi K3' },
  ],
  defaultModel: 'kimi-k3',
  installHint: 'Install kimi-cli (github.com/MoonshotAI/kimi-cli), run `kimi` once and `/login`, then retry.',
};

export const registerKimiHandlers = (win: BrowserWindow) => registerAcpProviderHandlers(win, KIMI_CONFIG);
export const ensureKimiTransport = (win: BrowserWindow, ws: Workspace) => ensureAcpTransport(win, ws, KIMI_CONFIG);
export const ensureKimiCommitSession = (win: BrowserWindow, ws: Workspace) => ensureAcpCommitSession(win, ws, KIMI_CONFIG);
export const promptKimiText = (
  win: BrowserWindow,
  ws: Workspace,
  options: Parameters<typeof promptAcpText>[3],
) => promptAcpText(win, ws, KIMI_CONFIG, options);
