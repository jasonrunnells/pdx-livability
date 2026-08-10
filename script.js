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

    // Custom panes let a layer's stacking position be set explicitly
    // instead of inheriting Leaflet's fixed pane order (where all
    // marker icons sit above all vector/circle layers regardless of
    // add order). Declare one per layer that needs to draw above or
    // below another layer type via cfg.pane + cfg.paneZIndex.
    config.layers.forEach(layerCfg => {
        if (layerCfg.pane && !map.getPane(layerCfg.pane)) {
            const pane = map.createPane(layerCfg.pane);
            pane.style.zIndex = layerCfg.paneZIndex || 400;
            pane.style.pointerEvents = 'auto';
        }
    });

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
        const labelUpdaters = [];

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

            const geoLayer = buildLayer(data, layerCfg, resolvedBreaks);

            if (layerCfg.toggle) {
    const startsOn = layerCfg.toggle.defaultOn === true;
    setPolygonVisibility(geoLayer, layerCfg, startsOn);
    addLayerToggle(map, geoLayer, layerCfg);
}

            // Clustered point layers: individual markers get grouped into
            // expanding count bubbles at low zoom, and spiderfy out into
            // their real markers as you zoom/click in — keeps a dense
            // point layer (like restaurants) readable at the metro scale.
            let mapLayer = geoLayer;
            if (layerCfg.cluster && typeof L.markerClusterGroup === 'function') {
                mapLayer = L.markerClusterGroup({
                    iconCreateFunction: makeClusterIconFn(layerCfg.color || '#111'),
                    showCoverageOnHover: false,
                    spiderfyOnMaxZoom: true,
                    maxClusterRadius: 50,
                    clusterPane: layerCfg.pane || 'markerPane'
                });
                mapLayer.addLayer(geoLayer);
            }

            mapLayer.addTo(map);
            loadedLayers[layerCfg.id] = mapLayer;

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

            // Auto-fit labels: bind a name label to each polygon, but only
            // let it show once we know whether it actually fits.
            if (layerCfg.type === 'polygon' && layerCfg.labelBy) {
                labelUpdaters.push(setupAutoLabels(map, geoLayer, layerCfg));
            }

            if (mapLayer.getBounds) {
                const b = mapLayer.getBounds();
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

        // Run label placement once now that the map has a real
        // view/zoom (fitBounds/setView above), then again on every
        // zoom change since a polygon's on-screen size — and so
        // whether its label fits — changes with zoom.
        labelUpdaters.forEach(update => update());
    });

    return map;
}

function buildLayer(data, cfg, resolvedBreaks) {

    // "boundary" layers are for context only: no fill, no popup,
    // not clickable/hoverable. Any other layer can also opt out of
    // interactivity via cfg.interactive: false — e.g. a polygon
    // loaded purely to drive label placement (setupAutoLabels) with
    // nothing actually drawn on top of it.
    const isInteractive = cfg.type !== 'boundary' && cfg.interactive !== false;

    const options = { interactive: isInteractive };
    if (cfg.pane) options.pane = cfg.pane;

    if (cfg.type === 'point') {
        options.pointToLayer = (feature, latlng) => {
            const color = resolveColor(feature.properties, cfg);

            if (cfg.shape === 'square') {
                const icon = L.divIcon({
                    className: 'square-marker-icon label-obstacle',
                    html: `<span style="background:${color}"></span>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                    popupAnchor: [0, -8]
                });
                return L.marker(latlng, { icon: icon, interactive: isInteractive, pane: cfg.pane || 'markerPane' });
            }

            return L.circleMarker(latlng, {
                radius: 6,
                weight: 1.5,
                color: '#fff',
                fillColor: color,
                fillOpacity: 0.9,
                interactive: isInteractive,
                pane: cfg.pane || 'overlayPane',
                className: 'label-obstacle'
            });
        };
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
            } else {
                if (cfg.toggle) {
    const neighborhoodColors = [
        '#e63946',
        '#f4a261',
        '#e9c46a',
        '#2a9d8f',
        '#457b9d',
        '#8e7dbe',
        '#e76f9a',
        '#70a288'
    ];

    const neighborhoodName = feature.properties.NAME || '';
    let colorIndex = 0;

    // Creates a consistent color from each neighborhood's name
    for (let i = 0; i < neighborhoodName.length; i++) {
        colorIndex =
            (colorIndex + neighborhoodName.charCodeAt(i)) %
            neighborhoodColors.length;
    }

    fillColor = neighborhoodColors[colorIndex];
    borderColor = '#000000';
} else {
    fillColor = resolveColor(feature.properties, cfg);
    borderColor = fillColor;
}
                if (cfg.toggle) {
    const neighborhoodColors = [
        '#e63946',
        '#f4a261',
        '#e9c46a',
        '#2a9d8f',
        '#457b9d',
        '#8e7dbe',
        '#e76f9a',
        '#70a288'
    ];

    const neighborhoodName = feature.properties.NAME || '';
    let colorIndex = 0;

    // Creates a consistent color from each neighborhood's name
    for (let i = 0; i < neighborhoodName.length; i++) {
        colorIndex =
            (colorIndex + neighborhoodName.charCodeAt(i)) %
            neighborhoodColors.length;
    }

    fillColor = neighborhoodColors[colorIndex];
    borderColor = '#000000';
} else {
    fillColor = resolveColor(feature.properties, cfg);
    borderColor = fillColor;
}
            }

            return {
                color: borderColor,
                // Both fall back to the previous fixed defaults, but
                // can be overridden per layer — e.g. weight: 0 to draw
                // a fully invisible polygon that still exists for
                // label placement to reference.
                weight: cfg.weight !== undefined ? cfg.weight : (cfg.choropleth ? 1 : 1.2),
                opacity: cfg.opacity !== undefined ? cfg.opacity : (cfg.choropleth ? 0.7 : 0.55),
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

/* ---------- Optional polygon toggle ----------
   Keeps a polygon layer on the map so it can continue to drive
   permanent labels while independently showing or hiding its fill
   and border. */
function setPolygonVisibility(layer, cfg, isVisible) {
    layer.setStyle({
        opacity: isVisible
            ? (cfg.opacity !== undefined ? cfg.opacity : 0.55)
            : 0,
        fillOpacity: isVisible
            ? (cfg.fillOpacity !== undefined ? cfg.fillOpacity : 0.12)
            : 0
    });
}

function addLayerToggle(map, layer, cfg) {
    const ToggleControl = L.Control.extend({
        options: {
            position: cfg.toggle.position || 'bottomleft'
        },

        onAdd: function () {
            const container = L.DomUtil.create(
                'div',
                'map-layer-toggle'
            );

            const label = L.DomUtil.create(
                'label',
                'map-layer-toggle-label',
                container
            );

            const checkbox = L.DomUtil.create(
                'input',
                'map-layer-toggle-checkbox',
                label
            );

           
           
           
           
           

            const text = L.DomUtil.create('span', '', label);

            checkbox.type = 'checkbox';
            checkbox.checked = cfg.toggle.defaultOn === true;
            checkbox.setAttribute('aria-label', cfg.toggle.label);

           
           
            text.textContent = cfg.toggle.label;

            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            L.DomEvent.on(checkbox, 'change', () => {
                setPolygonVisibility(
                    layer,
                    cfg,
                    checkbox.checked
                );
            });

            return container;
        }
    });

    new ToggleControl().addTo(map);
}

/* ---------- Cluster icon helper ----------
   Builds the iconCreateFunction for a clustered point layer: a
   solid circle in the layer's color with the cluster's point
   count, sized up a bit as the count grows. Clicking a bubble
   zooms in (Leaflet.markercluster's default behavior); once
   zoomed past maxClusterRadius, bubbles split apart into the
   individual markers underneath. */
function makeClusterIconFn(color) {
    return function (cluster) {
        const count = cluster.getChildCount();

        let size = 36;
        if (count >= 10) size = 42;
        if (count >= 25) size = 50;
        if (count >= 50) size = 58;

        return L.divIcon({
            html: `<div style="background:${color}">${count}</div>`,
            className: 'cluster-marker-icon label-obstacle',
            iconSize: [size, size]
        });
    };
}

/* ---------- Auto-fit neighborhood labels ----------
   Binds a permanent tooltip (the neighborhood name) to every
   feature in a polygon layer, then decides — on every zoom change —
   where and whether each one actually shows:
     1. A label only shows if the polygon's on-screen box is big
        enough to hold the text at all (so tiny slivers at low zoom
        don't get a name crammed into them).
     2. It tries the polygon's center first, then a few offset spots
        toward the edges, and uses whichever one doesn't overlap a
        point marker (grocery/restaurant) or a label that's already
        been placed.
     3. Bigger polygons get first pick of screen space; a label is
        dropped if none of its candidate spots are free.
   Returns an `update()` function the caller re-runs after the map's
   view is set, and again on every zoomend (screen size — and what's
   nearby — changes with zoom). */
const LABEL_FONT = '500 12px "Host Grotesk", sans-serif';
let labelMeasureCtx = null;

function measureTextWidth(text) {
    if (!labelMeasureCtx) {
        labelMeasureCtx = document.createElement('canvas').getContext('2d');
        labelMeasureCtx.font = LABEL_FONT;
    }
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
            className: 'neighborhood-label',
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
            const textWidth = measureTextWidth(item.name);
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

            const tooltip = item.layer.getTooltip();
            if (tooltip) tooltip.setLatLng(map.containerPointToLatLng(chosen.point));

            item.layer.openTooltip();
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

/* Bottom-left legend for categorical point layers — e.g. a
   restaurant marker symbol, then a list of grocery brand colors.
   Call directly with the map returned from initExplorerMap, since
   the categories are usually known ahead of time and don't need
   to wait on the data fetch. Takes a list of sections, each with
   an optional title and { shape, color, label } items. */
function addCategoryLegend(map, sections) {
    const LegendControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'map-legend');
            let html = '';

            sections.forEach(section => {
                if (section.title) {
                    html += `<div class="map-legend-title">${section.title}</div>`;
                }

                section.items.forEach(item => {
                    const shapeClass = item.shape === 'square' ? 'square' : 'circle';
                    html += `<div class="map-legend-row"><span class="map-legend-swatch ${shapeClass}" style="background:${item.color}"></span>${item.label}</div>`;
                });
            });

            container.innerHTML = html;
            L.DomEvent.disableClickPropagation(container);
            return container;
        }
    });

    new LegendControl().addTo(map);
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

/* ---------- Color resolution helper ----------
   Figures out a feature's color from whichever coloring strategy
   the layer config uses:
   - cfg.colorMap: exact { key: color } lookup (predictable, good
     when you need a legend with fixed labels/colors)
   - cfg.colorBy / cfg.colorKey: hashed against a palette (good for
     open-ended sets like place names where you don't want to
     hand-assign every color)
   - cfg.color: flat fallback
   cfg.colorKey(props) can normalize messy source data (typos,
   inconsistent casing) into a clean key before lookup/hashing;
   if omitted, cfg.colorBy is used as a plain property name. */
function resolveColor(props, cfg) {
    const key = cfg.colorKey ? cfg.colorKey(props) : (cfg.colorBy ? props[cfg.colorBy] : null);

    if (cfg.colorMap) {
        return cfg.colorMap[key] || cfg.color || '#111';
    }

    if (key !== null && key !== undefined) {
        return colorFromPalette(key, cfg.palette);
    }

    return cfg.color || '#111';
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
