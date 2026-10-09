# Sale price vs. county market value, per ZIP code, for estimating a likely price on lots with no listing.
#   python3 tools/saleratio.py <part> <parts>   -> _build/ratio_NN.jsonl   (byte-range chunks, short runs)
#   python3 tools/saleratio.py merge            -> data/sale_ratio.json   {"<zip>": ratio, "_all": ratio}
# Uses home sales from the last 2 years (2024-10 onward) with a sale price and a latest county value; ratio = median of sale / value.
import re, json, os, sys, glob, statistics
B=os.path.expanduser('~/mnt/pdx-livability/_build/'); D=os.path.expanduser('~/mnt/pdx-livability/maps/explorer/data/')
if sys.argv[1]=='merge':
    by={}
    for fn in glob.glob(B+'ratio_*.jsonl'):
        for l in open(fn): z,r=json.loads(l); by.setdefault(z,[]).append(r)
    allr=[r for v in by.values() for r in v]
    out={'_all':round(statistics.median(allr),3)}
    for z,v in by.items():
        if len(v)>=15: out[z]=round(statistics.median(v),3)
    json.dump(out,open(D+'sale_ratio.json','w'),separators=(',',':'),sort_keys=True)
    print('sales',len(allr),'zips',len(out)-1,'all',out['_all'],'range',min(out.values()),max(out.values())); sys.exit()
part,parts=int(sys.argv[1]),int(sys.argv[2]); SRC=D+'lots_outline.geojson'; size=os.path.getsize(SRC)
a=size*part//parts; b=size*(part+1)//parts
with open(SRC,'rb') as fh: fh.seek(a); buf=fh.read(b-a)
P=re.compile(rb'"properties":(\{[^{}]*\})')
out=open(B+'ratio_%02d.jsonl'%part,'w'); n=0
for m in P.finditer(buf):
    p=json.loads(m.group(1))
    if p.get('LANDUSE') not in ('SFR','RP R','R') and not str(p.get('LANDUSE') or '').startswith('SFR'): continue
    sp=p.get('SALEPRICE') or 0; sd=str(p.get('SALEDATE') or '')
    mm=re.match(r'(\d{1,2})/\d{1,2}/(\d{4})',sd); ym=(int(mm[2]),int(mm[1])) if mm else ((int(sd[:4]),int(sd[4:6])) if re.match(r'^\d{6}$',sd) else None)
    if not ym or ym<(2024,10) or sp<100000: continue
    v=p.get('TOTALVAL3') or p.get('TOTALVAL2') or p.get('TOTALVAL1') or 0
    if v<100000: continue
    r=sp/v
    if 0.5<r<2.5: out.write(json.dumps([str(p.get('SITEZIP') or '').strip(),round(r,4)])+'\n'); n+=1
print(part,n)
