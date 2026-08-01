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

            let resolvedBreaks = null;

            if (layerCfg.choropleth) {
                const colors = layerCfg.choropleth.colors || DEFAULT_CHOROPLETH_COLORS;

                // Fixed breaks if given, otherwise fall back to quantiles
                // computed from the loaded data.
                resolvedBreaks = (layerCfg.choropleth.breaks && layerCfg.choropleth.breaks.length)
                    ? layerCfg.choropleth.breaks
                    : computeQuantileBreaks(data.features, layerCfg.choropleth.property, colors.length);
            }

            const layer = buildLayer(data, layerCfg, resolvedBreaks);
            layer.addTo(map);
            loadedLayers[layerCfg.id] = layer;

            if (layerCfg.choropleth) {
                const hasNoData = data.features.some(f => {
                    const v = f.properties[layerCfg.choropleth.property];
                    return typeof v !== 'number' || isNaN(v);
                });

                addChoroplethLegend(map, {
                    colors: layerCfg.choropleth.colors || DEFAULT_CHOROPLETH_COLORS,
                    breaks: resolvedBreaks,
                    format: layerCfg.choropleth.legendFormat || (v => v),
                    title: layerCfg.choropleth.legendTitle,
                    showNoData: hasNoData
                });
            }

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

function buildLayer(data, cfg, resolvedBreaks) {

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
        const choroColors = cfg.choropleth
            ? (cfg.choropleth.colors || DEFAULT_CHOROPLETH_COLORS)
            : null;
        const breaks = resolvedBreaks || [];

        options.style = (feature) => {
            let fillColor;
            let borderColor;

            if (cfg.choropleth) {
                const val = feature.properties[cfg.choropleth.property];
                fillColor = colorForChoropleth(val, breaks, choroColors);
                borderColor = '#555555';
            } else if (cfg.colorBy) {
                fillColor = colorFromPalette(feature.properties[cfg.colorBy], cfg.palette);
                borderColor = fillColor;
            } else {
                fillColor = cfg.color || '#111';
                borderColor = fillColor;
            }

            return {
                color: borderColor,
                weight: cfg.choropleth ? 1 : 1.2,
                opacity: cfg.choropleth ? 0.7 : 0.55,
                fillColor: fillColor,
                fillOpacity: cfg.fillOpacity !== undefined ? cfg.fillOpacity : (cfg.choropleth ? 0.55 : 0.12),
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

/* ---------- Directions link helper ----------
   Deep-links to Google Maps directions for a point. Origin is
   left blank on purpose — Google Maps fills in "your location"
   itself, which is more reliable than anything we could cache. */
function buildDirectionsLink(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    return `<a class="popup-directions" href="${url}" target="_blank" rel="noopener noreferrer">Get Directions &rarr;</a>`;
}

/* ---------- Choropleth helpers ----------
   Classifies polygons into quantile buckets (equal count per
   bucket) rather than equal-width ranges, so a few extreme
   outliers don't wash out the color differences everywhere else. */
const DEFAULT_CHOROPLETH_COLORS = ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'];
const NO_DATA_COLOR = '#e2e2e2';

function computeQuantileBreaks(features, property, numClasses) {
    const values = features
        .map(f => f.properties[property])
        .filter(v => typeof v === 'number' && !isNaN(v))
        .sort((a, b) => a - b);

    if (!values.length) return [];

    const breaks = [];
    for (let i = 1; i < numClasses; i++) {
        const idx = Math.min(Math.floor((values.length * i) / numClasses), values.length - 1);
        breaks.push(values[idx]);
    }
    return breaks;
}

function colorForChoropleth(value, breaks, colors) {
    if (typeof value !== 'number' || isNaN(value)) return NO_DATA_COLOR;

    for (let i = 0; i < breaks.length; i++) {
        if (value <= breaks[i]) return colors[i];
    }
    return colors[colors.length - 1];
}

/* Bottom-left legend showing each choropleth bucket's color and
   range. Built from the same breaks/colors used to style the
   layer, so it always matches what's on screen. */
function addChoroplethLegend(map, options) {
    const { colors, breaks, format, title, showNoData } = options;

    const LegendControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'map-legend');
            let html = '';

            if (title) {
                html += `<div class="map-legend-title">${title}</div>`;
            }

            colors.forEach((color, i) => {
                let label;

                if (i === 0) {
                    label = `Under ${format(breaks[0])}`;
                } else if (i === colors.length - 1) {
                    label = `${format(breaks[breaks.length - 1])}+`;
                } else {
                    label = `${format(breaks[i - 1])} \u2013 ${format(breaks[i])}`;
                }

                html += `<div class="map-legend-row"><span class="map-legend-swatch" style="background:${color}"></span>${label}</div>`;
            });

            if (showNoData) {
                html += `<div class="map-legend-row"><span class="map-legend-swatch" style="background:${NO_DATA_COLOR}"></span>No data</div>`;
            }

            container.innerHTML = html;
            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });

    new LegendControl().addTo(map);
}

/* ---------- Value formatting helpers ---------- */
function formatCurrency(v) {
    if (typeof v !== 'number' || isNaN(v)) return null;
    return `$${Math.round(v).toLocaleString()}`;
}

function formatPercent(v) {
    if (typeof v !== 'number' || isNaN(v)) return null;
    return `${v.toFixed(1)}%`;
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
   { label, value } rows. Empty/missing values are skipped.
   Pass { divider: true } in the rows array to insert a
   separator line between groups of stats. */
function buildPopup(title, rows) {
    const rowsHtml = (rows || [])
        .map(r => {
            if (r.divider) return '<hr class="popup-divider">';
            if (r.value === undefined || r.value === null || r.value === '') return '';
            return `<div class="popup-row"><span class="popup-label">${r.label}</span>${r.value}</div>`;
        })
        .join('');

    return `<div class="popup-card"><div class="popup-title">${title || ''}</div>${rowsHtml}</div>`;
}
