/* Portland Explorer: mobile-first livability map. */
(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v!=null&&v!==''&&Number.isFinite(+v)?+v:null;
const usd=v=>num(v)==null?'–':'$'+Math.round(v).toLocaleString();
const pct=v=>num(v)==null?'–':Math.round(v)+'%';
const short=v=>v>=1e6?'$'+(v/1e6).toFixed(2)+'M':'$'+Math.round(v/1e3)+'K';
const title=v=>String(v||'').toLowerCase().replace(/\b\p{L}/gu,c=>c.toUpperCase());
const dark=matchMedia('(prefers-color-scheme: dark)').matches;
const mobile=matchMedia('(max-width: 799px)');

const map=L.map('map',{zoomControl:false,minZoom:8,maxZoom:19,zoomSnap:.5});
const esriTiles=p=>`https://services.arcgisonline.com/ArcGIS/rest/services/${p}/MapServer/tile/{z}/{y}/{x}`;
const vec=style=>{try{if(!L.maplibreGL||!window.maplibregl)throw Error('MapLibre not loaded');return L.maplibreGL({style:`https://tiles.openfreemap.org/styles/${style}`,attribution:'<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'});}catch(e){console.error('Vector basemap failed, using Esri tiles:',e);return L.tileLayer(esriTiles('World_Street_Map'),{maxNativeZoom:16,maxZoom:19,attribution:'Tiles &copy; Esri'});}};
const BASES={
 soft:()=>vec('liberty'),light:()=>vec('positron'),dark:()=>vec('dark'),
 sat:()=>L.layerGroup([L.tileLayer(esriTiles('World_Imagery'),{maxNativeZoom:19,maxZoom:19,attribution:'Imagery &copy; Esri'}),L.tileLayer(esriTiles('Reference/World_Boundaries_and_Places'),{maxNativeZoom:17,maxZoom:19})])
};
let base,baseId;const baseBtns={};
const setBase=id=>{
 if(base)map.removeLayer(base);
 baseId=id;base=BASES[id]();base.addTo(map);
 map.getContainer().classList.toggle('soft',id==='soft');
 try{localStorage.setItem('pdxBase',id);}catch(e){}
 Object.entries(baseBtns).forEach(([k,b])=>b.setAttribute('aria-pressed',String(k===id)));
};
map.setView([45.52,-122.67],11);
addEventListener('resize',()=>map.invalidateSize());
addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize(),300));
if(window.visualViewport)visualViewport.addEventListener('resize',()=>map.invalidateSize());
new ResizeObserver(()=>map.invalidateSize()).observe($('#map'));

const specs=[
 {id:'neighborhoods',label:'Neighborhoods',color:'#0f7b5f',g:'a'},
 {id:'census',label:'Census tracts',color:'#e8833a',g:'a'},
 {id:'cities',label:'Cities',color:'#5b5bd6',g:'a'},
 {id:'grocery',label:'Groceries',color:'#2b7de9',g:'p'},
 {id:'restaurants',label:'Food',color:'#e5484d',g:'p'}];
const groups={},chips={},all=[];let selected=null,census=null;

/* DOM */
document.body.insertAdjacentHTML('beforeend',`<div class="top"><div class="topbar"><div class="search"><span class="home"></span><input type="search" placeholder="Search Portland" aria-label="Search" autocomplete="off"></div><button class="lbtn" aria-label="Map layers" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg></button></div><div class="results"></div><div class="menu" hidden></div></div><div class="dock"><div class="menu bmenu" hidden></div><button class="fab pin" aria-label="Drop an observation here"><svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/></svg></button><button class="fab bbtn" aria-label="Basemap" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"/></svg></button><button class="fab locate" aria-label="Show my location"><svg viewBox="0 0 24 24"><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="5"/></svg></button></div><section class="sheet" aria-hidden="true"><div class="grab"></div><button class="x" aria-label="Close">&times;</button><div class="body"></div></section>`);
const home=$('.map-back-btn');if(home)$('.search .home').replaceWith(home);
const sheet=$('.sheet'),body=$('.body',sheet),results=$('.results'),input=$('.search input');
const openSheet=html=>{PX.lock=false;body.innerHTML=html;sheet.scrollTop=0;sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');};
const PX=window.PX={lock:false};
const closeSheet=()=>{PX.lock=false;PX.onClose&&PX.onClose();sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open');if(selected){selected.reset();selected=null;}};
$('.x',sheet).onclick=closeSheet;
new ResizeObserver(()=>document.body.style.setProperty('--sh',sheet.offsetHeight+'px')).observe(sheet);
addEventListener('keydown',e=>e.key==='Escape'&&closeSheet());
L.DomEvent.disableClickPropagation(sheet);L.DomEvent.disableScrollPropagation(sheet);
L.DomEvent.disableClickPropagation($('.top'));

/* Layer menu */
const menu=$('.menu'),lbtn=$('.lbtn');
const bmenu=$('.bmenu'),bbtn=$('.bbtn');
const closeMenu=()=>{menu.hidden=bmenu.hidden=true;lbtn.setAttribute('aria-expanded','false');bbtn.setAttribute('aria-expanded','false');};
lbtn.onclick=()=>{const o=menu.hidden;closeMenu();menu.hidden=!o;lbtn.setAttribute('aria-expanded',String(o));results.innerHTML='';};
bbtn.onclick=()=>{const o=bmenu.hidden;closeMenu();bmenu.hidden=!o;bbtn.setAttribute('aria-expanded',String(o));};
L.DomEvent.disableClickPropagation($('.dock'));
map.on('click dragstart zoomstart',closeMenu);
const mkRow=(s,i)=>{
 if(i===0||i===3)menu.insertAdjacentHTML('beforeend',`<h3>${i?'Places':'Areas'}</h3>`);
 const b=document.createElement('button');b.className='lrow';b.style.setProperty('--c',s.color);b.disabled=true;b.setAttribute('aria-pressed','false');b.innerHTML=`<i></i>${s.label}<em></em>`;
 b.onclick=()=>{toggle(s.id);closeMenu();};chips[s.id]=b;menu.appendChild(b);map.createPane('p-'+s.id).style.zIndex=410+i*10;
};
specs.forEach(mkRow);
map.createPane('p-hl').style.zIndex=440;
bmenu.insertAdjacentHTML('beforeend','<h3>Basemap</h3>');
[['soft','Standard'],['light','Light'],['dark','Dark'],['sat','Satellite']].forEach(([id,l])=>{
 const b=document.createElement('button');b.className='lrow';b.style.setProperty('--c','#8a9a94');b.setAttribute('aria-pressed','false');b.innerHTML=`<i></i>${l}<em></em>`;
 b.onclick=()=>{setBase(id);closeMenu();};baseBtns[id]=b;bmenu.appendChild(b);
});
let savedBase;try{savedBase=localStorage.getItem('pdxBase');}catch(e){}
setBase(BASES[savedBase]?savedBase:dark?'dark':'soft');
function toggle(id,on){
 const s=specs.find(x=>x.id===id),g=groups[id];if(!g)return;
 on=on??!map.hasLayer(g);
 if(on)specs.filter(x=>x.g===s.g&&x.id!==id).forEach(x=>toggle(x.id,false));
 on?g.addTo(map):map.removeLayer(g);
 chips[id].setAttribute('aria-pressed',String(on));
 if(on&&g.labels)g.labels();
 if(!on&&selected&&selected.id===id)closeSheet();
}

/* Detail cards */
const stat=(l,v)=>`<div class="stat"><span>${l}</span><b>${v}</b></div>`;
const dirs=ll=>`<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${ll.lat},${ll.lng}">Directions</a>`;
const change=(a,b)=>{if(!a||!b)return '<b>–</b>';const c=(a/b-1)*100;return `<b class="${c>=0?'up':'down'}">${c>=0?'+':''}${c.toFixed(1)}%</b>`;};
function chart(series){
 const pts=Object.entries(series||{}).filter(([k,v])=>k>='2022-01'&&num(v)!=null).sort(([a],[b])=>a<b?-1:1);
 if(pts.length<2)return '';
 const W=320,H=88,vs=pts.map(p=>p[1]),lo=Math.min(...vs),hi=Math.max(...vs),sp=hi-lo||1;
 const xy=pts.map(([,v],i)=>[8+i*(W-16)/(pts.length-1),H-10-(v-lo)/sp*(H-30)]);
 const line=xy.map(p=>p.join(',')).join(' ');
 const id='c'+Math.random().toString(36).slice(2,7);
 setTimeout(()=>{
  const el=document.getElementById(id);if(!el)return;
  const dot=$('.d',el),rd=$('.rd',el),g=$('.g',el),svg=$('svg',el);
  const show=e=>{const r=svg.getBoundingClientRect();const i=Math.max(0,Math.min(pts.length-1,Math.round((e.clientX-r.left)/r.width*(pts.length-1))));
   const [x,y]=xy[i];dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.style.display='';g.setAttribute('x1',x);g.setAttribute('x2',x);
   const d=new Date(pts[i][0]+'T12:00');rd.innerHTML=`<span>${d.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span><span>${usd(pts[i][1])}</span>`;};
  el.addEventListener('pointermove',show);el.addEventListener('pointerdown',show);
 });
 const y0=pts[0][0].slice(0,4),y1=pts.at(-1)[0].slice(0,4);
 return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Home value ${y0} to ${y1}"><line class="g" x1="8" x2="8" y1="0" y2="${H}"/><polygon class="a" points="8,${H} ${line} ${W-8},${H}"/><polyline class="l" points="${line}"/><circle class="d" r="5" cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}"/></svg><div class="rd"><span>${y0}</span><span>Touch chart to explore · ${y1}</span></div></div>`;
}
function inRing(p,ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng)c=!c;}return c;}
function tractAt(ll){let hit=null;census?.eachLayer(l=>{if(hit||!l.getBounds().contains(ll))return;const g=l.getLatLngs();const polys=Array.isArray(g[0][0])?g:[g];if(polys.some(r=>inRing(ll,r[0])))hit=l.feature.properties;});return hit;}
const HK=['HOMEVAL_ME','RENT_MED','MORT_COST_','MORT_TAX_M','YR_BUILT_M','INC_HH_MED'];
function hoodStats(layer,ll){
 const b=layer.getBounds(),g=layer.getLatLngs(),polys=Array.isArray(g[0][0])?g:[g],N=16,sum={},n={};let hit=0;
 const add=t=>{for(const k of HK){const v=num(t[k]);if(v>0){sum[k]=(sum[k]||0)+v;n[k]=(n[k]||0)+1;}}};
 for(let i=0;i<N;i++)for(let j=0;j<N;j++){
  const pt=L.latLng(b.getSouth()+(i+.5)/N*(b.getNorth()-b.getSouth()),b.getWest()+(j+.5)/N*(b.getEast()-b.getWest()));
  if(!polys.some(q=>inRing(pt,q[0])))continue;
  const t=tractAt(pt);if(t){add(t);hit++;}
 }
 if(!hit){const t=tractAt(ll);if(!t)return null;add(t);}
 return Object.fromEntries(HK.filter(k=>n[k]).map(k=>[k,sum[k]/n[k]]));
}
function hoodCard(p,hist,ll,layer){
 const now=p.ZHVI_2026_08,t=census?hoodStats(layer,ll):null,h=hist?.[p.RegionID];
 return `<h2>${esc(p.Name)}</h2><div class="sub">${esc(title(p.City))} · ${esc(p.County)} County</div><div class="big">${usd(now)}</div><div class="sub">Typical home value (Zillow, Aug 2026)</div>
 <div class="pills"><div class="pill">${change(now,p.ZHVI_2025_08)}<span>Past year</span></div><div class="pill">${change(now,h?.['2021-08-31'])}<span>Past 5 years</span></div></div>${chart(h)}
 ${t?`<details><summary>Census estimates</summary><div class="grid">${stat('Median home value',usd(t.HOMEVAL_ME))}${stat('Median rent',usd(t.RENT_MED))}${stat('Monthly mortgage',usd(t.MORT_COST_))}${stat('Yearly property tax',usd(t.MORT_TAX_M))}${stat('Typical year built',t.YR_BUILT_M?Math.round(t.YR_BUILT_M):'–')}${stat('Household income',usd(t.INC_HH_MED))}</div><div class="sub">Averaged across the census tracts that cover this neighborhood, so treat as approximate.</div></details>`:''}`;
}
const meter=(l,v,o)=>`<div class="stat wide"><div class="key" style="font-size:15px;color:var(--ink)"><span>${l}</span><b>${pct(v)}</b></div><div class="meter"><div class="bar"><i style="width:${v}%"></i></div>${o?`<u style="left:${o}%"></u>`:''}</div>${o?`<div class="key"><span>Oregon average ${pct(o)}</span></div>`:''}</div>`;
function schools(p){
 const rows=[['Reading','English_La','Oregon_ELA'],['Math','Mathematic','Oregon_Mat'],['Science','Science','Oregon_Sci']].filter(([,k])=>+p[k]>0);
 return `<details><summary>Schools</summary>${rows.length?`<div class="grid">${rows.map(([l,k,o])=>meter(l,+p[k],+p[o]||0)).join('')}</div><div class="sub">Test scores show the share of students meeting standards.</div>`:'<div class="sub" style="padding-bottom:8px">No school data for this tract.</div>'}</details>`;
}
function tractCard(p){
 const gk=Object.keys(p).find(k=>/^[A-F][+-]?$/.test(p[k]||'')&&!/FUNC/i.test(k)),own=num(p.OWN_OCC_PC)??0,rent=num(p.RENT_OCC_P)??0;
 const zones=[['Commercial','ZONE_Comme'],['Residential','ZONE_Resid'],['Res. rural','ZONE_Res_R'],['Industrial','ZONE_Indus'],['Parks','ZONE_Park_'],['Farm','ZONE_Farmi'],['Forest','ZONE_Fores']].filter(([,k])=>+p[k]>=1).sort((a,b)=>p[b[1]]-p[a[1]]);
 return `<h2>Census tract ${esc(String(p.GEOID||'').slice(-6))}</h2><div class="sub">${num(p.POP_Total)?.toLocaleString()||'–'} people · median age ${num(p.AGE_MED)??'–'}</div>
 <div class="big">${usd(p.INC_HH_MED)}</div><div class="sub">Median household income</div>
 <div class="grid">${stat('Median home value',usd(p.HOMEVAL_ME))}${stat('Median rent',usd(p.RENT_MED))}${stat('Monthly mortgage',usd(p.MORT_COST_))}${stat('Yearly property tax',usd(p.MORT_TAX_M))}
 ${gk?`<div class="stat wide"><span>Niche grade</span><b>${esc(p[gk])}</b></div>`:''}<div class="stat wide"><span>Own vs. rent</span><div class="bar"><i style="width:${own}%"></i><i style="width:${rent}%"></i></div><div class="key"><span>Own ${pct(own)}</span><span>Rent ${pct(rent)}</span></div></div></div>
 <details><summary>Demographics</summary><div class="grid">${stat('Under 18',pct(p.AGE_U18_PC))}${stat('65 and older',pct(p.AGE_65P_PC))}<div class="stat wide"><span>Bachelor's degree or higher</span><div class="bar"><i style="width:${num(p.EDU_BA_PCT)??0}%"></i></div><div class="key"><span>${pct(p.EDU_BA_PCT)}</span><span>Poverty ${pct(p.INC_POV_PC)}</span></div></div></div></details>
 ${schools(p)}
 ${zones.length?`<details><summary>Land use</summary><div class="grid">${zones.map(([n,k])=>stat(n,pct(p[k]))).join('')}</div></details>`:''}`;
}
const cityCard=p=>{const t=String(p.NAMELSAD||'').replace(p.NAME,'').trim();return `<h2>${esc(p.NAME)}</h2><div class="sub">${t==='CDP'?'Census-designated place':esc(title(t)||'City')}</div>`;};
const placeCard=(t,sub,ll,extra='')=>`<h2>${esc(t)}</h2><div class="sub">${esc(sub)}</div>${extra}${dirs(ll)}`;
const obsColors={Yes:'#0f7b5f',No:'#d64545',Remember:'#e0a100'};

/* Layers */
let hl=null;
function pick(layer,id,html,ll){
 PX.onClose&&PX.onClose();
 if(selected)selected.reset();
 const poly=['neighborhoods','cities','census'].includes(id);
 if(poly){layer.setStyle({weight:3.5,fillOpacity:.28,opacity:1});layer.bringToFront();selected={id,reset:()=>layer.setStyle(styleOf(id))};}
 else{const c=layer.hc||'#0f7b5f';hl=L.circleMarker(ll,{pane:'p-hl',radius:19,color:c,weight:3,fillColor:c,fillOpacity:.2,interactive:false}).addTo(map);selected={id,reset(){if(hl)map.removeLayer(hl);hl=null;}};}
 openSheet(html);
 if(poly){if(mobile.matches)map.panTo(ll,{animate:true});return;}
 const soft=['observations','explore','homes'].includes(id);
 const z=mobile.matches?(soft?14:Math.max(map.getZoom(),15)):Math.max(map.getZoom(),15);
 const shift=mobile.matches?[0,sheet.offsetHeight*(soft?.62:.5)]:[-198,0];
 map.flyTo(map.unproject(map.project(ll,z).add(shift),z),z,{duration:.6});
}
const styleOf=id=>{const c=specs.find(s=>s.id===id).color;return {color:c,weight:id==='cities'?2.4:1.9,opacity:.95,fillColor:c,fillOpacity:.12};};
function build(s,data,hist){
 const pane='p-'+s.id,items=[];let g;
 if(s.g==='a'){
  g=L.geoJSON(data,{pane,style:()=>styleOf(s.id),onEachFeature:(f,l)=>{
   const p=f.properties;
   l.on('click',e=>{L.DomEvent.stopPropagation(e);pick(l,s.id,s.id==='neighborhoods'?hoodCard(p,hist,e.latlng,l):s.id==='census'?tractCard(p):cityCard(p),e.latlng);});
   if(s.id!=='census'){const n=p.Name||p.NAME;l.bindTooltip(n,{permanent:true,direction:'center',className:'nl',interactive:false});items.push({l,n});}
  }});
  if(items.length){g.items=items;g.labels=()=>labels(g);map.on('moveend',()=>map.hasLayer(g)&&labels(g));}
  if(s.id==='census')census=g;
 }else{
  const gj=L.geoJSON(data,{pane,pointToLayer:(f,ll)=>{const c=s.id==='observations'?obsColors[f.properties.Observation_Type]||s.color:s.color;const m=L.marker(ll,{icon:L.divIcon({className:'',html:`<i class="dot" style="background:${c}"></i>`,iconSize:[22,22]})});m.hc=c;return m;},
   onEachFeature:(f,l)=>{const p=f.properties,ll=l.getLatLng();l.on('click',e=>{L.DomEvent.stopPropagation(e);
    let h;
    if(s.id==='grocery')h=placeCard(p.Name,[p.Address,p.City].filter(Boolean).join(', '),ll,p.Notes?`<div class="note">${esc(p.Notes)}</div>`:'');
    else if(s.id==='restaurants')h=placeCard(p.USER_NAME,[p.USER_CATEGORY,p.USER_ADDRESS].filter(Boolean).join(' · '),ll);
    else{const c=obsColors[p.Observation_Type]||s.color;h=placeCard(p.Observation_Type==='Remember'?'Remember this':p.Observation_Type==='Yes'?'Liked this spot':'Not for us',' ',ll,`<span class="badge" style="--c:${c}">${esc(p.Observation_Type)}</span>${p.Notes?`<div class="note">${esc(p.Notes)}</div>`:''}${(p.Photos||[]).length?`<div class="photos">${p.Photos.map(x=>`<img loading="lazy" alt="Photo" src="data/${x.split('/').map(encodeURIComponent).join('/')}">`).join('')}</div>`:''}`);}
    pick(l,s.id,h,ll);});}});
  g=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:45,spiderfyOnMaxZoom:true,iconCreateFunction:c=>{const n=c.getChildCount(),z=n<10?38:n<50?46:54;return L.divIcon({className:'',html:`<div class="cl" style="background:${s.color}">${n}</div>`,iconSize:[z,z]});}});
  g.addLayer(gj);
 }
 groups[s.id]=g;chips[s.id].disabled=false;
}
/* Labels: show only names that fit, without overlapping each other */
const ctx=document.createElement('canvas').getContext('2d');
function labels(g){
 ctx.font='700 12px Figtree,sans-serif';const placed=[];
 g.items.map(({l,n})=>{const b=l.getBounds(),a=map.latLngToContainerPoint(b.getNorthWest()),z=map.latLngToContainerPoint(b.getSouthEast());return {l,n,w:Math.abs(z.x-a.x),h:Math.abs(z.y-a.y),c:map.latLngToContainerPoint(b.getCenter())};})
  .sort((a,b)=>b.w*b.h-a.w*a.h).forEach(o=>{
   const tw=ctx.measureText(o.n).width,r={l:o.c.x-tw/2-3,r:o.c.x+tw/2+3,t:o.c.y-9,b:o.c.y+9};
   const ok=o.w>tw+14&&o.h>26&&!placed.some(q=>r.l<q.r&&r.r>q.l&&r.t<q.b&&r.b>q.t);
   if(ok){placed.push(r);o.l.openTooltip(map.containerPointToLatLng(o.c));}else o.l.closeTooltip();});
}

/* Data */
const load=async f=>{let err;for(const b of ['data/','']){try{const r=await fetch(b+f);if(r.ok)return await r.json();err=`${b+f} returned HTTP ${r.status}`;}catch(e){err=`${b+f}: ${e.message}`;}}throw Error(err);};
const toast=(t,ms=12000)=>{const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),ms);};
const fails=[];let ft;
const fail=(n,e)=>{console.error(n,e);fails.push(n);clearTimeout(ft);ft=setTimeout(()=>toast(location.protocol==='file:'?'Open this through a web server (http://), not by double-clicking the file. Browsers block data loading from local files.':`Couldn't load ${fails.join(', ')}. First error: ${e.message}`),400);};
const searchable=[];
load('metro.geojson').then(d=>{const m=L.geoJSON(d,{interactive:false,style:{color:dark?'#eef3f1':'#13201b',weight:2,dashArray:'6 6',fill:false,opacity:.6}}).addTo(map);map.fitBounds(m.getBounds(),{padding:[30,30]});}).catch(e=>fail('metro boundary',e));
specs.forEach(s=>{
 const req=s.id==='neighborhoods'?Promise.all([load('neighborhoods.geojson'),load('zhvi_history.json').catch(()=>({}))]):load(s.id+'.geojson').then(d=>[d]);
 (s.id==='neighborhoods'?req:req).then(([d,h])=>{
  build(s,d,h);
  d.features.forEach(f=>{const p=f.properties,n=p.Name||p.NAME||p.USER_NAME;if(n&&s.id!=='census'&&s.id!=='observations')searchable.push({n,sub:s.id==='neighborhoods'?title(p.City):s.label,s,f});});
  if(s.id==='neighborhoods')toggle('neighborhoods',true);
 }).catch(e=>fail(s.label,e));
});

/* Search */
let addrRes=[],at;
input.addEventListener('input',()=>{
 const q=input.value.trim(),ql=q.toLowerCase();clearTimeout(at);
 const local=ql.length<2?'':searchable.filter(x=>x.n.toLowerCase().includes(ql)).slice(0,6).map(x=>`<button data-i="${searchable.indexOf(x)}">${esc(x.n)}<small>${esc(x.sub)}</small></button>`).join('');
 results.innerHTML=local?`<h3 class="rh">Neighborhoods &amp; places</h3>${local}`:'';
 if(q.length>=6&&/\d/.test(q)&&PX.onAddr)at=setTimeout(async()=>{
  try{addrRes=await PX.onAddr(q);}catch(e){addrRes=[];}
  if(input.value.trim()!==q||!addrRes.length)return;
  results.insertAdjacentHTML('beforeend',`<h3 class="rh">Addresses</h3>${addrRes.map((a,i)=>`<button data-a="${i}">${esc(a.label)}<small>Save as Home</small></button>`).join('')}`);
 },600);
});
results.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.a!=null){const a=addrRes[+b.dataset.a];results.innerHTML='';input.blur();PX.onAddrPick(a);return;}
 const x=searchable[+b.dataset.i];
 results.innerHTML='';input.value=x.n;input.blur();
 if(!map.hasLayer(groups[x.s.id]))toggle(x.s.id,true);
 let target;groups[x.s.id].eachLayer(l=>{if(l.feature===x.f)target=l;});
 if(!target)return;
 if(target.getBounds){map.fitBounds(target.getBounds(),{padding:[40,40]});target.fire('click',{latlng:target.getBounds().getCenter()});}
 else{map.setView(target.getLatLng(),16);target.fire('click');}
});
map.on('click',()=>{if(!PX.lock)closeSheet();results.innerHTML='';});
map.on('dragstart',()=>{if(!PX.lock)closeSheet();});

/* Location */
let me,halo,watching=false;
$('.locate').onclick=()=>{
 if(!navigator.geolocation)return toast('Location isn’t available on this device');
 const go=p=>{const ll=L.latLng(p.coords.latitude,p.coords.longitude);
  if(!me){halo=L.circle(ll,{radius:p.coords.accuracy,weight:0,fillColor:'#2b7de9',fillOpacity:.14,interactive:false}).addTo(map);me=L.circleMarker(ll,{radius:8,weight:3,color:'#fff',fillColor:'#2b7de9',fillOpacity:1,interactive:false,className:'me'}).addTo(map);}
  else{me.setLatLng(ll);halo.setLatLng(ll).setRadius(p.coords.accuracy);}
  return ll;};
 navigator.geolocation.getCurrentPosition(p=>{map.setView(go(p),15);if(!watching){watching=true;navigator.geolocation.watchPosition(go,()=>{},{enableHighAccuracy:true});}},()=>toast('Allow location access to see where you are'),{enableHighAccuracy:true,timeout:15000});
};
Object.assign(PX,{map,openSheet,closeSheet,pick,toggle,esc,usd,dirs,dark,body,
 toast:t=>toast(t,5000),
 register:(sp,g)=>{specs.push(sp);mkRow(specs.length-1===0?sp:sp,specs.length-1);groups[sp.id]=g;chips[sp.id].disabled=false;},
 pinBtn:$('.pin')});
})();
