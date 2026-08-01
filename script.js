/* ============================================================
   Shared GIS Explorer Map Engine
   Used by every page under /maps/<name>/index.html

   Each map page loads Leaflet + this file, then calls
   initExplorerMap({...}) with a small config describing which
   geojson layers to load and how they should behave.
   ============================================================ */

function initExplorerMap(config) {

    const map = L.map(config.container, {
        zoomControl: false,
        minZoom: 8,
        maxZoom: 19
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    if (config.showUserLocation) {
        const locationApi = enableUserLocation(map);
        addLocateControl(map, locationApi);
    }

    // Minimal light basemap, no labels, so the data layers stay
    // the most prominent thing on screen.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    const loadedLayers = {};
    let combinedBounds = null;

    // Fetch every layer's data first, THEN add layers to the map in
    // config order. Adding layers as each fetch happened to resolve
    // meant z-order depended on network timing, not the config array.
    const dataLoaders = config.layers.map(layerCfg =>
        fetch(layerCfg.url)
            .then(res => res.json())
            .catch(err => {
                console.error(`Failed to load layer "${layerCfg.id}":`, err);
                return null;
            })
    );

    Promise.all(dataLoaders).then(dataList => {
        config.layers.forEach((layerCfg, i) => {
            const data = dataList[i];
            if (!data) return;

            const layer = buildLayer(data, layerCfg);
            layer.addTo(map);
            loadedLayers[layerCfg.id] = layer;

            if (layer.getBounds) {
                const b = layer.getBounds();
                if (b.isValid()) {
                    combinedBounds = combinedBounds ? combinedBounds.extend(b) : b;
                }
            }
        });

        const fitLayer = config.fitBoundsLayer && loadedLayers[config.fitBoundsLayer];

        if (fitLayer && fitLayer.getBounds && fitLayer.getBounds().isValid()) {
            map.fitBounds(fitLayer.getBounds(), { padding: [20, 20] });
        } else if (combinedBounds && combinedBounds.isValid()) {
            map.fitBounds(combinedBounds, { padding: [20, 20] });
        } else {
            map.setView([45.52, -122.67], 11);
        }
    });

    return map;
}

function buildLayer(data, cfg) {

    // "boundary" layers are for context only: no fill, no popup,
    // not clickable/hoverable.
    const isInteractive = cfg.type !== 'boundary';

    const options = { interactive: isInteractive };

    if (cfg.type === 'point') {
        options.pointToLayer = (feature, latlng) => L.circleMarker(latlng, {
            radius: 6,
            weight: 1.5,
            color: '#fff',
            fillColor: cfg.color || '#111',
            fillOpacity: 0.9,
            interactive: isInteractive
        });
    } else if (cfg.type === 'polygon') {
        options.style = (feature) => {
            const color = cfg.colorBy
                ? colorFromPalette(feature.properties[cfg.colorBy], cfg.palette)
                : (cfg.color || '#111');

            return {
                color: color,
                weight: 1.2,
                opacity: 0.55,
                fillColor: color,
                fillOpacity: cfg.fillOpacity !== undefined ? cfg.fillOpacity : 0.12,
                interactive: isInteractive
            };
        };
    } else if (cfg.type === 'boundary') {
        options.style = () => ({
            color: cfg.color || '#111',
            weight: 2,
            dashArray: '4,4',
            fill: false,
            interactive: false
        });
    }

    const layer = L.geoJSON(data, options);

    if (isInteractive && cfg.popup) {
        layer.eachLayer(featureLayer => {
            const props = featureLayer.feature.properties;
            let content = cfg.popup(props);

            if (cfg.directions && typeof featureLayer.getLatLng === 'function') {
                const ll = featureLayer.getLatLng();
                content += buildDirectionsLink(ll.lat, ll.lng);
            }

            if (content) featureLayer.bindPopup(content);
        });
    }

    return layer;
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
            link.innerHTML = '&#9673;';

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

/* ---------- Directions link helper ----------
   Deep-links to Google Maps directions for a point. Origin is
   left blank on purpose — Google Maps fills in "your location"
   itself, which is more reliable than anything we could cache. */
function buildDirectionsLink(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    return `<a class="popup-directions" href="${url}" target="_blank" rel="noopener noreferrer">Get Directions &rarr;</a>`;
}

/* ---------- Color palette helper ----------
   Deterministically maps a value (e.g. a place name) to a color
   from a palette, so each distinct feature gets its own consistent
   color across reloads without needing to hand-assign one. */
const DEFAULT_PALETTE = [
    '#1d3557', '#c1443c', '#2e7d32', '#e07a5f', '#6a4c93',
    '#f4a261', '#4361ee', '#bc6c25', '#7209b7', '#2a9d8f'
];

function colorFromPalette(key, palette) {
    const list = palette || DEFAULT_PALETTE;
    const str = String(key);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return list[hash % list.length];
}

/* ---------- Popup content helper ----------
   Builds a consistent popup card from a title + list of
   { label, value } rows. Empty/missing values are skipped. */
function buildPopup(title, rows) {
    const rowsHtml = (rows || [])
        .filter(r => r.value !== undefined && r.value !== null && r.value !== '')
        .map(r => `<div class="popup-row"><span class="popup-label">${r.label}</span>${r.value}</div>`)
        .join('');

    return `<div class="popup-card"><div class="popup-title">${title || ''}</div>${rowsHtml}</div>`;
}
