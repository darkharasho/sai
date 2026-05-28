import { useEffect, useState, useCallback } from 'react';
import { ArrowDown, ArrowUp, GitBranch } from 'lucide-react';
import type { WireClient } from '../wire';
import ChangesView from './ChangesView';
import RepoPicker from './RepoPicker';
import { readPersisted, writePersisted, isString } from '../lib/persisted';

interface Props {
  client: WireClient;
  workspacePath: string;
  metaMembers?: { projectPath: string; name: string }[];
}

interface StatusEntry { path: string; status: string; staged: boolean }

type Note = { id: string; text: string; kind: 'ok' | 'err' };

const DRAFT_KEY = 'sai-remote-commit-draft';
const DRAFT_VERSION = 1;

function validateDrafts(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isString(v)) out[k] = v;
  }
  return out;
}

function readDrafts(): Record<string, string> {
  return readPersisted(DRAFT_KEY, DRAFT_VERSION, validateDrafts, {});
}
function writeDraft(cwd: string, message: string) {
  const m = readDrafts();
  if (message) m[cwd] = message;
  else delete m[cwd];
  writePersisted(DRAFT_KEY, DRAFT_VERSION, m);
}

export default function Git({ client, workspacePath, metaMembers }: Props) {
  const [cwd, setCwd] = useState<string>(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  const [branch, setBranch] = useState<string | null>(null);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const [message, setMessage] = useState<string>('');
  const [pendingStagePath, setPendingStagePath] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ commit?: boolean; push?: boolean; pull?: boolean }>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    setCwd(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  }, [workspacePath, metaMembers]);

  useEffect(() => {
    setMessage(readDrafts()[cwd] ?? '');
  }, [cwd]);

  // Direct WS roundtrip for the enriched status (branch/ahead/behind).
  const refreshHeader = useCallback(async () => {
    try {
      const reqId = `gh${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const got = await new Promise<any>((resolve, reject) => {
        const off = client.on((m: any) => {
          if (m && m.reqId === reqId) {
            off();
            if (m.type === 'files.status.result') resolve(m);
            else if (m.type === 'error') reject(new Error(m.message ?? 'status failed'));
          }
        });
        client.send({ type: 'files.status', cwd, reqId });
        setTimeout(() => { off(); reject(new Error('status timeout')); }, 5000);
      });
      setBranch(got.branch ?? null);
      setAhead(got.ahead ?? 0);
      setBehind(got.behind ?? 0);
      setStagedCount((got.entries as StatusEntry[]).filter((e) => e.staged).length);
    } catch {
      setBranch(null);
      setAhead(0);
      setBehind(0);
      setStagedCount(0);
    }
  }, [client, cwd]);

  useEffect(() => { void refreshHeader(); }, [refreshHeader, refreshKey]);

  const addNote = (text: string, kind: Note['kind']) => {
    const n: Note = { id: `n${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, kind };
    setNotes((arr) => [...arr.slice(-2), n]);
    setTimeout(() => setNotes((arr) => arr.filter((x) => x.id !== n.id)), 5000);
  };

  const onToggleStage = async (path: string, staged: boolean) => {
    setPendingStagePath(path);
    try {
      if (staged) await client.unstageFile(cwd, path);
      else        await client.stageFile(cwd, path);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addNote(`${staged ? 'unstage' : 'stage'} failed: ${(err as Error).message}`, 'err');
    } finally {
      setPendingStagePath(null);
    }
  };

  const onCommit = async () => {
    if (!message.trim() || stagedCount === 0 || busy.commit) return;
    setBusy((b) => ({ ...b, commit: true }));
    try {
      const r: any = await client.commit(cwd, message.trim());
      addNote(r?.hash ? `committed ${String(r.hash).slice(0, 7)}` : 'committed', 'ok');
      setMessage('');
      writeDraft(cwd, '');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addNote(`commit failed: ${(err as Error).message}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, commit: false }));
    }
  };

  const onPush = async () => {
    if (busy.push) return;
    setBusy((b) => ({ ...b, push: true }));
    try { await client.push(cwd); addNote('pushed', 'ok'); setRefreshKey((k) => k + 1); }
    catch (err) { addNote(`push failed: ${(err as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, push: false })); }
  };
  const onPull = async () => {
    if (busy.pull) return;
    setBusy((b) => ({ ...b, pull: true }));
    try { await client.pull(cwd); addNote('pulled', 'ok'); setRefreshKey((k) => k + 1); }
    catch (err) { addNote(`pull failed: ${(err as Error).message}`, 'err'); }
    finally { setBusy((b) => ({ ...b, pull: false })); }
  };

  const onMessageChange = (v: string) => {
    setMessage(v);
    writeDraft(cwd, v);
  };

  const canCommit = message.trim().length > 0 && stagedCount > 0 && !busy.commit;

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text)',
      }}>
        Changes
      </div>

      {metaMembers && metaMembers.length > 0 && (
        <RepoPicker members={metaMembers} current={cwd} onPick={setCwd} />
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 12, fontFamily: '"Geist Mono", ui-monospace, monospace', flexShrink: 0 }}>
          <GitBranch size={13} strokeWidth={2} />
          {branch ?? '—'}
        </span>
        {(ahead > 0 || behind > 0) && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: '"Geist Mono", ui-monospace, monospace', flexShrink: 0 }}>
            {ahead > 0 && <>&#8593;{ahead} </>}
            {behind > 0 && <>&#8595;{behind}</>}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onPull}
          disabled={!branch || busy.pull}
          style={{ ...iconBtn, opacity: !branch || busy.pull ? 0.6 : 1, color: 'var(--text)' }}
        >
          <ArrowDown size={13} strokeWidth={2} />
          {busy.pull ? 'Pulling…' : 'Pull'}
        </button>
        <button
          onClick={onPush}
          disabled={!branch || ahead === 0 || busy.push}
          style={{ ...iconBtn, opacity: !branch || ahead === 0 || busy.push ? 0.6 : 1, color: ahead > 0 ? 'var(--accent)' : 'var(--text)' }}
        >
          <ArrowUp size={13} strokeWidth={2} />
          {busy.push ? 'Pushing…' : ahead > 0 ? `Push ${ahead}` : 'Push'}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <ChangesView
          client={client}
          cwd={cwd}
          onToggleStage={onToggleStage}
          pendingStagePath={pendingStagePath}
          refreshKey={refreshKey}
        />
      </div>

      {notes.length > 0 && (
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}>
          {notes.map((n) => (
            <div key={n.id} style={{
              fontSize: 11,
              fontFamily: '"Geist Mono", ui-monospace, monospace',
              color: n.kind === 'err' ? 'var(--red)' : 'var(--green)',
            }}>
              {n.text}
            </div>
          ))}
        </div>
      )}

      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        padding: '8px 12px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}>
          Commit {stagedCount > 0 ? `(${stagedCount} staged)` : '(0 staged)'}
        </div>
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Message"
          rows={2}
          style={{
            width: '100%',
            minWidth: 0,
            resize: 'none',
            fontFamily: 'inherit',
            fontSize: 16,
            lineHeight: 1.4,
            padding: '8px 10px',
            background: 'var(--bg-input)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <button
          onClick={onCommit}
          disabled={!canCommit}
          style={{
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            background: canCommit ? 'var(--accent)' : 'var(--bg-elevated)',
            color: canCommit ? '#000' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderColor: canCommit ? 'var(--accent)' : 'var(--border)',
            borderRadius: 8,
            cursor: canCommit ? 'pointer' : 'not-allowed',
            opacity: canCommit ? 1 : 0.6,
            alignSelf: 'flex-start',
          }}
        >
          {busy.commit ? 'Committing…' : 'Commit'}
        </button>
      </div>
    </div>
  );
}
