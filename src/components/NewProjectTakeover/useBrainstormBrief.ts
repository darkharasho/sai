import { useState, useRef, useCallback, useEffect } from 'react';

export interface BrainstormMessage { role: 'user' | 'assistant'; content: string }
export interface StackItemView { name: string; rationale: string }
export interface ProjectBriefView {
  projectName: string | null; summary: string | null;
  goals: string[]; nonGoals: string[]; stack: StackItemView[];
  openQuestions: string[]; ready: boolean;
}
export const EMPTY_BRIEF: ProjectBriefView = {
  projectName: null, summary: null, goals: [], nonGoals: [], stack: [], openQuestions: [], ready: false,
};

export interface UseBrainstormBrief {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  brief: ProjectBriefView;
  questionCount: number;
  send(message: string): Promise<void>;
  editBrief(patch: Partial<ProjectBriefView>): Promise<{ ok: boolean; error?: string }>;
  end(): Promise<void>;
  transcriptDirty: boolean;
}

export function useBrainstormBrief(): UseBrainstormBrief {
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<ProjectBriefView>(EMPTY_BRIEF);
  const [questionCount, setQuestionCount] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const unsubsRef = useRef<Array<() => void>>([]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const { sessionId } = await (window.sai as any).brainstormStart();
    sessionIdRef.current = sessionId;
    // Session-lifetime brief subscription: fires for model tool calls AND
    // editBrief round-trips (both emit brainstorm:brief:<sid>).
    unsubsRef.current.push(
      (window.sai as any).brainstormOnBrief(sessionId, (b: ProjectBriefView) => setBrief(b)),
    );
    return sessionId;
  }, []);

  useEffect(() => () => {
    unsubsRef.current.forEach(u => u());
    unsubsRef.current = [];
    const sid = sessionIdRef.current;
    if (sid) {
      (window.sai as any).brainstormEnd(sid).catch(() => {});
      sessionIdRef.current = null;
    }
  }, []);

  const send = useCallback(async (message: string) => {
    setError(null);
    setIsStreaming(true);
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    let sid: string;
    try {
      sid = await ensureSession();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start brainstorm');
      setIsStreaming(false);
      return;
    }

    let buffered = '';
    const unsubChunk = (window.sai as any).brainstormOnChunk(sid, (text: string) => {
      buffered += text;
      setStreamingText(buffered);
    });
    const finish = () => {
      unsubChunk();
      unsubDone();
      unsubError();
      unsubsRef.current = unsubsRef.current.filter(u => u !== unsubChunk && u !== unsubDone && u !== unsubError);
    };
    const unsubDone = (window.sai as any).brainstormOnDone(sid, (text: string) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      if (!briefRef.current.ready) setQuestionCount(c => c + 1);
      setStreamingText('');
      setIsStreaming(false);
      finish();
    });
    const unsubError = (window.sai as any).brainstormOnError(sid, (err: string) => {
      setError(err);
      setStreamingText('');
      setIsStreaming(false);
      finish();
    });
    unsubsRef.current.push(unsubChunk, unsubDone, unsubError);

    try {
      await (window.sai as any).brainstormSend(sid, message);
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
      setIsStreaming(false);
    }
  }, [ensureSession]);

  const editBrief = useCallback(async (patch: Partial<ProjectBriefView>) => {
    const sid = await ensureSession();
    const r = await (window.sai as any).brainstormEditBrief(sid, patch);
    if (r.ok && r.brief) setBrief(r.brief);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  }, [ensureSession]);

  const end = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      await (window.sai as any).brainstormEnd(sid).catch(() => {});
      sessionIdRef.current = null;
    }
  }, []);

  const transcriptDirty = messages.length > 0 ||
    brief.projectName !== null || brief.summary !== null || brief.goals.length > 0;

  return { messages, streamingText, isStreaming, error, brief, questionCount, send, editBrief, end, transcriptDirty };
}
