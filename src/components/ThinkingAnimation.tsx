import SaiLogo from './SaiLogo';
import { useThinkingDriver } from './Chat/useThinkingDriver';

interface ThinkingAnimationProps {
  color?: string;
  /** Secondary label explaining a silent pause (thinking-token count, API
   *  retry backoff, context compaction). Rendered muted after the status. */
  hint?: string | null;
}

export default function ThinkingAnimation({ color, hint }: ThinkingAnimationProps = {}) {
  const { saiAnimationEnabled, chainMode, displayText, clockText, Icon } = useThinkingDriver();

  return (
    <div className="thinking-animation" style={color ? { color } : undefined}>
      {saiAnimationEnabled
        ? <SaiLogo mode={chainMode} size={18} className="thinking-icon" color={color || '#c7913b'} />
        : <Icon size={16} className="thinking-icon" style={color ? { color } : undefined} />}
      {saiAnimationEnabled && (
        <span className="thinking-clock">[{clockText}]</span>
      )}
      <span className="thinking-text" style={color ? { color } : undefined}>
        {/* Shimmer only without a color override — the shimmer gradient would
            discard the caller's custom color. */}
        <span className={color ? undefined : 'sai-shimmer'}>{displayText}</span>
        {saiAnimationEnabled
          ? <span className="thinking-cursor thinking-cursor-block" style={color ? { backgroundColor: color } : undefined} />
          : <>
              <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
              ...
            </>}
      </span>
      {hint && (
        <span className="thinking-hint" style={{ opacity: 0.55, marginLeft: 8, fontSize: 12 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
