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
  const isApproval = state === 'approval';

  if (state === 'busy-done') {
    return (
      <span
        className={`ws-sq ws-sq-busy-done-wrap${className ? ` ${className}` : ''}`}
        title={title}
        data-testid={testId}
      >
        <span className="ws-sq ws-sq-busy" style={{ WebkitMask: SQ_MASK, mask: SQ_MASK }} />
        <span className="ws-sq ws-sq-inner" style={{ WebkitMask: SQ_MASK, mask: SQ_MASK }} />
      </span>
    );
  }

  return (
    <span
      className={`ws-sq ws-sq-${state}${className ? ` ${className}` : ''}`}
      title={title}
      data-testid={testId}
      style={{
        WebkitMask: isApproval ? TRI_MASK : SQ_MASK,
        mask: isApproval ? TRI_MASK : SQ_MASK,
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
