import { Notification, BrowserWindow, app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { devlog, devlogSnip } from './devlog';

const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function isEnabled(): boolean {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return settings.systemNotifications === true;
  } catch {
    return false;
  }
}

/**
 * Track focus state via window events — more reliable than isFocused() on Wayland.
 * Call initFocusTracking(win) once after window creation.
 */
let windowFocused = true;
let activeWorkspacePath = '';

export function initFocusTracking(win: BrowserWindow) {
  win.on('focus', () => { windowFocused = true; devlog('notify', 'focus', { focused: true }); });
  win.on('blur', () => { windowFocused = false; devlog('notify', 'focus', { focused: false }); });
  windowFocused = win.isFocused();
  devlog('notify', 'focus.init', { focused: windowFocused });
}

export function setActiveWorkspace(projectPath: string) {
  const prev = activeWorkspacePath;
  activeWorkspacePath = projectPath;
  if (prev !== projectPath) devlog('notify', 'activeWorkspace', { from: prev, to: projectPath });
}

export interface CompletionInfo {
  provider?: string;
  duration?: number;   // ms
  turns?: number;
  cost?: number;       // USD
  summary?: string;    // final text snippet
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

/**
 * Flash the taskbar and optionally send a system notification
 * when a response completes while the window is unfocused.
 */
export function notifyCompletion(
  win: BrowserWindow,
  projectPath: string,
  info?: CompletionInfo,
  /** Diagnostics only: who called and what turn state they read. */
  ctx?: Record<string, unknown>,
) {
  // Diagnostics: record the decision AND the state it was taken on, so a
  // spurious "has finished" can be traced back to its call site + turn state.
  const trace = (decision: string) => devlog('notify', `completion.${decision}`, {
    projectPath,
    windowFocused,
    activeWorkspacePath,
    isActive: projectPath === activeWorkspacePath,
    provider: info?.provider,
    duration: info?.duration,
    turns: info?.turns,
    summary: devlogSnip(info?.summary, 80),
    ...(ctx ?? {}),
  });

  if (win.isDestroyed()) { trace('skipped.destroyed'); return; }
  // Use event-tracked focus state — isFocused() is unreliable on Wayland
  // Only suppress if the window is focused AND this is the active workspace
  if (windowFocused && projectPath === activeWorkspacePath) { trace('suppressed.focused'); return; }

  if (!isEnabled()) { trace('skipped.disabled'); return; }

  trace('fired');

  win.flashFrame(true);

  if (Notification.isSupported()) {
    const wsName = path.basename(projectPath);

    const parts: string[] = [];
    if (info?.provider) parts.push(info.provider);
    if (info?.duration) parts.push(formatDuration(info.duration));
    if (info?.turns && info.turns > 1) parts.push(`${info.turns} turns`);
    if (info?.cost) parts.push(`$${info.cost.toFixed(4)}`);

    const meta = parts.length > 0 ? ` (${parts.join(' · ')})` : '';

    let body = `${wsName} has finished${meta}`;
    if (info?.summary) {
      const snippet = info.summary.length > 100 ? info.summary.slice(0, 100) + '…' : info.summary;
      body += `\n${snippet}`;
    }

    new Notification({
      title: 'SAI',
      body,
    }).show();
  }
}

/**
 * Fire an immediate system notification when a workspace needs approval.
 * Unlike completion notifications, this always fires regardless of focus.
 */
export function notifyApproval(win: BrowserWindow, workspaceName: string, toolName: string, command: string) {
  if (win.isDestroyed()) return;
  if (!isEnabled()) return;

  win.flashFrame(true);

  if (Notification.isSupported()) {
    const cmdSnippet = command.length > 100 ? command.slice(0, 100) + '…' : command;
    new Notification({
      title: `Approval needed — ${workspaceName}`,
      body: `${toolName}: ${cmdSnippet}`,
    }).show();
  }
}

/**
 * Fire an immediate system notification when the agent asks the user a
 * question via the AskUserQuestion tool. Always fires regardless of focus
 * — the agent is blocked until the user answers.
 */
export function notifyQuestion(win: BrowserWindow, workspaceName: string, question: string) {
  if (win.isDestroyed()) return;
  if (!isEnabled()) return;

  win.flashFrame(true);

  if (Notification.isSupported()) {
    const snippet = question.length > 140 ? question.slice(0, 140) + '…' : question;
    new Notification({
      title: `Question — ${workspaceName}`,
      body: snippet,
    }).show();
  }
}

/**
 * Fire an immediate system notification when the agent presents a plan
 * via ExitPlanMode. Always fires regardless of focus — the agent is
 * blocked until the user approves or rejects.
 */
export function notifyPlanReview(win: BrowserWindow, workspaceName: string) {
  if (win.isDestroyed()) return;
  if (!isEnabled()) return;

  win.flashFrame(true);

  if (Notification.isSupported()) {
    new Notification({
      title: `Plan review — ${workspaceName}`,
      body: 'The agent has a plan ready for your approval.',
    }).show();
  }
}
