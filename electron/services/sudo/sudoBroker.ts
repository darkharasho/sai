// One-time sudo prompt coordinator. Ported from otto
// (src/main/autonomy/sudo-broker.ts) with app-wide scope: concurrent callers
// (two chats hitting sudo at once) coalesce into a single prompt. Free of
// electron imports.

import { randomUUID } from 'node:crypto';

export interface SudoPromptArgs {
  projectPath: string;
  scope: string;
  toolUseId: string;
  command: string;
}

interface SessionLike {
  isUnlocked(): boolean;
  unlock(password: string): Promise<{ ok: boolean; error?: string }>;
}

const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/**
 * Coordinates the one-time password prompt that elevates SAI for `sudo`
 * commands: emits a `sudo-prompt` event, parks a promise keyed by promptId,
 * and resolves it when the renderer replies via the `claude:sudoReply` IPC.
 * On a valid password the SudoSession unlocks and every later sudo command in
 * this app run elevates silently.
 */
export class SudoBroker {
  private readonly pending = new Map<string, (password: string | null) => void>();
  private inFlight: Promise<boolean> | null = null;
  private current: { projectPath: string; scope: string; toolUseId: string; command: string; promptId: string; error?: string } | null = null;

  constructor(
    private readonly session: SessionLike,
    private readonly emit: (payload: Record<string, unknown>) => void,
    private readonly opts: { promptTimeoutMs?: number; maxAttempts?: number } = {}
  ) {}

  /**
   * Ensure sudo can run. Resolves true once unlocked, false if the user
   * cancelled, the prompt timed out, or all password attempts failed. While a
   * prompt is in flight, additional callers share its outcome (one card only).
   */
  async ensureUnlocked(args: SudoPromptArgs): Promise<boolean> {
    if (this.session.isUnlocked()) return true;
    if (this.inFlight) return this.inFlight;
    const flow = this.promptLoop(args).finally(() => {
      this.inFlight = null;
      this.current = null;
    });
    this.inFlight = flow;
    return flow;
  }

  /** Renderer reply: a password to try, or null to cancel. */
  resolveSudo(promptId: string, password: string | null): void {
    const resolver = this.pending.get(promptId);
    if (!resolver) return;
    this.pending.delete(promptId);
    resolver(password);
  }

  /** The prompt currently awaiting a renderer reply, for mount-time re-seeding
   *  (a chat opened after its sudo-prompt event fired would otherwise never
   *  see the card). Null when no prompt is outstanding. */
  getPendingPrompt(): { projectPath: string; scope: string; toolUseId: string; command: string; promptId: string; error?: string } | null {
    return this.current;
  }

  private async promptLoop(args: SudoPromptArgs): Promise<boolean> {
    const maxAttempts = this.opts.maxAttempts ?? MAX_ATTEMPTS;
    let error: string | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const password = await this.prompt(args, error);
      if (password === null) {
        this.emitResolved(args, 'cancelled');
        return false;
      }
      const res = await this.session.unlock(password);
      if (res.ok) {
        this.emitResolved(args, 'unlocked');
        return true;
      }
      error = res.error ?? 'sudo authentication failed';
    }
    this.emitResolved(args, 'failed');
    return false;
  }

  private prompt(args: SudoPromptArgs, error: string | undefined): Promise<string | null> {
    const promptId = randomUUID();
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(promptId)) resolve(null);
      }, this.opts.promptTimeoutMs ?? PROMPT_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();

      this.pending.set(promptId, (password) => {
        clearTimeout(timer);
        resolve(password);
      });

      this.current = {
        projectPath: args.projectPath,
        scope: args.scope,
        toolUseId: args.toolUseId,
        command: args.command,
        promptId,
        error,
      };

      this.emit({
        type: 'sudo-prompt',
        projectPath: args.projectPath,
        scope: args.scope,
        toolUseId: args.toolUseId,
        promptId,
        command: args.command,
        error,
      });
    });
  }

  private emitResolved(args: SudoPromptArgs, status: 'unlocked' | 'cancelled' | 'failed'): void {
    this.emit({
      type: 'sudo-resolved',
      projectPath: args.projectPath,
      scope: args.scope,
      toolUseId: args.toolUseId,
      status,
    });
  }
}
