import { useEffect, useState } from 'react';
import type { WireClient } from '../wire';
import ChangesView from './ChangesView';
import BrowseView from './BrowseView';
import RepoPicker from './RepoPicker';

interface Props {
  client: WireClient;
  workspacePath: string;
  metaMembers?: { projectPath: string; name: string }[];
}

type SubTab = 'changes' | 'browse';

const TAB_KEY = 'sai-remote-files-subtab';

export default function Files({ client, workspacePath, metaMembers }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as SubTab) ?? 'changes'; } catch { return 'changes'; }
  });
  const [cwd, setCwd] = useState<string>(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);

  useEffect(() => {
    setCwd(metaMembers && metaMembers.length > 0 ? metaMembers[0].projectPath : workspacePath);
  }, [workspacePath, metaMembers]);

  const setSub = (v: SubTab) => {
    setSubTab(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* quota */ }
  };

  const tabBtn = (v: SubTab): React.CSSProperties => ({
    flex: 1,
    padding: '6px 0',
    fontSize: 11,
    fontWeight: 600,
    background: 'transparent',
    color: subTab === v ? 'var(--accent)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: `2px solid ${subTab === v ? 'var(--accent)' : 'transparent'}`,
    cursor: 'pointer',
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {metaMembers && metaMembers.length > 0 && (
        <RepoPicker members={metaMembers} current={cwd} onPick={setCwd} />
      )}
      <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button style={tabBtn('changes')} onClick={() => setSub('changes')}>Changes</button>
        <button style={tabBtn('browse')} onClick={() => setSub('browse')}>Browse</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {subTab === 'changes'
          ? <ChangesView client={client} cwd={cwd} />
          : <BrowseView client={client} cwd={cwd} />}
      </div>
    </div>
  );
}
