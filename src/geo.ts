/** Minimal coordinate shape. Leaflet's LatLng satisfies it, so pure modules don't need Leaflet. */
export interface LatLngLike {
  lat: number;
  lng: number;
}
