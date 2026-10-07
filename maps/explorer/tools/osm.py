# Builds data/osm_places.geojson from an OpenStreetMap export (Geofabrik shapefile -> ArcGIS Pro -> GeoJSON).
# One point per place (inside its shape), only inside the Metro boundary.  Run: python3 tools/osm.py [input.geojson]
import json, os, sys
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, 'OSM_POIs_2.geojson')
KEEP = {'veterinary', 'dog_park', 'cinema', 'fitness_centre', 'prison', 'theme_park', 'zoo',
        'playground', 'bookshop'}          # fclass values; add more here when the export has them

def ring_area_centroid(r):
    a = cx = cy = 0
    for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
        c = x1 * y2 - x2 * y1; a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
    return (a / 2, (cx / (3 * a), cy / (3 * a))) if a else (0, (r[0][0], r[0][1]))
def inside(rings, x, y):
    c = False
    for r in rings:
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def label_point(geom):
    if geom['type'] == 'Point': return geom['coordinates'][:2]
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    poly = max(polys, key=lambda p: abs(ring_area_centroid([q[:2] for q in p[0]])[0]))
    rings = [[q[:2] for q in r] for r in poly]
    x, y = ring_area_centroid(rings[0])[1]
    if inside(rings, x, y): return [x, y]
    xs = []                                    # centroid fell outside (L-shapes): middle of the widest piece on that row
    for r in rings:
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            if (y1 > y) != (y2 > y): xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort(); spans = [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]
    a, b = max(spans, key=lambda s: s[1] - s[0]) if spans else (x, x)
    return [(a + b) / 2, y]

metro = json.load(open(os.path.join(D, 'metro.geojson')))
mrings = [[q[:2] for q in r] for f in metro['features'] for p in (f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']]) for r in p]
out, seen, skipped = [], set(), 0
for f in json.load(open(SRC, encoding='utf-8'))['features']:
    p, g = f['properties'], f['geometry']
    if not g or p.get('fclass') not in KEEP: continue
    if p.get('osm_id') in seen: continue
    x, y = label_point(g)
    if not inside(mrings, x, y): skipped += 1; continue
    seen.add(p.get('osm_id'))
    out.append({'type': 'Feature', 'properties': {'kind': p['fclass'], 'name': (p.get('name') or '').strip(), 'osm': p.get('osm_id')},
                'geometry': {'type': 'Point', 'coordinates': [round(x, 6), round(y, 6)]}})
json.dump({'type': 'FeatureCollection', 'features': out}, open(os.path.join(D, 'osm_places.geojson'), 'w'), separators=(',', ':'))
import collections
print(len(out), 'kept,', skipped, 'outside Metro', dict(collections.Counter(o['properties']['kind'] for o in out)))
