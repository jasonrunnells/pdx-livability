import json, gzip, sys, os, time
D=os.path.expanduser('~/mnt/pdx-livability/maps/explorer/data/')
O=os.path.expanduser('~/mnt/pdx-livability/_build/')
def feats(path):
    dec=json.JSONDecoder(); CH=1<<24
    with open(path,'r',encoding='utf-8') as f:
        buf=f.read(CH); i=buf.index('[',buf.index('"features"'))+1
        while True:
            while i<len(buf) and buf[i] in ' \r\n\t,': i+=1
            if i>=len(buf):
                more=f.read(CH)
                if not more: return
                buf=more; i=0; continue
            if buf[i]==']': return
            try: obj,j=dec.raw_decode(buf,i)
            except json.JSONDecodeError:
                more=f.read(CH)
                if not more: raise
                buf=buf[i:]+more; i=0; continue
            yield obj; i=j
            if i>CH: buf=buf[i:]; i=0
def rnd(c):
    if isinstance(c[0],(int,float)): return [round(c[0],6),round(c[1],6)]
    return [rnd(x) for x in c]
SMALL={'ST':'St','AVE':'Ave','RD':'Rd','DR':'Dr','BLVD':'Blvd','LN':'Ln','CT':'Ct','PL':'Pl','WAY':'Way','HWY':'Hwy','PKWY':'Pkwy','TER':'Ter','CIR':'Cir','LOOP':'Loop','FWY':'Fwy','BRG':'Bridge','SQ':'Sq','ALY':'Aly','TRL':'Trl','PATH':'Path','HTS':'Hts','XING':'Xing','RAMP':'Ramp'}
DIRS={'N','S','E','W','NE','NW','SE','SW','NB','SB','EB','WB','US','MAX','I5','I84','I205','I405'}
import re
def nice(s):
    if not s: return ''
    out=[]
    for w in s.split():
        if w in DIRS: out.append(w)
        elif w in SMALL: out.append(SMALL[w])
        elif re.match(r'^\d+(ST|ND|RD|TH)$',w): out.append(w.lower())
        else: out.append(w.capitalize() if not w[:1].isdigit() else w.lower())
    return ' '.join(out)
def cls(t):
    if t==1110: return 'motorway',8
    if t in(1120,1121,1122,1123,1221,1222,1223,1321,1421,1471,1521): return 'ramp',11
    if t==1200: return 'trunk',8
    if t==1300: return 'primary',9
    if t==1400: return 'secondary',10
    if t==1450: return 'tertiary',11
    if t in(2100,2200): return 'rail',12
    if t==3100: return None,0
    if t in(1600,1700,1780,1800,1900,2000): return 'minor',14
    return 'residential',13
def write(name,src,fn):
    t=time.time(); n=0
    with gzip.open(O+name+'.geojsonl.gz','wt',encoding='utf-8',compresslevel=5) as g:
        for f in feats(D+src+'.geojson'):
            if not f.get('geometry'): continue
            r=fn(f['properties'] or {})
            if r is None: continue
            props,tip=r
            o={'type':'Feature','geometry':{'type':f['geometry']['type'],'coordinates':rnd(f['geometry']['coordinates'])},'properties':props}
            if tip: o['tippecanoe']=tip
            g.write(json.dumps(o,separators=(',',':'))+'\n'); n+=1
    print(name,n,round(time.time()-t),'s',flush=True)
def bld(p):
    o={}
    for k,kk in(('BLDG_ADDR','addr'),('BLDG_TYPE','type'),('BLDG_USE','use'),('BLDG_SQFT','sqft'),('YEAR_BUILT','year')):
        v=p.get(k)
        if v in(None,'',' ',0,'Unknown'): continue
        o[kk]=v.strip() if isinstance(v,str) else v
    return o,None
def street(p):
    c,z=cls(p.get('TYPE'))
    if not c: return None
    nm=(p.get('FULL_NAME') or '').strip()
    if 'UNNAMED' in nm or 'RAMP' in nm or c=='rail': nm=''
    o={'class':c}
    if nm: o['name']=nice(nm)
    return o,{'minzoom':z}
def trail(p):
    if p.get('STATUS') in('Decommissioned','On-Street','Under construction'): return None
    o={'sys':p.get('SYSTEMTYPE') or ''}
    if p.get('TRAILNAME'): o['name']=p['TRAILNAME'].strip()
    if p.get('STATUS')=='Restricted_Private': o['private']=1
    return o,{'minzoom':11 if p.get('SYSTEMTYPE') in('Regional','State') else 12}
def named(k):
    def f(p):
        o={}
        if p.get(k): o['name']=str(p[k]).strip()
        if p.get('ACREAGE'): o['acres']=round(p['ACREAGE'],1)
        return o,None
    return f
jobs={'parks':('parksNaturalAreas',named('SITENAME')),'golf':('golfCourses',named('SITENAME')),'cemeteries':('cemeteries',named('SITENAME')),
'schoolLots':('schoolLots',named('SITE_NAME')),'water':('waterbodies',lambda p:({'class':p.get('CLASS')},None)),'metro':('metro',lambda p:({},None)),
'cities':('cities',lambda p:({'name':p.get('NAME')},None)),'trails':('trails',trail),'streets':('streets',street),'lotsBackground':('lots_background',lambda p:({},None)),'buildings':('buildingFootprints',bld)}

def lot(p):
    o={}
    a=(p.get('SITEADDR') or '').strip()
    if a:
        o['addr']=nice(a)
        n=a.split()[0]
        if n[:1].isdigit(): o['num']=n
    def put(k,src,fn=None):
        v=p.get(src)
        if v in (None,'',' ',0,'0'): return
        if isinstance(v,str): v=v.strip()
        o[k]=fn(v) if fn else v
    put('city','SITECITY',lambda v:v.title()); put('zip','SITEZIP'); put('use','LANDUSE')
    put('year','YEARBUILT',lambda v:int(v) if str(v).isdigit() else v)
    put('sqft','BLDGSQFT'); put('beds','BEDROOMS'); put('floors','FLOORS'); put('units','UNITS')
    put('land','LANDVAL3'); put('bldg','BLDGVAL3'); put('total','TOTALVAL3')
    put('total23','TOTALVAL1'); put('total24','TOTALVAL2')
    put('saledate','SALEDATE'); put('saleprice','SALEPRICE'); put('lotsqft','A_T_SQFT')
    return o,None
jobs['lots']=('lots_outline',lot)
for name in sys.argv[1:]:
    src,fn=jobs[name]; write(name,src,fn)
print('DONE')
