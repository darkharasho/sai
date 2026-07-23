import { BrowserWindow } from 'electron';
import type { Workspace } from './workspace';
import {
  registerAcpProviderHandlers,
  ensureAcpTransport,
  ensureAcpCommitSession,
  promptAcpText,
  acpContentToToolResult,
  type AcpProviderConfig,
} from './acpProvider';

export const GEMINI_CONFIG: AcpProviderConfig = {
  key: 'gemini',
  displayName: 'Gemini',
  label: 'Gemini ACP',
  command: 'gemini',
  args: ['--acp'],
  models: [
    { id: 'auto-gemini-3', name: 'Auto (Gemini 3)' },
    { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
  ],
  defaultModel: 'auto-gemini-3',
  fastModel: 'gemini-2.5-flash',
};

// Signature-stable wrappers — imported by electron/services/claude.ts and tests.
export { acpContentToToolResult };
export const registerGeminiHandlers = (win: BrowserWindow) => registerAcpProviderHandlers(win, GEMINI_CONFIG);
export const ensureGeminiTransport = (win: BrowserWindow, ws: Workspace) => ensureAcpTransport(win, ws, GEMINI_CONFIG);
export const ensureGeminiCommitSession = (win: BrowserWindow, ws: Workspace) => ensureAcpCommitSession(win, ws, GEMINI_CONFIG);
export const promptGeminiText = (
  win: BrowserWindow,
  ws: Workspace,
  options: Parameters<typeof promptAcpText>[3],
) => promptAcpText(win, ws, GEMINI_CONFIG, options);
