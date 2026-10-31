import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteBuilder, type RouteResult } from './router';
import { fetchElevation, interpolateElevation, type ElevationPoint, type ElevationResult } from './elevation';
import { renderProfile, clearProfile, distanceAtX, CURSOR_COLOR } from './profile';
import { cumulativeDistances, pointAtDistance } from './geo';
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
  color: '#1a1a2e',
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
const profileCanvas = document.getElementById('profile-canvas') as HTMLCanvasElement;
const profileToggle = document.getElementById('profile-toggle')!;
const profileContainer = document.getElementById('profile-container')!;
const profileStatus = document.getElementById('profile-status')!;

function updateButtons(): void {
  const count = route.waypointCount;
  btnUndo.disabled = count === 0;
  btnClear.disabled = count === 0;
  btnExport.disabled = currentRoute === null || pendingLegs > 0;
}

/** gain/loss null = not known (shown as `unknown`: "…" while loading, "–" after a failure). */
function updateStats(distance: number, gain: number | null, loss: number | null, unknown = '…'): void {
  statDistance.textContent = `${(distance / 1000).toFixed(1)} km`;
  statGain.textContent = gain === null ? `+${unknown}` : `+${Math.round(gain)}m`;
  statLoss.textContent = loss === null ? `-${unknown}` : `-${Math.round(loss)}m`;
  statGain.classList.toggle('loading', gain === null);
  statLoss.classList.toggle('loading', loss === null);
}

type ElevationStatus = 'idle' | 'loading' | 'ready' | 'error';

function setElevationStatus(status: ElevationStatus): void {
  profileContainer.classList.toggle('ready', status === 'ready');
  profileContainer.classList.toggle('loading', status === 'loading');
  profileContainer.classList.toggle('error', status === 'error');
  profileStatus.classList.toggle('hidden', status !== 'loading' && status !== 'error');
  profileStatus.textContent =
    status === 'loading' ? 'Loading elevation…' : status === 'error' ? 'Elevation unavailable' : '';
}

/** Drops any scheduled or in-flight elevation request; its result will never be applied. */
function cancelElevation(): void {
  hideHover();
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
    const elev = await fetchElevation(result.coordinates, { signal: abort.signal });
    if (abort.signal.aborted) return; // route changed while we were waiting
    elevationAbort = null;
    currentElevation = elev;
    routeDistances = cumulativeDistances(result.coordinates);
    shownProfile = elev.points;
    updateStats(result.totalDistance, elev.gain, elev.loss);
    renderProfile(profileCanvas, shownProfile);
    setElevationStatus('ready');
  } catch (err) {
    if (abort.signal.aborted) return;
    elevationAbort = null;
    console.warn('[maps-mipho] elevation fetch failed', err);
    updateStats(result.totalDistance, null, null, '–');
    setElevationStatus('error');
  }
}

async function onRouteFound(result: RouteResult | null, pending: number): Promise<void> {
  pendingLegs = pending;
  if (!result) {
    resetStats();
    updateButtons();
    return;
  }

  // Any elevation we have belongs to the previous route shape.
  cancelElevation();
  currentRoute = result;
  currentElevation = null;
  updateStats(result.totalDistance, null, null);
  setElevationStatus('loading');
  updateButtons();

  // Only fetch elevation for a complete route, debounced so rapid edits make one request.
  if (pending > 0) return;
  elevationTimeout = setTimeout(() => {
    elevationTimeout = null;
    void loadElevation(result);
  }, ELEVATION_DEBOUNCE_MS);
}

const route = new RouteBuilder(map, onRouteFound);

// Map tap to add waypoint
map.on('click', (e: L.LeafletMouseEvent) => {
  route.add(e.latlng);
  updateButtons();
});

// Toolbar buttons
btnFreehand.addEventListener('click', () => {
  route.mode = route.mode === 'freehand' ? 'snapped' : 'freehand';
  btnFreehand.classList.toggle('active', route.mode === 'freehand');
});

btnUndo.addEventListener('click', () => {
  route.undo();
  updateButtons();
});

btnClear.addEventListener('click', () => {
  route.clear();
  updateButtons();
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
