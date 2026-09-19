/* This map is self-contained. Existing map pages keep using the shared script unchanged. */
document.addEventListener('DOMContentLoaded', () => {
    const map = initExplorerMap({container:'map',showUserLocation:true,layers:[]});
    const specs = [
        {id:'neighborhoods', label:'Neighborhoods', file:'neighborhoods.geojson', pane:410, color:'#59a6a5'},
        {id:'cities', label:'Cities', file:'cities.geojson', pane:420, color:'#5d81b5'},
        {id:'census', label:'Census tracts', file:'census.geojson', pane:430, color:'#cbac91'},
        {id:'grocery', label:'Grocery stores', file:'grocery.geojson', pane:450, color:'#3b8752'},
        {id:'restaurants', label:'Restaurants', file:'restaurants.geojson', pane:460, color:'#b36a36'},
        {id:'observations', label:'Sept 2026 observations', file:'observations.geojson', pane:470, color:'#8a5ba6'}
    ];
    const groups = {};
    const inputs = {};
    const exclusiveAreas = ['neighborhoods', 'cities', 'census'];
    const exclusivePlaces = ['grocery', 'restaurants', 'observations'];
    const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? '$'+Math.round(Number(value)).toLocaleString() : 'No data';
    const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US',{maximumFractionDigits:1}) : 'No data';
    const row = (name,value) => value == null || value === '' ? '' : `<div class="popup-row"><span class="popup-label">${safe(name)}</span>${safe(value)}</div>`;
    const card = (title,contents) => `<div class="popup-card"><div class="popup-title">${safe(title)}</div>${contents}</div>`;
    const fetchJSON = async filename => {const res=await fetch('data/'+filename);if(!res.ok)throw Error(`${filename}: HTTP ${res.status}`);return res.json();};
    const note = document.createElement('div'); note.className='explorer-error'; note.setAttribute('role','status');
    for(const spec of specs){const pane=map.createPane('explorer-'+spec.id);pane.style.zIndex=String(spec.pane);}
    const LayerControl=L.Control.extend({options:{position:'topright'},onAdd(){
        const el=L.DomUtil.create('div','explorer-layers');
        const panelId='explorer-layer-list';
        el.innerHTML=`<button type="button" class="explorer-collapse" aria-expanded="true" aria-controls="${panelId}">Layers <span class="explorer-chevron" aria-hidden="true"></span></button>`+
            `<div class="explorer-panel" id="${panelId}">`+
            specs.map(s=>`<label class="explorer-row${s.id==='grocery'?' explorer-divider':''}" style="--layer-color:${s.color}"><span>${safe(s.label)}</span><input type="checkbox" data-layer="${s.id}" aria-label="Show ${safe(s.label)}" disabled></label>`).join('')+
            '</div>';
        const panel=el.querySelector('.explorer-panel');
        const collapse=el.querySelector('.explorer-collapse');
        panel.appendChild(note);
        const setOpen=open=>{
            panel.hidden=!open;
            el.classList.toggle('is-collapsed',!open);
            collapse.setAttribute('aria-expanded',String(open));
        };
        setOpen(!window.matchMedia('(max-width: 600px)').matches);
        collapse.addEventListener('click',()=>setOpen(panel.hidden));
        el.querySelectorAll('input').forEach(input=>{inputs[input.dataset.layer]=input;input.addEventListener('change',()=>{
            const layer=groups[input.dataset.layer];if(!layer)return;
            if(input.checked){
                const exclusiveGroup=exclusiveAreas.includes(input.dataset.layer)?exclusiveAreas:exclusivePlaces;
                exclusiveGroup.forEach(id=>{
                    if(id!==input.dataset.layer && inputs[id]?.checked){
                        inputs[id].checked=false;
                        if(groups[id])map.removeLayer(groups[id]);
                    }
                });
            }
            if(input.checked)layer.addTo(map);else map.removeLayer(layer);
            if(input.checked && layer.updateLabels)layer.updateLabels();
        });});
        L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el);
        return el;
    }});
    new LayerControl().addTo(map);
    function error(spec,err){console.error('Map layer error',spec.id,err);note.textContent+=`${spec.label} could not load. `;inputs[spec.id].closest('label').title=String(err);}
    function polygonLayer(data,spec,options){return L.geoJSON(data,{...options,pane:'explorer-'+spec.id});}
    function setup(spec,data,history={}){
        let layer;
        if(spec.id==='neighborhoods'){
            layer=polygonLayer(data,spec,{
                style:()=>({color:'#246b70',weight:1,opacity:.8,fillColor:spec.color,fillOpacity:.22}),
                onEachFeature:(f,l)=>{
                    const p=f.properties;
                    const now=p.ZHVI_2026_08,prior=p.ZHVI_2025_08;
                    const fiveYearsAgo=history[String(p.RegionID)]?.['2021-08-31'];
                    const pct=now!=null&&prior?`${((now/prior-1)*100).toFixed(1)}%`:null;
                    const fiveYearChange=now!=null&&fiveYearsAgo?`${((now/fiveYearsAgo-1)*100).toFixed(1)}%`:null;
                    l.bindPopup(card(p.Name,row('City',p.City)+row('Typical Home Value · Aug 2026',money(now))+row('Change since Aug 2025',pct)+row('Change since Aug 2021',fiveYearChange)));
                }
            });
            // Permanent labels belong to the layer; removing it hides the labels too.
            layer.updateLabels=setupAutoLabels(map,layer,{labelBy:'Name'});
            map.on('moveend',()=>{if(map.hasLayer(layer))layer.updateLabels();});
        }else if(spec.id==='cities'){
            layer=polygonLayer(data,spec,{
                style:()=>({color:'#2d486c',weight:1.4,fillColor:spec.color,fillOpacity:.07}),
                onEachFeature:(f,l)=>{l.bindPopup(card(f.properties.NAME,''));
                    l.bindTooltip(String(f.properties.NAME||''),{permanent:true,direction:'center',className:'explorer-city-label',interactive:false});}
            });
        }else if(spec.id==='census'){
            layer=polygonLayer(data,spec,{
                style:()=>({color:'#8b705c',weight:1,opacity:.8,fillColor:spec.color,fillOpacity:.10}),
                onEachFeature:(f,l)=>{const p=f.properties;l.bindPopup(card('Census tract '+String(p.GEOID||'').slice(-6),
                    row('Population',number(p.POP_Total))+row('Age (median)',number(p.AGE_MED))+
                    row('Mortgage Cost',money(p.MORT_COST_))+row('Mortgage Tax',money(p.MORT_TAX_M))+
                    row('Rent',money(p.RENT_MED))+row('Year Built',number(p.YR_BUILT_M))));}
            });
        }else{
            const obsColors={Yes:'#2e7d32',No:'#c1443c',Maybe:'#e9a23b',Remember:'#4361ee'};
            layer=L.geoJSON(data,{
                pane:'explorer-'+spec.id,
                pointToLayer:(f,ll)=>L.circleMarker(ll,{pane:'explorer-'+spec.id,radius:7,color:'#fff',weight:1.5,fillOpacity:.95,fillColor:spec.id==='observations'?(obsColors[f.properties.Observation_Type]||spec.color):spec.color,className:'label-obstacle'}),
                onEachFeature:(f,l)=>{
                    const p=f.properties;
                    if(spec.id==='grocery')l.bindPopup(card(p.Name,row('Category',p.Category)+row('Address',[p.Address,p.City].filter(Boolean).join(', '))+row('Notes',p.Notes)));
                    if(spec.id==='restaurants')l.bindPopup(card(p.USER_NAME,row('Category',p.USER_CATEGORY)+row('Address',[p.USER_ADDRESS,p.USER_CITY].filter(Boolean).join(', '))));
                    if(spec.id==='observations'){
                        const images=(p.Photos||[]).map(path=>{
                            const src='data/'+path.split('/').map(encodeURIComponent).join('/');
                            return `<a href="${src}" target="_blank" rel="noopener noreferrer"><img src="${src}" alt="Observation photo" loading="lazy"></a>`;
                        }).join('');
                        l.bindPopup(card('Observation · '+p.Observation_Type,row('Type',p.Observation_Type)+(p.Notes?`<div class="explorer-notes">${safe(p.Notes)}</div>`:'')+(images?`<div class="explorer-photo-grid">${images}</div>`:'')),{className:'explorer-popup',maxWidth:290});
                    }
                }
            });
        }
        groups[spec.id]=layer;
        inputs[spec.id].disabled=false;
    }
    fetchJSON('metro.geojson').then(data=>{
        const metro=L.geoJSON(data,{interactive:false,style:{color:'#202a2d',weight:2,dashArray:'5,4',fill:false}}).addTo(map);
        if(metro.getBounds().isValid())map.fitBounds(metro.getBounds(),{padding:[30,30]});
    }).catch(err=>{console.error(err);note.textContent+='Metro boundary could not load. ';});
    specs.forEach(spec=>{
        const data=spec.id==='neighborhoods'
            ? Promise.all([fetchJSON(spec.file),fetchJSON('zhvi_history.json').catch(err=>{console.error('Home value history could not load',err);return {};})]).then(([geojson,history])=>setup(spec,geojson,history))
            : fetchJSON(spec.file).then(geojson=>setup(spec,geojson));
        data.catch(err=>error(spec,err));
    });
});
