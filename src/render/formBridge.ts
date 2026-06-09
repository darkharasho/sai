export interface FormResult {
  ok: boolean;
  value?: unknown;
  dismissed?: boolean;
  error?: string;
}

interface Pending {
  resolve: (r: FormResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const queue: Pending[] = [];

/**
 * Register a pending form. Returns a promise that resolves when submitForm() is
 * called (FIFO), on timeout, or on cancel(). The agent blocks on one form at a
 * time, so the queue is normally length 0 or 1.
 */
export function registerPendingForm(timeoutMs: number): { promise: Promise<FormResult>; cancel: () => void } {
  let entry: Pending;
  const promise = new Promise<FormResult>((resolve) => {
    const timer = setTimeout(() => {
      remove(entry);
      resolve({ ok: false, dismissed: true, error: 'form timed out' });
    }, timeoutMs);
    entry = { resolve, timer };
    queue.push(entry);
  });
  const cancel = () => {
    if (remove(entry)) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, dismissed: true, error: 'form cancelled' });
    }
  };
  return { promise, cancel };
}

/** Resolve the oldest pending form with the submitted value. No-op if none. */
export function submitForm(value: unknown): void {
  const entry = queue.shift();
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.resolve({ ok: true, value });
}

function remove(entry: Pending): boolean {
  const i = queue.indexOf(entry);
  if (i === -1) return false;
  queue.splice(i, 1);
  return true;
}

export function _resetForTests(): void {
  for (const e of queue) clearTimeout(e.timer);
  queue.length = 0;
}
