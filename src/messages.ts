import L from 'leaflet';
import { OsrmError } from './osrm';

const TOAST_MS = 7000;

/**
 * User-facing messages over the bottom of the map: a persistent hint (what to do next) and a
 * dismissible toast (something went wrong). Neither blocks map taps except the toast itself.
 */
export class MapMessages {
  private readonly hint: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly toastText: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(map: L.Map) {
    const container = L.DomUtil.create('div', 'map-messages', map.getContainer());

    this.toast = L.DomUtil.create('div', 'map-toast hidden', container);
    this.toast.setAttribute('role', 'alert');
    this.toastText = L.DomUtil.create('span', '', this.toast);
    const close = L.DomUtil.create('button', 'map-toast-close', this.toast);
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => this.hideToast());
    // Taps on the toast must not reach the map (they would add a waypoint).
    L.DomEvent.disableClickPropagation(this.toast);

    this.hint = L.DomUtil.create('div', 'map-hint hidden', container);
    this.hint.setAttribute('role', 'status');
  }

  /** Shows `text` as the hint, or hides it when null. */
  setHint(text: string | null): void {
    this.hint.classList.toggle('hidden', text === null);
    if (text !== null && this.hint.textContent !== text) this.hint.textContent = text;
  }

  showToast(text: string): void {
    this.toastText.textContent = text;
    this.toast.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), TOAST_MS);
  }

  hideToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toast.classList.add('hidden');
  }
}

/** Plain-language explanation for a failed leg. */
export function routingErrorMessage(error: unknown): string {
  const why =
    error instanceof OsrmError && (error.code === 'NoRoute' || error.code === 'NoSegment')
      ? 'No walking route found between these points.'
      : typeof navigator !== 'undefined' && navigator.onLine === false
        ? "You're offline, so the route couldn't be calculated."
        : "The routing service didn't respond.";
  return `${why} Joined with a straight line — tap Undo to remove it.`;
}
