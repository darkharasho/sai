import { useState, useEffect, useRef, useCallback } from 'react';

export interface BrainstormMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type SynthesizeResponse =
  | { ok: true; projectName: string; context: string; transcript: string }
  | { ok: false; needsClarification: true; question: string }
  | { ok: false; needsClarification?: false; error: string };

export interface UseBrainstorm {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  startError: string | null;
  send: (message: string) => Promise<void>;
  synthesize: (opts?: { force?: boolean }) => Promise<SynthesizeResponse>;
  end: () => Promise<void>;
  hasReply: boolean;
}

export function useBrainstorm(enabled: boolean): UseBrainstorm {
  const [, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const result: any = await (window as any).sai.brainstormStart();
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      return result.sessionId as string;
    } catch (e: any) {
      setStartError(e?.message ?? 'Failed to start brainstorm');
      throw e;
    }
  }, []);

  useEffect(() => {
    return () => {
      unsubsRef.current.forEach(u => u());
      unsubsRef.current = [];
      const sid = sessionIdRef.current;
      if (sid) (window as any).sai.brainstormEnd(sid).catch(() => {});
    };
  }, []);

  const send = useCallback(async (message: string) => {
    if (!enabled) return;
    setError(null);
    setIsStreaming(true);
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    let sid: string;
    try {
      sid = await ensureSession();
    } catch {
      setIsStreaming(false);
      return;
    }

    let buffered = '';
    const unsubChunk = (window as any).sai.brainstormOnChunk(sid, (text: string) => {
      buffered += text;
      setStreamingText(buffered);
    });

    const unsubDone = (window as any).sai.brainstormOnDone(sid, (text: string) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      setStreamingText('');
      setIsStreaming(false);
      unsubChunk();
      unsubDone();
      unsubError();
    });

    const unsubError = (window as any).sai.brainstormOnError(sid, (err: string) => {
      setError(err);
      setStreamingText('');
      setIsStreaming(false);
      unsubChunk();
      unsubDone();
      unsubError();
    });

    unsubsRef.current.push(unsubChunk, unsubDone, unsubError);

    try {
      await (window as any).sai.brainstormSend(sid, message);
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
      setIsStreaming(false);
    }
  }, [enabled, ensureSession]);

  const synthesize = useCallback(async (opts?: { force?: boolean }): Promise<SynthesizeResponse> => {
    const sid = sessionIdRef.current;
    if (!sid) return { ok: false, error: 'No active brainstorm session' };
    const r: SynthesizeResponse = await (window as any).sai.brainstormSynthesize(sid, opts);
    // If the model pushed back with a clarification, fold it into the
    // visible transcript as an organic assistant turn.
    if (!r.ok && r.needsClarification) {
      setMessages(prev => [...prev, { role: 'assistant', content: r.question }]);
    }
    return r;
  }, []);

  const end = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      await (window as any).sai.brainstormEnd(sid).catch(() => {});
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, []);

  return {
    messages,
    streamingText,
    isStreaming,
    error,
    startError,
    send,
    synthesize,
    end,
    hasReply: messages.some(m => m.role === 'assistant'),
  };
}
