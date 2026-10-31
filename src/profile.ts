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

  // Grid lines
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const elev = minElev - elevPad + ((elevRange + 2 * elevPad) * i) / yTicks;
    const y = scaleY(elev);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(w - PADDING.right, y);
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(elev)}m`, PADDING.left - 5, y + 4);
  }

  const xTicks = 4;
  for (let i = 0; i <= xTicks; i++) {
    const dist = (maxDist * i) / xTicks;
    const x = scaleX(dist);
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, h - PADDING.bottom);
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(dist / 1000).toFixed(1)}`, x, h - PADDING.bottom + 15);
  }

  // km label
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('km', w - PADDING.right + 5, h - PADDING.bottom + 15);

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
