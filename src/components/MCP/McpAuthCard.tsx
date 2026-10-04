import { useState } from 'react';
import type { McpAuthState } from '../../types';

interface McpAuthCardProps {
  auth: McpAuthState;
  canPasteCallback: boolean;
  /** Live actions (Open again / Retry) are off while no session is available. */
  disabled?: boolean;
  onOpenAgain(): void;
  onCancel(): void;
  onSubmitCallbackUrl(url: string): void;
}

/** Only http(s) links are ever shown, copied or trusted as a sign-in URL. */
export function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export default function McpAuthCard({ auth, canPasteCallback, disabled, onOpenAgain, onCancel, onSubmitCallbackUrl }: McpAuthCardProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [url, setUrl] = useState('');
  const safeUrl = isHttpUrl(auth.authUrl) ? auth.authUrl : undefined;
  // A waiting state whose link isn't a web address can never complete: surface it.
  const badLink = auth.phase === 'waiting' && !!auth.authUrl && !safeUrl;
  const waiting = auth.phase === 'waiting' && !badLink;
  const title = waiting ? 'Finish signing in in your browser'
    : auth.phase === 'timeout' ? "Sign-in didn't complete"
    : 'Sign-in failed';
  const body = waiting
    ? 'We opened the login page. SAI reconnects this server automatically when you approve.'
    : badLink ? "The server returned a sign-in link that isn't a web address, so it was not opened."
    : auth.phase === 'timeout' ? 'No approval arrived within 5 minutes. Try again.'
    : auth.error ?? 'The server rejected the sign-in.';

  return (
    <div className={`mcp-auth ${waiting ? '' : 'bad'}`}>
      <div aria-live="polite">
        <b>{title}</b>
        <p>{body}</p>
      </div>
      {safeUrl && <div className="mcp-auth-url" title={safeUrl}>{safeUrl}</div>}
      <div className="mcp-acts">
        <button className="mcp-btn" disabled={disabled} onClick={onOpenAgain}>{waiting ? 'Open again' : 'Retry'}</button>
        {safeUrl && (
          <button className="mcp-btn" onClick={() => { void window.sai.clipboardWrite?.(safeUrl); }}>Copy link</button>
        )}
        {(waiting || badLink) && <button className="mcp-btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
      {waiting && canPasteCallback && (
        <div className="mcp-auth-paste">
          <button className="mcp-link" aria-expanded={pasteOpen} onClick={() => setPasteOpen((o) => !o)}>Paste redirect URL</button>
          {pasteOpen && (
            <div className="mcp-auth-paste-row">
              <input className="form-input mono" aria-label="Redirect URL" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:…/callback?code=…" />
              <button className="mcp-btn" disabled={!url.trim()} onClick={() => onSubmitCallbackUrl(url.trim())}>Submit</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
