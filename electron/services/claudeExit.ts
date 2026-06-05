/**
 * Pure mapping from a Claude CLI process exit to the terminal `claude:message`
 * events the renderer should receive. A turn normally ends via a `result`
 * message (which clears `busy` before exit), so `wasBusy` is true here only
 * when the process died WITHOUT finishing its turn — i.e. a crash. A non-zero
 * exit code or a terminating signal in that case is a fatal error (so swarm
 * tasks mark `failed` rather than the previous false `done`). A clean exit
 * while busy still emits a plain `done`.
 */
export interface ExitTerminalEvent {
  type: 'error' | 'done';
  fatal?: boolean;
  text?: string;
}

export function exitTerminalEvents(
  code: number | null,
  signal: NodeJS.Signals | string | null,
  wasBusy: boolean,
): ExitTerminalEvent[] {
  if (!wasBusy) return [];
  const crashed = (code != null && code !== 0) || signal != null;
  if (!crashed) return [{ type: 'done' }];
  const detail = signal != null ? `signal ${signal}` : `code ${code}`;
  return [
    { type: 'error', fatal: true, text: `Claude process exited unexpectedly (${detail})` },
    { type: 'done' },
  ];
}
