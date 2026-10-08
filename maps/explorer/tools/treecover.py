# Tree-cover wash as transparent PNGs (exactly like the preview): crown areas on a 4 m grid, Gaussian-blended.
import json, math, sys
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image
src = sys.argv[1]
pts = [(f['geometry']['coordinates'][0], f['geometry']['coordinates'][1], f['properties']['grid_code'] * 0.3048)
       for f in json.load(open(src))['features'] if f['geometry'] and f['properties']['grid_code'] >= 15]
xs = np.array([p[0] for p in pts]); ys = np.array([p[1] for p in pts]); hs = np.array([p[2] for p in pts])
r = np.clip(1.4 + 0.12 * hs, 1.6, 7.0)
lat0 = ys.mean(); KX = 111320 * math.cos(math.radians(lat0)); KY = 110540
cell = 4.0; pad = 120
x0, x1 = xs.min() - pad / KX, xs.max() + pad / KX; y0, y1 = ys.min() - pad / KY, ys.max() + pad / KY
W = int((x1 - x0) * KX / cell) + 1; H = int((y1 - y0) * KY / cell) + 1
g = np.zeros((H, W), np.float32)
np.add.at(g, (((y1 - ys) * KY / cell).astype(int), ((xs - x0) * KX / cell).astype(int)), (np.pi * r ** 2).astype(np.float32))
def make(sig_m, name, amax):
    d = gaussian_filter(g, sig_m / cell) / (cell * cell); d = np.clip(d / 0.6, 0, 1)
    lo = np.array([186, 206, 156]); hi = np.array([86, 134, 68])
    t = np.clip((d - 0.08) / 0.92, 0, 1)[..., None]
    rgb = lo + (hi - lo) * t
    a = np.clip(d * 1.25, 0, 1) * amax
    img = np.dstack([rgb, a[..., None] * 255]).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(name, optimize=True)
make(18, 'treecover_tight.png', 0.55)
make(36, 'treecover_soft.png', 0.55)
print(json.dumps({'w': W, 'h': H, 'coords': [[round(x0, 6), round(y1, 6)], [round(x1, 6), round(y1, 6)], [round(x1, 6), round(y0, 6)], [round(x0, 6), round(y0, 6)]]}))
