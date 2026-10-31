import type { LatLngLike } from './geo';

export interface ElevationPoint {
  lat: number;
  lng: number;
  elevation: number;
  distance: number;
}

export interface ElevationResult {
  points: ElevationPoint[];
  gain: number;
  loss: number;
}

function haversineDistance(a: LatLngLike, b: LatLngLike): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function downsample(coords: LatLngLike[], maxPoints: number): { point: LatLngLike; distance: number }[] {
  if (coords.length === 0) return [];

  const distances: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  }

  const totalDist = distances[distances.length - 1];
  if (totalDist === 0) return [{ point: coords[0], distance: 0 }];

  const count = Math.min(maxPoints, coords.length);
  const interval = totalDist / (count - 1);
  const sampled: { point: LatLngLike; distance: number }[] = [];

  let coordIdx = 0;
  for (let i = 0; i < count; i++) {
    const targetDist = i * interval;
    while (coordIdx < distances.length - 1 && distances[coordIdx + 1] < targetDist) {
      coordIdx++;
    }
    if (coordIdx >= coords.length - 1) {
      sampled.push({ point: coords[coords.length - 1], distance: totalDist });
    } else {
      const segFraction =
        distances[coordIdx + 1] === distances[coordIdx]
          ? 0
          : (targetDist - distances[coordIdx]) / (distances[coordIdx + 1] - distances[coordIdx]);
      const lat = coords[coordIdx].lat + segFraction * (coords[coordIdx + 1].lat - coords[coordIdx].lat);
      const lng = coords[coordIdx].lng + segFraction * (coords[coordIdx + 1].lng - coords[coordIdx].lng);
      sampled.push({ point: { lat, lng }, distance: targetDist });
    }
  }

  return sampled;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBatch(points: { point: LatLngLike; distance: number }[]): Promise<(number | null)[]> {
  const locations = points.map((p) => ({
    latitude: p.point.lat,
    longitude: p.point.lng,
  }));
  const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations }),
  });

  if (!res.ok) throw new Error(`Elevation API error: ${res.status}`);

  const data = await res.json();
  return data.results.map((r: { elevation: number | null }) => r.elevation);
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

export async function fetchElevation(coords: LatLngLike[], maxSamples = 200): Promise<ElevationResult> {
  const sampled = downsample(coords, maxSamples);
  if (sampled.length === 0) return { points: [], gain: 0, loss: 0 };

  const batchSize = 100;
  const elevations: (number | null)[] = [];

  for (let i = 0; i < sampled.length; i += batchSize) {
    if (i > 0) await delay(1100);
    const batch = sampled.slice(i, i + batchSize);
    const results = await fetchBatch(batch);
    elevations.push(...results);
  }

  const points: ElevationPoint[] = sampled.map((s, i) => ({
    lat: s.point.lat,
    lng: s.point.lng,
    elevation: elevations[i] ?? 0,
    distance: s.distance,
  }));

  const validElevations = points.map((p) => p.elevation);
  const { gain, loss } = computeGainLoss(validElevations);

  return { points, gain, loss };
}

export function interpolateElevation(
  coords: LatLngLike[],
  profile: ElevationPoint[],
): number[] {
  if (profile.length === 0) return coords.map(() => 0);

  const distances: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversineDistance(coords[i - 1], coords[i]));
  }

  return distances.map((d) => {
    let lo = 0;
    let hi = profile.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (profile[mid].distance <= d) lo = mid;
      else hi = mid;
    }
    if (profile[hi].distance === profile[lo].distance) return profile[lo].elevation;
    const t = (d - profile[lo].distance) / (profile[hi].distance - profile[lo].distance);
    return profile[lo].elevation + t * (profile[hi].elevation - profile[lo].elevation);
  });
}
