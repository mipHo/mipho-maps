import type { LatLngLike } from './geo';

const SERVICE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

export interface OsrmRoute {
  coords: LatLngLike[];
  /** Metres. */
  distance: number;
}

export class OsrmError extends Error {
  constructor(
    /** OSRM response code (e.g. "NoRoute", "InvalidOptions"), or "HttpError"/"BadResponse". */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OsrmError';
  }
}

/**
 * Walking route through the given points (at least 2).
 * Rejects with OsrmError on routing failures, or with the fetch AbortError if `signal` aborts.
 */
export async function fetchRoute(points: LatLngLike[], signal?: AbortSignal): Promise<OsrmRoute> {
  if (points.length < 2) throw new OsrmError('InvalidInput', 'Need at least 2 points');

  // OSRM wants lng,lat pairs separated by ';'.
  const path = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const res = await fetch(`${SERVICE_URL}/${path}?overview=full&geometries=geojson`, { signal });

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new OsrmError(res.ok ? 'BadResponse' : 'HttpError', `OSRM HTTP ${res.status}`);
  }

  if (data?.code !== 'Ok') {
    throw new OsrmError(data?.code ?? 'HttpError', data?.message ?? `OSRM HTTP ${res.status}`);
  }

  const route = data.routes?.[0];
  if (!route?.geometry?.coordinates) throw new OsrmError('BadResponse', 'OSRM response has no route');

  return {
    // GeoJSON is [lng, lat]; flip to { lat, lng }.
    coords: route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng })),
    distance: route.distance,
  };
}
