export default function TerminalModeView({ projectPath }: { projectPath: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Terminal Mode — {projectPath}
    </div>
  );
}
