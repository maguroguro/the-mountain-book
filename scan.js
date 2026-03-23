/**
 * Scans a user-selected base folder.
 * Supports:
 *   • 3+ livelli: BASE → gruppo → (eventuale cartella intermedia, es. «0) Monte Alto») → uscita → file
 *   • 2 livelli: BASE → cartella uscita → file
 * Ogni cartella uscita contiene i file traccia (.gpx, .kml) e le foto di quell’uscita.
 */
(function (global) {
  'use strict';

  const MAX_TRACK_POINTS = 600;
  const MAX_PROFILE_PTS = 250;
  const THUMB_W = 480;
  const THUMB_H = 360;
  const PIN_W = 80;
  const PIN_H = 80;

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = (x) => (x * Math.PI) / 180;
    const dlat = toR(lat2 - lat1);
    const dlon = toR(lon2 - lon1);
    const a =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dlon / 2) ** 2;
    return R * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function perpDist(p, a, b) {
    if (a[0] === b[0] && a[1] === b[1]) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const num = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]);
    const den = Math.hypot(b[1] - a[1], b[0] - a[0]);
    return den ? num / den : 0;
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    let dm = 0,
      idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > dm) {
        dm = d;
        idx = i;
      }
    }
    if (dm > eps) {
      return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
    }
    return [pts[0], pts[pts.length - 1]];
  }

  function simplify(pts, target) {
    if (pts.length <= target) return pts;
    let eps = 0.00005;
    while (true) {
      const s = rdp(pts, eps);
      if (s.length <= target) return s;
      eps *= 1.8;
    }
  }

  function parseISODate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Converte un token data (ISO, GG-MM-AAAA, MM-AAAA) in YYYY-MM-DD. */
  function toISOFromDateToken(token) {
    if (!token) return null;
    const t = String(token).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m1 = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m1) {
      const d = +m1[1],
        mo = +m1[2],
        y = +m1[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const m2 = t.match(/^(\d{1,2})-(\d{4})$/);
    if (m2) {
      const mo = +m2[1],
        y = +m2[2];
      if (mo < 1 || mo > 12) return null;
      return `${y}-${String(mo).padStart(2, '0')}-01`;
    }
    return null;
  }

  /**
   * Nome cartella uscita → solo nome percorso + data come metadati.
   * Rimuove "NN) ", individua l’ultima data nel nome (pattern comuni) e la toglie dal titolo
   * (incluso eventuale testo dopo la data, es. "A h 2,30").
   */
  function parseTrekFolderLabel(raw) {
    const full = String(raw || '').trim();
    const out = { title: full, dateISO: null, year: null };
    if (!full) return out;

    let rest = full.replace(/^\d+\)\s*/i, '').trim();

    const combined = /(\d{4}-\d{2}-\d{2})|(\d{1,2}-\d{1,2}-\d{4})|(\d{1,2}-\d{4})/g;
    let last = null;
    let m;
    while ((m = combined.exec(rest)) !== null) {
      last = { text: m[0], index: m.index };
    }

    if (last) {
      const iso = toISOFromDateToken(last.text);
      if (iso) {
        out.dateISO = iso;
        out.year = parseInt(iso.slice(0, 4), 10);
        let title = rest.slice(0, last.index).trim();
        title = title.replace(/[\s\-–—,;]+$/g, '').trim();
        title = title.replace(/\s+/g, ' ');
        out.title = title ? title : `Uscita ${iso}`;
        return out;
      }
    }

    out.title = rest.replace(/\s+/g, ' ');
    return out;
  }

  /** Toglie prefisso tipo "12) " dal nome cartella. */
  function stripFolderIndexPrefix(s) {
    return String(s || '')
      .replace(/^\d+\)\s*/i, '')
      .trim();
  }

  /**
   * Nome uscita da albero cartelle: «genitore - foglio» (es. monte alto - Favento Scala …).
   * `tf.name` è tipo "0)Monte Alto / 3)Nome uscita 29-09-2019" dopo flatten.
   */
  function computeTrekDisplayName(tf) {
    const raw = String(tf.name || '').trim();
    if (!raw) return '';
    const parts = raw.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) {
      const p = parseTrekFolderLabel(parts[0]);
      const t = (p.title || stripFolderIndexPrefix(parts[0])).replace(/\s+/g, ' ').trim();
      return t;
    }
    const parentClean = stripFolderIndexPrefix(parts[0]).toLowerCase();
    const leafRaw = parts[parts.length - 1];
    const leafParsed = parseTrekFolderLabel(leafRaw);
    const leafTitle = (leafParsed.title || stripFolderIndexPrefix(leafRaw)).replace(/\s+/g, ' ').trim();
    if (!parentClean) return leafTitle;
    return `${parentClean} - ${leafTitle}`;
  }

  /** Data opzionale nel nome della cartella gruppo (anno / raccolta). */
  function parseDateFromFolderName(s) {
    if (!s) return null;
    const combined = /(\d{4}-\d{2}-\d{2})|(\d{1,2}-\d{1,2}-\d{4})|(\d{1,2}-\d{4})/g;
    let last = null;
    let m;
    while ((m = combined.exec(s)) !== null) {
      last = m[0];
    }
    return last ? toISOFromDateToken(last) : null;
  }

  /** Es. "Escursioni 2019 con Nadia" → 2019 */
  function inferYearFromGroupFolder(groupName) {
    const m = String(groupName || '').match(/(?:^|\s)(\d{4})(?:\s|$)/);
    return m ? parseInt(m[1], 10) : null;
  }

  const SKIP_SUBDIR_NAMES = new Set(['thumbs', 'thumb', '.thumbs']);

  async function listSubdirs(dirHandle) {
    const list = [];
    for await (const [n, h] of dirHandle.entries()) {
      if (h.kind === 'directory' && !n.startsWith('.') && !SKIP_SUBDIR_NAMES.has(n.toLowerCase())) {
        list.push({ name: n, handle: h });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  }

  /**
   * Se un figlio di BASE contiene sottocartelle, ognuna è un’uscita (nome gruppo = livello 1).
   * Altrimenti il figlio stesso è l’uscita (layout piatto).
   */
  async function expandTrekFolders(baseHandle) {
    const out = [];
    for await (const [name, handle] of baseHandle.entries()) {
      if (handle.kind !== 'directory' || name.startsWith('.')) continue;
      const subdirs = await listSubdirs(handle);
      if (subdirs.length > 0) {
        for (const sub of subdirs) {
          if (SKIP_SUBDIR_NAMES.has(sub.name.toLowerCase())) continue;
          out.push({
            group: name,
            name: sub.name,
            handle: sub.handle,
            label: `${name} / ${sub.name}`,
          });
        }
      } else {
        out.push({
          group: '',
          name,
          handle,
          label: name,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }

  /** File traccia/foto direttamente in questa cartella (non nei figli). */
  async function hasTrackOrPhotoDirect(dirHandle) {
    for await (const [n, h] of dirHandle.entries()) {
      if (h.kind !== 'file' || n.startsWith('.')) continue;
      const low = n.toLowerCase();
      if (
        low.endsWith('.gpx') ||
        low.endsWith('.kml') ||
        low.endsWith('.jpg') ||
        low.endsWith('.jpeg')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cartelle «solo contenitore» (solo sottocartelle, nessun .gpx/.kml/.jpg qui):
   * es. «Escursioni 2019 / 0) Monte Alto /» con uscite 1), 2), 4) dentro →
   * una uscita per sottocartella. Ripetuto fino a 12 passaggi per nidificazione profonda.
   */
  async function flattenNestedGroupFolders(trekFolders) {
    const MAX_PASSES = 12;
    let list = trekFolders;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const next = [];
      let changed = false;
      for (const tf of list) {
        const subdirs = await listSubdirs(tf.handle);
        const hasDirect = await hasTrackOrPhotoDirect(tf.handle);
        if (subdirs.length > 0 && !hasDirect) {
          changed = true;
          for (const sub of subdirs) {
            if (SKIP_SUBDIR_NAMES.has(sub.name.toLowerCase())) continue;
            next.push({
              group: tf.group,
              name: `${tf.name} / ${sub.name}`,
              handle: sub.handle,
              label: tf.group ? `${tf.group} / ${tf.name} / ${sub.name}` : `${tf.name} / ${sub.name}`,
            });
          }
        } else {
          next.push(tf);
        }
      }
      list = next;
      if (!changed) break;
    }
    return list.sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }

  function parseGPXText(xmlText, fileStem) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const err = doc.querySelector('parsererror');
    if (err) return null;

    const pts = [];
    const trkpts = doc.getElementsByTagName('trkpt');
    for (let i = 0; i < trkpts.length; i++) {
      const el = trkpts[i];
      const lat = parseFloat(el.getAttribute('lat'));
      const lon = parseFloat(el.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      let ele = 0;
      const eel = el.getElementsByTagName('ele')[0];
      if (eel && eel.textContent) ele = parseFloat(eel.textContent) || 0;
      let time = null;
      const tel = el.getElementsByTagName('time')[0];
      if (tel && tel.textContent) time = parseISODate(tel.textContent.trim());
      pts.push({ lat, lon, ele, time });
    }

    if (!pts.length) {
      const wpts = doc.getElementsByTagName('wpt');
      for (let i = 0; i < wpts.length; i++) {
        const el = wpts[i];
        const lat = parseFloat(el.getAttribute('lat'));
        const lon = parseFloat(el.getAttribute('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        let ele = 0;
        const eel = el.getElementsByTagName('ele')[0];
        if (eel && eel.textContent) ele = parseFloat(eel.textContent) || 0;
        let time = null;
        const tel = el.getElementsByTagName('time')[0];
        if (tel && tel.textContent) time = parseISODate(tel.textContent.trim());
        pts.push({ lat, lon, ele, time });
      }
    }

    if (!pts.length) return null;

    let trkName = '';
    const nameEl = doc.getElementsByTagName('name')[0];
    if (nameEl && nameEl.textContent) trkName = nameEl.textContent.trim();

    return { pts, trkName, fileStem };
  }

  /**
   * KML: LineString/MultiGeometry coordinates (lon,lat,alt), gx:coord (lon lat alt).
   */
  function parseKMLText(xmlText, fileStem) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const err = doc.querySelector('parsererror');
    if (err) return null;

    const pts = [];
    const pushPt = (lat, lon, ele) => {
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        pts.push({
          lat,
          lon,
          ele: Number.isFinite(ele) ? ele : 0,
          time: null,
        });
      }
    };

    const coordEls = doc.getElementsByTagName('coordinates');
    for (let i = 0; i < coordEls.length; i++) {
      const raw = coordEls[i].textContent.replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      for (const chunk of raw.split(/\s+/)) {
        if (!chunk) continue;
        const parts = chunk.split(',').map((x) => parseFloat(x));
        if (parts.length < 2) continue;
        const lon = parts[0];
        const lat = parts[1];
        const ele = parts.length > 2 ? parts[2] : 0;
        pushPt(lat, lon, ele);
      }
    }

    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName !== 'coord') continue;
      const raw = el.textContent.trim();
      if (!raw) continue;
      const parts = raw.split(/\s+/).map((x) => parseFloat(x));
      if (parts.length < 2) continue;
      pushPt(parts[1], parts[0], parts.length > 2 ? parts[2] : 0);
    }

    if (!pts.length) return null;

    let trkName = '';
    const docName = doc.querySelector('Document > name');
    const pmName = doc.querySelector('Placemark > name');
    if (docName && docName.textContent) trkName = docName.textContent.trim();
    else if (pmName && pmName.textContent) trkName = pmName.textContent.trim();
    else {
      const ne = doc.getElementsByTagName('name')[0];
      if (ne && ne.textContent) trkName = ne.textContent.trim();
    }

    return { pts, trkName, fileStem };
  }

  function buildTrackRecord(rawPts, trekName, displayTitle, id, dateHint, folderDisplayName) {
    const raw = rawPts.map((p) => [p.lat, p.lon, p.ele, p.time]);
    let distKm = 0;
    let eleUp = 0;
    let eleDn = 0;
    for (let i = 1; i < raw.length; i++) {
      const p1 = raw[i - 1],
        p2 = raw[i];
      distKm += haversine(p1[0], p1[1], p2[0], p2[1]);
      const de = p2[2] - p1[2];
      if (de > 0) eleUp += de;
      else eleDn += Math.abs(de);
    }
    const elevs = raw.map((p) => p[2]).filter((e) => e > 0);
    const lats = raw.map((p) => p[0]);
    const lons = raw.map((p) => p[1]);

    let dateStr = dateHint || null;
    if (!dateStr && raw[0][3]) dateStr = raw[0][3].toISOString().slice(0, 10);

    let name = (folderDisplayName || '').trim();
    if (!name) {
      name = trekName;
      if (!name || /^(track|traccia|route|percorso|untitled)$/i.test(name)) {
        name = (displayTitle || '').replace(/[_-]/g, ' ').trim();
      }
    }

    let time_hm = null;
    if (raw.length && raw[0][3]) {
      const t0 = raw[0][3];
      time_hm = t0.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }

    const step = Math.max(1, Math.floor(raw.length / MAX_PROFILE_PTS));
    let cumulative = 0;
    const profile = [];
    for (let i = 0; i < raw.length; i += step) {
      if (i > 0) {
        const j = i - step;
        cumulative += haversine(raw[j][0], raw[j][1], raw[i][0], raw[i][1]);
      }
      profile.push({
        d: Math.round(cumulative * 1000) / 1000,
        e: Math.round(raw[i][2] * 10) / 10,
        lat: Math.round(raw[i][0] * 1e6) / 1e6,
        lon: Math.round(raw[i][1] * 1e6) / 1e6,
      });
    }

    const coords = raw.map((p) => [p[0], p[1]]);
    const simplified = simplify(coords, MAX_TRACK_POINTS);

    return {
      id,
      name,
      date: dateStr,
      time_hm: time_hm || undefined,
      year: dateStr ? parseInt(dateStr.slice(0, 4), 10) : null,
      distance_km: Math.round(distKm * 100) / 100,
      ele_gain_m: Math.round(eleUp),
      ele_loss_m: Math.round(eleDn),
      ele_max_m: elevs.length ? Math.round(Math.max(...elevs)) : 0,
      ele_min_m: elevs.length ? Math.round(Math.min(...elevs)) : 0,
      bounds: {
        n: Math.max(...lats),
        s: Math.min(...lats),
        e: Math.max(...lons),
        w: Math.min(...lons),
      },
      center: [
        Math.round((lats.reduce((a, b) => a + b, 0) / lats.length) * 1e5) / 1e5,
        Math.round((lons.reduce((a, b) => a + b, 0) / lons.length) * 1e5) / 1e5,
      ],
      coords: simplified.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]),
      elevation_profile: profile,
      _timedPts: (() => {
        const tp = raw
          .filter((p) => p[3] instanceof Date && !isNaN(p[3]))
          .map((p) => ({ lat: p[0], lon: p[1], t: p[3].getTime() }));
        return tp.length >= 2 ? tp : null;
      })(),
    };
  }

  /**
   * Interpolates a (lat, lon) position on a timed track given a photo's ISO datetime.
   * Returns null if the timestamp falls outside the track's time range or no timed points exist.
   */
  function interpolateOnTrack(timedPts, isoDatetime) {
    if (!timedPts || timedPts.length < 2) return null;
    const ts = new Date(isoDatetime).getTime();
    if (isNaN(ts)) return null;
    if (ts < timedPts[0].t || ts > timedPts[timedPts.length - 1].t) return null;
    for (let i = 1; i < timedPts.length; i++) {
      const a = timedPts[i - 1], b = timedPts[i];
      if (ts >= a.t && ts <= b.t) {
        const frac = b.t === a.t ? 0 : (ts - a.t) / (b.t - a.t);
        return {
          lat: a.lat + frac * (b.lat - a.lat),
          lon: a.lon + frac * (b.lon - a.lon),
        };
      }
    }
    return null;
  }

  async function collectRecursive(dirHandle, basePath, gpx, images) {
    for await (const [entryName, handle] of dirHandle.entries()) {
      if (entryName.startsWith('.')) continue;
      const rel = basePath ? `${basePath}/${entryName}` : entryName;
      if (handle.kind === 'directory') {
        await collectRecursive(handle, rel, gpx, images);
      } else if (handle.kind === 'file') {
        const low = entryName.toLowerCase();
        if (low.endsWith('.gpx') || low.endsWith('.kml')) gpx.push({ handle, name: entryName, rel });
        else if (low.endsWith('.jpg') || low.endsWith('.jpeg')) images.push({ handle, name: entryName, rel });
      }
    }
  }

  /** Metadati file traccia/foto (per diff senza rileggere GPX/EXIF). */
  async function collectFileMeta(dirHandle, basePath) {
    const rows = [];
    for await (const [entryName, handle] of dirHandle.entries()) {
      if (entryName.startsWith('.')) continue;
      const rel = basePath ? `${basePath}/${entryName}` : entryName;
      if (handle.kind === 'directory') {
        rows.push(...(await collectFileMeta(handle, rel)));
      } else if (handle.kind === 'file') {
        const low = entryName.toLowerCase();
        if (
          !low.endsWith('.gpx') &&
          !low.endsWith('.kml') &&
          !low.endsWith('.jpg') &&
          !low.endsWith('.jpeg')
        ) {
          continue;
        }
        const file = await handle.getFile();
        rows.push({ rel, mtime: file.lastModified, size: file.size });
      }
    }
    return rows;
  }

  function fingerprintFileMeta(rows) {
    const sorted = [...rows].sort((a, b) => a.rel.localeCompare(b.rel, 'it'));
    return sorted.map((r) => `${r.rel}\t${r.mtime}\t${r.size}`).join('\n');
  }

  function findPreviousTrackForLabel(tracks, photos, label) {
    const byField = tracks.find((t) => t.folder_label === label);
    if (byField) return byField;
    const ph = photos.find((p) => p.folder === label);
    if (!ph) return null;
    return tracks.find((t) => t.id === ph.track_id) || null;
  }

  function findPreviousPhotosForLabel(photos, label, trackId) {
    return photos.filter((p) => p.folder === label && p.track_id === trackId);
  }

  /**
   * ID univoco per uscita: `tf.label` (percorso cartella) è univoco.
   * Prima si usava solo group+name → slug tronco o nomi ripetuti (es. più «Monte Alto»)
   * potevano collidere e sovrascrivere tracce/foto.
   */
  function makeIdFromLabel(label, index) {
    const slug = String(label || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 96);
    return (slug || 'trek') + '_' + index;
  }

  async function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function makeThumbBlob(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(THUMB_W / bmp.width, THUMB_H / bmp.height, 1);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  async function makePinBlob(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(PIN_W / bmp.width, PIN_H / bmp.height, 1);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.70));
  }

  async function scanBaseFolder(baseHandle, onProgress, opts) {
    if (!baseHandle || baseHandle.kind !== 'directory') throw new Error('Cartella non valida');

    opts = opts || {};
    const incremental =
      !!opts.incremental &&
      opts.previous &&
      Array.isArray(opts.previous.tracks) &&
      opts.previous.tracks.length > 0 &&
      opts.previous.trekFingerprints &&
      typeof opts.previous.trekFingerprints === 'object';

    if (onProgress) onProgress({ phase: 'listing', message: 'Lettura struttura cartelle…' });
    let trekFolders = await expandTrekFolders(baseHandle);
    trekFolders = await flattenNestedGroupFolders(trekFolders);
    if (!trekFolders.length) throw new Error('Nessuna cartella uscita trovata');
    if (onProgress) {
      onProgress({
        phase: 'listing',
        message: `${trekFolders.length} uscite da elaborare`,
        total: trekFolders.length,
      });
    }

    const tracks = [];
    const photos = [];
    const blobUrls = [];
    const trekFingerprints = {};
    const prevTracks = incremental ? opts.previous.tracks : [];
    const prevPhotos = incremental ? opts.previous.photos || [] : [];
    const prevFp = incremental ? opts.previous.trekFingerprints : {};
    let idx = 0;

    for (const tf of trekFolders) {
      idx++;
      const label = tf.label;
      const metaRows = await collectFileMeta(tf.handle, '');
      const fp = fingerprintFileMeta(metaRows);
      trekFingerprints[label] = fp;

      if (incremental && prevFp[label] === fp) {
        const prevTrack = findPreviousTrackForLabel(prevTracks, prevPhotos, label);
        if (prevTrack) {
          const prevPh = findPreviousPhotosForLabel(prevPhotos, label, prevTrack.id);
          tracks.push({ ...prevTrack, folder_label: label });
          for (const p of prevPh) {
            photos.push({ ...p });
            blobUrls.push(p.src, p.thumb);
          }
          if (onProgress) {
            onProgress({
              phase: 'folder',
              current: idx,
              total: trekFolders.length,
              name: tf.label,
              trackFiles: metaRows.filter((r) => /\.(gpx|kml)$/i.test(r.rel)).length,
              photos: metaRows.filter((r) => /\.(jpe?g)$/i.test(r.rel)).length,
              unchanged: true,
            });
          }
          continue;
        }
      }

      const gpxList = [];
      const imgList = [];
      await collectRecursive(tf.handle, '', gpxList, imgList);
      gpxList.sort((a, b) => a.name.localeCompare(b.name, 'it'));
      imgList.sort((a, b) => a.name.localeCompare(b.name, 'it'));

      if (onProgress) {
        onProgress({
          phase: 'folder',
          current: idx,
          total: trekFolders.length,
          name: tf.label,
          trackFiles: gpxList.length,
          photos: imgList.length,
        });
      }

      const id = makeIdFromLabel(tf.label, idx);
      let mergedPts = [];
      let gpxTrekName = '';
      for (const g of gpxList) {
        const file = await g.handle.getFile();
        const text = await fileToText(file);
        const stem = file.name.replace(/\.[^.]+$/, '');
        let parsed = parseGPXText(text, stem);
        if (!parsed) parsed = parseKMLText(text, stem);
        if (!parsed) continue;
        if (parsed.trkName && !gpxTrekName) gpxTrekName = parsed.trkName;
        mergedPts = mergedPts.concat(parsed.pts);
      }

      const folderDisplayName = computeTrekDisplayName(tf);
      const nameParts = String(tf.name || '')
        .trim()
        .split(/\s*\/\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      const leafSegment = nameParts.length ? nameParts[nameParts.length - 1] : '';
      const leafParsed = parseTrekFolderLabel(leafSegment);
      let dateHint = leafParsed.dateISO || parseDateFromFolderName(tf.group || '') || null;

      let track = null;
      if (mergedPts.length) {
        track = buildTrackRecord(mergedPts, gpxTrekName, leafParsed.title, id, dateHint, folderDisplayName);
      } else {
        let y = dateHint ? parseInt(dateHint.slice(0, 4), 10) : null;
        if (!y && leafParsed.year) y = leafParsed.year;
        if (!y && tf.group) y = inferYearFromGroupFolder(tf.group);
        track = {
          id,
          name: folderDisplayName || leafParsed.title || leafSegment || tf.name,
          date: dateHint,
          year: y,
          distance_km: 0,
          ele_gain_m: 0,
          ele_loss_m: 0,
          ele_max_m: 0,
          ele_min_m: 0,
          bounds: { n: 0, s: 0, e: 0, w: 0 },
          center: [46.5, 11],
          coords: [],
          elevation_profile: [],
        };
      }
      track.folder_label = label;

      if (!track.year && tf.group) {
        const yg = inferYearFromGroupFolder(tf.group);
        if (yg) track.year = yg;
      }

      if (!imgList.length && !mergedPts.length) continue;

      tracks.push(track);

      const exifr = global.exifr;
      let pi = 0;
      for (const im of imgList) {
        pi++;
        if (onProgress && (pi === 1 || pi === imgList.length || pi % 4 === 0)) {
          onProgress({
            phase: 'photo',
            trekCurrent: idx,
            trekTotal: trekFolders.length,
            photoCurrent: pi,
            photoTotal: imgList.length,
            file: im.name,
          });
        }
        if (pi % 20 === 0) await Promise.resolve();

        const file = await im.handle.getFile();
        let lat = null,
          lon = null,
          datetime = null,
          date = dateHint || null;
        if (exifr && typeof exifr.parse === 'function') {
          try {
            const ex = await exifr.parse(file, { gps: true, exif: true, ifd0: true, merge: true });
            if (ex) {
              if (ex.latitude != null && ex.longitude != null) {
                lat = Math.round(ex.latitude * 1e6) / 1e6;
                lon = Math.round(ex.longitude * 1e6) / 1e6;
              }
              const raw = ex.DateTimeOriginal || ex.CreateDate || ex.ModifyDate;
              if (raw) {
                const d = raw instanceof Date ? raw : new Date(raw);
                if (!isNaN(d.getTime())) {
                  datetime = d.toISOString();
                  date = d.toISOString().slice(0, 10);
                }
              }
            }
          } catch (e) {
            /* skip exif */
          }
        }

        const srcBlob = URL.createObjectURL(file);
        blobUrls.push(srcBlob);
        let thumbBlob = null;
        try {
          thumbBlob = await makeThumbBlob(file);
        } catch (e) {
          thumbBlob = file;
        }
        const thumbUrl = URL.createObjectURL(thumbBlob);
        blobUrls.push(thumbUrl);

        let pinUrl = thumbUrl;
        try {
          const pinBlob = await makePinBlob(file);
          pinUrl = URL.createObjectURL(pinBlob);
          blobUrls.push(pinUrl);
        } catch (e) { /* fall back to thumbUrl */ }

        const stem = im.name.replace(/\.[^.]+$/i, '');
        photos.push({
          id: stem + '_' + id,
          folder: tf.label,
          src: srcBlob,
          thumb: thumbUrl,
          pin: pinUrl,
          lat,
          lon,
          datetime,
          date,
          track_id: id,
        });
      }

      // Override photo GPS with position interpolated from track timestamps.
      // Camera GPS may be inaccurate on first shots (cold start); the track is more reliable.
      if (track._timedPts) {
        for (const photo of photos.filter((p) => p.track_id === id && p.datetime)) {
          const pos = interpolateOnTrack(track._timedPts, photo.datetime);
          if (pos) {
            photo.lat = Math.round(pos.lat * 1e6) / 1e6;
            photo.lon = Math.round(pos.lon * 1e6) / 1e6;
          }
        }
        delete track._timedPts;
      }

      if (track.time_hm == null && imgList.length) {
        const ours = photos.filter((p) => p.track_id === id && p.datetime);
        if (ours.length) {
          const sorted = [...ours].sort((a, b) => String(a.datetime || '').localeCompare(String(b.datetime || '')));
          const d = new Date(sorted[0].datetime);
          if (!isNaN(d.getTime())) {
            track.time_hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
          }
        }
      }

      if (!track.coords.length) {
        const withGps = photos.filter((p) => p.track_id === id && p.lat != null && p.lon != null);
        if (withGps.length) {
          const la = withGps.reduce((s, p) => s + p.lat, 0) / withGps.length;
          const lo = withGps.reduce((s, p) => s + p.lon, 0) / withGps.length;
          track.center = [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5];
        }
      }
    }

    tracks.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const totalKm = Math.round(tracks.reduce((s, t) => s + t.distance_km, 0) * 10) / 10;
    const totalEle = Math.round(tracks.reduce((s, t) => s + t.ele_gain_m, 0));
    const eleRecord = tracks.length ? Math.max(...tracks.map((t) => t.ele_max_m || 0)) : 0;
    const years = [...new Set(tracks.map((t) => t.year).filter(Boolean))].sort();

    const stats = {
      total_tracks: tracks.length,
      total_photos: photos.length,
      total_km: totalKm,
      total_ele_gain: totalEle,
      ele_record: eleRecord,
      years,
    };

    return { stats, tracks, photos, blobUrls, trekFingerprints };
  }

  /**
   * Nome visualizzato da `folder_label` (path completo salvato sulla traccia).
   * Salta il primo segmento (cartella gruppo/anno) e usa la stessa logica di computeTrekDisplayName.
   */
  function computeDisplayNameFromFolderLabel(folderLabel) {
    const parts = String(folderLabel || '')
      .trim()
      .split(/\s*\/\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return '';
    const tfName = parts.length === 1 ? parts[0] : parts.slice(1).join(' / ');
    return computeTrekDisplayName({ name: tfName });
  }

  global.TrekScan = {
    scanBaseFolder,
    haversine,
    parseTrekFolderLabel,
    toISOFromDateToken,
    computeDisplayNameFromFolderLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
