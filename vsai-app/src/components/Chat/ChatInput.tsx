import { useState, useRef, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSend(value.trim());
        setValue('');
      }
    }
  };

  return (
    <div className="chat-input-area">
      <textarea
        ref={textareaRef}
        className="chat-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message... (Shift+Enter for newline)"
        rows={3}
        disabled={disabled}
      />
      <style>{`
        .chat-input-area { padding: 8px 16px 16px; }
        .chat-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 10px 14px;
          font-family: inherit;
          font-size: 13px;
          resize: none;
          outline: none;
        }
        .chat-input:focus { border-color: var(--accent); }
        .chat-input:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}
