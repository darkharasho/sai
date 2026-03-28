interface NavBarProps {
  activeSidebar: string | null;
  onToggle: (id: string) => void;
}

export default function NavBar({ activeSidebar, onToggle }: NavBarProps) {
  const isActive = activeSidebar === 'git';

  return (
    <nav
      style={{
        width: 'var(--nav-width)',
        minWidth: 'var(--nav-width)',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        gap: 4,
      }}
    >
      <button
        onClick={() => onToggle('git')}
        title="Source Control"
        style={{
          width: 40,
          height: 40,
          background: 'transparent',
          border: 'none',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isActive ? 'var(--accent)' : 'var(--text-muted)'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <line x1="12" y1="9" x2="12" y2="15" />
        </svg>
      </button>
    </nav>
  );
}
