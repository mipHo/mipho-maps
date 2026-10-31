import L from 'leaflet';
import type { LatLngLike } from './geo';
import { fetchRoute } from './osrm';

export type LegMode = 'snapped' | 'freehand';

export interface RouteResult {
  coordinates: LatLngLike[];
  /** Metres. */
  totalDistance: number;
}

export type RouteListener = (result: RouteResult | null) => void;

/** The path between two consecutive waypoints. Computed once, when the leg is created. */
interface Leg {
  mode: LegMode;
  status: 'pending' | 'ok' | 'error';
  coords: LatLngLike[];
  /** Metres. */
  distance: number;
  polyline: L.Polyline | null;
}

const LEG_STYLES: Record<LegMode, L.PolylineOptions> = {
  snapped: { color: '#2196f3', weight: 5, opacity: 0.8 },
  freehand: { color: '#ff9800', weight: 5, opacity: 0.8, dashArray: '10, 10' },
};

const MARKER_COLORS = { start: '#4caf50', end: '#f44336', via: '#2196f3' };

/**
 * Builds a walking route from clicked waypoints.
 * Invariant: legs.length === max(0, waypoints.length - 1), and legs[i] joins waypoints[i] → waypoints[i + 1].
 */
export class RouteBuilder {
  /** Mode used for the next leg; existing legs keep theirs. */
  mode: LegMode = 'snapped';

  private waypoints: L.LatLng[] = [];
  private legs: Leg[] = [];
  private readonly markers: L.LayerGroup;

  constructor(
    private readonly map: L.Map,
    private readonly onChange: RouteListener,
  ) {
    this.markers = L.layerGroup().addTo(map);
  }

  get waypointCount(): number {
    return this.waypoints.length;
  }

  add(latlng: LatLngLike): void {
    const point = L.latLng(latlng.lat, latlng.lng);
    const prev = this.waypoints[this.waypoints.length - 1];
    this.waypoints.push(point);

    if (prev) {
      const leg: Leg = { mode: this.mode, status: 'pending', coords: [], distance: 0, polyline: null };
      this.legs.push(leg);
      if (leg.mode === 'freehand') {
        this.settleLeg(leg, [prev, point], prev.distanceTo(point));
      } else {
        this.routeLeg(leg, prev, point);
      }
    }

    this.refreshMarkers();
    this.emit();
  }

  undo(): void {
    if (this.waypoints.length === 0) return;
    this.waypoints.pop();
    const leg = this.legs.pop();
    if (leg) this.removeLegLayer(leg);
    this.refreshMarkers();
    this.emit();
  }

  clear(): void {
    for (const leg of this.legs) this.removeLegLayer(leg);
    this.legs = [];
    this.waypoints = [];
    this.markers.clearLayers();
    this.emit();
  }

  private routeLeg(leg: Leg, from: L.LatLng, to: L.LatLng): void {
    // TODO(step 4): replies for legs removed by undo/clear are not ignored yet.
    fetchRoute([from, to]).then(
      (route) => {
        this.settleLeg(leg, route.coords, route.distance);
        this.emit();
      },
      (err) => {
        console.error('[maps-mipho] routing error', err);
        leg.status = 'error';
        this.emit();
      },
    );
  }

  private settleLeg(leg: Leg, coords: LatLngLike[], distance: number): void {
    leg.status = 'ok';
    leg.coords = coords;
    leg.distance = distance;
    leg.polyline = L.polyline(coords, LEG_STYLES[leg.mode]).addTo(this.map);
  }

  private removeLegLayer(leg: Leg): void {
    if (leg.polyline) {
      this.map.removeLayer(leg.polyline);
      leg.polyline = null;
    }
  }

  private refreshMarkers(): void {
    this.markers.clearLayers();
    const n = this.waypoints.length;
    this.waypoints.forEach((wp, i) => {
      const color = i === 0 ? MARKER_COLORS.start : i === n - 1 ? MARKER_COLORS.end : MARKER_COLORS.via;
      L.marker(wp, {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            width: 16px; height: 16px; border-radius: 50%;
            background: ${color};
            border: 3px solid #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(this.markers);
    });
  }

  /** Concatenates finished legs (pending/failed ones are skipped, as before) and notifies the listener. */
  private emit(): void {
    const coordinates: LatLngLike[] = [];
    let totalDistance = 0;

    for (const leg of this.legs) {
      if (leg.coords.length === 0) continue;
      // Each leg starts where the previous one ended; drop the duplicate point.
      coordinates.push(...(coordinates.length === 0 ? leg.coords : leg.coords.slice(1)));
      totalDistance += leg.distance;
    }

    this.onChange(coordinates.length >= 2 ? { coordinates, totalDistance } : null);
  }
}
