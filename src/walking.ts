/** Naismith's rule: 5 km/h on the flat, plus 1 hour per 600 m of ascent. Descent is ignored. */
const FLAT_SPEED_M_PER_MIN = 5000 / 60;
const ASCENT_M_PER_MIN = 600 / 60;

/** Estimated walking time in minutes. */
export function walkingTimeMinutes(distanceM: number, ascentM: number): number {
  return distanceM / FLAT_SPEED_M_PER_MIN + Math.max(0, ascentM) / ASCENT_M_PER_MIN;
}

/** "45 min", "1 h", "2 h 05 min". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}
