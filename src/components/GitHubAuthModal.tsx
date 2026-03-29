import { useState, useEffect } from 'react';
import { X, Copy, Check, ExternalLink, Loader } from 'lucide-react';

interface Props {
  onSuccess: (user: { login: string; avatar_url: string; name: string }) => void;
  onClose: () => void;
}

type Stage = 'loading' | 'waiting' | 'error';

export default function GitHubAuthModal({ onSuccess, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('loading');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    window.sai.githubStartAuth().then((result: { user_code: string; verification_uri: string; expires_in: number }) => {
      if (cancelled) return;
      setUserCode(result.user_code);
      setVerificationUri(result.verification_uri);
      setStage('waiting');
    }).catch(() => {
      if (!cancelled) {
        setErrorMsg('Failed to connect to GitHub. Check your internet connection.');
        setStage('error');
      }
    });

    const unsubComplete = window.sai.githubOnAuthComplete((user: any) => {
      if (!cancelled) onSuccess(user);
    });

    const unsubError = window.sai.githubOnAuthError((err: string) => {
      if (cancelled) return;
      setErrorMsg(err === 'expired_token' ? 'Code expired. Please try again.' : 'Authorization denied.');
      setStage('error');
    });

    return () => {
      cancelled = true;
      unsubComplete();
      unsubError();
      window.sai.githubCancelAuth();
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenBrowser = () => {
    window.sai.openExternal(verificationUri);
  };

  const handleRetry = () => {
    setStage('loading');
    setErrorMsg('');
    window.sai.githubStartAuth().then((result: { user_code: string; verification_uri: string; expires_in: number }) => {
      setUserCode(result.user_code);
      setVerificationUri(result.verification_uri);
      setStage('waiting');
    }).catch(() => {
      setErrorMsg('Failed to connect to GitHub.');
      setStage('error');
    });
  };

  return (
    <div className="gh-modal-overlay" onClick={onClose}>
      <div className="gh-modal" onClick={e => e.stopPropagation()}>
        <button className="gh-modal-close" onClick={onClose}><X size={16} /></button>

        <div className="gh-modal-header">
          <svg className="gh-octocat" viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <div>
            <div className="gh-modal-title">Connect GitHub Account</div>
            <div className="gh-modal-subtitle">Authorize SAI to access your profile</div>
          </div>
        </div>

        {stage === 'loading' && (
          <div className="gh-modal-loading">
            <Loader size={20} className="gh-spinner" />
            <span>Connecting to GitHub…</span>
          </div>
        )}

        {stage === 'waiting' && (
          <>
            <div className="gh-modal-steps">
              <div className="gh-step">
                <span className="gh-step-num">1</span>
                <span>Copy your one-time code</span>
              </div>
              <div className="gh-step">
                <span className="gh-step-num">2</span>
                <span>Paste it on GitHub's device activation page</span>
              </div>
              <div className="gh-step">
                <span className="gh-step-num">3</span>
                <span>Come back — we'll detect it automatically</span>
              </div>
            </div>

            <button className="gh-code-block" onClick={handleCopy} title="Click to copy">
              <span className="gh-code-text">{userCode}</span>
              <span className="gh-code-copy">
                {copied ? <Check size={15} color="var(--green)" /> : <Copy size={15} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </span>
            </button>

            <button className="gh-open-btn" onClick={handleOpenBrowser}>
              <ExternalLink size={14} />
              Open GitHub in browser
            </button>

            <div className="gh-modal-waiting">
              <Loader size={13} className="gh-spinner-sm" />
              <span>Waiting for authorization…</span>
            </div>
          </>
        )}

        {stage === 'error' && (
          <div className="gh-modal-error">
            <div className="gh-error-msg">{errorMsg}</div>
            <button className="gh-open-btn" onClick={handleRetry}>Try again</button>
          </div>
        )}

        <style>{`
          .gh-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3000;
            backdrop-filter: blur(4px);
          }
          .gh-modal {
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 24px;
            width: 360px;
            position: relative;
            box-shadow: 0 24px 64px rgba(0,0,0,0.5);
          }
          .gh-modal-close {
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
          }
          .gh-modal-close:hover { color: var(--text); background: var(--bg-hover); }
          .gh-modal-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }
          .gh-octocat { color: var(--text); flex-shrink: 0; }
          .gh-modal-title { font-size: 15px; font-weight: 600; color: var(--text); }
          .gh-modal-subtitle { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
          .gh-modal-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-secondary);
            font-size: 13px;
            padding: 12px 0;
          }
          .gh-spinner {
            animation: gh-spin 1s linear infinite;
            color: var(--text-muted);
          }
          .gh-spinner-sm {
            animation: gh-spin 1s linear infinite;
            color: var(--text-muted);
            flex-shrink: 0;
          }
          @keyframes gh-spin { to { transform: rotate(360deg); } }
          .gh-modal-steps {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
          }
          .gh-step {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 12px;
            color: var(--text-secondary);
          }
          .gh-step-num {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 600;
            flex-shrink: 0;
            color: var(--accent);
          }
          .gh-code-block {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
            cursor: pointer;
            margin-bottom: 10px;
            transition: border-color 0.15s;
          }
          .gh-code-block:hover { border-color: var(--accent); }
          .gh-code-text {
            font-family: 'JetBrains Mono', monospace;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: 4px;
            color: var(--text);
          }
          .gh-code-copy {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            color: var(--text-muted);
          }
          .gh-open-btn {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 7px;
            background: var(--accent);
            border: none;
            border-radius: 6px;
            color: #000;
            font-size: 13px;
            font-weight: 600;
            padding: 9px 16px;
            cursor: pointer;
            margin-bottom: 14px;
          }
          .gh-open-btn:hover { opacity: 0.85; }
          .gh-modal-waiting {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 12px;
            color: var(--text-muted);
            justify-content: center;
          }
          .gh-modal-error {
            text-align: center;
            padding: 8px 0;
          }
          .gh-error-msg {
            color: #f87171;
            font-size: 13px;
            margin-bottom: 14px;
          }
        `}</style>
      </div>
    </div>
  );
}
