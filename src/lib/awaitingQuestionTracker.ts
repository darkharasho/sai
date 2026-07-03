export interface QuestionStatusMsg {
  type: string;
  projectPath: string;
  /** Session-scoped chats carry their session id; legacy chat scope omits it. */
  scope?: string;
}

/** Composite key matching streamingScopes / waitingScopes: `${projectPath}:${scope}`. */
export function questionScopeKey(projectPath: string, scope?: string): string {
  return `${projectPath}:${scope || 'chat'}`;
}

/** The projectPath half of a scope key. Scopes (session UUIDs or 'chat')
 *  never contain ':', so the last separator is the boundary even when the
 *  path itself contains one. */
export function scopeKeyProjectPath(scopeKey: string): string {
  return scopeKey.slice(0, scopeKey.lastIndexOf(':'));
}

// Tracks scopes (not whole workspaces) blocked on an AskUserQuestion answer or
// an ExitPlanMode review. Keying by scope means one chat finishing a turn
// can't clear the "waiting for your answer" state of a sibling chat in the
// same workspace — with workspace-level keys, any scope's result/done wiped
// the flag while another chat was still waiting.
export function applyQuestionEvent(prev: Set<string>, msg: QuestionStatusMsg): Set<string> {
  const key = questionScopeKey(msg.projectPath, msg.scope);
  switch (msg.type) {
    case 'question_needed':
    case 'plan_review_needed': {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    }
    case 'question_answered':
    case 'plan_review_answered':
    case 'result':
    case 'done': {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    }
    default:
      return prev;
  }
}

/** Roll scope keys up to the workspaces that contain at least one waiting scope. */
export function questionWorkspaces(scopeKeys: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const key of scopeKeys) out.add(scopeKeyProjectPath(key));
  return out;
}

/** Session ids (scopes) waiting on a question within one workspace. */
export function questionSessionIdsFor(scopeKeys: ReadonlySet<string>, projectPath: string): Set<string> {
  const prefix = `${projectPath}:`;
  const out = new Set<string>();
  for (const key of scopeKeys) {
    if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
  }
  return out;
}
