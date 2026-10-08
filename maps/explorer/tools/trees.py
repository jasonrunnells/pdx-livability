# Builds tree shapes for 3D from treetop points (LiDAR canopy -> ArcGIS treetop steps -> GeoJSON points, grid_code = height in feet).
# 3D: each tree = trunk + lower crown + upper crown (stacked blocks)       -> <outdir>/trees.geojsonl
# Tree cover: a 20 m grid; w = share of each cell under tree crowns (0-1)    -> <outdir>/cover.geojsonl
# Run: python3 trees.py input.geojson outdir     then tippecanoe -L trees:.. -L cover:..
import json, math, os, sys, zlib
src, outdir = sys.argv[1], sys.argv[2]; dst = os.path.join(outdir, 'trees.geojsonl')
MIN_FT = 15                       # shorter tops are shrubs/hedges
pts = []
if src.endswith('.csv'):   # lon,lat,height_ft (from tools/treetops.py)
    for ln in open(src):
        lo, la, hf = ln.split(','); h = float(hf) * 0.3048
        if h >= MIN_FT * 0.3048: pts.append([float(lo), float(la), h])
else:
    for f in json.load(open(src, encoding='utf-8'))['features']:
        h = (f['properties'].get('grid_code') or f['properties'].get('Value') or 0) * 0.3048
        if h >= MIN_FT * 0.3048 and f['geometry']: pts.append([*f['geometry']['coordinates'][:2], h])
lat0 = sum(p[1] for p in pts) / len(pts)
KX, KY = 111320 * math.cos(math.radians(lat0)), 110540     # meters per degree
# 1) merge double tops: within 2.5 m keep the taller (grid hash)
pts.sort(key=lambda p: -p[2]); cell = 2.5; grid = {}; kept = []
def key(x, y): return (int(x * KX // cell), int(y * KY // cell))
for p in pts:
    gx, gy = key(p[0], p[1]); near = False
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for q in grid.get((gx + i, gy + j), ()):
                if math.hypot((p[0] - q[0]) * KX, (p[1] - q[1]) * KY) < 2.5: near = True; break
            if near: break
        if near: break
    if not near: grid.setdefault((gx, gy), []).append(p); kept.append(p)
# 2) nearest neighbour distance (caps crown width so crowns don't swallow each other)
cell2 = 12; g2 = {}
for i, p in enumerate(kept): g2.setdefault((int(p[0] * KX // cell2), int(p[1] * KY // cell2)), []).append(i)
def nn(i):
    p = kept[i]; gx, gy = int(p[0] * KX // cell2), int(p[1] * KY // cell2); best = 99
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for j in g2.get((gx + a, gy + b), ()):
                if j != i: best = min(best, math.hypot((p[0] - kept[j][0]) * KX, (p[1] - kept[j][1]) * KY))
    return best
def ring(x, y, r, n=8, rot=0.0):
    pts = [[round(x + r * math.cos(rot + 2 * math.pi * k / n) / KX, 6), round(y + r * math.sin(rot + 2 * math.pi * k / n) / KY, 6)] for k in range(n)]
    return [pts + [pts[0]]]
out = open(dst, 'w'); n = 0
CELL = 20; cover = {}   # (gx, gy) -> crown area in m2
for i, (x, y, h) in enumerate(kept):
    seed = zlib.crc32(f'{x:.6f}{y:.6f}'.encode()); rnd = (seed % 1000) / 1000; rot = (seed >> 10) % 360 * math.pi / 180
    # Tree type from shape (no species in LiDAR): tall ones are taken as evergreens (Douglas fir / cedar), shorter as leafy.
    conifer = h >= 20 or (h >= 14 and rnd < 0.45)
    room = max(1.4, 0.6 * nn(i))                                   # don't swallow the neighbours
    if conifer:   # narrow pointed evergreen: bare trunk, then 4 tiers that shrink toward the top
        R = min(max(1.5, 0.1 * h + 0.9), 4.6, room)
        base = h * (0.18 + 0.12 * rnd)
        tiers = [(1.0, 0.00, 0.42), (0.68, 0.34, 0.74), (0.36, 0.66, 1.0)]
        shade = 3 + seed % 2                                         # darker greens
        parts = [('t', ring(x, y, max(0.22, R * 0.11), 4, rot), 0, base + 0.5)]
        for k, (f, t0, t1) in enumerate(tiers):
            parts.append(('c', ring(x, y, R * f, 7 if k < 2 else 6, rot + 0.4 * k), base + (h - base) * t0, base + (h - base) * t1))
    else:         # leafy tree: short trunk, rounded crown (wider in the middle)
        R = min(max(1.8, 0.17 * h + 1.0), 6.2, room)
        base = h * (0.28 + 0.1 * rnd)
        shade = seed % 3                                             # lighter greens
        c = h - base
        parts = [('t', ring(x, y, max(0.25, R * 0.1), 4, rot), 0, base + 0.5),
                 ('c', ring(x, y, R * 0.72, 7, rot), base, base + c * 0.3),
                 ('c', ring(x, y, R, 8, rot + 0.3), base + c * 0.22, base + c * 0.72),
                 ('c', ring(x, y, R * 0.6, 6, rot + 0.6), base + c * 0.66, h)]
    r = R
    k = (int(x * KX // CELL), int(y * KY // CELL)); cover[k] = cover.get(k, 0) + math.pi * r * r
    for kind, geom, b, t in parts:
        out.write(json.dumps({'type': 'Feature', 'properties': {'b': round(b), 'h': max(round(t), round(b) + 1), 's': 9 if kind == 't' else shade}, 'tippecanoe': {'minzoom': 15},
                              'geometry': {'type': 'Polygon', 'coordinates': geom}}, separators=(',', ':')) + '\n'); n += 1
with open(os.path.join(outdir, 'cover.geojsonl'), 'w') as cv:
    for (gx, gy), a in cover.items():
        w = min(1.0, a / (CELL * CELL))
        if w < 0.03: continue
        cv.write(json.dumps({'type': 'Feature', 'properties': {'w': round(w, 2)}, 'tippecanoe': {'minzoom': 11},
            'geometry': {'type': 'Point', 'coordinates': [round((gx + 0.5) * CELL / KX, 6), round((gy + 0.5) * CELL / KY, 6)]}}, separators=(',', ':')) + '\n')
print(len(cover), 'cover cells;', len(pts), 'tops ->', len(kept), 'trees,', n, 'shapes')
