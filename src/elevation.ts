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

/**
 * Total ascent/descent with hysteresis: a climb or descent counts only once the profile has
 * reversed by more than `threshold` metres, so DEM noise is ignored but gradual slopes
 * (many small steps) are counted in full. gain − loss equals end − start to within 2 × `threshold`
 * (an uncounted sub-threshold drift is possible at each end of the route).
 */
export function computeGainLoss(elevations: number[], threshold = 3): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  if (elevations.length < 2) return { gain, loss };

  // Before a direction is established, track both extremes so the true start of the first
  // climb/descent is used, not just the first sample.
  let lo = elevations[0];
  let hi = elevations[0];
  let dir = 0; // +1 climbing, -1 descending, 0 not yet known
  let anchor = 0; // elevation where the current climb/descent started
  let extreme = 0; // highest point of the current climb / lowest of the current descent

  for (let i = 1; i < elevations.length; i++) {
    const e = elevations[i];
    if (dir === 0) {
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
      if (e - lo > threshold) { dir = 1; anchor = lo; extreme = e; }
      else if (hi - e > threshold) { dir = -1; anchor = hi; extreme = e; }
    } else if (dir === 1) {
      if (e > extreme) extreme = e;
      else if (extreme - e > threshold) {
        gain += extreme - anchor;
        anchor = extreme; dir = -1; extreme = e;
      }
    } else {
      if (e < extreme) extreme = e;
      else if (e - extreme > threshold) {
        loss += anchor - extreme;
        anchor = extreme; dir = 1; extreme = e;
      }
    }
  }

  // Close the last climb/descent.
  if (dir === 1) gain += extreme - anchor;
  else if (dir === -1) loss += anchor - extreme;
  return { gain, loss };
}

/**
 * Replaces missing values by linear interpolation between the nearest known neighbours
 * (or the nearest one, at the ends). Throws if nothing is known.
 */
export function fillGaps(values: (number | null)[]): number[] {
  const known = values.flatMap((v, i) => (v === null ? [] : [i]));
  if (known.length === 0) throw new Error('Elevation API returned no data for this route');
  return values.map((v, i) => {
    if (v !== null) return v;
    const after = known.find((k) => k > i);
    const before = [...known].reverse().find((k) => k < i);
    if (before === undefined) return values[after!]!;
    if (after === undefined) return values[before]!;
    const t = (i - before) / (after - before);
    return values[before]! + t * (values[after]! - values[before]!);
  });
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
  const elevations = fillGaps((await Promise.all(batches)).flat());

  const points: ElevationPoint[] = sampled.map((s, i) => ({
    lat: s.point.lat,
    lng: s.point.lng,
    elevation: elevations[i],
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
