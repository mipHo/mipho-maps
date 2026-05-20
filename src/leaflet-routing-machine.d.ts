import * as L from 'leaflet';

declare module 'leaflet' {
  namespace Routing {
    interface Waypoint {
      latLng: L.LatLng | null;
    }

    interface RouteSummary {
      totalDistance: number;
      totalTime: number;
    }

    interface Route {
      coordinates: L.LatLng[];
      summary: RouteSummary;
    }

    interface RoutingResultEvent {
      routes: Route[];
    }

    interface RouterOptions {
      serviceUrl?: string;
      profile?: string;
    }

    interface LineOptions {
      styles?: L.PathOptions[];
      extendToWaypoints?: boolean;
      missingRouteTolerance?: number;
    }

    interface ControlOptions {
      router?: object;
      waypoints?: L.LatLng[];
      show?: boolean;
      addWaypoints?: boolean;
      draggableWaypoints?: boolean;
      routeWhileDragging?: boolean;
      fitSelectedRoutes?: boolean;
      lineOptions?: LineOptions;
      createMarker?: (
        waypointIndex: number,
        waypoint: Waypoint,
        numberOfWaypoints: number,
      ) => L.Marker;
    }

    interface Control extends L.Control {
      getWaypoints(): Waypoint[];
      setWaypoints(waypoints: L.LatLng[]): this;
      spliceWaypoints(index: number, waypointsToRemove: number, ...newWaypoints: L.LatLng[]): Waypoint[];
      on(event: string, fn: (e: any) => void): this;
    }

    function control(options?: ControlOptions): Control;
    function osrmv1(options?: RouterOptions): object;
  }
}
