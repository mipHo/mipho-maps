# mipho-maps

A mobile-friendly walking route planner. Tap the map to drop waypoints; the app snaps each leg to walking paths, shows distance, ascent/descent and an estimated walking time, draws an elevation profile, and exports the route as GPX or KML.

**Live:** https://mipho.github.io/mipho-maps/

## Features

- **Snapped or freehand legs** — snapped legs follow walking paths (OSRM); toggle *Freehand* for straight lines across open ground. Each leg keeps its own mode.
- **Stats** — distance, ascent, descent and walking time ([Naismith's rule](https://en.wikipedia.org/wiki/Naismith%27s_rule): 5 km/h plus 1 h per 600 m of ascent).
- **Elevation profile** — hover or drag along it to see the matching point on the map.
- **Live location** — with permission, shows your position and starts the map there (otherwise Valdivia, Chile).
- **Export** — GPX or KML, with elevation per point.
- **Undo / Clear**, empty-state hints, and clear messages when routing or elevation fails.

## Running locally

Requires **Node.js 18+** (22 recommended — the version CI uses).

```sh
npm install      # install dependencies (first time, or after package.json changes)
npm run dev      # start the dev server with hot reload
```

Then open **http://localhost:5173/mipho-maps/** — note the `/mipho-maps/` path, which matches the GitHub Pages URL.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks (`tsc`) and builds a production bundle into `dist/` |
| `npm run preview` | Serves the built `dist/` locally, to check a production build |

> **Location needs a secure page.** Browsers only allow geolocation on `https://` or `localhost`. Opening the dev server from a phone via your computer's IP (`http://192.168.…`) works for everything except location — use the live site to test that on a phone.

## Deployment

Every push to `main` builds and deploys to GitHub Pages via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (`npm ci` → `npm run build` → publish `dist/`). A type error fails the build, so nothing broken is published. You can also redeploy from the **Actions** tab (*Run workflow*) or with `gh workflow run deploy.yml`.

The site is served from a sub-path, so `vite.config.ts` sets `base: '/mipho-maps/'`. If the repository is renamed, update it to match.

## Project structure

```
index.html           Page layout: toolbar, map, stats + elevation panel
vite.config.ts       Vite config (base path for GitHub Pages)
src/
  main.ts            Wires everything together: map, toolbar, stats, profile, export
  router.ts          RouteBuilder — waypoints and legs, one OSRM request per leg,
                     ignores stale/out-of-order replies, straight-line fallback on errors
  osrm.ts            OSRM routing client (walking profile)
  elevation.ts       Open-Meteo elevation client: sampling, rate-limit retry,
                     gap filling, ascent/descent calculation
  profile.ts         Elevation chart (canvas): axes, hover crosshair
  location.ts        Live user location (dot + accuracy circle)
  messages.ts        Map hint and error toast
  walking.ts         Walking-time estimate and duration formatting
  geo.ts             Distance helpers (haversine, distance along a path)
  export.ts          GPX / KML generation and download
  style.css          Dark theme and layout (colours are CSS variables at the top)
```

## External services

The app has no backend; the browser calls these free public services directly:

| Service | Used for | Notes |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles | Map | [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/) |
| [routing.openstreetmap.de](https://routing.openstreetmap.de/) (OSRM, FOSSGIS) | Walking routes | Demo server, meant for light use |
| [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) | Elevation | Free tier is **non-commercial** and rate-limited; the app samples 100 points per route (one request) and retries after 60 s when limited |

For heavier or commercial use, switch to self-hosted or paid equivalents.
