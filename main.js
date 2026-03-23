/**
 * Electron — finestra unica. L’UI è servita su http://127.0.0.1 (porta fissa)
 * così la pagina è un “secure context”: File System Access (Cartella / Aggiorna) funziona.
 * Con file:// l’API non è disponibile e i pulsanti sembrano “morti”.
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');

const STATIC_PORT_START = 48723;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function createStaticHandler(root) {
  const rootResolved = path.resolve(root);
  return (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(u.pathname);
      if (pathname === '/') pathname = '/index.html';
      const relative = pathname.replace(/^\/+/, '');
      if (!relative || relative.includes('..')) {
        res.writeHead(403);
        res.end();
        return;
      }
      const filePath = path.join(rootResolved, relative);
      if (!filePath.startsWith(rootResolved + path.sep) && filePath !== rootResolved) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
        res.end(data);
      });
    } catch (_) {
      res.writeHead(500);
      res.end();
    }
  };
}

function startStaticServer(root, startPort) {
  return new Promise((resolve, reject) => {
    const handler = createStaticHandler(root);
    function attempt(port) {
      const server = http.createServer(handler);
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') attempt(port + 1);
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        resolve({ server, port });
      });
    }
    attempt(startPort);
  });
}

let staticServer = null;
let staticPort = null;
let useFileFallback = false;

async function ensureStaticServer() {
  if (staticPort != null) return staticPort;
  if (useFileFallback) return null;
  try {
    const { server, port } = await startStaticServer(__dirname, STATIC_PORT_START);
    staticServer = server;
    staticPort = port;
    return port;
  } catch (e) {
    console.error('Static server failed:', e);
    useFileFallback = true;
    return null;
  }
}

async function loadAppInto(win) {
  const port = await ensureStaticServer();
  if (port != null) {
    await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  } else {
    await win.loadFile(path.join(__dirname, 'index.html'));
  }
}

function getAppIconPath() {
  const name = 'app-icon-emoji.png';
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', name);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return path.join(__dirname, 'assets', name);
}

function createWindow() {
  let icon;
  try {
    const p = getAppIconPath();
    if (fs.existsSync(p)) {
      icon = nativeImage.createFromPath(p);
      if (icon.isEmpty()) icon = undefined;
    }
  } catch (_) {
    icon = undefined;
  }

  const win = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'The Mountain Book',
    backgroundColor: '#0e0d0b',
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: false,
    },
  });

  return win;
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    try {
      const p = getAppIconPath();
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) app.dock.setIcon(img);
      }
    } catch (_) {}
  }
  const win = createWindow();
  await loadAppInto(win);
});

app.on('will-quit', () => {
  if (staticServer) {
    try {
      staticServer.close();
    } catch (_) {}
    staticServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow();
    loadAppInto(win).catch((e) => console.error(e));
  }
});
