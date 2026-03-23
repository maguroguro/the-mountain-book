# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm start          # Launch Electron app in dev mode
npm run dist:mac   # Build Mac app (runs icon gen + electron-builder + moves .app to root)
npm run pack       # Alias for dist:mac
```

**After every code change** to `index.html`, `main.js`, `scan.js`, `persist.js`, `package.json`, or `assets/`, always run `npm run dist:mac` to rebuild `The Mountain Book.app` in the repo root.

### Python data pipeline (one-time setup)
```bash
pip install gpxpy Pillow piexif
python3 build.py   # Process GPX + photos → data/trek-data.js
```

No test or lint commands are configured.

## Architecture

The app is a **hiking journal** with interactive maps, statistics, and photo galleries. It runs in two modes:

### Dual-Mode Data Loading

**Mode A — Python build (static web):** `build.py` reads GPX/KML files and photos from disk, processes them, and writes `data/trek-data.js` containing a global `window.TREK_DATA`. Opening `index.html` in a browser consumes this file directly.

**Mode B — Electron (dynamic scanning):** `main.js` serves the app over a local HTTP server (port 48723+) to get a secure context. The user picks a folder via `showDirectoryPicker()`. `scan.js` scans it using the File System Access API, and `persist.js` caches results in IndexedDB for instant subsequent loads.

### Module Responsibilities

- **`main.js`** — Electron entry point; creates BrowserWindow and HTTP server; MIME handling.
- **`index.html`** — The entire UI (2256 lines, all inline CSS/JS). Four views: Map, Statistics, Timeline, Welcome/Loading. Left sidebar for track list/search/filter; right panel for track stats, elevation profile, and photo gallery.
- **`scan.js`** — Folder scanner. Recursively unwraps nested "container" folders, parses GPX/KML, extracts EXIF GPS/timestamps from photos, generates thumbnails, associates photos to tracks by date or GPS proximity (≤8 km). Uses file fingerprinting for incremental re-scans.
- **`persist.js`** — IndexedDB wrapper with two stores: `meta` (track/photo metadata) and `blobs` (thumbnail images). Restores state on app boot.
- **`build.py`** — Standalone Python equivalent of `scan.js`. Outputs everything as `data/trek-data.js`.

### Data Shape

Both modes produce the same structure: an array of **tracks** (id, name, date, distance, elevation gain, coordinate array, elevation profile) and **photos** (id, lat/lon, datetime, base64 thumbnail, associated track_id). The UI consumes this identically regardless of source.

### Key Libraries

- **Leaflet 1.9.4** — Map rendering; tracks drawn as polylines colored by year
- **Leaflet MarkerCluster** — Photo pin clustering
- **Chart.js 4.4.0** — Statistics charts (yearly totals, elevation distribution)
- **exifr 7.1.3** — In-browser EXIF extraction from photos during Electron scanning

## App Packaging

The Mac build targets `dir` only (unpackaged `.app`). After `electron-builder` runs, a post-build script (`scripts/move-app-to-root.cjs`) moves `The Mountain Book.app` to the repo root. There is no DMG or ZIP output unless explicitly requested.
