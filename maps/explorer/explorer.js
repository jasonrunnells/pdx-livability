/* Portland Explorer: map, labels, location control, and layer behavior. */
(() => {
'use strict';

function initExplorerMap() {
    const map=L.map('map',{zoomControl:false,minZoom:8,maxZoom:19});
    L.control.zoom({position:'bottomright'}).addTo(map);
    const locationApi=enableUserLocation(map);
    addLocateControl(map,locationApi);
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{
        attribution:'Tiles &copy; Esri — Esri, DeLorme, NAVTEQ',
        maxNativeZoom:16,
        maxZoom:19
    }).addTo(map);
    map.setView([45.52,-122.67],11);
    return map;
}

document.addEventListener('DOMContentLoaded', () => {
    const map = initExplorerMap();
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
                onEachFeature:(f,l)=>l.bindPopup(card(f.properties.NAME,''))
            });
            layer.updateLabels=setupAutoLabels(map,layer,{
                labelBy:'NAME',
                labelClass:'explorer-city-label',
                labelFont:'700 12px "Host Grotesk", sans-serif'
            });
            map.on('moveend',()=>{if(map.hasLayer(layer))layer.updateLabels();});
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


/* Neighborhood labels and geolocation controls, previously in the root script. */
const LABEL_FONT = '500 12px "Host Grotesk", sans-serif';
let labelMeasureCtx = null;

function measureTextWidth(text, font=LABEL_FONT) {
    if (!labelMeasureCtx) {
        labelMeasureCtx = document.createElement('canvas').getContext('2d');
    }
    labelMeasureCtx.font = font;
    return labelMeasureCtx.measureText(text).width;
}

function setupAutoLabels(map, geoLayer, cfg) {
    const labelFeatures = [];

    geoLayer.eachLayer(featureLayer => {
        const name = featureLayer.feature.properties[cfg.labelBy];
        if (!name || typeof featureLayer.getBounds !== 'function') return;

        featureLayer.bindTooltip(String(name), {
            permanent: true,
            direction: 'center',
            className: cfg.labelClass || 'neighborhood-label',
            interactive: false
        });

        labelFeatures.push({ layer: featureLayer, name: String(name) });
    });

    function rectsOverlap(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }

    // Real screen positions of every visible point marker (grocery dots,
    // restaurant pins/cluster bubbles) right now, so labels can dodge them
    // instead of just dodging each other.
    function collectMarkerObstacles() {
        const mapRect = map.getContainer().getBoundingClientRect();
        const els = map.getContainer().querySelectorAll('.label-obstacle');
        const rects = [];

        els.forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;
            rects.push({
                left: r.left - mapRect.left,
                right: r.right - mapRect.left,
                top: r.top - mapRect.top,
                bottom: r.bottom - mapRect.top
            });
        });

        return rects;
    }

    // Candidate offsets to try within a polygon's box, as fractions of its
    // half-width/half-height — center first, then out toward each side and
    // corner, so a label prefers the middle but will shift if something's
    // in the way.
    const CANDIDATE_OFFSETS = [
        [0, 0],
        [0, -0.35], [0, 0.35], [-0.3, 0], [0.3, 0],
        [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]
    ];

    function update() {
        if (!map.hasLayer(geoLayer)) return;
        const placedRects = [];
        const markerObstacles = collectMarkerObstacles();

        // Measure every candidate's on-screen box first, then place
        // biggest-polygon-first so small neighborhoods yield space to
        // large ones instead of whoever happens to iterate first.
        const measured = labelFeatures.map(item => {
            const bounds = item.layer.getBounds();
            const nw = map.latLngToContainerPoint(bounds.getNorthWest());
            const se = map.latLngToContainerPoint(bounds.getSouthEast());
            return {
                ...item,
                boxWidth: Math.abs(se.x - nw.x),
                boxHeight: Math.abs(se.y - nw.y),
                center: map.latLngToContainerPoint(bounds.getCenter())
            };
        });

        measured.sort((a, b) => (b.boxWidth * b.boxHeight) - (a.boxWidth * a.boxHeight));

        measured.forEach(item => {
            const textWidth = measureTextWidth(item.name, cfg.labelFont || LABEL_FONT);
            const textHeight = 14;
            const padding = 10;
            const halfW = item.boxWidth / 2;
            const halfH = item.boxHeight / 2;

            const fitsBasicSize = item.boxWidth >= textWidth + padding && item.boxHeight >= textHeight + padding;

            if (!fitsBasicSize) {
                item.layer.closeTooltip();
                return;
            }

            let chosen = null;

            for (const [dx, dy] of CANDIDATE_OFFSETS) {
                const cx = item.center.x + dx * halfW;
                const cy = item.center.y + dy * halfH;

                const rect = {
                    left: cx - textWidth / 2 - 2,
                    right: cx + textWidth / 2 + 2,
                    top: cy - textHeight / 2 - 1,
                    bottom: cy + textHeight / 2 + 1
                };

                // Stay inside the polygon's own box — an offset spot
                // that's technically clear but sticks outside the shape
                // isn't a real fit.
                const withinBox =
                    rect.left >= item.center.x - halfW && rect.right <= item.center.x + halfW &&
                    rect.top >= item.center.y - halfH && rect.bottom <= item.center.y + halfH;

                if (!withinBox) continue;
                if (markerObstacles.some(o => rectsOverlap(rect, o))) continue;
                if (placedRects.some(p => rectsOverlap(rect, p))) continue;

                chosen = { rect, point: L.point(cx, cy) };
                break;
            }

            if (!chosen) {
                item.layer.closeTooltip();
                return;
            }

            placedRects.push(chosen.rect);

            // Pass the chosen position to openTooltip itself. Calling it without
            // a position resets a polygon tooltip to its default center.
            item.layer.openTooltip(map.containerPointToLatLng(chosen.point));
        });
    }

    map.on('zoomend', update);
    return update;
}

/* ---------- User location ----------
   Watches the browser's geolocation and keeps a "you are here"
   dot (with an accuracy halo) in sync on the map. Returns an
   object exposing the last known position for other controls. */
function enableUserLocation(map) {
    if (!navigator.geolocation) {
        return { getLatLng: () => null };
    }

    let marker = null;
    let accuracyCircle = null;
    let lastLatLng = null;

    navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            lastLatLng = L.latLng(latitude, longitude);

            if (!marker) {
                accuracyCircle = L.circle(lastLatLng, {
                    radius: accuracy,
                    weight: 0,
                    fillColor: '#4285F4',
                    fillOpacity: 0.12,
                    interactive: false
                }).addTo(map);

                marker = L.circleMarker(lastLatLng, {
                    radius: 7,
                    weight: 2,
                    color: '#fff',
                    fillColor: '#4285F4',
                    fillOpacity: 1,
                    interactive: false
                }).addTo(map);
            } else {
                marker.setLatLng(lastLatLng);
                accuracyCircle.setLatLng(lastLatLng);
                accuracyCircle.setRadius(accuracy);
            }
        },
        (err) => console.warn('Geolocation unavailable:', err.message),
        { enableHighAccuracy: true, maximumAge: 15000 }
    );

    return { getLatLng: () => lastLatLng };
}

/* Small "center on my location" button, styled to match Leaflet's
   own zoom control so it fits right in above it. */
function addLocateControl(map, locationApi) {
    const LocateControl = L.Control.extend({
        options: { position: 'bottomright' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar locate-control');
            const link = L.DomUtil.create('a', '', container);
            link.href = '#';
            link.title = 'Show my location';
            link.innerHTML = '&#10070;';

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(link, 'click', (e) => {
                L.DomEvent.preventDefault(e);
                const ll = locationApi.getLatLng();

                if (ll) {
                    map.setView(ll, 15);
                } else if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
                        (err) => console.warn('Geolocation unavailable:', err.message)
                    );
                }
            });

            return container;
        }
    });

    new LocateControl().addTo(map);
}

})();
