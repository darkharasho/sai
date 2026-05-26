import { useEffect, useState } from 'react';
import { Folder, FileText, ChevronRight, ChevronDown, ArrowLeft } from 'lucide-react';
import type { WireClient } from '../wire';
import FileViewer from './FileViewer';
import FileEditor from './FileEditor';
import { langFromPath } from './lang';

interface Entry { name: string; kind: 'file' | 'dir'; size?: number }

interface Props {
  client: WireClient;
  cwd: string;
  /** Signaled when a file is opened/closed so the parent (NavDrawer) can swap to fullscreen mode. */
  onOpenChange?: (open: boolean) => void;
}

interface OpenFile {
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
  mtime?: number;
  sha?: string;
}

function Row({
  client, cwd, entry, parent, depth, onPickFile,
}: {
  client: WireClient;
  cwd: string;
  entry: Entry;
  parent: string;
  depth: number;
  onPickFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const childPath = parent ? `${parent}/${entry.name}` : entry.name;

  useEffect(() => {
    if (!expanded || entry.kind !== 'dir' || children.length > 0) return;
    setLoading(true);
    client.listFiles(cwd, childPath)
      .then((e) => setChildren(e as Entry[]))
      .finally(() => setLoading(false));
  }, [expanded, entry.kind, client, cwd, childPath]);

  const Icon = entry.kind === 'dir' ? Folder : FileText;
  const Chevron = entry.kind === 'dir' ? (expanded ? ChevronDown : ChevronRight) : null;

  return (
    <>
      <button
        onClick={() => {
          if (entry.kind === 'dir') setExpanded((v) => !v);
          else onPickFile(childPath);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: `6px 14px 6px ${10 + depth * 14}px`,
          background: 'transparent',
          color: 'var(--text)',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
          {Chevron && <Chevron size={12} color="var(--text-muted)" />}
        </span>
        <Icon size={13} color="var(--text-muted)" strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: 13,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {entry.name}
        </span>
      </button>
      {expanded && entry.kind === 'dir' && (
        <>
          {loading && <div style={{ padding: `4px 14px 4px ${24 + depth * 14}px`, fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>}
          {children.map((c) => (
            <Row
              key={c.name}
              client={client}
              cwd={cwd}
              entry={c}
              parent={childPath}
              depth={depth + 1}
              onPickFile={onPickFile}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function BrowseView({ client, cwd, onOpenChange }: Props) {
  const [rootEntries, setRootEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoadingRoot(true); setErr(null);
    setOpen(null);
    onOpenChange?.(false);
    client.listFiles(cwd, '')
      .then((e) => setRootEntries(e as Entry[]))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoadingRoot(false));
  }, [client, cwd]);

  const pickFile = (path: string) => {
    setLoadingFile(true);
    client.readFile(cwd, path)
      .then((r: any) => {
        setOpen({ path, ...r });
        onOpenChange?.(true);
      })
      .finally(() => setLoadingFile(false));
  };

  const closeFile = () => {
    setOpen(null);
    onOpenChange?.(false);
  };

  if (open && !loadingFile) {
    // Text files within the inline-content threshold open directly in the editor;
    // anything else (binary, oversized → signedUrl) falls back to the viewer.
    const editable =
      open.encoding === 'text' && !open.signedUrl &&
      typeof open.content === 'string' &&
      typeof open.mtime === 'number' && typeof open.sha === 'string';

    if (editable) {
      return (
        <FileEditor
          client={client}
          cwd={cwd}
          path={open.path}
          initialContent={open.content!}
          initialMtime={open.mtime!}
          initialSha={open.sha!}
          onSave={() => { /* stay in editor after save; mtime/sha already refreshed internally */ }}
          onCancel={closeFile}
        />
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
        }}>
          <button
            onClick={closeFile}
            aria-label="Back to files"
            style={{
              width: 32, height: 32,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
            }}
          ><ArrowLeft size={16} /></button>
          <div style={{
            flex: 1, minWidth: 0,
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 12, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{open.path}</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <FileViewer
            client={client}
            cwd={cwd}
            path={open.path}
            content={open.content}
            signedUrl={open.signedUrl}
            encoding={open.encoding}
            size={open.size}
            lang={open.lang ?? langFromPath(open.path) ?? undefined}
            mime={open.mime}
            mtime={open.mtime}
            sha={open.sha}
            onRefetch={() => pickFile(open.path)}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loadingRoot && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
        {err && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        {loadingFile && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Opening…</div>}
        {!loadingRoot && rootEntries.map((e) => (
          <Row
            key={e.name}
            client={client}
            cwd={cwd}
            entry={e}
            parent=""
            depth={1}
            onPickFile={pickFile}
          />
        ))}
      </div>
    </div>
  );
}
