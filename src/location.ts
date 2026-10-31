import L from 'leaflet';

/**
 * waiting: asked, no fix yet · active: have a position · denied: the user refused (or the browser
 * blocks it) · unsupported: no geolocation, or not a secure context (http:// other than localhost).
 */
export type LocationState = 'waiting' | 'active' | 'denied' | 'unsupported';

interface Options {
  /** First position fix after start(); used to centre the map once. */
  onFirstFix?: (latlng: L.LatLng) => void;
}

const DOT_STYLE: L.CircleMarkerOptions = {
  radius: 7,
  color: '#ffffff',
  weight: 3,
  fillColor: '#29b6f6',
  fillOpacity: 1,
  interactive: false, // taps go through to the map (adding a waypoint at your position works)
};

const ACCURACY_STYLE: L.CircleOptions = {
  radius: 0,
  color: '#29b6f6',
  weight: 1,
  opacity: 0.5,
  fillColor: '#29b6f6',
  fillOpacity: 0.12,
  interactive: false,
};

/** Shows the user's live position (dot + accuracy circle) once they allow location access. */
export class UserLocation {
  state: LocationState = 'waiting';
  /** Latest position, or null before the first fix / after denial. */
  position: L.LatLng | null = null;

  private readonly dot = L.circleMarker([0, 0], DOT_STYLE);
  private readonly accuracy = L.circle([0, 0], ACCURACY_STYLE);
  private watchId: number | null = null;
  private hadFix = false;

  constructor(
    private readonly map: L.Map,
    private readonly options: Options = {},
  ) {}

  /** Starts watching; the browser asks the user for permission the first time. */
  start(): void {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      this.state = 'unsupported';
      return;
    }
    this.state = 'waiting';
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
  }

  private onPosition(pos: GeolocationPosition): void {
    const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
    this.position = latlng;
    this.state = 'active';

    this.accuracy.setLatLng(latlng).setRadius(pos.coords.accuracy);
    this.dot.setLatLng(latlng);
    if (!this.map.hasLayer(this.dot)) {
      this.accuracy.addTo(this.map);
      this.dot.addTo(this.map);
    }

    if (!this.hadFix) {
      this.hadFix = true;
      this.options.onFirstFix?.(latlng);
    }
  }

  private onError(err: GeolocationPositionError): void {
    if (err.code === err.PERMISSION_DENIED) {
      // Final: stop watching and remove anything shown.
      if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.state = 'denied';
      this.position = null;
      this.dot.remove();
      this.accuracy.remove();
    }
    // POSITION_UNAVAILABLE / TIMEOUT are transient: keep watching and showing the last position.
  }
}
