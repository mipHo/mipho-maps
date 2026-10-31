const L = (window as any).L;

export interface RouteResult {
  coordinates: any[];
  totalDistance: number;
}

type RouteCallback = (result: RouteResult | null) => void;

interface Segment {
  type: 'snapped' | 'freehand';
  waypoints: any[];
  coordinates: any[];
  distance: number;
  polyline: any | null;
}

let segments: Segment[] = [];
let markers: any[] = [];
let freehandMode = false;
let map: any;
let routeCallback: RouteCallback;
let osrmRouter: any;

export function setFreehandMode(on: boolean): void {
  freehandMode = on;
}

export function isFreehandMode(): boolean {
  return freehandMode;
}

function getAllWaypoints(): any[] {
  if (segments.length === 0) return [];
  const all = [...segments[0].waypoints];
  for (let i = 1; i < segments.length; i++) {
    all.push(...segments[i].waypoints.slice(1));
  }
  return all;
}

export function getWaypointCount(_control: any): number {
  return getAllWaypoints().length;
}

function refreshMarkers(): void {
  for (const m of markers) map.removeLayer(m);
  markers = [];

  const allWps = getAllWaypoints();
  for (let i = 0; i < allWps.length; i++) {
    const isStart = i === 0;
    const isEnd = i === allWps.length - 1 && allWps.length > 1;
    const m = L.marker(allWps[i], {
      icon: L.divIcon({
        className: '',
        html: `<div style="
          width: 16px; height: 16px; border-radius: 50%;
          background: ${isStart ? '#4caf50' : isEnd ? '#f44336' : '#2196f3'};
          border: 3px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    }).addTo(map);
    markers.push(m);
  }
}

function emitMergedRoute(): void {
  const allCoords: any[] = [];
  let totalDist = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.coordinates.length === 0) continue;
    const coords = i === 0 ? seg.coordinates : seg.coordinates.slice(1);
    allCoords.push(...coords);
    totalDist += seg.distance;
  }

  if (allCoords.length >= 2) {
    routeCallback({ coordinates: allCoords, totalDistance: totalDist });
  } else {
    routeCallback(null);
  }
}

function routeSnappedSegment(segment: Segment): void {
  if (segment.waypoints.length < 2) {
    segment.coordinates = [];
    segment.distance = 0;
    if (segment.polyline) {
      map.removeLayer(segment.polyline);
      segment.polyline = null;
    }
    emitMergedRoute();
    return;
  }

  const wps = segment.waypoints.map((wp: any) => ({ latLng: wp }));
  osrmRouter.route(wps, (err: any, routes: any) => {
    if (err || !routes || routes.length === 0) {
      console.error('[maps-mipho] routing error', err);
      segment.coordinates = [];
      segment.distance = 0;
      if (segment.polyline) {
        map.removeLayer(segment.polyline);
        segment.polyline = null;
      }
      emitMergedRoute();
      return;
    }

    const route = routes[0];
    segment.coordinates = route.coordinates;
    segment.distance = route.summary.totalDistance;

    if (segment.polyline) {
      segment.polyline.setLatLngs(segment.coordinates);
    } else {
      segment.polyline = L.polyline(segment.coordinates, {
        color: '#2196f3', weight: 5, opacity: 0.8,
      }).addTo(map);
    }

    console.log('[maps-mipho] snapped route found', route.summary);
    emitMergedRoute();
  });
}

function updateFreehandSegment(segment: Segment): void {
  segment.coordinates = segment.waypoints.map((wp: any) => L.latLng(wp.lat, wp.lng));

  segment.distance = 0;
  for (let i = 1; i < segment.waypoints.length; i++) {
    segment.distance += segment.waypoints[i - 1].distanceTo(segment.waypoints[i]);
  }

  if (segment.polyline) {
    segment.polyline.setLatLngs(segment.coordinates);
  } else if (segment.coordinates.length >= 2) {
    segment.polyline = L.polyline(segment.coordinates, {
      color: '#ff9800', weight: 5, opacity: 0.8, dashArray: '10, 10',
    }).addTo(map);
  }

  emitMergedRoute();
}

export function createRoutingControl(mapInstance: any, onRoute: RouteCallback): any {
  map = mapInstance;
  routeCallback = onRoute;
  osrmRouter = L.Routing.osrmv1({
    serviceUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1',
    profile: 'foot',
  });
  return null;
}

export function addWaypoint(_control: any, latlng: any): void {
  const point = L.latLng(latlng.lat, latlng.lng);
  const currentType = freehandMode ? 'freehand' : 'snapped';
  const active = segments.length > 0 ? segments[segments.length - 1] : null;

  if (!active || active.type !== currentType) {
    const bridgePoint = active && active.waypoints.length > 0
      ? active.waypoints[active.waypoints.length - 1]
      : null;

    const newSeg: Segment = {
      type: currentType,
      waypoints: bridgePoint ? [bridgePoint, point] : [point],
      coordinates: [],
      distance: 0,
      polyline: null,
    };
    segments.push(newSeg);

    if (currentType === 'snapped') {
      routeSnappedSegment(newSeg);
    } else {
      updateFreehandSegment(newSeg);
    }
  } else {
    active.waypoints.push(point);
    if (currentType === 'snapped') {
      routeSnappedSegment(active);
    } else {
      updateFreehandSegment(active);
    }
  }

  refreshMarkers();
  console.log('[maps-mipho] addWaypoint, segments:', segments.length, 'total waypoints:', getWaypointCount(null));
}

export function undoWaypoint(_control: any): void {
  if (segments.length === 0) return;

  const active = segments[segments.length - 1];
  const isBridged = segments.length > 1;
  const minWps = isBridged ? 2 : 1;

  if (active.waypoints.length > minWps) {
    active.waypoints.pop();
    if (active.type === 'snapped') {
      routeSnappedSegment(active);
    } else {
      updateFreehandSegment(active);
    }
  } else {
    if (active.polyline) map.removeLayer(active.polyline);
    segments.pop();
    emitMergedRoute();
  }

  refreshMarkers();
}

export function clearWaypoints(_control: any): void {
  for (const seg of segments) {
    if (seg.polyline) map.removeLayer(seg.polyline);
  }
  segments = [];
  for (const m of markers) map.removeLayer(m);
  markers = [];
}
