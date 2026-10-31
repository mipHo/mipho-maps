import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteBuilder, type RouteResult } from './router';
import {
  fetchElevation,
  interpolateElevation,
  RateLimitError,
  type ElevationPoint,
  type ElevationResult,
} from './elevation';
import { renderProfile, clearProfile, distanceAtX, CURSOR_COLOR } from './profile';
import { cumulativeDistances, pointAtDistance } from './geo';
import { formatDuration, walkingTimeMinutes } from './walking';
import { MapMessages, routingErrorMessage } from './messages';
import { generateGPX, generateKML, downloadFile } from './export';

const map = L.map('map', { zoomControl: false }).setView([-39.81, -73.24], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);

/** Map marker that follows the cursor on the elevation profile. */
const hoverMarker = L.circleMarker([0, 0], {
  radius: 7,
  color: '#1c1c1c',
  weight: 2,
  fillColor: CURSOR_COLOR,
  fillOpacity: 1,
  interactive: false,
});

const ELEVATION_DEBOUNCE_MS = 500;

let currentRoute: RouteResult | null = null;
/** Elevation for currentRoute; null while loading, after a failure, or when there's no route. */
let currentElevation: ElevationResult | null = null;
/** Last profile drawn; kept (dimmed) while a newer one loads so the panel doesn't jump. */
let shownProfile: ElevationPoint[] = [];
/** Cumulative distances along currentRoute.coordinates; set together with currentElevation. */
let routeDistances: number[] = [];
let elevationTimeout: ReturnType<typeof setTimeout> | null = null;
let elevationAbort: AbortController | null = null;
let pendingLegs = 0;

const btnFreehand = document.getElementById('btn-freehand') as HTMLButtonElement;
const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnGpx = document.getElementById('btn-gpx') as HTMLButtonElement;
const btnKml = document.getElementById('btn-kml') as HTMLButtonElement;
const exportMenu = document.getElementById('export-menu')!;
const statDistance = document.getElementById('stat-distance')!;
const statGain = document.getElementById('stat-gain')!;
const statLoss = document.getElementById('stat-loss')!;
const statTime = document.getElementById('stat-time')!;
const profileCanvas = document.getElementById('profile-canvas') as HTMLCanvasElement;
const profileToggle = document.getElementById('profile-toggle')!;
const profileContainer = document.getElementById('profile-container')!;
const profileStatus = document.getElementById('profile-status')!;

/** Toolbar buttons and the map hint, from the current waypoint count / route state. */
function updateControls(): void {
  const count = route.waypointCount;
  btnUndo.disabled = count === 0;
  btnClear.disabled = count === 0;
  btnExport.disabled = currentRoute === null || pendingLegs > 0;

  messages.setHint(
    count === 0
      ? 'Tap the map to set a start point'
      : count === 1
        ? route.mode === 'freehand'
          ? 'Tap again to draw a straight line to the next point'
          : 'Tap again to route to the next point'
        : null,
  );
}

/** gain/loss null = not known (shown as `unknown`: "…" while loading, "–" after a failure). */
function updateStats(distance: number, gain: number | null, loss: number | null, unknown = '…'): void {
  statDistance.textContent = `${(distance / 1000).toFixed(1)} km`;
  statGain.textContent = gain === null ? `+${unknown}` : `+${Math.round(gain)} m`;
  statLoss.textContent = loss === null ? `-${unknown}` : `-${Math.round(loss)} m`;

  // Walking time needs the ascent. While loading: "…". If elevation failed: the flat-ground
  // estimate, marked "≥" because any climb only adds time.
  if (gain !== null) statTime.textContent = formatDuration(walkingTimeMinutes(distance, gain));
  else if (unknown === '…') statTime.textContent = '…';
  else statTime.textContent = `≥ ${formatDuration(walkingTimeMinutes(distance, 0))}`;

  statGain.classList.toggle('loading', gain === null);
  statLoss.classList.toggle('loading', loss === null);
  statTime.classList.toggle('loading', gain === null);
}

/**
 * idle: no route yet · routing: legs still being routed · loading: fetching elevation ·
 * waiting: rate-limited, retrying soon · ready: profile matches the route · error: fetch failed.
 */
type ElevationStatus = 'idle' | 'routing' | 'loading' | 'waiting' | 'ready' | 'error';

const STATUS_TEXT: Record<ElevationStatus, string> = {
  idle: 'Add two points to see the elevation profile',
  routing: 'Finding route…',
  loading: 'Loading elevation…',
  waiting: 'Elevation limit reached — retrying soon',
  ready: '',
  error: 'Elevation unavailable',
};

/** `text` overrides the default wording for the status. */
function setElevationStatus(status: ElevationStatus, text = STATUS_TEXT[status]): void {
  const busy = status === 'routing' || status === 'loading' || status === 'waiting';
  profileContainer.classList.toggle('ready', status === 'ready');
  profileContainer.classList.toggle('loading', busy); // spinner + dimmed chart
  profileContainer.classList.toggle('error', status === 'error');
  profileStatus.classList.toggle('hidden', status === 'ready');
  profileStatus.textContent = text;
}

/** Live "retrying in N s" countdown while a rate-limited elevation request waits. */
let retryCountdown: ReturnType<typeof setInterval> | null = null;

function startRetryCountdown(waitMs: number): void {
  stopRetryCountdown();
  const retryAt = Date.now() + waitMs;
  const tick = () => {
    const seconds = Math.ceil((retryAt - Date.now()) / 1000);
    if (seconds <= 0) {
      stopRetryCountdown();
      setElevationStatus('loading');
    } else {
      setElevationStatus('waiting', `Elevation limit reached — retrying in ${seconds} s`);
    }
  };
  tick();
  retryCountdown = setInterval(tick, 1000);
}

function stopRetryCountdown(): void {
  if (retryCountdown) clearInterval(retryCountdown);
  retryCountdown = null;
}

/** Drops any scheduled or in-flight elevation request; its result will never be applied. */
function cancelElevation(): void {
  hideHover();
  stopRetryCountdown();
  if (elevationTimeout) clearTimeout(elevationTimeout);
  elevationTimeout = null;
  elevationAbort?.abort();
  elevationAbort = null;
}

function resetStats(): void {
  cancelElevation();
  updateStats(0, 0, 0);
  currentRoute = null;
  currentElevation = null;
  shownProfile = [];
  clearProfile(profileCanvas);
  setElevationStatus('idle');
}

async function loadElevation(result: RouteResult): Promise<void> {
  const abort = new AbortController();
  elevationAbort = abort;
  try {
    const elev = await fetchElevation(result.coordinates, {
      signal: abort.signal,
      onRateLimitWait: (waitMs) => {
        if (!abort.signal.aborted) startRetryCountdown(waitMs);
      },
    });
    if (abort.signal.aborted) return; // route changed while we were waiting
    stopRetryCountdown();
    elevationAbort = null;
    currentElevation = elev;
    routeDistances = cumulativeDistances(result.coordinates);
    shownProfile = elev.points;
    updateStats(result.totalDistance, elev.gain, elev.loss);
    renderProfile(profileCanvas, shownProfile);
    setElevationStatus('ready');
  } catch (err) {
    if (abort.signal.aborted) return;
    stopRetryCountdown();
    elevationAbort = null;
    console.warn('[maps-mipho] elevation fetch failed', err);
    updateStats(result.totalDistance, null, null, '–');
    setElevationStatus(
      'error',
      err instanceof RateLimitError
        ? 'Elevation limit still reached — change the route to try again'
        : STATUS_TEXT.error,
    );
  }
}

async function onRouteFound(result: RouteResult | null, pending: number): Promise<void> {
  pendingLegs = pending;
  if (!result) {
    resetStats();
    // e.g. two points with the first leg still being routed
    if (pending > 0) setElevationStatus('routing');
    updateControls();
    return;
  }

  // Any elevation we have belongs to the previous route shape.
  cancelElevation();
  currentRoute = result;
  currentElevation = null;
  updateStats(result.totalDistance, null, null);
  setElevationStatus(pending > 0 ? 'routing' : 'loading');
  updateControls();

  // Only fetch elevation for a complete route, debounced so rapid edits make one request.
  if (pending > 0) return;
  elevationTimeout = setTimeout(() => {
    elevationTimeout = null;
    void loadElevation(result);
  }, ELEVATION_DEBOUNCE_MS);
}

const messages = new MapMessages(map);
const route = new RouteBuilder(map, onRouteFound, (err) => messages.showToast(routingErrorMessage(err)));
updateControls();
setElevationStatus('idle');

// Map tap to add waypoint
map.on('click', (e: L.LeafletMouseEvent) => {
  route.add(e.latlng);
  updateControls();
});

// Toolbar buttons
btnFreehand.addEventListener('click', () => {
  route.mode = route.mode === 'freehand' ? 'snapped' : 'freehand';
  btnFreehand.classList.toggle('active', route.mode === 'freehand');
  updateControls(); // hint wording depends on the mode
});

btnUndo.addEventListener('click', () => {
  route.undo();
  messages.hideToast(); // the toast usually refers to the leg just removed
  updateControls();
});

btnClear.addEventListener('click', () => {
  route.clear();
  messages.hideToast();
  updateControls();
});

btnExport.addEventListener('click', () => {
  exportMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('#export-group')) {
    exportMenu.classList.add('hidden');
  }
});

const EXPORT_FORMATS = {
  gpx: { generate: generateGPX, filename: 'route.gpx', mimeType: 'application/gpx+xml' },
  kml: { generate: generateKML, filename: 'route.kml', mimeType: 'application/vnd.google-earth.kml+xml' },
} as const;

function exportRoute(format: keyof typeof EXPORT_FORMATS): void {
  exportMenu.classList.add('hidden');
  if (!currentRoute) return;
  const { generate, filename, mimeType } = EXPORT_FORMATS[format];
  const elevations = currentElevation
    ? interpolateElevation(currentRoute.coordinates, currentElevation.points)
    : currentRoute.coordinates.map(() => 0);
  downloadFile(generate(currentRoute.coordinates, elevations), filename, mimeType);
}

btnGpx.addEventListener('click', () => exportRoute('gpx'));
btnKml.addEventListener('click', () => exportRoute('kml'));

// Profile collapse toggle
profileToggle.addEventListener('click', () => {
  profileContainer.classList.toggle('collapsed');
  // A profile that arrived while collapsed was drawn at 0×0; redraw it at the real size.
  redrawProfile();
});

function redrawProfile(): void {
  if (shownProfile.length > 0) renderProfile(profileCanvas, shownProfile);
}

window.addEventListener('resize', redrawProfile);

// Hovering / touching the profile shows the matching point on the map.
function showHover(e: PointerEvent): void {
  // Only for a profile that matches the current route (not the dimmed one shown while loading).
  if (!currentElevation || !currentRoute) return;
  const d = distanceAtX(profileCanvas, currentElevation.points, e.offsetX);
  if (d === null) return;
  hoverMarker.setLatLng(pointAtDistance(currentRoute.coordinates, routeDistances, d));
  if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map);
  renderProfile(profileCanvas, currentElevation.points, d);
}

function hideHover(): void {
  if (!map.hasLayer(hoverMarker)) return;
  hoverMarker.remove();
  redrawProfile();
}

profileCanvas.addEventListener('pointerdown', showHover);
profileCanvas.addEventListener('pointermove', showHover);
profileCanvas.addEventListener('pointerleave', hideHover);
profileCanvas.addEventListener('pointercancel', hideHover);
