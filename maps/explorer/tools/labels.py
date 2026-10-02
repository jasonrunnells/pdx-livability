import json, math
def rings_of(g):
    return [g['coordinates']] if g['type']=='Polygon' else g['coordinates']
def area(r):
    a=0
    for i in range(len(r)-1): a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1]
    return abs(a)/2
def inside(x,y,poly):
    c=False
    for r in poly:
        n=len(r)
        for i in range(n-1):
            x1,y1=r[i];x2,y2=r[i+1]
            if (y1>y)!=(y2>y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
def segdist(px,py,ax,ay,bx,by):
    dx,dy=bx-ax,by-ay
    t=0 if dx==dy==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-ax-t*dx,py-ay-t*dy)
def edge(x,y,poly):
    return min(segdist(x,y,r[i][0],r[i][1],r[i+1][0],r[i+1][1]) for r in poly for i in range(len(r)-1))
def label_pt(g):
    polys=rings_of(g); poly=max(polys,key=lambda p:area(p[0]))
    xs=[p[0] for p in poly[0]]; ys=[p[1] for p in poly[0]]
    # simplify vertices for speed
    if sum(len(r) for r in poly)>400:
        step=max(1,sum(len(r) for r in poly)//400); poly=[r[::step]+[r[0]] for r in poly]
    best=None
    x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
    for n in (12,):
        for i in range(n):
            for j in range(n):
                x=x0+(i+.5)*(x1-x0)/n; y=y0+(j+.5)*(y1-y0)/n
                if inside(x,y,poly):
                    d=edge(x,y,poly)
                    if not best or d>best[0]: best=(d,x,y)
    if best:  # refine
        d,bx,by=best; s=(x1-x0)/12
        for _ in range(3):
            s/=3
            for i in range(-3,4):
                for j in range(-3,4):
                    x,y=bx+i*s,by+j*s
                    if inside(x,y,poly):
                        dd=edge(x,y,poly)
                        if dd>d: d,best=dd,(dd,x,y)
            _,bx,by=best
        return [round(best[1],6),round(best[2],6)], sum(area(p[0]) for p in polys)
    c=poly[0][0]; return c, sum(area(p[0]) for p in polys)
ACRE=1/ (4046.86) * (111320*78600)  # deg^2 -> acres approx at 45N
out=open('labels.geojsonl','w')
def emit(pt,props,mz): out.write(json.dumps({'type':'Feature','geometry':{'type':'Point','coordinates':pt},'properties':props,'tippecanoe':{'minzoom':mz}})+'\n')
for line in open('cities.geojsonl'):
    f=json.loads(line); nm=f['properties'].get('name')
    if not nm: continue
    pt,a=label_pt(f['geometry']); ac=a*ACRE
    emit(pt,{'kind':'city','name':nm,'rank':round(ac)}, 8 if ac>20000 else (9 if ac>5000 else 10))
for fn,kind in (('parks','park'),('golf','golf'),('cemeteries','cemetery'),('schoolLots','school')):
    for line in open(fn+'.geojsonl'):
        f=json.loads(line); nm=f['properties'].get('name')
        if not nm: continue
        pt,a=label_pt(f['geometry']); ac=a*ACRE
        if kind=='school': mz=15
        else: mz=11 if ac>=300 else 12 if ac>=100 else 13 if ac>=30 else 14 if ac>=5 else 15
        emit(pt,{'kind':kind,'name':nm,'acres':round(ac)},mz)
out.close()
