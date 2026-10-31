import { cumulativeDistances, lowerIndex, pointAtDistance, type LatLngLike } from './geo';

/** Open-Meteo elevation API (Copernicus DEM, ~90 m). Max 100 coordinates per request. */
const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const BATCH_SIZE = 100;

export interface ElevationPoint {
  lat: number;
  lng: number;
  elevation: number;
  /** Metres along the route. */
  distance: number;
}

export interface ElevationResult {
  points: ElevationPoint[];
  gain: number;
  loss: number;
}

/** Up to `maxPoints` points evenly spaced by distance along the path, including both ends. */
function downsample(coords: LatLngLike[], maxPoints: number): { point: LatLngLike; distance: number }[] {
  if (coords.length === 0) return [];

  const distances = cumulativeDistances(coords);
  const totalDist = distances[distances.length - 1];
  if (totalDist === 0) return [{ point: coords[0], distance: 0 }];

  // totalDist > 0 implies at least 2 coords, so count >= 2.
  const count = Math.min(maxPoints, coords.length);
  return Array.from({ length: count }, (_, i) => {
    const distance = i === count - 1 ? totalDist : (totalDist * i) / (count - 1);
    return { point: pointAtDistance(coords, distances, distance), distance };
  });
}

async function fetchBatch(points: LatLngLike[], signal?: AbortSignal): Promise<(number | null)[]> {
  const latitude = points.map((p) => p.lat.toFixed(5)).join(',');
  const longitude = points.map((p) => p.lng.toFixed(5)).join(',');
  const res = await fetch(`${ELEVATION_URL}?latitude=${latitude}&longitude=${longitude}`, { signal });

  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data?.elevation)) {
    throw new Error(`Elevation API error: ${data?.reason ?? `HTTP ${res.status}`}`);
  }
  if (data.elevation.length !== points.length) {
    throw new Error(`Elevation API returned ${data.elevation.length} values for ${points.length} points`);
  }
  return data.elevation.map((e: unknown) => (typeof e === 'number' && Number.isFinite(e) ? e : null));
}

function computeGainLoss(elevations: number[], threshold = 2): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > threshold) gain += diff;
    else if (diff < -threshold) loss += Math.abs(diff);
  }
  return { gain, loss };
}

export async function fetchElevation(
  coords: LatLngLike[],
  { maxSamples = 200, signal }: { maxSamples?: number; signal?: AbortSignal } = {},
): Promise<ElevationResult> {
  const sampled = downsample(coords, maxSamples);
  if (sampled.length === 0) return { points: [], gain: 0, loss: 0 };

  const batches: Promise<(number | null)[]>[] = [];
  for (let i = 0; i < sampled.length; i += BATCH_SIZE) {
    batches.push(fetchBatch(sampled.slice(i, i + BATCH_SIZE).map((s) => s.point), signal));
  }
  const elevations = (await Promise.all(batches)).flat();

  const points: ElevationPoint[] = sampled.map((s, i) => ({
    lat: s.point.lat,
    lng: s.point.lng,
    elevation: elevations[i] ?? 0,
    distance: s.distance,
  }));

  const { gain, loss } = computeGainLoss(points.map((p) => p.elevation));
  return { points, gain, loss };
}

/** Elevation at `distance` metres along the route, linearly interpolated between profile samples. */
export function elevationAtDistance(profile: ElevationPoint[], distance: number): number {
  if (profile.length === 0) return 0;
  const lo = lowerIndex(profile.map((p) => p.distance), distance);
  const hi = Math.min(lo + 1, profile.length - 1);
  const span = profile[hi].distance - profile[lo].distance;
  if (span <= 0) return profile[lo].elevation;
  const t = Math.min(1, Math.max(0, (distance - profile[lo].distance) / span));
  return profile[lo].elevation + t * (profile[hi].elevation - profile[lo].elevation);
}

export function interpolateElevation(coords: LatLngLike[], profile: ElevationPoint[]): number[] {
  if (profile.length === 0) return coords.map(() => 0);
  return cumulativeDistances(coords).map((d) => elevationAtDistance(profile, d));
}
