/**
 * Salvataggio locale nell’app (IndexedDB): tracci, statistiche, blob foto.
 * Stesso origine = stesso DB (browser localhost, Electron file:// per path app).
 */
(function (global) {
  'use strict';

  const DB_NAME = 'MountainBookDB';
  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_BLOBS = 'blobs';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      };
    });
  }

  function getMeta(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const r = tx.objectStore(STORE_META).get('snapshot');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  function getBlobRow(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const r = tx.objectStore(STORE_BLOBS).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  /**
   * @param {object} S — stato app { gstats, tracks, photos }
   */
  async function buildSnapshot(S) {
    const rows = [];
    const photoIds = [];
    for (const p of S.photos || []) {
      try {
        const full = await fetch(p.src).then((r) => r.blob());
        const thumb = await fetch(p.thumb).then((r) => r.blob());
        rows.push({
          id: p.id,
          full,
          thumb,
          meta: {
            id: p.id,
            folder: p.folder,
            lat: p.lat,
            lon: p.lon,
            datetime: p.datetime,
            date: p.date,
            track_id: p.track_id,
          },
        });
        photoIds.push(p.id);
      } catch (e) {
        console.warn('[persist] foto non salvata', p.id, e);
      }
    }
    return {
      stats: S.gstats,
      tracks: S.tracks,
      rows,
      photoIds,
      trekFingerprints: S.trekFingerprints || {},
    };
  }

  async function saveFromState(S) {
    if (!S.tracks || (!S.tracks.length && !(S.photos && S.photos.length))) return;
    const snap = await buildSnapshot(S);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const metaS = tx.objectStore(STORE_META);
      const blobS = tx.objectStore(STORE_BLOBS);
      metaS.put(
        {
          stats: snap.stats,
          tracks: snap.tracks,
          photoIds: snap.photoIds,
          trekFingerprints: snap.trekFingerprints || {},
          savedAt: new Date().toISOString(),
        },
        'snapshot'
      );
      const clr = blobS.clear();
      clr.onsuccess = () => {
        for (const row of snap.rows) {
          blobS.put({ full: row.full, thumb: row.thumb, meta: row.meta }, row.id);
        }
      };
      clr.onerror = () => reject(clr.error);
    });
  }

  async function loadIntoPayload() {
    const db = await openDb();
    const meta = await getMeta(db);
    if (!meta || !meta.tracks || !meta.tracks.length) return null;

    const photoIds = meta.photoIds || [];
    const photos = [];
    const blobUrls = [];

    for (const id of photoIds) {
      const row = await getBlobRow(db, id);
      if (!row || !row.full || !row.thumb) continue;
      const src = URL.createObjectURL(row.full);
      const thumb = URL.createObjectURL(row.thumb);
      blobUrls.push(src, thumb);
      photos.push({ ...row.meta, src, thumb });
    }

    return {
      stats: meta.stats,
      tracks: meta.tracks,
      photos,
      blobUrls,
      trekFingerprints: meta.trekFingerprints || {},
    };
  }

  async function hasSnapshot() {
    try {
      const db = await openDb();
      const meta = await getMeta(db);
      return !!(meta && meta.tracks && meta.tracks.length);
    } catch (e) {
      return false;
    }
  }

  async function clearAll() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_META).clear();
      tx.objectStore(STORE_BLOBS).clear();
    });
  }

  /** Salva il riferimento alla cartella base (File System Access API) per «Aggiorna» e avvio. */
  async function saveFolderHandle(handle) {
    if (!handle) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_META).put(handle, 'folderHandle');
    });
  }

  async function loadFolderHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const r = tx.objectStore(STORE_META).get('folderHandle');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  global.MountainBookPersist = {
    saveFromState,
    loadIntoPayload,
    hasSnapshot,
    clearAll,
    saveFolderHandle,
    loadFolderHandle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
