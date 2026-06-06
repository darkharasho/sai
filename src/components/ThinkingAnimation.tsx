import SaiLogo from './SaiLogo';
import { useThinkingDriver } from './Chat/useThinkingDriver';

interface ThinkingAnimationProps {
  color?: string;
}

export default function ThinkingAnimation({ color }: ThinkingAnimationProps = {}) {
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
        {displayText}
        {saiAnimationEnabled
          ? <span className="thinking-cursor thinking-cursor-block" style={color ? { backgroundColor: color } : undefined} />
          : <>
              <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
              ...
            </>}
      </span>
    </div>
  );
}
