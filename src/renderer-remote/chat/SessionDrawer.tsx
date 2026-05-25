import { useState, useEffect } from 'react';
import type { WireClient } from '../wire';

interface SessionMeta {
  id: string;
  projectPath: string;
  title?: string;
  updatedAt: number;
  kind?: string;
}

interface Props {
  client: WireClient;
  followEnabled: boolean;
  onFollowChange: (v: boolean) => void;
  onAttach: (projectPath: string, sessionId: string) => void;
  currentProjectPath: string | null;
  open: boolean;
  onClose: () => void;
}

export default function SessionDrawer({ client, followEnabled, onFollowChange, onAttach, currentProjectPath, open, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentProjectPath) return;
    setLoading(true); setErr(null);
    client.listSessions(currentProjectPath)
      .then((s) => setSessions((s as SessionMeta[]) ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [open, currentProjectPath, client]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="w-72 bg-neutral-950 border-r border-neutral-800 flex flex-col">
        <div className="p-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="text-sm font-semibold">Sessions</div>
          <button onClick={onClose} className="text-neutral-400 text-xl leading-none">×</button>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-neutral-900">
          <input type="checkbox" checked={followEnabled} onChange={(e) => onFollowChange(e.target.checked)} />
          Follow desktop
        </label>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-neutral-500">Loading…</div>}
          {err && <div className="px-3 py-2 text-xs text-red-400">{err}</div>}
          {!loading && sessions.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">No sessions for this workspace.</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { onAttach(s.projectPath, s.id); onClose(); }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-900 border-b border-neutral-900"
            >
              <div className="truncate">{s.title ?? `Session ${s.id.slice(0, 6)}`}</div>
              <div className="text-xs text-neutral-500">{new Date(s.updatedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 bg-black/40" onClick={onClose} />
    </div>
  );
}
