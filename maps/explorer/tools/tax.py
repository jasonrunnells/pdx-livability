# Builds the property tax lookup:  python3 tools/tax.py
#   in:  _build/taxlots_metro_Reduced.csv (Metro RLIS tax lots, no shapes), _build/rates/*.csv (code area -> total rate per $1,000)
#   out: maps/explorer/data/tax/<first 3 chars of house number>.json   {"<address lowercased>|<zip>": [tax/yr, assessed, rate x100, county, code, account, city]}
# Estimate = assessed value x the code area's total rate. Multnomah uses 2026-27 rates (2025-26 for the few code areas missing from the new sheet); Washington and Clackamas use 2025-26 (newest posted).
import csv, json, os, statistics, collections
exec(open(os.path.join(os.path.dirname(__file__),'prep.py')).read().split('def cls')[0])
B=os.path.expanduser('~/mnt/pdx-livability/_build/')
R={}
for co,fn in (('M','mult_2025-2026'),('M','mult_2026-2027'),('W','wash_2025-2026'),('C','clack_2025-2026')):
    for line in open(B+'rates/'+fn+'.csv'):
        k,v=line.strip().split(','); R[(co,k)]=float(v)
rows=collections.defaultdict(list); miss=collections.Counter()
for r in csv.DictReader(open(B+'taxlots_metro_Reduced.csv',encoding='utf-8-sig')):
    a=r['SITEADDR'].strip(); co=r['COUNTY']
    if not a[:1].isdigit() or r['OWNERTYPE'].strip()!='PRIVATE': continue
    av=float(r['ASSESSVAL'] or 0); rate=R.get((co,r['TAXCODE'].strip()))
    if av<=0: continue
    if rate is None: miss[co]+=1; continue
    city=r['SITECITY'].strip().title(); jc=r['JURIS_CITY'].strip().title()
    rows[nice(a).lower()+'|'+r['SITEZIP'].strip()].append((round(av*rate/1000),round(av),round(rate*100),co,r['TAXCODE'].strip(),r['PRIMACCNUM'].strip(),'' if jc==city else jc))
out=os.path.expanduser('~/mnt/pdx-livability/maps/explorer/data/tax/'); os.makedirs(out,exist_ok=True)
shards=collections.defaultdict(dict); multi=0
for k,v in rows.items():
    if len(v)>1:   # several tax accounts at one address (condos, split lots): show the middle one, and how many
        multi+=1; v.sort(); m=list(v[len(v)//2]); m.append(len(v)); v=[m]
    shards[k.split()[0][:3]][k]=list(v[0])
for s,d in shards.items(): json.dump(d,open(out+s+'.json','w',encoding='utf-8'),separators=(',',':'))
print('addresses',len(rows),'multi',multi,'shards',len(shards),'no rate',dict(miss))
