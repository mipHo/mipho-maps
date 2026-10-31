/** Minimal coordinate shape. Leaflet's LatLng satisfies it, so pure modules don't need Leaflet. */
export interface LatLngLike {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineDistance(a: LatLngLike, b: LatLngLike): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** distances[i] = metres along the path from coords[0] to coords[i]. */
export function cumulativeDistances(coords: LatLngLike[]): number[] {
  const distances = coords.length > 0 ? [0] : [];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  }
  return distances;
}

/** Largest i with sorted[i] <= value (0 if value is below the first entry). */
export function lowerIndex(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point on the path at `distance` metres from the start (clamped to the path's ends). */
export function pointAtDistance(coords: LatLngLike[], distances: number[], distance: number): LatLngLike {
  const last = coords.length - 1;
  if (distance <= 0) return coords[0];
  if (distance >= distances[last]) return coords[last];
  const i = lowerIndex(distances, distance);
  const span = distances[i + 1] - distances[i];
  const t = span === 0 ? 0 : (distance - distances[i]) / span;
  return {
    lat: coords[i].lat + t * (coords[i + 1].lat - coords[i].lat),
    lng: coords[i].lng + t * (coords[i + 1].lng - coords[i].lng),
  };
}
