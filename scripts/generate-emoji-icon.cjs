#!/usr/bin/env node
/**
 * Icona app 1024×1024: PNG colorato Twemoji 🏔 (U+1F3D4), non testo canvas
 * (node-canvas disegna spesso solo silhouette nere senza Apple Color Emoji).
 * Twemoji: CC-BY 4.0 — https://github.com/twitter/twemoji
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

/** Twemoji repo: PNG in assets/72x72 (npm dist/72x72 non esiste → 404) */
const TWEMOJI_PNG =
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@v14.0.2/assets/72x72/1f3d4.png';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'app-icon-emoji.png');
const SIZE = 1024;

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) {
            reject(new Error('Redirect senza Location'));
            return;
          }
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          download(next).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} per ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function main() {
  const buf = await download(TWEMOJI_PNG);
  const img = await loadImage(buf);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  const pad = SIZE * 0.08;
  const maxW = SIZE - 2 * pad;
  const maxH = SIZE - 2 * pad;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);

  const dir = path.dirname(OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT, canvas.toBuffer('image/png'));
  console.log('Wrote', OUT, '(Twemoji 1f3d4, color)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
