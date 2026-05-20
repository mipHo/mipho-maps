const L = (window as any).L;

export interface RouteResult {
  coordinates: any[];
  totalDistance: number;
}

type RouteCallback = (result: RouteResult | null) => void;

const waypoints: any[] = [];

export function createRoutingControl(map: any, onRoute: RouteCallback): any {
  const control = L.Routing.control({
    router: L.Routing.osrmv1({
      serviceUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1',
      profile: 'foot',
    }),
    waypoints: [],
    show: false,
    addWaypoints: false,
    draggableWaypoints: true,
    routeWhileDragging: true,
    fitSelectedRoutes: false,
    lineOptions: {
      styles: [{ color: '#2196f3', weight: 5, opacity: 0.8 }],
      extendToWaypoints: true,
      missingRouteTolerance: 0,
    },
    createMarker: (waypointIndex: number, waypoint: any, numberOfWaypoints: number) => {
      const isStart = waypointIndex === 0;
      const isEnd = waypointIndex === numberOfWaypoints - 1;
      const marker = L.marker(waypoint.latLng, {
        draggable: true,
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
      });

      marker.bindPopup(
        `<button class="waypoint-remove-btn" data-index="${waypointIndex}">Remove</button>`,
        { closeButton: false },
      );

      marker.on('popupopen', () => {
        const btn = document.querySelector(`.waypoint-remove-btn[data-index="${waypointIndex}"]`);
        btn?.addEventListener('click', () => {
          removeWaypoint(control, waypointIndex);
        });
      });

      return marker;
    },
  }).addTo(map);

  control.on('routesfound', (e: any) => {
    const route = e.routes[0];
    console.log('[maps-mipho] route found', route.summary);
    onRoute({
      coordinates: route.coordinates,
      totalDistance: route.summary.totalDistance,
    });
  });

  control.on('routingerror', (e: any) => {
    console.error('[maps-mipho] routing error', e);
    onRoute(null);
  });

  return control;
}

export function addWaypoint(control: any, latlng: any): void {
  waypoints.push(L.latLng(latlng.lat, latlng.lng));
  console.log('[maps-mipho] setWaypoints, count:', waypoints.length);
  control.setWaypoints([...waypoints]);
  if (waypoints.length >= 2) {
    console.log('[maps-mipho] calling route()');
    control.route();
  }
}

function removeWaypoint(control: any, index: number): void {
  waypoints.splice(index, 1);
  control.setWaypoints([...waypoints]);
}

export function undoWaypoint(control: any): void {
  if (waypoints.length > 0) {
    waypoints.pop();
    control.setWaypoints([...waypoints]);
  }
}

export function clearWaypoints(control: any): void {
  waypoints.length = 0;
  control.setWaypoints([]);
}

export function getWaypointCount(_control: any): number {
  return waypoints.length;
}
