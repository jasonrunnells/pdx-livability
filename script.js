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
            const content = cfg.popup(props);
            if (content) featureLayer.bindPopup(content);
        });
    }

    return layer;
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
