# Builds lot house-number label points: one point per lot at its "visual center"
# (pole of inaccessibility), computed in local meters so it never lands outside the lot.
import json, gzip, math, heapq, os, sys
exec(open(os.path.join(os.path.dirname(__file__),'prep.py')).read().split('def rnd')[0])

def seg_d2(px,py,ax,ay,bx,by):
    dx,dy=bx-ax,by-ay
    if dx or dy:
        t=((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)
        if t>1: ax,ay=bx,by
        elif t>0: ax+=dx*t; ay+=dy*t
    dx,dy=px-ax,py-ay; return dx*dx+dy*dy

def sdist(x,y,rings):
    inside=False; m=float('inf')
    for r in rings:
        n=len(r); j=n-1
        for i in range(n):
            ax,ay=r[i]; bx,by=r[j]
            if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax: inside=not inside
            m=min(m,seg_d2(x,y,ax,ay,bx,by)); j=i
    return (1 if inside else -1)*math.sqrt(m)

def polylabel(rings,prec=0.5):
    xs=[p[0] for p in rings[0]]; ys=[p[1] for p in rings[0]]
    x0,y0,x1,y1=min(xs),min(ys),max(xs),max(ys); w,h=x1-x0,y1-y0
    cs=min(w,h)
    if cs<=0: return (x0,y0)
    hcs=cs/2; q=[]
    def cell(x,y,hh):
        d=sdist(x,y,rings); return (-(d+hh*1.4142),d,x,y,hh)
    x=x0
    while x<x1:
        y=y0
        while y<y1: heapq.heappush(q,cell(x+hcs,y+hcs,hcs)); y+=cs
        x+=cs
    # start from area centroid
    A=cx=cy=0; r=rings[0]
    for (ax,ay),(bx,by) in zip(r,r[1:]+r[:1]):
        c=ax*by-bx*ay; A+=c; cx+=(ax+bx)*c; cy+=(ay+by)*c
    best=cell(cx/(3*A),cy/(3*A),0) if A else cell(x0+w/2,y0+h/2,0)
    bb=cell(x0+w/2,y0+h/2,0)
    if bb[1]>best[1]: best=bb
    n=0
    while q and n<4000:
        c=heapq.heappop(q); n+=1
        if c[1]>best[1]: best=c
        if -c[0]-best[1]<=prec: continue
        hh=c[4]/2
        for dx in(-hh,hh):
            for dy in(-hh,hh): heapq.heappush(q,cell(c[2]+dx,c[3]+dy,hh))
    return best[2],best[3]

def ring_area(r):
    return abs(sum(ax*by-bx*ay for (ax,ay),(bx,by) in zip(r,r[1:]+r[:1])))/2


# Run in byte-range chunks so each run stays short:  python3 lotlabels.py <part> <parts>
part,parts=int(sys.argv[1]),int(sys.argv[2])
SRC=D+'lots_outline.geojson'; size=os.path.getsize(SRC)
A0=size*part//parts; B0=size*(part+1)//parts
MARK=b'{"type":"Feature",'
def chunk_feats():
    dec=json.JSONDecoder()
    with open(SRC,'rb') as fh:
        fh.seek(A0); buf=fh.read(B0-A0+(8<<20))
    i=buf.find(MARK)
    while i!=-1 and i < (B0-A0):
        n=buf.find(MARK,i+1)
        obj,_=dec.raw_decode(buf[i:n if n!=-1 else len(buf)].decode('utf-8','ignore'))
        yield obj
        i=n
out=gzip.open(os.path.expanduser('~/mnt/pdx-livability/_build/lotlabels_%02d.geojsonl.gz'%part),'wt')
cnt=0
for f in chunk_feats():
    g=f.get('geometry'); p=f['properties']
    addr=(p.get('SITEADDR') or '').strip()
    if not g or not addr: continue
    num=addr.split()[0]
    if not num[:1].isdigit(): continue
    polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    lon0,lat0=polys[0][0][0]; kx=111320*math.cos(math.radians(lat0)); ky=110540
    best=None
    for poly in polys:
        rings=[[((x-lon0)*kx,(y-lat0)*ky) for x,y in r[:-1] if True] for r in poly]
        rings=[r for r in rings if len(r)>=3]
        if not rings: continue
        ar=ring_area(rings[0])
        if not best or ar>best[0]: best=(ar,rings)
    if not best: continue
    x,y=polylabel(best[1])
    out.write(json.dumps({'type':'Feature','properties':{'num':num},'geometry':{'type':'Point','coordinates':[round(lon0+x/kx,7),round(lat0+y/ky,7)]}})+'\n')
    cnt+=1
    if cnt%50000==0: print(cnt,flush=True)
out.close(); print('DONE',cnt,flush=True)
