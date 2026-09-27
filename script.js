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

sb.auth.getSession().then(async({data:{session}})=>{
  if(!session)return;
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

const homeForm=$('#homeForm'),addBtn=$('#addHomeBtn'),addrInput=homeForm['addr-q'],addrResults=$('#addrResults'),thumbsEl=$('#homeThumbs'),saveBtn=$('#saveHome'),homeErr=$('#homeErr');
let picked=null,files=[];
const resetForm=()=>{homeForm.reset();picked=null;files=[];thumbsEl.innerHTML='';addrResults.innerHTML='';saveBtn.disabled=true;homeErr.textContent='';};

addBtn.onclick=()=>{
  if(!gate.hidden){gate.scrollIntoView({behavior:'smooth',block:'start'});return;}
  const show=homeForm.hidden;homeForm.hidden=!show;
  if(show){homeForm.scrollIntoView({behavior:'smooth',block:'start'});addrInput.focus();}
};
$('#cancelHome').onclick=()=>{homeForm.hidden=true;resetForm();};

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
let at;
addrInput.addEventListener('input',()=>{
  picked=null;const q=addrInput.value.trim();clearTimeout(at);addrResults.innerHTML='';
  if(q.length<6)return;
  at=setTimeout(async()=>{
    try{
      const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&viewbox=-123.6,46.0,-121.6,44.9&q='+encodeURIComponent(q));
      const typedNum=(q.match(/^\s*(\d+[a-zA-Z]?)/)||[])[1];
      const res=(await r.json()).map(x=>({label:cleanAddress(x.address,typedNum)||x.display_name.split(', ').slice(0,4).join(', '),lat:+x.lat,lng:+x.lon}));
      if(addrInput.value.trim()!==q)return;
      addrResults.innerHTML=res.map((a,i)=>`<button type="button" data-i="${i}">${esc(a.label)}</button>`).join('');
      addrResults.onclick=e=>{
        const b=e.target.closest('button');if(!b)return;
        picked=res[+b.dataset.i];addrInput.value=picked.label;addrResults.innerHTML='';
        const near=(a,c)=>Math.hypot(a.lat-c.lat,a.lng-c.lng)<0.0003;
        const dup=allRows.find(r=>r.kind==='home'&&((r.address||'').trim().toLowerCase()===picked.label.trim().toLowerCase()||near(r,picked)));
        if(dup){
          const who=[dup.created_by_name,dup.created_at?new Date(dup.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):null].filter(Boolean).join(' on ');
          if(!confirm(`This address may have already been added${who?` by ${who}`:''}.\n\nAdd it again anyway?`)){picked=null;addrInput.value='';}
        }
      };
    }catch(e){}
  },500);
});
addrInput.addEventListener('blur',()=>{setTimeout(()=>{addrResults.innerHTML='';},150);});

const thumbs=()=>{thumbsEl.innerHTML=files.map((x,i)=>`<img data-i="${i}" src="${URL.createObjectURL(x)}">`).join('');saveBtn.disabled=!picked;};
thumbsEl.onclick=e=>{const i=e.target.dataset.i;if(i==null)return;files.splice(+i,1);thumbs();};
homeForm.querySelector('input[type=file]').onchange=e=>{files.push(...e.target.files);e.target.value='';thumbs();};
homeForm.addEventListener('input',()=>{saveBtn.disabled=!picked;});

homeForm.addEventListener('submit', async ev=>{
  ev.preventDefault();
  if(!picked){homeErr.textContent='Pick an address from the list.';return;}
  saveBtn.disabled=true;saveBtn.textContent='Saving…';homeErr.textContent='';
  try{
    const urls=[];for(const f of files)urls.push(await upload(f));
    const f=homeForm;
    const rec={kind:'home',lat:picked.lat,lng:picked.lng,address:picked.label,
      link:norm(f.link.value.trim()||null),price:num(f.price.value),beds:num(f.beds.value),
      baths:num(f.baths.value),sqft:num(f.sqft.value),note:f.note.value.trim()||null,photos:urls};
    const {error}=await sb.from('places').insert({...rec,created_by_name:user.user_metadata?.name||null});
    if(error)throw error;
    homeForm.hidden=true;resetForm();
  }catch(x){homeErr.textContent=x.message||'Could not save. Check your connection.';}
  finally{saveBtn.disabled=false;saveBtn.textContent='Save home';}
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
