import { useState, useEffect } from 'react';
import { Download, CheckCircle, X } from 'lucide-react';
import SaiLogo from './SaiLogo';

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
}

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({
    phase: 'idle',
    version: null,
    percent: 0,
    errorMessage: null,
  });
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(window.sai.onUpdateStatus((status: string) => {
      if (status === 'checking') {
        setState(prev => ({ ...prev, phase: 'checking', errorMessage: null }));
        setDismissed(false);
        setVisible(true);
      } else if (status === 'up-to-date') {
        // Briefly show "up to date" then hide
        setTimeout(() => setVisible(false), 2000);
      }
    }));

    cleanups.push(window.sai.onUpdateAvailable((info: any) => {
      setState(prev => ({ ...prev, phase: 'downloading', version: info.version, percent: 0 }));
      setDismissed(false);
      setVisible(true);
    }));

    cleanups.push(window.sai.onUpdateProgress((progress: any) => {
      setState(prev => ({ ...prev, phase: 'downloading', percent: Math.round(progress.percent) }));
    }));

    cleanups.push(window.sai.onUpdateDownloaded((info: any) => {
      setState(prev => ({ ...prev, phase: 'ready', version: info.version, percent: 100 }));
    }));

    cleanups.push(window.sai.onUpdateError((err: any) => {
      setState(prev => ({ ...prev, phase: 'error', errorMessage: err.message }));
      setTimeout(() => setVisible(false), 8000);
    }));

    return () => cleanups.forEach(fn => fn());
  }, []);

  if (!visible || dismissed) return null;

  const { phase, version, percent } = state;

  return (
    <div className={`update-notification ${visible ? 'slide-in' : ''}`}>
      {phase === 'checking' && (
        <div className="update-pill update-checking">
          <SaiLogo mode="scanner" size={14} />
          <span>Checking for updates...</span>
        </div>
      )}

      {phase === 'downloading' && (
        <div className="update-pill update-downloading">
          <Download size={11} />
          <span>Updating {version ? `to v${version}` : ''}...</span>
          <div className="update-progress-track">
            <div
              className="update-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="update-percent">{percent}%</span>
        </div>
      )}

      {phase === 'ready' && (
        <div className="update-pill update-ready">
          <CheckCircle size={11} />
          <span>v{version} ready</span>
          <button className="update-restart-btn" onClick={() => window.sai.updateInstall()}>
            Restart Now
          </button>
          <button className="update-dismiss" onClick={() => setDismissed(true)}>
            <X size={10} />
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="update-pill update-error">
          <span>Update failed</span>
          <button className="update-dismiss" onClick={() => setDismissed(true)}>
            <X size={10} />
          </button>
        </div>
      )}

      <style>{`
        .update-notification {
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
          margin-right: 10px;
          transform: translateX(120%);
          opacity: 0;
          transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
        }
        .update-notification.slide-in {
          transform: translateX(0);
          opacity: 1;
        }
        .update-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
          border: 1px solid;
        }
        .update-checking {
          color: var(--text-muted);
          border-color: var(--border);
          background: var(--bg-hover);
        }
        .update-downloading {
          color: var(--accent);
          border-color: rgba(199, 145, 12, 0.3);
          background: rgba(199, 145, 12, 0.08);
        }
        .update-ready {
          color: var(--green);
          border-color: rgba(0, 168, 132, 0.3);
          background: rgba(0, 168, 132, 0.08);
        }
        .update-error {
          color: var(--red);
          border-color: rgba(227, 85, 53, 0.3);
          background: rgba(227, 85, 53, 0.08);
        }
        .update-progress-track {
          width: 48px;
          height: 4px;
          background: rgba(199, 145, 12, 0.2);
          border-radius: 2px;
          overflow: hidden;
        }
        .update-progress-fill {
          height: 100%;
          background: var(--accent);
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        .update-percent {
          font-family: 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 10px;
          min-width: 28px;
          text-align: right;
        }
        .update-restart-btn {
          background: var(--green);
          color: #000;
          border: none;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }
        .update-restart-btn:hover {
          filter: brightness(1.15);
        }
        .update-dismiss {
          background: none;
          border: none;
          color: inherit;
          opacity: 0.5;
          cursor: pointer;
          padding: 2px;
          display: flex;
          border-radius: 3px;
        }
        .update-dismiss:hover {
          opacity: 1;
          background: rgba(255,255,255,0.1);
        }
      `}</style>
    </div>
  );
}
