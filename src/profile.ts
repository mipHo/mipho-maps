import { elevationAtDistance, type ElevationPoint } from './elevation';

const PADDING = { top: 15, right: 15, bottom: 30, left: 45 };
const GRID_COLOR = 'rgba(255,255,255,0.1)';
const LINE_COLOR = '#2196f3';
const FILL_COLOR = 'rgba(33,150,243,0.25)';
// Mirror the theme variables in style.css (canvas can't use CSS vars directly).
const TEXT_COLOR = '#a0a0a0';
const LABEL_BG = 'rgba(28,28,28,0.9)';
export const CURSOR_COLOR = '#ffc107';

/**
 * A round tick step (m × 10^n, m from `multipliers`) giving roughly `target` intervals over `range`.
 */
export function niceStep(range: number, target: number, multipliers = [1, 2, 2.5, 5]): number {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = multipliers.find((k) => raw <= k * mag * 1.0000001);
  return (m ?? 10) * mag;
}

/** Multiples of `step` within [min, max], free of float drift (0.30000000000000004 → 0.3). */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  for (let k = first; k * step <= max + step * 1e-9; k++) {
    out.push(Number((k * step).toPrecision(12)));
  }
  return out;
}

/** Fewest decimals (0–3) that show every multiple of `step` exactly: 1 → 0, 0.5 → 1, 0.25 → 2, 25 → 0. */
export function decimalsFor(step: number): number {
  for (let d = 0; d < 3; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
  }
  return 3;
}

/**
 * Route distance (metres) under canvas-relative x (CSS px), clamped to the plotted range.
 * Null if there's nothing plotted.
 */
export function distanceAtX(canvas: HTMLCanvasElement, data: ElevationPoint[], x: number): number | null {
  if (data.length < 2) return null;
  const plotW = canvas.clientWidth - PADDING.left - PADDING.right;
  if (plotW <= 0) return null;
  const maxDist = data[data.length - 1].distance;
  const t = Math.min(1, Math.max(0, (x - PADDING.left) / plotW));
  return t * maxDist;
}

/** Draws the profile; if `cursorDistance` is given, also a crosshair and label at that distance. */
export function renderProfile(
  canvas: HTMLCanvasElement,
  data: ElevationPoint[],
  cursorDistance: number | null = null,
): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  // Only reallocate the backing store when the size changes (this runs on every pointer move).
  const pxW = Math.round(rect.width * dpr);
  const pxH = Math.round(rect.height * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const plotW = w - PADDING.left - PADDING.right;
  const plotH = h - PADDING.top - PADDING.bottom;

  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add at least 2 waypoints to see elevation', w / 2, h / 2);
    return;
  }

  const maxDist = data[data.length - 1].distance;
  const elevations = data.map((d) => d.elevation);
  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const elevRange = maxElev - minElev || 1;
  const elevPad = elevRange * 0.1;

  const scaleX = (dist: number) => PADDING.left + (dist / maxDist) * plotW;
  const scaleY = (elev: number) =>
    PADDING.top + plotH - ((elev - (minElev - elevPad)) / (elevRange + 2 * elevPad)) * plotH;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px sans-serif';

  // Y axis: whole-metre round ticks ("120 m"), labels right-aligned in the left padding.
  const yStep = Math.max(1, niceStep(elevRange + 2 * elevPad, 4, [1, 2, 5]));
  ctx.textAlign = 'right';
  for (const elev of ticks(minElev - elevPad, maxElev + elevPad, yStep)) {
    const y = scaleY(elev);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(w - PADDING.right, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(elev)} m`, PADDING.left - 5, y + 4);
  }

  // X axis: round distances; metres for short routes, km otherwise. Unit only on the last label.
  const useKm = maxDist >= 1000;
  const unitScale = useKm ? 1000 : 1;
  const xStep = niceStep(maxDist / unitScale, Math.max(2, Math.floor(plotW / 70))) * unitScale;
  const decimals = decimalsFor(xStep / unitScale);
  const xValues = ticks(0, maxDist, xStep);
  const labelY = h - PADDING.bottom + 15;
  let prevRight = -Infinity;
  xValues.forEach((dist, i) => {
    const x = scaleX(dist);
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, h - PADDING.bottom);
    ctx.stroke();

    const isLast = i === xValues.length - 1;
    const label = (dist / unitScale).toFixed(decimals) + (isLast ? (useKm ? ' km' : ' m') : '');
    const width = ctx.measureText(label).width;
    // Centre under the tick, but keep inside the canvas and don't overlap the previous label.
    let left = Math.min(x - width / 2, w - 2 - width);
    left = Math.max(left, 2);
    if (left < prevRight + 6) return;
    ctx.textAlign = 'left';
    ctx.fillText(label, left, labelY);
    prevRight = left + width;
  });

  // Filled area
  ctx.beginPath();
  ctx.moveTo(scaleX(data[0].distance), scaleY(data[0].elevation));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(scaleX(data[i].distance), scaleY(data[i].elevation));
  }
  ctx.lineTo(scaleX(data[data.length - 1].distance), scaleY(minElev - elevPad));
  ctx.lineTo(scaleX(data[0].distance), scaleY(minElev - elevPad));
  ctx.closePath();
  ctx.fillStyle = FILL_COLOR;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(scaleX(data[0].distance), scaleY(data[0].elevation));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(scaleX(data[i].distance), scaleY(data[i].elevation));
  }
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (cursorDistance !== null) {
    const d = Math.min(maxDist, Math.max(0, cursorDistance));
    const elev = elevationAtDistance(data, d);
    const x = scaleX(d);
    const y = scaleY(elev);

    ctx.strokeStyle = CURSOR_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, h - PADDING.bottom);
    ctx.stroke();

    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Label at the top, flipped to the left of the line near the right edge.
    const label = `${(d / 1000).toFixed(2)} km · ${Math.round(elev)} m`;
    ctx.font = '600 11px sans-serif';
    const labelW = ctx.measureText(label).width + 10;
    const flip = x + 6 + labelW > w - PADDING.right;
    const lx = flip ? x - 6 - labelW : x + 6;
    ctx.fillStyle = LABEL_BG;
    ctx.fillRect(lx, PADDING.top, labelW, 18);
    ctx.fillStyle = CURSOR_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText(label, lx + 5, PADDING.top + 13);
  }
}

export function clearProfile(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
