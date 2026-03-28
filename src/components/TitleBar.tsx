interface TitleBarProps {
  projectPath: string;
  onProjectChange: (path: string) => void;
}

export default function TitleBar({ projectPath, onProjectChange }: TitleBarProps) {
  const projectName = projectPath
    ? projectPath.split('/').pop() || projectPath
    : 'No Project';

  return (
    <div
      style={{
        height: 'var(--titlebar-height)',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <button
        onClick={async () => {
          const folder = await window.vsai.selectFolder();
          if (folder) {
            onProjectChange(folder);
          }
        }}
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'transparent',
          border: 'none',
          color: 'var(--text)',
          fontSize: 12,
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: 4,
        } as React.CSSProperties}
      >
        {projectName}
      </button>
    </div>
  );
}
