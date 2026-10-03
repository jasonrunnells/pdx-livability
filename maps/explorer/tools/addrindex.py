# Builds the address search index from lots_outline.geojson.
#   python3 addrindex.py <part> <parts>   -> _build/addr_NN.jsonl.gz   (byte-range chunks, short runs)
#   python3 addrindex.py merge            -> maps/explorer/data/addr/<first 2 chars of house number>.json
# Each row: [address, city, zip, lon, lat]  (lon/lat = middle of the lot's largest piece; the map then
# finds the lot itself by matching the address in the lot tiles).
import json, gzip, os, sys, glob
exec(open(os.path.join(os.path.dirname(__file__),'prep.py')).read().split('def cls')[0])
B=os.path.expanduser('~/mnt/pdx-livability/_build/')
if sys.argv[1]=='merge':
    seen={}; 
    for fn in sorted(glob.glob(B+'addr_*.jsonl.gz')):
        for line in gzip.open(fn,'rt',encoding='utf-8'):
            r=json.loads(line); k=(r[0].lower(),(r[1] or '').lower())
            if k not in seen: seen[k]=r
    out=os.path.join(D,'addr'); os.makedirs(out,exist_ok=True)
    shards={}
    for r in seen.values(): shards.setdefault(r[0].split()[0][:2].lower(),[]).append(r)
    for k,rows in shards.items():
        rows.sort(key=lambda r:r[0])
        json.dump(rows,open(os.path.join(out,k+'.json'),'w',encoding='utf-8'),separators=(',',':'))
    print('rows',len(seen),'shards',len(shards)); sys.exit()
part,parts=int(sys.argv[1]),int(sys.argv[2])
SRC=D+'lots_outline.geojson'; size=os.path.getsize(SRC)
A0=size*part//parts; B0=size*(part+1)//parts
MARK=b'{"type":"Feature",'
dec=json.JSONDecoder()
with open(SRC,'rb') as fh:
    fh.seek(A0); buf=fh.read(B0-A0+(8<<20))
out=gzip.open(B+'addr_%02d.jsonl.gz'%part,'wt',encoding='utf-8'); cnt=0
i=buf.find(MARK)
while i!=-1 and i<(B0-A0):
    n=buf.find(MARK,i+1)
    f,_=dec.raw_decode(buf[i:n if n!=-1 else len(buf)].decode('utf-8','ignore')); i=n
    g=f.get('geometry'); p=f['properties']; a=(p.get('SITEADDR') or '').strip()
    if not g or not a or not a[:1].isdigit(): continue
    polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    best=None
    for poly in polys:
        r=poly[0]; xs=[c[0] for c in r]; ys=[c[1] for c in r]; ar=(max(xs)-min(xs))*(max(ys)-min(ys))
        if not best or ar>best[0]: best=(ar,(min(xs)+max(xs))/2,(min(ys)+max(ys))/2)
    city=(p.get('SITECITY') or '').strip().title(); z=str(p.get('SITEZIP') or '').strip()
    out.write(json.dumps([nice(a),city,z,round(best[1],5),round(best[2],5)],separators=(',',':'))+'\n'); cnt+=1
out.close(); print(part,'done',cnt,flush=True)
