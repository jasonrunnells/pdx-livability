/* Shared pins: Observations (GPS), Explore (press-and-hold), Homes (address search). */
(() => {
'use strict';
const P=window.PX,{map,esc,usd}=P;
const sb=supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co','sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx');
const KINDS={observation:{id:'observations',one:'Observation',label:'Observations',color:'#8e4ec6'},explore:{id:'explore',one:'Explore',label:'Explore',color:'#d99a00'},home:{id:'homes',one:'Home',label:'Homes',color:'#1f9d55'}};
const rows=new Map(),marks=new Map(),groups={};
let user=null,started=false,tmp=null;

/* Layers */
Object.entries(KINDS).forEach(([kind,k])=>{
 const g=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:45,iconCreateFunction:c=>{const n=c.getChildCount(),z=n<10?38:n<50?46:54;return L.divIcon({className:'',html:`<div class="cl" style="background:${k.color}">${n}</div>`,iconSize:[z,z]});}});
 g.labels=()=>{if(!user)start().then(ok=>ok||signIn());};
 groups[kind]=g;P.register({id:k.id,label:k.label,color:k.color,g:'p'},g);
});
const show=kind=>P.toggle(KINDS[kind].id,true);

/* Auth + data */
async function start(){
 const {data:{session}}=await sb.auth.getSession();user=session?.user||null;
 if(!user)return false;
 if(started)return true;started=true;
 if(!user.user_metadata?.name){const n=(prompt('Your first name (shown on the pins you add)')||'').trim();if(n)await sb.auth.updateUser({data:{name:n}});user=(await sb.auth.getUser()).data.user;}
 const {data,error}=await sb.from('places').select('*');
 if(error){P.toast(error.message);started=false;return false;}
 data.forEach(upsert);
 sb.channel('places').on('postgres_changes',{event:'*',schema:'public',table:'places'},p=>p.eventType==='DELETE'?drop(p.old.id):upsert(p.new)).subscribe();
 return true;
}
const withAuth=fn=>user?fn():start().then(ok=>ok?fn():signIn(fn));
function signIn(then){
 P.openSheet(`<h2>Sign in</h2><div class="sub">Sign in to see and add your shared pins.</div><form class="pf"><input name="e" type="email" placeholder="Email" autocomplete="username" required><input name="p" type="password" placeholder="Password" autocomplete="current-password" required><div class="perr"></div><button class="btn">Sign in</button></form>`);
 P.body.onclick=null;const f=P.body.querySelector('form');
 f.onsubmit=async ev=>{ev.preventDefault();const {error}=await sb.auth.signInWithPassword({email:f.e.value,password:f.p.value});
  if(error){P.body.querySelector('.perr').textContent=error.message;return;}
  P.closeSheet();if(await start())then&&then();};
}

/* Markers */
const norm=u=>u?(/^https?:\/\//i.test(u)?u:'https://'+u):null;
const num=v=>{v=String(v??'').replace(/[^\d.]/g,'');return v===''?null:+v;};
function upsert(r){
 drop(r.id,true);rows.set(r.id,r);
 const k=KINDS[r.kind],c=r.kind==='home'?(r.visited?'#d64545':k.color):k.color;
 const m=L.marker([r.lat,r.lng],{icon:L.divIcon({className:'',html:`<i class="dot" style="background:${c}">${r.kind==='home'&&r.visited?'✓':''}</i>`,iconSize:[22,22]})});
 m.hc=c;m.on('click',e=>{L.DomEvent.stopPropagation(e);open(r.id);});
 marks.set(r.id,m);groups[r.kind].addLayer(m);
}
function drop(id,keep){const m=marks.get(id);if(m){Object.values(groups).forEach(g=>g.removeLayer(m));marks.delete(id);}if(!keep)rows.delete(id);}
function open(id){const r=rows.get(id),m=marks.get(id);if(!r||!m)return;P.pick(m,KINDS[r.kind].id,card(r),m.getLatLng());P.body.onclick=e=>act(e,id);}

/* Cards */
function card(r){
 const k=KINDS[r.kind],home=r.kind==='home',t=home?(r.address||r.title||k.one):(r.title||(r.note||'').slice(0,50)||k.one);
 const who=[r.created_by_name,new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})].filter(Boolean).join(' · ');
 const st=home?`<div class="strip">${[r.beds!=null?`${r.beds} bd`:null,r.baths!=null?`${r.baths} ba`:null,r.sqft?`${r.sqft.toLocaleString()} sqft`:null].filter(Boolean).join(' · ')||'No details yet'}</div>`:'';
 return `<h2${home?' class="addr"':''}>${esc(t)}</h2><div class="sub">${k.one}${r.visited&&home?' · Visited':''} · ${esc(who)}</div>
 ${home?`<div class="big">${r.price?usd(r.price):'No price'}</div>${st}`:''}
 ${r.note?`<div class="note">${esc(r.note)}</div>`:''}
 ${(r.photos||[]).length?`<div class="photos">${r.photos.map(u=>`<img loading="lazy" alt="Photo" src="${esc(u)}">`).join('')}</div>`:''}
 <div class="pills two">${[`<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}">Directions</a>`,r.link?`<a class="btn alt" target="_blank" rel="noopener" href="${esc(r.link)}">${home?'Open listing':'Open link'}</a>`:null].filter(Boolean).join('')}</div>
 <div class="acts">${r.kind!=='observation'?`<button data-act="visit">${home?(r.visited?'Undo visited':'Mark visited'):'Mark visited'}</button>`:''}<button data-act="edit">Edit</button><button data-act="del" class="danger">Delete</button></div>`;
}
const stat=(l,v,cls)=>`<div class="stat${cls?' '+cls:''}"><span>${l}</span><b>${esc(v)}</b></div>`;
async function act(e,id){
 const b=e.target.closest('[data-act]');if(!b)return;const r=rows.get(id);
 if(b.dataset.act==='edit')return form({...r});
 if(b.dataset.act==='del'){if(!confirm('Delete this pin?'))return;const {error}=await sb.from('places').delete().eq('id',id);if(error)return P.toast(error.message);drop(id);P.closeSheet();return;}
 const patch=r.kind==='home'?{visited:!r.visited}:{kind:'observation'};
 const {data,error}=await sb.from('places').update(patch).eq('id',id).select().single();if(error)return P.toast(error.message);
 upsert(data);if(r.kind==='home'){P.body.innerHTML=card(data);}else{show('observation');form({...data});}
}

/* Form */
async function shrink(file){
 const img=await createImageBitmap(file,{imageOrientation:'from-image'}),s=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');
 c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
 return new Promise(res=>c.toBlob(res,'image/jpeg',.8));
}
async function upload(file){
 const path=`${crypto.randomUUID()}.jpg`,{error}=await sb.storage.from('photos').upload(path,await shrink(file),{contentType:'image/jpeg'});
 if(error)throw error;return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
function form(o){
 const k=o.kind,H=k==='home',pics=[...(o.photos||[])],files=[];
 const v=(x,n)=>esc(x??'');
 P.openSheet(`<h2>${o.id?'Edit':'New'} ${KINDS[k].one.toLowerCase()}</h2><form class="pf">
  ${H?`<input name="address" placeholder="Address" value="${v(o.address)}">`:`<input name="title" placeholder="${k==='explore'?'Place name':'Title (optional)'}" value="${v(o.title)}">`}
  ${k!=='observation'?`<input name="link" inputmode="url" placeholder="${H?'Listing link':'Link (optional)'}" value="${v(o.link)}">`:''}
  ${H?`<input name="price" inputmode="numeric" placeholder="Price" value="${v(o.price)}"><div class="pr"><input name="beds" inputmode="decimal" placeholder="Beds" value="${v(o.beds)}"><input name="baths" inputmode="decimal" placeholder="Baths" value="${v(o.baths)}"><input name="sqft" inputmode="numeric" placeholder="Sq ft" value="${v(o.sqft)}"></div>`:''}
  <textarea name="note" rows="3" placeholder="Notes">${v(o.note)}</textarea>
  <label class="pph">Add photos<input type="file" accept="image/*" multiple hidden></label><div class="pth"></div>
  <div class="perr"></div><button class="btn" disabled>Save</button></form>`);
 P.lock=true;P.body.onclick=null;
 const f=P.body.querySelector('form'),btn=f.querySelector('.btn'),th=f.querySelector('.pth'),err=f.querySelector('.perr');
 const gv=n=>f.elements[n]?.value.trim()||'';
 const ok=()=>{btn.disabled=!(gv('title')||gv('note')||gv('address')||pics.length||files.length);};
 const thumbs=()=>{th.innerHTML=[...pics.map((u,i)=>`<img data-p="${i}" src="${esc(u)}">`),...files.map((x,i)=>`<img data-f="${i}" src="${URL.createObjectURL(x)}">`)].join('');ok();};
 th.onclick=e=>{const i=e.target;if(i.dataset.p!=null)pics.splice(+i.dataset.p,1);else if(i.dataset.f!=null)files.splice(+i.dataset.f,1);else return;thumbs();};
 f.querySelector('input[type=file]').onchange=e=>{files.push(...e.target.files);e.target.value='';thumbs();};
 f.oninput=ok;thumbs();
 f.onsubmit=async ev=>{
  ev.preventDefault();btn.disabled=true;btn.textContent='Saving…';err.textContent='';
  try{
   const urls=[];for(const x of files)urls.push(await upload(x));
   const val=n=>gv(n)||null;
   const rec={kind:k,lat:o.lat,lng:o.lng,title:val('title'),note:val('note'),address:H?val('address'):null,link:norm(val('link')),price:H?num(gv('price')):null,beds:H?num(gv('beds')):null,baths:H?num(gv('baths')):null,sqft:H?num(gv('sqft')):null,photos:[...pics,...urls]};
   const name=user.user_metadata?.name||null;
   const q=o.id?sb.from('places').update(rec).eq('id',o.id):sb.from('places').insert({...rec,created_by_name:name});
   const {data,error}=await q.select().single();if(error)throw error;
   upsert(data);P.closeSheet();show(k);setTimeout(()=>open(data.id),50);
  }catch(x){err.textContent=x.message||'Could not save. Check your connection.';btn.disabled=false;btn.textContent='Save';}
 };
}
P.onClose=()=>{if(tmp){map.removeLayer(tmp);tmp=null;}};
function newPin(kind,lat,lng,extra){
 P.onClose();const c=KINDS[kind].color,o={kind,lat,lng,...extra};
 tmp=L.marker([lat,lng],{draggable:true,icon:L.divIcon({className:'',html:`<i class="dot tmp" style="background:${c}"></i>`,iconSize:[30,30]})}).addTo(map);
 tmp.on('dragend',()=>{const p=tmp.getLatLng();o.lat=p.lat;o.lng=p.lng;});
 map.flyTo([lat,lng],Math.max(map.getZoom(),16));form(o);
}

/* Ways to add */
P.pinBtn.onclick=()=>withAuth(()=>{
 if(!navigator.geolocation)return P.toast('Location isn’t available on this device');
 P.toast('Finding you…');
 navigator.geolocation.getCurrentPosition(p=>newPin('observation',p.coords.latitude,p.coords.longitude),()=>P.toast('Allow location access to drop an observation here'),{enableHighAccuracy:true,timeout:15000});
});
let last=0;const addExplore=ll=>{if(Date.now()-last<1500)return;last=Date.now();navigator.vibrate?.(30);withAuth(()=>newPin('explore',ll.lat,ll.lng));};
const el=map.getContainer();let lp,sx,sy;
el.addEventListener('pointerdown',e=>{
 if(e.pointerType!=='touch'||e.target.closest('.leaflet-marker-icon'))return;
 sx=e.clientX;sy=e.clientY;clearTimeout(lp);lp=setTimeout(()=>addExplore(map.mouseEventToLatLng(e)),650);
});
['pointerup','pointercancel','pointermove'].forEach(t=>el.addEventListener(t,e=>{if(t!=='pointermove'||Math.hypot(e.clientX-sx,e.clientY-sy)>10)clearTimeout(lp);}));
map.on('contextmenu',e=>addExplore(e.latlng));
el.addEventListener('contextmenu',e=>e.preventDefault());
let hinted=false;map.on('click',()=>{if(!hinted&&user){hinted=true;P.toast('Tip: press and hold anywhere to save a place to explore');}});

/* Address lookup (OpenStreetMap, free) */
P.onAddr=async q=>{
 const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&countrycodes=us&viewbox=-123.6,46.0,-121.6,44.9&q='+encodeURIComponent(q));
 return (await r.json()).map(x=>({label:x.display_name.split(', ').slice(0,4).join(', '),lat:+x.lat,lng:+x.lon}));
};
P.onAddrPick=a=>withAuth(()=>newPin('home',a.lat,a.lng,{address:a.label}));

start();
})();
