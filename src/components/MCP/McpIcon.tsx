import { useState } from 'react';
import { Server } from 'lucide-react';

interface McpIconProps {
  iconUrl?: string;
  size?: number;
  className?: string;
  imgClassName?: string;
}

export default function McpIcon({ iconUrl, size = 14, className = 'card-icon', imgClassName = 'card-icon-img' }: McpIconProps) {
  const [failed, setFailed] = useState(false);

  if (iconUrl && !failed) {
    return (
      <img
        className={imgClassName}
        src={iconUrl}
        alt=""
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={className}>
      <Server size={size} />
    </div>
  );
}
