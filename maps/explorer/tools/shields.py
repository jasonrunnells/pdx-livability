# Builds data/shields.geojson: highway shield points, evenly spaced per route.
# Each point has a tier; higher tiers fill in as you zoom in.
import json, math, os, re
D = os.path.join(os.path.dirname(__file__), '..', 'data')
ROUTES = {
  'i-5':    ['I5 FWY NB', 'I5 FWY SB', 'MARQUAM BRG'],
  'i-205':  ['I205 FWY NB', 'I205 FWY SB'],
  'i-84':   ['I84 FWY EB', 'I84 FWY WB'],
  'i-405':  ['I405 FWY NB', 'I405 FWY SB', 'FREMONT BRG'],
  'us-26':  ['NW SUNSET HWY EB', 'NW SUNSET HWY WB', 'SW SUNSET HWY EB', 'SW SUNSET HWY WB', 'HWY 26', 'SE HWY 26', 'SE HWY 26 EB', 'SE HWY 26 WB', 'SE MT HOOD HWY', 'SE POWELL BLVD'],
  'us-30':  ['HWY 30', 'NW ST HELENS RD', 'NW YEON AVE'],
  'or-217': ['HWY 217 NB', 'HWY 217 SB'],
  'or-213': ['HWY 213', 'HWY 213 NB', 'HWY 213 SB', 'S HWY 213'],
  'or-212': ['SE HWY 212'],
  'or-224': ['SE HWY 224'],
  'or-99E': ['MCLOUGHLIN BLVD', 'S MCLOUGHLIN BLVD', 'SE MCLOUGHLIN BLVD', 'S HWY 99E'],
  'or-99W': ['SW PACIFIC HWY', 'SW BARBUR BLVD'],
  'or-8':   ['SW TUALATIN VALLEY HWY', 'SE TUALATIN VALLEY HWY', 'SW CANYON RD'],
  'or-10':  ['SW BEAVERTON HILLSDALE HWY', 'SW FARMINGTON RD'],
  'or-43':  ['WILLAMETTE DR', 'S MACADAM AVE'],
  'or-47':  ['NW HWY 47', 'SW HWY 47'],
}
BY = {n: r for r, ns in ROUTES.items() for n in ns}
TIERS = [16, 8, 4, 2, 1]          # km between shields of the same route, per tier
KX = 111.32 * math.cos(math.radians(45.5)); KY = 110.57
segs = {r: [] for r in ROUTES}
for f in json.load(open(os.path.join(D, 'streets.geojson'), encoding='utf-8'))['features']:
    r = BY.get((f['properties'].get('FULL_NAME') or '').strip())
    if r and f['geometry']:
        g = f['geometry']; segs[r] += [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
out = []
for r, lines in segs.items():
    cand = []                      # a candidate point every ~150 m along every piece
    for ln in lines:
        for (x1, y1), (x2, y2) in zip(ln, ln[1:]):
            L = math.hypot((x2 - x1) * KX, (y2 - y1) * KY); n = max(1, int(L / 0.15))
            cand += [(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n) for i in range(n)]
    if not cand: continue
    xs = [c[0] for c in cand]; ys = [c[1] for c in cand]
    axis = 0 if (max(xs) - min(xs)) * KX > (max(ys) - min(ys)) * KY else 1
    cand.sort(key=lambda c: c[axis])  # walk the route end to end
    kept = []
    for t, km in enumerate(TIERS):
        for c in cand:
            if all(math.hypot((c[0] - k[0]) * KX, (c[1] - k[1]) * KY) >= km for k in kept):
                kept.append(c); out.append({'type': 'Feature', 'properties': {'s': r, 't': t},
                    'geometry': {'type': 'Point', 'coordinates': [round(c[0], 6), round(c[1], 6)]}})
    print(r, len(lines), 'pieces', sum(1 for o in out if o['properties']['s'] == r), 'shields')
json.dump({'type': 'FeatureCollection', 'features': out}, open(os.path.join(D, 'shields.geojson'), 'w'), separators=(',', ':'))
