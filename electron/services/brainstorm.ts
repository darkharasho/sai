import { randomUUID } from 'node:crypto';

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrainstormSession {
  sessionId: string;
  claudeSessionId?: string;
  transcript: TranscriptTurn[];
  createdAt: number;
}

const sessions = new Map<string, BrainstormSession>();

export function createSession(): { sessionId: string } {
  const sessionId = randomUUID();
  sessions.set(sessionId, { sessionId, transcript: [], createdAt: Date.now() });
  return { sessionId };
}

export function getSession(sessionId: string): BrainstormSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test-only — clears in-memory state between tests. */
export function __resetSessions(): void {
  sessions.clear();
}

export interface SynthesizeResult {
  projectName: string;
  context: string;
}

export function parseSynthesizeOutput(raw: string): SynthesizeResult {
  let text = raw.trim();

  // Strip ```json or ``` fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // If still not pure JSON, try to extract the first {...} block
  let jsonText = text;
  if (!jsonText.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found in output');
    }
    jsonText = text.slice(start, end + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`Malformed JSON: ${e.message}`);
  }

  const projectName = typeof parsed.projectName === 'string' ? parsed.projectName.trim() : '';
  const context = typeof parsed.context === 'string' ? parsed.context.trim() : '';

  if (!projectName) throw new Error('Missing or empty projectName');
  if (projectName.length > 40) throw new Error('projectName exceeds 40 characters');
  if (!context) throw new Error('Missing or empty context');

  return { projectName, context };
}

export const BRAINSTORM_SYSTEM_PROMPT = [
  'You are helping the user think through a brand-new software project before they create the folder and scaffolding.',
  'Your job is to explore feasibility, surface trade-offs, ask about constraints, and propose options.',
  'Keep responses concise and conversational. Do NOT produce code or file structures.',
  'When the user asks you to synthesize, output strict JSON with two fields:',
  '  - projectName: kebab-case, ≤ 40 chars',
  '  - context: a 2–4 sentence summary suitable for a CLAUDE.md "Project Context" section',
  'No other text when synthesizing — just the JSON object.',
].join('\n');

export const SYNTHESIZE_PROMPT =
  'Synthesize our conversation. Respond with ONLY a JSON object: {"projectName":"...","context":"..."}. No prose, no code fences.';

export function buildClaudeArgs(opts: {
  userMessage: string;
  claudeSessionId: string | undefined;
}): string[] {
  const args: string[] = [
    '-p', opts.userMessage,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '1',
  ];
  if (opts.claudeSessionId) {
    args.push('--resume', opts.claudeSessionId);
  } else {
    args.push('--append-system-prompt', BRAINSTORM_SYSTEM_PROMPT);
  }
  return args;
}
