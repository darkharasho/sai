import { useEffect, useState } from 'react';
import type { WireClient } from '../wire';
import BrowseView from './BrowseView';
import RepoPicker from './RepoPicker';

interface Props {
  client: WireClient;
  workspacePath: string;
  metaMembers?: { projectPath: string; name: string }[];
  onOpenChange?: (open: boolean) => void;
}

export default function Files({ client, workspacePath, metaMembers, onOpenChange }: Props) {
  const [cwd, setCwd] = useState<string>(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  const [fileOpen, setFileOpen] = useState(false);

  useEffect(() => {
    setCwd(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  }, [workspacePath, metaMembers]);

  const handleOpenChange = (open: boolean) => {
    setFileOpen(open);
    onOpenChange?.(open);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {!fileOpen && (
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text)',
        }}>
          Files
        </div>
      )}
      {!fileOpen && metaMembers && metaMembers.length > 0 && (
        <RepoPicker members={metaMembers} current={cwd} onPick={setCwd} />
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <BrowseView client={client} cwd={cwd} onOpenChange={handleOpenChange} />
      </div>
    </div>
  );
}
