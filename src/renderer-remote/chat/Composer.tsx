import { useState, useRef } from 'react';

interface Props {
  streaming: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export default function Composer({ streaming, onSend, onInterrupt }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    ref.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="border-t border-neutral-800 p-2 flex gap-2 items-end min-w-0">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={streaming ? 'Responding…' : 'Message'}
        rows={1}
        className="flex-1 min-w-0 resize-none bg-neutral-900 border border-neutral-800 rounded px-3 py-2 focus:outline-none focus:border-neutral-600"
        style={{ fontSize: '16px' }}
      />
      {streaming ? (
        <button
          onClick={onInterrupt}
          className="shrink-0 px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-sm"
        >Stop</button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="shrink-0 px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
        >Send</button>
      )}
    </div>
  );
}
