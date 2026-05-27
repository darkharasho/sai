export interface QuestionStatusMsg {
  type: string;
  projectPath: string;
}

export function applyQuestionEvent(prev: Set<string>, msg: QuestionStatusMsg): Set<string> {
  switch (msg.type) {
    case 'question_needed': {
      if (prev.has(msg.projectPath)) return prev;
      const next = new Set(prev);
      next.add(msg.projectPath);
      return next;
    }
    case 'question_answered':
    case 'result':
    case 'done': {
      if (!prev.has(msg.projectPath)) return prev;
      const next = new Set(prev);
      next.delete(msg.projectPath);
      return next;
    }
    default:
      return prev;
  }
}
