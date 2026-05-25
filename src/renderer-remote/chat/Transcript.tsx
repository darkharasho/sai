import { useEffect, useRef } from 'react';
import ToolCard from './ToolCard';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string | Record<string, unknown>;
  toolStatus?: 'running' | 'done' | 'error';
  streaming?: boolean;
}

interface Props {
  messages: TranscriptMessage[];
}

export default function Transcript({ messages }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.text?.length]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      {messages.map((m) => {
        if (m.role === 'tool') {
          return (
            <ToolCard
              key={m.id}
              name={m.toolName ?? 'tool'}
              input={m.toolInput}
              result={m.toolResult}
              status={m.toolStatus ?? 'running'}
            />
          );
        }
        const bubble = m.role === 'user'
          ? 'bg-blue-600 text-white self-end'
          : m.role === 'system'
          ? 'bg-neutral-900 text-neutral-400 text-xs italic'
          : 'bg-neutral-900 text-neutral-100';
        return (
          <div key={m.id} className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${bubble}`}>
            {m.streaming && !m.text ? (
              <span className="inline-flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse delay-100" />
                <span className="w-1.5 h-1.5 bg-neutral-500 rounded-full animate-pulse delay-200" />
              </span>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans">{m.text}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
