# Treetops from the 6 ft canopy-height raster (Oregon North State Plane, feet) -> CSV lon,lat,height_ft
import math, sys, time
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter, maximum_filter
Image.MAX_IMAGE_PIXELS = None
t0 = time.time()
im = Image.open(sys.argv[1]); X0, Y0 = im.tag_v2[33922][3], im.tag_v2[33922][4]; CS = im.tag_v2[33550][0]
a = np.asarray(im); H, W = a.shape; print('loaded', a.shape, round(time.time() - t0), 's', flush=True)
# inverse Lambert Conformal Conic 2SP (EPSG:2913, GRS80, feet)
A = 6378137.0; F = 1 / 298.257222101; E = math.sqrt(2 * F - F * F); FT = 0.3048
r = math.radians; p1, p2, p0, l0 = r(44 + 1/3), r(46.0), r(43 + 2/3), r(-120.5); FE = 8202099.737532808 * FT
m = lambda p: math.cos(p) / math.sqrt(1 - (E * math.sin(p)) ** 2)
t = lambda p: math.tan(math.pi / 4 - p / 2) / ((1 - E * math.sin(p)) / (1 + E * math.sin(p))) ** (E / 2)
n = (math.log(m(p1)) - math.log(m(p2))) / (math.log(t(p1)) - math.log(t(p2))); Fc = m(p1) / (n * t(p1) ** n); rho0 = A * Fc * t(p0) ** n
def inv(xft, yft):
    x = xft * FT - FE; y = rho0 - yft * FT
    rho = np.sqrt(x * x + y * y); tt = (rho / (A * Fc)) ** (1 / n); th = np.arctan2(x, y)
    lon = th / n + l0; phi = np.pi / 2 - 2 * np.arctan(tt)
    for _ in range(6): phi = np.pi / 2 - 2 * np.arctan(tt * ((1 - E * np.sin(phi)) / (1 + E * np.sin(phi))) ** (E / 2))
    return np.degrees(lon), np.degrees(phi)
out = open(sys.argv[2], 'w'); total = 0; CH = 1500; PAD = 6
for r0 in range(0, H, CH):
    s0, s1 = max(0, r0 - PAD), min(H, r0 + CH + PAD)
    blk = a[s0:s1].astype(np.float32)
    sm = uniform_filter(blk, 3)                                   # light smoothing (3x3 mean) kills flat-top doubles
    fp = np.zeros((5, 5), bool); yy, xx = np.ogrid[-2:3, -2:3]; fp[yy * yy + xx * xx <= 5] = True   # ~12 ft circle
    mx = maximum_filter(sm, footprint=fp)
    top = (sm == mx) & (sm >= 15) & (blk >= 15)
    top[: r0 - s0] = False; top[r0 - s0 + CH:] = False
    rr, cc = np.nonzero(top)
    xs = X0 + (cc + 0.5) * CS; ys = Y0 - (rr + s0 + 0.5) * CS
    lon, lat = inv(xs, ys); hts = blk[rr, cc].astype(int)
    out.write(''.join(f'{lo:.6f},{la:.6f},{h}\n' for lo, la, h in zip(lon, lat, hts)))
    total += len(rr); print(r0, total, round(time.time() - t0), 's', flush=True)
print('DONE', total)
