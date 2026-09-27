(() => {
'use strict';
const $=(s)=>document.querySelector(s);
const sb=supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co','sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const truncate=(s,max)=>{if(s.length<=max)return s;const cut=s.slice(0,max),sp=cut.lastIndexOf(' ');return (sp>0?cut.slice(0,sp):cut).trim()+'…';};
const usd=v=>v==null?'–':'$'+Math.round(v).toLocaleString();
const KIND={observation:{label:'Observation',letter:'O',color:'#8e4ec6'},explore:{label:'Explore',letter:'E',color:'#d99a00'},home:{label:'Home',letter:'H',color:'#1f9d55'}};
const gate=$('#gate'),authed=$('#authed');
let user=null;

function photoSrc(u){return /^https?:\/\//i.test(u)?u:'maps/explorer/'+u;}
const dateStr=d=>new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});

/* Recent updates: every kind, simple card */
function updateCard(r){
  const k=KIND[r.kind]||{label:r.kind,letter:'?',color:'#888'};
  const t=r.kind==='home'?(r.address||'Home'):(r.title||truncate(r.note||'',44)||k.label);
  const who=[r.created_by_name,dateStr(r.created_at)].filter(Boolean).join(', ');
  const photo=(r.photos||[])[0];
  return `<a class="card" style="--dot:${k.color}" href="maps/explorer/index.html?pin=${r.id}">
    <div class="imgwrap">${photo?`<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">`:`<div class="ph" style="color:${k.color}">${k.letter}</div>`}</div>
    <div class="body">
      <div class="tag"><i></i>${k.label}</div>
      <div class="t">${esc(t)}</div>
      <div class="w">${esc(who)}</div>
    </div>
  </a>`;
}

/* Homes: full listing card */
function homeCard(r){
  const specs=[r.beds!=null?`${r.beds} bd`:null,r.baths!=null?`${r.baths} ba`:null,r.sqft?`${r.sqft.toLocaleString()} sqft`:null].filter(Boolean).join(' · ');
  const photo=(r.photos||[])[0];
  return `<a class="card home-card" style="--dot:${KIND.home.color}" href="maps/explorer/index.html?pin=${r.id}">
    <div class="imgwrap">
      ${photo?`<img loading="lazy" alt="" src="${esc(photoSrc(photo))}">`:`<div class="ph" style="color:${KIND.home.color}">H</div>`}
      ${r.visited?'<div class="check" title="Visited">✓</div>':''}
    </div>
    <div class="body">
      <div class="price">${usd(r.price)}</div>
      <div class="addr">${esc(r.address||'')}</div>
      ${specs?`<div class="specs">${specs}</div>`:''}
    </div>
  </a>`;
}

function render(rows){
  const updates=$('#updatesGrid'),homes=$('#homesGrid');
  updates.innerHTML=rows.length?rows.slice(0,9).map(updateCard).join(''):'<p class="empty">Nothing logged yet.</p>';
  const h=rows.filter(r=>r.kind==='home').slice(0,9);
  homes.innerHTML=h.length?h.map(homeCard).join(''):'<p class="empty">No homes added yet.</p>';
  requestAnimationFrame(()=>navUpdaters.forEach(u=>u()));
}

let allRows=[];
async function loadData(){
  gate.hidden=true;authed.hidden=false;
  const {data,error}=await sb.from('places').select('*').order('created_at',{ascending:false}).limit(60);
  if(error){$('#updatesGrid').innerHTML=`<p class="empty">Couldn't load: ${esc(error.message)}</p>`;return;}
  allRows=data;render(allRows);
  sb.channel('home-feed').on('postgres_changes',{event:'*',schema:'public',table:'places'},p=>{
    if(p.eventType==='DELETE'){allRows=allRows.filter(r=>r.id!==p.old.id);}
    else{allRows=[p.new,...allRows.filter(r=>r.id!==p.new.id)];}
    render(allRows);
  }).subscribe();
}

async function ensureName(){
  if(user.user_metadata?.name)return;
  const n=(prompt('Your first name (shown on what you add)')||'').trim();
  if(n){await sb.auth.updateUser({data:{name:n}});user=(await sb.auth.getUser()).data.user;}
}

/* The sign-in box starts hidden and only appears once we know you're signed out (no flash on load) */
let authChecked=false;
sb.auth.getSession().then(async({data:{session}})=>{
  authChecked=true;
  if(!session){gate.hidden=false;return;}
  user=session.user;await ensureName();loadData();
});
$('#signin').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const f=ev.target,err=$('#signinErr');err.textContent='';
  const {data,error}=await sb.auth.signInWithPassword({email:f.email.value,password:f.password.value});
  if(error){err.textContent=error.message;return;}
  user=data.user;await ensureName();loadData();
});

/* Add a home */
const norm=u=>u?(/^https?:\/\//i.test(u)?u:'https://'+u):null;
const num=v=>{v=String(v??'').replace(/[^\d.]/g,'');return v===''?null:+v;};
async function shrink(file){
  const img=await createImageBitmap(file,{imageOrientation:'from-image'}),s=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');
  c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return new Promise(res=>c.toBlob(res,'image/jpeg',.8));
}
async function upload(file){
  const path=`${crypto.randomUUID()}.jpg`,{error}=await sb.storage.from('photos').upload(path,await shrink(file),{contentType:'image/jpeg'});
  if(error)throw error;return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
}

const homeForm=$('#homeForm'),addBtn=$('#addHomeBtn'),addrInput=homeForm['addr-q'],linkInput=homeForm.link,addrResults=$('#addrResults'),addrHint=$('#addrHint'),thumbsEl=$('#homeThumbs'),saveBtn=$('#saveHome'),homeErr=$('#homeErr');
let picked=null,files=[],sugg=[],autoAddr='';
const setHint=t=>{addrHint.textContent=t||'';};
/* Save is available as soon as there's an address; the map location is looked up on save if needed */
const refresh=()=>{saveBtn.disabled=!addrInput.value.trim();};
const resetForm=()=>{homeForm.reset();picked=null;files=[];sugg=[];autoAddr='';thumbsEl.innerHTML='';addrResults.innerHTML='';setHint('');homeErr.textContent='';refresh();};

addBtn.onclick=()=>{
  if(!user){if(authChecked){gate.hidden=false;gate.scrollIntoView({behavior:'smooth',block:'start'});}return;}
  const show=homeForm.hidden;homeForm.hidden=!show;
  if(show){homeForm.scrollIntoView({behavior:'smooth',block:'start'});linkInput.focus();}
};
$('#cancelHome').onclick=()=>{homeForm.hidden=true;resetForm();};

/* Address lookup (OpenStreetMap, free): build a clean "123 SW Main St, Portland, OR 97225" line */
const DIR_ABBR={North:'N',South:'S',East:'E',West:'W',Northeast:'NE',Northwest:'NW',Southeast:'SE',Southwest:'SW'};
const SUF_ABBR={Street:'St',Avenue:'Ave',Boulevard:'Blvd',Drive:'Dr',Court:'Ct',Lane:'Ln',Place:'Pl',Road:'Rd',Terrace:'Ter',Circle:'Cir',Parkway:'Pkwy',Highway:'Hwy',Trail:'Trl',Square:'Sq'};
const STATE_ABBR={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC'};
function cleanAddress(a,typedNum){
  let road=a.road||'';
  Object.entries(DIR_ABBR).forEach(([k,v])=>{road=road.replace(new RegExp(`\\b${k}\\b`,'g'),v);});
  Object.entries(SUF_ABBR).forEach(([k,v])=>{road=road.replace(new RegExp(`\\b${k}\\b`,'g'),v);});
  const houseNum=a.house_number||typedNum||'';
  const line1=[houseNum,road].filter(Boolean).join(' ');
  const city=a.city||a.town||a.village||a.hamlet||'';
  const state=STATE_ABBR[a.state]||a.state||'';
  const stateZip=[state,a.postcode].filter(Boolean).join(' ');
  const line2=[city,stateZip].filter(Boolean).join(', ');
  return [line1,line2].filter(Boolean).join(', ');
}
async function geocode(q,limit=5){
  const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=${limit}&countrycodes=us&viewbox=-123.6,46.0,-121.6,44.9&q=`+encodeURIComponent(q));
  if(!r.ok)throw Error(`Address lookup failed (${r.status})`);
  const typedNum=(q.match(/^\s*(\d+[a-zA-Z]?)/)||[])[1];
  return (await r.json()).map(x=>({label:cleanAddress(x.address,typedNum)||x.display_name.split(', ').slice(0,4).join(', '),lat:+x.lat,lng:+x.lon}));
}
/* Find a map location for any typed address: as typed, then without a unit number, then just the street
   (OpenStreetMap is missing some house numbers, especially newer homes) */
async function locate(q){
  const tries=[q,q.replace(/\s*(#\s*[\w-]+|\b(apt|unit|ste|suite)\b\.?\s*[\w-]+)/i,''),q.replace(/^\s*\d+[a-zA-Z]?\s+/,'')].map(s=>s.trim()).filter(Boolean);
  for(const t of [...new Set(tries)]){const r=await geocode(t,1);if(r.length)return r[0];}
  return null;
}

/* Zillow links carry the address: zillow.com/homedetails/1234-SE-Main-St-Portland-OR-97214/12345_zpid/ */
const STREET_END=/^(st|street|ave|av|avenue|blvd|boulevard|dr|drive|ct|court|ln|lane|pl|place|rd|road|ter|terrace|cir|circle|pkwy|parkway|hwy|highway|way|loop|trl|trail|sq|square|xing|row|walk|path|pt|point|vw|view|run|aly|alley|plz|plaza)$/i;
const TWO_WORD_CITY=new Set(['lake oswego','west linn','happy valley','oregon city','forest grove','battle ground','king city','wood village','north plains']);
function zillowAddress(url){
  const m=url.match(/zillow\.com\/homedetails\/([^/?#]+)/i)||url.match(/zillow\.com\/homes\/([^/?#]+?)_rb/i);
  if(!m)return null;
  let slug;try{slug=decodeURIComponent(m[1]);}catch(e){slug=m[1];}
  const t=slug.replace(/[,+]/g,'-').split('-').filter(Boolean);
  if(t.length<3||!/^\d/.test(t[0]))return null;
  let zip='',st='';
  if(/^\d{5}$/.test(t.at(-1)))zip=t.pop();
  if(/^[A-Za-z]{2}$/.test(t.at(-1)||''))st=t.pop().toUpperCase();
  let i=-1;t.forEach((w,j)=>{if(j>1&&STREET_END.test(w))i=j;});
  let street=t.join(' '),city='';
  if(i>0){
    let e=i+1;
    if(/^#./.test(t[e]||''))e+=1;
    else if(/^(apt|unit|ste|suite|#)$/i.test(t[e]||''))e+=2;
    street=t.slice(0,e).join(' ');city=t.slice(e).join(' ');
  }else if(t.length>3){ /* no suffix (e.g. "SW Broadway"): city is the last word, or last two for known two-word cities */
    const two=t.slice(-2).join(' ').toLowerCase(),n=TWO_WORD_CITY.has(two)?2:1;
    street=t.slice(0,-n).join(' ');city=t.slice(-n).join(' ');
  }
  return [street,[city,[st,zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}
linkInput.addEventListener('input',async()=>{
  const a=zillowAddress(linkInput.value.trim()),cur=addrInput.value.trim();
  if(!a||(cur&&cur!==autoAddr))return;  /* never overwrite an address you typed yourself */
  addrInput.value=autoAddr=a;picked=null;addrResults.innerHTML='';refresh();
  setHint('Address filled in from the Zillow link. Finding it on the map…');
  try{
    const loc=await locate(a);
    if(addrInput.value.trim()!==a)return;
    if(loc){picked={label:a,lat:loc.lat,lng:loc.lng};setHint('Address filled in from the Zillow link.');}
    else setHint("Address filled in from the Zillow link, but it couldn't be found on the map. Check it before saving.");
  }catch(e){setHint('Address filled in from the Zillow link.');}
});

/* Duplicate check */
const near=(a,c)=>Math.hypot(a.lat-c.lat,a.lng-c.lng)<0.0003;
function dupOK(a){
  const dup=allRows.find(r=>r.kind==='home'&&((r.address||'').trim().toLowerCase()===a.label.trim().toLowerCase()||near(r,a)));
  if(!dup)return true;
  const who=[dup.created_by_name,dup.created_at?new Date(dup.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):null].filter(Boolean).join(' on ');
  return confirm(`This address may have already been added${who?` by ${who}`:''}.\n\nAdd it again anyway?`);
}

/* Suggestions while typing */
let at;
addrInput.addEventListener('input',()=>{
  picked=null;autoAddr='';setHint('');const q=addrInput.value.trim();clearTimeout(at);addrResults.innerHTML='';
  if(q.length<6)return;
  at=setTimeout(async()=>{
    let res;try{res=await geocode(q);}catch(e){return;}
    if(addrInput.value.trim()!==q||document.activeElement!==addrInput)return;
    sugg=res;
    addrResults.innerHTML=res.length?res.map((a,i)=>`<button type="button" data-i="${i}">${esc(a.label)}</button>`).join('')
      :'<p class="none">No suggestions. You can still save; the location is looked up when you save.</p>';
  },500);
});
addrResults.addEventListener('pointerdown',e=>e.preventDefault()); /* keep focus so a tap isn't lost to the blur below */
addrResults.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const a=sugg[+b.dataset.i];addrResults.innerHTML='';
  if(!dupOK(a)){addrInput.value='';picked=null;refresh();return;}
  picked={...a,checked:true};addrInput.value=a.label;refresh();
});
addrInput.addEventListener('blur',()=>{setTimeout(()=>{addrResults.innerHTML='';},200);});

const thumbs=()=>{thumbsEl.innerHTML=files.map((x,i)=>`<img data-i="${i}" src="${URL.createObjectURL(x)}">`).join('');refresh();};
thumbsEl.onclick=e=>{const i=e.target.dataset.i;if(i==null)return;files.splice(+i,1);thumbs();};
homeForm.querySelector('input[type=file]').onchange=e=>{files.push(...e.target.files);e.target.value='';thumbs();};
homeForm.addEventListener('input',refresh);

homeForm.addEventListener('submit', async ev=>{
  ev.preventDefault();
  const q=addrInput.value.trim();
  if(!q){homeErr.textContent='Enter an address or paste a Zillow link.';return;}
  saveBtn.disabled=true;homeErr.textContent='';
  try{
    let a=picked&&picked.label===q?picked:null;
    if(!a){
      saveBtn.textContent='Finding address…';
      const loc=await locate(q);
      if(!loc)throw Error("Couldn't find that address on the map. Check the spelling, or pick one of the suggestions.");
      a={label:q,lat:loc.lat,lng:loc.lng};
    }
    if(!a.checked&&!dupOK(a))return;
    saveBtn.textContent='Saving…';
    const urls=[];for(const f of files)urls.push(await upload(f));
    const f=homeForm;
    const rec={kind:'home',lat:a.lat,lng:a.lng,address:a.label,
      link:norm(f.link.value.trim()||null),price:num(f.price.value),beds:num(f.beds.value),
      baths:num(f.baths.value),sqft:num(f.sqft.value),note:f.note.value.trim()||null,photos:urls};
    const {error}=await sb.from('places').insert({...rec,created_by_name:user.user_metadata?.name||null});
    if(error)throw error;
    homeForm.hidden=true;resetForm();
  }catch(x){homeErr.textContent=x.message||'Could not save. Check your connection.';}
  finally{saveBtn.textContent='Save home';refresh();}
});

/* Row arrows: scroll one card-width per click, disable at the ends */
const navUpdaters=[];
document.querySelectorAll('.nav').forEach(nav=>{
  const row=document.getElementById(nav.dataset.for),prev=nav.querySelector('.prev'),next=nav.querySelector('.next');
  const step=()=>(row.querySelector('.card')?.getBoundingClientRect().width||228)+16;
  const update=()=>{prev.disabled=row.scrollLeft<=2;next.disabled=row.scrollLeft>=row.scrollWidth-row.clientWidth-2;};
  prev.onclick=()=>row.scrollBy({left:-step(),behavior:'smooth'});
  next.onclick=()=>row.scrollBy({left:step(),behavior:'smooth'});
  row.addEventListener('scroll',update);
  navUpdaters.push(update);
  update();
});
addEventListener('resize',()=>navUpdaters.forEach(u=>u()));
})();
