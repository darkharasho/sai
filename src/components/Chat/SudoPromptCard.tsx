import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { KeyRound, Lock, X } from 'lucide-react';
import type { PendingSudoPrompt } from '../../types';
import { SPRING, DISTANCE, useReducedMotionTransition } from './motion';

interface SudoPromptCardProps {
  prompt: PendingSudoPrompt;
}

/**
 * Inline password prompt for agent-run sudo commands. One unlock elevates the
 * whole app run. The password goes straight to the main process over IPC —
 * never into chat history or the model stream. The card is dismissed by the
 * broker's `sudo-resolved` event (ChatPanel clears the pending state).
 */
export function SudoPromptCard({ prompt }: SudoPromptCardProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const entryTransition = useReducedMotionTransition(SPRING.gentle);

  // Autofocus on a fresh prompt; a retry arrives as a NEW promptId, so this
  // also resets busy + password after a wrong attempt.
  useEffect(() => {
    setBusy(false);
    setPassword('');
    inputRef.current?.focus();
  }, [prompt.promptId]);

  const submit = useCallback(
    (pw: string | null) => {
      if (busy) return;
      setBusy(true);
      void window.sai.claudeSudoReply(prompt.promptId, pw);
    },
    [busy, prompt.promptId]
  );

  return (
    <motion.div
      data-testid="sudo-prompt-card"
      layout
      initial={{ opacity: 0, y: DISTANCE.slide }}
      animate={{ opacity: 1, y: 0, transition: entryTransition }}
      style={{
        background: 'var(--surface-3)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        marginBottom: 8,
        overflow: 'hidden',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' }}>
        <KeyRound size={16} style={{ color: 'var(--accent)' }} />
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 12, fontWeight: 600, color: 'var(--accent)',
        }}>sudo</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Administrator password — asked once, unlocks until SAI quits
        </span>
      </div>
      <pre style={{
        margin: '8px 14px', padding: '8px 10px', borderRadius: 6,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-hairline)',
        fontSize: 12, overflowX: 'auto',
      }}>{prompt.command}</pre>
      {prompt.error && (
        <div style={{ padding: '0 14px 4px', fontSize: 12, color: 'var(--red)' }}>
          {prompt.error}
        </div>
      )}
      <form
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px 12px' }}
        onSubmit={(e) => { e.preventDefault(); if (password.length > 0) submit(password); }}
      >
        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          disabled={busy}
          style={{
            flex: 1, minWidth: 0, borderRadius: 6, padding: '6px 10px', fontSize: 12,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text)', outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
            opacity: busy || password.length === 0 ? 0.5 : 1,
          }}
        >
          <Lock size={14} /> Unlock
        </button>
        <button
          type="button"
          onClick={() => submit(null)}
          disabled={busy}
          style={{
            background: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 6,
            padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <X size={14} /> Cancel
        </button>
      </form>
    </motion.div>
  );
}
