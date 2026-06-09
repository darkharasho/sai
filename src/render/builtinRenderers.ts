export interface ChartInput {
  chart: 'bar' | 'line';
  labels: string[];
  values: number[];
  color?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CHART_W = 320;
const CHART_H = 180;
const PAD = 24;

export function buildChartHtml(input: ChartInput): string {
  const { chart, labels, values } = input;
  if (labels.length !== values.length) {
    throw new Error('chart labels and values must have the same length');
  }
  const color = typeof input.color === 'string' ? escapeHtml(input.color) : '#6aa9ff';
  const max = Math.max(1, ...values);
  const plotW = CHART_W - PAD * 2;
  const plotH = CHART_H - PAD * 2;
  const n = values.length;

  const xFor = (i: number) => (n <= 1 ? PAD + plotW / 2 : PAD + (i * plotW) / (n - 1));
  const yFor = (v: number) => PAD + plotH - (v / max) * plotH;

  let body = '';
  if (chart === 'bar') {
    const slot = plotW / Math.max(1, n);
    const barW = slot * 0.6;
    body = values
      .map((v, i) => {
        const h = (v / max) * plotH;
        const x = PAD + slot * i + (slot - barW) / 2;
        const y = PAD + plotH - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" rx="2"/>`;
      })
      .join('');
  } else {
    const points = values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
    body = `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`;
  }

  const labelEls = labels
    .map((label, i) => {
      const slot = plotW / Math.max(1, n);
      const x = chart === 'bar' ? PAD + slot * i + slot / 2 : xFor(i);
      return `<text x="${x.toFixed(1)}" y="${CHART_H - 6}" font-size="9" text-anchor="middle" fill="#9aa3b2">${escapeHtml(label)}</text>`;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" ` +
    `style="font-family:system-ui,sans-serif">` +
    `<line x1="${PAD}" y1="${CHART_H - PAD}" x2="${CHART_W - PAD}" y2="${CHART_H - PAD}" stroke="#3a3f4b"/>` +
    `${body}${labelEls}</svg>`
  );
}

export interface DiffInput {
  before: string;
  after: string;
  layout?: 'side-by-side' | 'stacked';
  beforeLabel?: string;
  afterLabel?: string;
}

export function buildDiffHtml(input: DiffInput): string {
  const beforeLabel = escapeHtml(input.beforeLabel ?? 'Before');
  const afterLabel = escapeHtml(input.afterLabel ?? 'After');
  const stacked = input.layout === 'stacked';
  const gridStyle = stacked
    ? 'display:grid;gap:12px'
    : 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
  const cell = (label: string, content: string) =>
    `<div style="border:1px solid #2a2f3a;border-radius:8px;overflow:hidden">` +
    `<div style="padding:4px 8px;font:600 11px system-ui,sans-serif;color:#9aa3b2;` +
    `background:#1b1f27;border-bottom:1px solid #2a2f3a">${label}</div>` +
    `<div style="padding:10px">${content}</div></div>`;
  return (
    `<div style="${gridStyle};font-family:system-ui,sans-serif">` +
    `${cell(beforeLabel, input.before)}${cell(afterLabel, input.after)}</div>`
  );
}
