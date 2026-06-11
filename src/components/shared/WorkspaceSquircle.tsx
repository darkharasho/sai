import './WorkspaceSquircle.css';
import { DOT_MASK_URL } from '../../lib/assets';
import { TRIANGLE_MASK_URL, type IndicatorState } from '../../lib/workspaceStatus';

interface WorkspaceSquircleProps {
  state: IndicatorState;
  title?: string;
  className?: string;
  'data-testid'?: string;
}

interface StatusSlotProps {
  children: React.ReactNode;
  className?: string;
}

const SQ_MASK = `url("${DOT_MASK_URL}") center / contain no-repeat`;
const TRI_MASK = `url("${TRIANGLE_MASK_URL}") center / contain no-repeat`;

export function WorkspaceSquircle({ state, title, className, 'data-testid': testId }: WorkspaceSquircleProps) {
  // Triangle = "needs your input": orange for approvals, blue for an
  // AskUserQuestion waiting on an answer.
  const isTriangle = state === 'approval' || state === 'question';

  // busy-done ("something busy + something done") is a single squircle split
  // diagonally into the busy (gold) and done (grey) colors — see the CSS. It
  // falls through the shared single-span path below, masked like the others.
  return (
    <span
      className={`ws-sq ws-sq-${state}${className ? ` ${className}` : ''}`}
      title={title}
      data-testid={testId}
      style={{
        WebkitMask: isTriangle ? TRI_MASK : SQ_MASK,
        mask: isTriangle ? TRI_MASK : SQ_MASK,
      }}
    />
  );
}

export function StatusSlot({ children, className }: StatusSlotProps) {
  return (
    <span className={`ws-status-slot${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  );
}
