import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteBuilder, type RouteResult } from './router';
import { fetchElevation, interpolateElevation, type ElevationPoint, type ElevationResult } from './elevation';
import { renderProfile, clearProfile } from './profile';
import { generateGPX, generateKML, downloadFile } from './export';

const map = L.map('map', { zoomControl: false }).setView([-39.81, -73.24], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);

let currentRoute: RouteResult | null = null;
let currentElevation: ElevationResult | null = null;
let elevationTimeout: ReturnType<typeof setTimeout> | null = null;

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

function updateButtons(): void {
  const count = route.waypointCount;
  btnUndo.disabled = count === 0;
  btnClear.disabled = count === 0;
  btnExport.disabled = currentRoute === null;
}

function updateStats(distance: number, gain: number, loss: number): void {
  statDistance.textContent = `${(distance / 1000).toFixed(1)} km`;
  statGain.textContent = `+${Math.round(gain)}m`;
  statLoss.textContent = `-${Math.round(loss)}m`;
}

function resetStats(): void {
  updateStats(0, 0, 0);
  currentRoute = null;
  currentElevation = null;
  clearProfile(profileCanvas);
}

async function onRouteFound(result: RouteResult | null): Promise<void> {
  console.log('[maps-mipho] routesfound', result);
  if (!result) {
    resetStats();
    updateButtons();
    return;
  }

  currentRoute = result;
  console.log('[maps-mipho] distance:', result.totalDistance, 'coords:', result.coordinates.length);
  updateStats(result.totalDistance, currentElevation?.gain ?? 0, currentElevation?.loss ?? 0);
  updateButtons();

  // Debounce elevation fetch
  if (elevationTimeout) clearTimeout(elevationTimeout);
  elevationTimeout = setTimeout(async () => {
    try {
      const elev = await fetchElevation(result.coordinates);
      currentElevation = elev;
      updateStats(result.totalDistance, elev.gain, elev.loss);
      renderProfile(profileCanvas, elev.points);
    } catch {
      console.warn('Failed to fetch elevation data');
    }
  }, 1500);
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

btnGpx.addEventListener('click', () => {
  if (!currentRoute) return;
  const elevations = currentElevation
    ? interpolateElevation(currentRoute.coordinates, currentElevation.points)
    : currentRoute.coordinates.map(() => 0);
  const gpx = generateGPX(currentRoute.coordinates, elevations);
  downloadFile(gpx, 'route.gpx', 'application/gpx+xml');
  exportMenu.classList.add('hidden');
});

btnKml.addEventListener('click', () => {
  if (!currentRoute) return;
  const elevations = currentElevation
    ? interpolateElevation(currentRoute.coordinates, currentElevation.points)
    : currentRoute.coordinates.map(() => 0);
  const kml = generateKML(currentRoute.coordinates, elevations);
  downloadFile(kml, 'route.kml', 'application/vnd.google-earth.kml+xml');
  exportMenu.classList.add('hidden');
});

// Profile collapse toggle
profileToggle.addEventListener('click', () => {
  profileContainer.classList.toggle('collapsed');
});

// Redraw profile on resize
window.addEventListener('resize', () => {
  if (currentElevation) {
    renderProfile(profileCanvas, currentElevation.points);
  }
});
