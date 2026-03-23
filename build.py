#!/usr/bin/env python3
"""
Trek Builder — processa GPX + foto JPEG e genera trek-data.js per la webapp.

Struttura attesa nella stessa cartella di build.py:
  gpx/          ← i file .gpx
  foto/         ← una sottocartella per uscita (es. "Dolomiti 2022-07-15")
  data/         ← generato automaticamente
  index.html    ← la webapp

Uso:
  cd /percorso/trek-papa
  pip install gpxpy Pillow piexif
  python3 build.py
"""

import json, math, os, re, sys
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

# ─── dipendenze ──────────────────────────────────────────────────────────────

def require(pkg, pip_name=None):
    try:
        return __import__(pkg)
    except ImportError:
        name = pip_name or pkg
        sys.exit(f"\n❌  Pacchetto mancante. Installalo con:\n    pip install {name}\n")

gpxpy  = require("gpxpy")
Image  = require("PIL", "Pillow").Image
ImageOps = require("PIL", "Pillow").ImageOps
piexif = require("piexif")

# ─── configurazione ───────────────────────────────────────────────────────────

BASE_DIR         = Path(__file__).parent
GPX_DIR          = BASE_DIR / "gpx"
FOTO_DIR         = BASE_DIR / "foto"
THUMB_DIR        = FOTO_DIR / "thumbs"
DATA_DIR         = BASE_DIR / "data"
THUMB_SIZE       = (480, 360)
MAX_TRACK_POINTS = 600     # punti per tracciato dopo semplificazione
MAX_PROFILE_PTS  = 250     # punti per il profilo altimetrico
SUPPORTED_EXTS   = {".jpg", ".jpeg"}

# ─── geometria / GPS ──────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    d = math.radians
    dlat = d(lat2 - lat1); dlon = d(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(d(lat1)) * math.cos(d(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(min(1, math.sqrt(a)))

def exif_rational_to_float(val):
    return val[0][0]/val[0][1] + val[1][0]/val[1][1]/60 + val[2][0]/val[2][1]/3600

def exif_gps_to_decimal(gps):
    lat = exif_rational_to_float(gps[2])
    lon = exif_rational_to_float(gps[4])
    if gps.get(1) == b'S': lat = -lat
    if gps.get(3) == b'W': lon = -lon
    return round(lat, 6), round(lon, 6)

# ─── Douglas-Peucker ─────────────────────────────────────────────────────────

def perp_dist(p, a, b):
    if a == b:
        return math.hypot(p[0]-a[0], p[1]-a[1])
    num = abs((b[1]-a[1])*p[0] - (b[0]-a[0])*p[1] + b[0]*a[1] - b[1]*a[0])
    den = math.hypot(b[1]-a[1], b[0]-a[0])
    return num/den if den else 0

def rdp(pts, eps=0.0001):
    if len(pts) < 3: return pts
    dm, idx = 0, 0
    for i in range(1, len(pts)-1):
        d = perp_dist(pts[i], pts[0], pts[-1])
        if d > dm: dm, idx = d, i
    if dm > eps:
        return rdp(pts[:idx+1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]

def simplify(pts, target):
    if len(pts) <= target: return pts
    eps = 0.00005
    while True:
        s = rdp(pts, eps)
        if len(s) <= target: return s
        eps *= 1.8

# ─── parsing GPX ─────────────────────────────────────────────────────────────

def parse_gpx(path: Path) -> dict | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            gpx = gpxpy.parse(f)
    except Exception as e:
        print(f"    ⚠️  {path.name}: errore parsing — {e}")
        return None

    raw_pts = []
    for trk in gpx.tracks:
        for seg in trk.segments:
            for pt in seg.points:
                if pt.latitude and pt.longitude:
                    raw_pts.append((pt.latitude, pt.longitude, pt.elevation or 0, pt.time))

    # prova anche waypoints se non ci sono track points
    if not raw_pts and gpx.waypoints:
        for wp in gpx.waypoints:
            raw_pts.append((wp.latitude, wp.longitude, wp.elevation or 0, wp.time))

    if not raw_pts:
        print(f"    ⚠️  {path.name}: nessun punto trovato, saltato")
        return None

    # statistiche
    dist_km = 0.0; ele_up = 0.0; ele_dn = 0.0
    for i in range(1, len(raw_pts)):
        p1, p2 = raw_pts[i-1], raw_pts[i]
        dist_km += haversine(p1[0], p1[1], p2[0], p2[1])
        de = p2[2] - p1[2]
        if de > 0: ele_up += de
        else:      ele_dn += abs(de)

    elevs = [p[2] for p in raw_pts if p[2] and p[2] > 0]
    lats  = [p[0] for p in raw_pts]
    lons  = [p[1] for p in raw_pts]

    # data
    date_str = None
    if raw_pts[0][3]:
        date_str = raw_pts[0][3].strftime("%Y-%m-%d")
    if not date_str and gpx.tracks and gpx.tracks[0].name:
        m = re.search(r'(\d{4}-\d{2}-\d{2})', gpx.tracks[0].name)
        if m: date_str = m.group(1)
    if not date_str:
        m = re.search(r'(\d{4}-\d{2}-\d{2})', path.stem)
        if m: date_str = m.group(1)

    # nome
    name = (gpx.tracks[0].name if gpx.tracks and gpx.tracks[0].name else "").strip()
    if not name or name.lower() in ('track','traccia','route','percorso','untitled',''):
        name = re.sub(r'[_-]', ' ', path.stem).strip()

    # profilo altimetrico
    step = max(1, len(raw_pts) // MAX_PROFILE_PTS)
    cumulative = 0.0
    profile = []
    for i in range(0, len(raw_pts), step):
        if i > 0:
            j = i - step
            cumulative += haversine(raw_pts[j][0], raw_pts[j][1], raw_pts[i][0], raw_pts[i][1])
        profile.append({"d": round(cumulative, 3), "e": round(raw_pts[i][2], 1)})

    coords = [(p[0], p[1]) for p in raw_pts]
    simplified = simplify(coords, MAX_TRACK_POINTS)

    return {
        "id":               path.stem,
        "name":             name,
        "date":             date_str,
        "year":             int(date_str[:4]) if date_str else None,
        "distance_km":      round(dist_km, 2),
        "ele_gain_m":       round(ele_up),
        "ele_loss_m":       round(ele_dn),
        "ele_max_m":        round(max(elevs)) if elevs else 0,
        "ele_min_m":        round(min(elevs)) if elevs else 0,
        "bounds":           {"n": max(lats), "s": min(lats), "e": max(lons), "w": min(lons)},
        "center":           [round(sum(lats)/len(lats), 5), round(sum(lons)/len(lons), 5)],
        "coords":           [[round(p[0], 5), round(p[1], 5)] for p in simplified],
        "elevation_profile": profile,
    }

def parse_kml(path: Path) -> dict | None:
    try:
        tree = ET.parse(path)
        root = tree.getroot()
    except Exception as e:
        print(f"    ⚠️  {path.name}: errore parsing — {e}")
        return None

    raw_pts = []
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "coordinates":
            text = (elem.text or "").replace("\n", " ")
            for chunk in text.split():
                chunk = chunk.strip()
                if not chunk:
                    continue
                parts = [float(x) for x in chunk.split(",") if x != ""]
                if len(parts) >= 2:
                    lon, lat = parts[0], parts[1]
                    ele = parts[2] if len(parts) > 2 else 0
                    raw_pts.append((lat, lon, ele, None))
        elif tag == "coord":
            text = (elem.text or "").strip()
            if not text:
                continue
            parts = text.split()
            if len(parts) >= 2:
                lon, lat = float(parts[0]), float(parts[1])
                ele = float(parts[2]) if len(parts) > 2 else 0
                raw_pts.append((lat, lon, ele, None))

    if not raw_pts:
        print(f"    ⚠️  {path.name}: nessun punto trovato, saltato")
        return None

    dist_km = 0.0
    ele_up = 0.0
    ele_dn = 0.0
    for i in range(1, len(raw_pts)):
        p1, p2 = raw_pts[i - 1], raw_pts[i]
        dist_km += haversine(p1[0], p1[1], p2[0], p2[1])
        de = p2[2] - p1[2]
        if de > 0:
            ele_up += de
        else:
            ele_dn += abs(de)

    elevs = [p[2] for p in raw_pts if p[2] and p[2] > 0]
    lats = [p[0] for p in raw_pts]
    lons = [p[1] for p in raw_pts]

    date_str = None
    m = re.search(r"(\d{4}-\d{2}-\d{2})", path.stem)
    if m:
        date_str = m.group(1)

    name = ""
    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "name" and elem.text:
            name = elem.text.strip()
            break
    if not name or name.lower() in ("track", "traccia", "route", "percorso", "untitled", ""):
        name = re.sub(r"[_-]", " ", path.stem).strip()

    step = max(1, len(raw_pts) // MAX_PROFILE_PTS)
    cumulative = 0.0
    profile = []
    for i in range(0, len(raw_pts), step):
        if i > 0:
            j = i - step
            cumulative += haversine(raw_pts[j][0], raw_pts[j][1], raw_pts[i][0], raw_pts[i][1])
        profile.append({"d": round(cumulative, 3), "e": round(raw_pts[i][2], 1)})

    coords = [(p[0], p[1]) for p in raw_pts]
    simplified = simplify(coords, MAX_TRACK_POINTS)

    return {
        "id": path.stem,
        "name": name,
        "date": date_str,
        "year": int(date_str[:4]) if date_str else None,
        "distance_km": round(dist_km, 2),
        "ele_gain_m": round(ele_up),
        "ele_loss_m": round(ele_dn),
        "ele_max_m": round(max(elevs)) if elevs else 0,
        "ele_min_m": round(min(elevs)) if elevs else 0,
        "bounds": {"n": max(lats), "s": min(lats), "e": max(lons), "w": min(lons)},
        "center": [round(sum(lats) / len(lats), 5), round(sum(lons) / len(lons), 5)],
        "coords": [[round(p[0], 5), round(p[1], 5)] for p in simplified],
        "elevation_profile": profile,
    }

# ─── foto ─────────────────────────────────────────────────────────────────────

def make_thumb(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists(): return True
    try:
        img = Image.open(src)
        img = ImageOps.exif_transpose(img)
        img.thumbnail(THUMB_SIZE, Image.LANCZOS)
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
        img.save(dst, "JPEG", quality=82, optimize=True)
        return True
    except Exception as e:
        print(f"      ⚠️  thumb fallita ({src.name}): {e}")
        return False

def extract_exif(path: Path) -> dict | None:
    try:
        img = Image.open(path)
        raw = img.info.get("exif", b"")
        if not raw: return None
        exif = piexif.load(raw)
    except Exception:
        return None

    lat = lon = dt = None

    gps = exif.get("GPS", {})
    if gps and 2 in gps and 4 in gps:
        try: lat, lon = exif_gps_to_decimal(gps)
        except: pass

    exif_ifd = exif.get("Exif", {})
    zeroth   = exif.get("0th", {})
    for tag in (piexif.ExifIFD.DateTimeOriginal, piexif.ExifIFD.DateTimeDigitized):
        val = exif_ifd.get(tag)
        if val:
            try:
                s = val.decode() if isinstance(val, bytes) else val
                dt = datetime.strptime(s, "%Y:%m:%d %H:%M:%S")
                break
            except: pass
    if not dt:
        val = zeroth.get(piexif.ImageIFD.DateTime)
        if val:
            try:
                s = val.decode() if isinstance(val, bytes) else val
                dt = datetime.strptime(s, "%Y:%m:%d %H:%M:%S")
            except: pass

    return {
        "lat": lat, "lon": lon,
        "datetime": dt.isoformat() if dt else None,
        "date":     dt.strftime("%Y-%m-%d") if dt else None,
    }

def closest_track(lat, lon, tracks, max_km=8.0):
    best_id = None; best_d = float("inf")
    for t in tracks:
        for pt in t["coords"]:
            d = haversine(lat, lon, pt[0], pt[1])
            if d < best_d: best_d, best_id = d, t["id"]
    return best_id if best_d <= max_km else None

def process_photos(tracks):
    by_date = {}
    for t in tracks:
        if t["date"]: by_date.setdefault(t["date"], []).append(t)

    photos = []
    folders = sorted([d for d in FOTO_DIR.iterdir() if d.is_dir() and d.name != "thumbs"])

    for folder in folders:
        imgs = sorted([f for f in folder.iterdir() if f.suffix.lower() in SUPPORTED_EXTS])
        if not imgs: continue
        print(f"  📁 {folder.name}  ({len(imgs)} img)")

        folder_date = None
        m = re.search(r'(\d{4}-\d{2}-\d{2})', folder.name)
        if m: folder_date = m.group(1)

        folder_photos = []
        for img_path in imgs:
            meta = extract_exif(img_path) or {}
            date  = meta.get("date") or folder_date
            lat   = meta.get("lat")
            lon   = meta.get("lon")
            if not date and not lat: continue   # niente da usare

            rel_img   = img_path.relative_to(FOTO_DIR)
            thumb_path = THUMB_DIR / rel_img
            if not make_thumb(img_path, thumb_path): continue

            # associa al tracciato
            track_id = None
            if date and date in by_date:
                cands = by_date[date]
                track_id = cands[0]["id"] if len(cands) == 1 else (
                    closest_track(lat, lon, cands, 8) if lat else cands[0]["id"]
                )
            if not track_id and lat:
                track_id = closest_track(lat, lon, tracks, 8)

            folder_photos.append({
                "id":       img_path.stem,
                "folder":   folder.name,
                "src":      "foto/" + "/".join(rel_img.parts),
                "thumb":    "foto/thumbs/" + "/".join(rel_img.parts),
                "lat":      lat,
                "lon":      lon,
                "datetime": meta.get("datetime"),
                "date":     date,
                "track_id": track_id,
            })

        photos.extend(folder_photos)
        print(f"     → {len(folder_photos)} foto processate")

    return photos

# ─── main ─────────────────────────────────────────────────────────────────────

def main():
    print("\n🏔  Trek Builder\n" + "─"*40)

    if not GPX_DIR.exists():
        sys.exit(f"\n❌  Cartella GPX non trovata: {GPX_DIR}\nCreala e mettici i file .gpx\n")

    DATA_DIR.mkdir(exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    # ── tracciati
    print("\n🗺️  Parsing tracciati GPX / KML…")
    gpx_files = sorted(GPX_DIR.glob("*.gpx"))
    kml_files = sorted(GPX_DIR.glob("*.kml"))
    track_files = gpx_files + kml_files
    if not track_files:
        print(f"  ⚠️  Nessun .gpx o .kml trovato in {GPX_DIR}")
    tracks = []
    for f in gpx_files:
        print(f"  ▸ {f.name}")
        r = parse_gpx(f)
        if r:
            tracks.append(r)
    for f in kml_files:
        print(f"  ▸ {f.name}")
        r = parse_kml(f)
        if r:
            tracks.append(r)
    tracks.sort(key=lambda t: t["date"] or "")
    print(f"  ✅  {len(tracks)}/{len(track_files)} tracciati validi")

    # ── foto
    print("\n📸 Processing foto…")
    photos = []
    if FOTO_DIR.exists():
        photos = process_photos(tracks)
        print(f"  ✅  {len(photos)} foto processate")
    else:
        print(f"  ⚠️  Cartella foto non trovata ({FOTO_DIR}), salto")

    # ── statistiche globali
    stats = {
        "total_tracks":   len(tracks),
        "total_photos":   len(photos),
        "total_km":       round(sum(t["distance_km"] for t in tracks), 1),
        "total_ele_gain": round(sum(t["ele_gain_m"]  for t in tracks)),
        "ele_record":     max((t["ele_max_m"] for t in tracks), default=0),
        "years":          sorted(set(t["year"] for t in tracks if t["year"])),
    }

    # ── salva come JS (funziona anche con file://)
    payload = json.dumps({"stats": stats, "tracks": tracks, "photos": photos},
                         ensure_ascii=False, separators=(',',':'))
    js_path = DATA_DIR / "trek-data.js"
    js_path.write_text(f"window.TREK_DATA={payload};", encoding="utf-8")

    size_kb = js_path.stat().st_size // 1024
    print(f"""
╔══════════════════════════════════════════╗
║  ✅  Build completata                    ║
╠══════════════════════════════════════════╣
║  Tracciati  : {stats['total_tracks']:>4}                        ║
║  Foto       : {stats['total_photos']:>4}                        ║
║  Km totali  : {stats['total_km']:>7.1f}                    ║
║  Dislivello : {stats['total_ele_gain']:>7,.0f} m                ║
║  File JS    : {size_kb:>4} KB                       ║
╚══════════════════════════════════════════╝

Apri index.html nel browser (doppio click).
""")

if __name__ == "__main__":
    main()
