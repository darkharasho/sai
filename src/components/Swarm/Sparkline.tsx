import React from 'react';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

/**
 * Tiny SVG sparkline. Renders a line + area fill.
 * - Empty data → renders nothing.
 * - Pure component, no animation.
 * - Normalizes values to fit the height. A flat series renders along the
 *   bottom edge so the user gets a baseline rather than a misleading midline.
 */
export default function Sparkline({
  data,
  width = 60,
  height = 16,
  color = 'currentColor',
  fillOpacity = 0.2,
  strokeWidth = 1.25,
}: Props) {
  if (!data || data.length === 0) return null;
  const n = data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min;
  const stepX = n === 1 ? 0 : width / (n - 1);

  const yFor = (v: number): number => {
    if (span <= 0) return height - strokeWidth / 2;
    const norm = (v - min) / span; // 0..1
    return height - norm * (height - strokeWidth) - strokeWidth / 2;
  };

  const points = data.map((v, i) => {
    const x = n === 1 ? width / 2 : i * stepX;
    return `${x.toFixed(2)},${yFor(v).toFixed(2)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${(n === 1 ? width / 2 : (n - 1) * stepX).toFixed(2)},${height} L 0,${height} Z`;

  return (
    <svg
      data-testid="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      <path d={areaPath} fill={color} fillOpacity={fillOpacity} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
