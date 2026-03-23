#!/usr/bin/env node
/**
 * Sposta The Mountain Book.app dalla cartella mac-* (output electron-builder) alla root del progetto.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let entries;
try {
  entries = fs.readdirSync(root, { withFileTypes: true });
} catch (e) {
  console.error(e);
  process.exit(1);
}

const macDir = entries.find((e) => e.isDirectory() && /^mac-/.test(e.name));
if (!macDir) {
  console.warn('move-app-to-root: nessuna cartella mac-* trovata (salto).');
  process.exit(0);
}

const macPath = path.join(root, macDir.name);
const apps = fs.readdirSync(macPath).filter((f) => f.endsWith('.app'));
if (!apps.length) {
  console.warn('move-app-to-root: nessun .app in', macPath);
  process.exit(0);
}

const appName = apps[0];
const src = path.join(macPath, appName);
const dest = path.join(root, appName);

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
fs.renameSync(src, dest);

try {
  fs.rmSync(macPath, { recursive: true });
} catch (e) {
  /* cartella non vuota o altro */
}

console.log('App in root:', dest);
