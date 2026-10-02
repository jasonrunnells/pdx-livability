/* ==========================================================================
   Portland Explorer — basemap
   Vector tiles (PMTiles) drawn with MapLibre GL.
   Tiles live in ./tiles and are built from the GeoJSON in ./data.
   ========================================================================== */
(() => {
  'use strict';

  /* ---------- Settings ---------- */
  const TILES = {
    base:      new URL('tiles/base.pmtiles', location.href).href,
    buildings: new URL('tiles/buildings.pmtiles', location.href).href,
    lots:      new URL('tiles/lots.pmtiles', location.href).href,
  };
  // Free, no-key elevation tiles (AWS Open Data "Terrain Tiles") used for hillshade.
  const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const GLYPHS = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';
  const FONT = {
    regular:  ['Open Sans Regular'],
    semibold: ['Open Sans Semibold'],
    italic:   ['Open Sans Italic'],
  };

  const START  = { center: [-122.655, 45.515], zoom: 11.3 };
  const METRO  = [[-123.1535, 45.2814], [-122.3315, 45.6574]];  // Metro boundary extent
  const BOUNDS = [[-124.30, 44.30], [-121.20, 46.60]];   // how far you can pan
  const ZOOM   = { min: 8, max: 19.5, buildings: 15 };

  /* ---------- Colors (light = the layer guide) ---------- */
  const PALETTE = {
    light: {
      background: '#E8E0D8',
      lots:       '#E8E0D8',
      lotLine:    '#CAC4BE',
      parks:      '#CEDBAF',
      golf:       '#CFE6CF',
      cemeteries: '#D5DCC2',
      water:      '#C2D4E8',
      waterLine:  '#ACC4E4',
      schools:    '#EDE0B2',
      trail:      '#F1F7E9',
      trailEdge:  '#8DA65B',
      street:     '#FFFFFF',
      streetCase: '#C9C2BA',
      rail:       '#A49D95',
      building:   '#D9CCBE',
      buildingLine: '#D3C7B9',
      metro:      '#333333',
      text:       '#55524F',
      textLot:    '#5C5650',
      textCity:   '#45403B',
      textPark:   '#3F5726',
      textSchool: '#776628',
      halo:       'rgba(255,255,255,0.95)',
      shadow:     'rgba(84,70,56,0.50)',
      highlight:  'rgba(255,255,255,0.40)',
      accent:     'rgba(84,70,56,0.18)',
    },
    dark: {
      background: '#1F2327',
      lots:       '#1F2327',
      lotLine:    '#30353A',
      parks:      '#2C3A25',
      golf:       '#24372B',
      cemeteries: '#283027',
      water:      '#1B3440',
      waterLine:  '#28495A',
      schools:    '#36311F',
      trail:      '#C8D6B3',
      trailEdge:  '#4D6338',
      street:     '#3A3F45',
      streetCase: '#0F1113',
      rail:       '#5C5751',
      building:   '#2C3034',
      buildingLine: '#3A3F44',
      metro:      '#B8BEC5',
      text:       '#D2D6DA',
      textLot:    '#B4BAC0',
      textCity:   '#E4E6E8',
      textPark:   '#A6C487',
      textSchool: '#CBB977',
      halo:       'rgba(22,25,28,0.92)',
      shadow:     'rgba(0,0,0,0.55)',
      highlight:  'rgba(255,255,255,0.07)',
      accent:     'rgba(0,0,0,0.20)',
    },
  };

  /* ---------- Street hierarchy ---------- */
  // Line width (px) for each street class at zoom 8, 10, 13, 16, 19.
  const W = {
    motorway:    [1.2, 2.0, 3.5, 9,   26],
    trunk:       [1.0, 1.6, 3.0, 8,   22],
    primary:     [0,   1.1, 2.6, 7,   20],
    secondary:   [0,   0.7, 2.0, 6,   17],
    tertiary:    [0,   0.4, 1.5, 5,   14],
    ramp:        [0,   0.5, 1.2, 3.5, 10],
    residential: [0,   0,   0.8, 3.5, 11],
    minor:       [0,   0,   0.4, 2,   6],
  };
  const RANK = { motorway: 8, trunk: 7, primary: 6, secondary: 5, tertiary: 4, ramp: 3, residential: 2, minor: 1 };

  // Extra width of the gray outline around each street, at the same zooms.
  const CASE = [1.2, 1.4, 1.6, 2.0, 2.6];

  function widthAt(i, withCase) {
    const m = ['match', ['get', 'class']];
    for (const [k, v] of Object.entries(W)) m.push(k, v[i] > 0 && withCase ? v[i] + CASE[i] : v[i]);
    m.push(0.5);
    return m;
  }
  const zoomed = (withCase) => ['interpolate', ['exponential', 1.6], ['zoom'],
    8, widthAt(0, withCase), 10, widthAt(1, withCase), 13, widthAt(2, withCase), 16, widthAt(3, withCase), 19, widthAt(4, withCase)];
  const streetWidth = zoomed(false);
  const caseWidth   = zoomed(true);
  const streetRank = ['match', ['get', 'class'], ...Object.entries(RANK).flat(), 0];

  /* ---------- Style ---------- */
  function buildStyle(theme) {
    const c = PALETTE[theme];
    const halo = (w) => ({ 'text-halo-color': c.halo, 'text-halo-width': w });

    return {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        base:      { type: 'vector', url: 'pmtiles://' + TILES.base },
        buildings: { type: 'vector', url: 'pmtiles://' + TILES.buildings },
        lots:      { type: 'vector', url: 'pmtiles://' + TILES.lots },
        terrain:   { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, maxzoom: 15, encoding: 'terrarium',
                     attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>' },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': c.background } },

        /* Ground */
        { id: 'lots',       type: 'fill', source: 'base', 'source-layer': 'lots',       paint: { 'fill-color': c.lots } },
        { id: 'lot-lines',  type: 'line', source: 'lots', 'source-layer': 'lots', minzoom: 15,
          paint: {
            'line-color': c.lotLine,
            'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.4, 17, 0.8, 19, 1.2],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.6, 1],
          } },
        { id: 'parks',      type: 'fill', source: 'base', 'source-layer': 'parks',      paint: { 'fill-color': c.parks } },
        { id: 'golf',       type: 'fill', source: 'base', 'source-layer': 'golf',       paint: { 'fill-color': c.golf } },
        /* Hillshade sits on top of the ground layers so their colors pick up the terrain */
        { id: 'hillshade', type: 'hillshade', source: 'terrain',
          paint: {
            'hillshade-illumination-anchor': 'map',
            'hillshade-illumination-direction': 315,
            'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 0.45, 17, 0.3],
            'hillshade-shadow-color': c.shadow,
            'hillshade-highlight-color': c.highlight,
            'hillshade-accent-color': c.accent,
          } },
        /* Cemeteries sit above the hillshade so their guide color (#D5DCC2) shows true */
        { id: 'cemeteries', type: 'fill', source: 'base', 'source-layer': 'cemeteries', paint: { 'fill-color': c.cemeteries } },
        { id: 'water',      type: 'fill', source: 'base', 'source-layer': 'water',      paint: { 'fill-color': c.water } },
        /* Thin darker shoreline, like PortlandMaps */
        { id: 'water-line', type: 'line', source: 'base', 'source-layer': 'water', minzoom: 10,
          paint: {
            'line-color': c.waterLine,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.9, 18, 1.4],
          } },
        { id: 'schools',    type: 'fill', source: 'base', 'source-layer': 'schools',    paint: { 'fill-color': c.schools } },

        /* Trails: dashed green line on a soft light ribbon so they show on any ground */
        { id: 'trails-edge', type: 'line', source: 'base', 'source-layer': 'trails', minzoom: 12,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': c.trail,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.42, 15, 0.72],
            'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 1.3, 14, 2.3, 17, 4.1, 19, 6],
          } },
        { id: 'trails', type: 'line', source: 'base', 'source-layer': 'trails', minzoom: 11,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': c.trailEdge,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.52, 14, 0.92],
            'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.65, 14, 1.1, 17, 1.85, 19, 2.6],
            'line-dasharray': [2.25, 1.7],
          } },

        /* Streets */
        { id: 'rail', type: 'line', source: 'base', 'source-layer': 'streets', minzoom: 12,
          filter: ['==', ['get', 'class'], 'rail'],
          paint: {
            'line-color': c.rail,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1.4, 19, 2.4],
            'line-dasharray': [3, 2],
          } },
        { id: 'streets-case', type: 'line', source: 'base', 'source-layer': 'streets',
          filter: ['!=', ['get', 'class'], 'rail'],
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': streetRank },
          paint: { 'line-color': c.streetCase, 'line-width': caseWidth } },
        { id: 'streets', type: 'line', source: 'base', 'source-layer': 'streets',
          filter: ['!=', ['get', 'class'], 'rail'],
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': streetRank },
          paint: { 'line-color': c.street, 'line-width': streetWidth } },

        /* Buildings (zoomed in only) */
        { id: 'buildings', type: 'fill', source: 'buildings', 'source-layer': 'buildings', minzoom: ZOOM.buildings,
          paint: {
            'fill-color': c.building,
            'fill-outline-color': c.buildingLine,
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM.buildings, 0, ZOOM.buildings + 0.6, 1],
          } },

        /* Metro boundary */
        { id: 'metro', type: 'line', source: 'base', 'source-layer': 'metro',
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': c.metro,
            'line-opacity': 0.75,
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 1.6, 18, 2.4],
            'line-dasharray': [4, 3],
          } },

        /* ---------- Labels ---------- */
        { id: 'label-lots', type: 'symbol', source: 'lots', 'source-layer': 'lotlabels', minzoom: 17,
          layout: {
            'text-field': ['get', 'num'], 'text-font': FONT.regular,
            'text-size': ['interpolate', ['linear'], ['zoom'], 17, 9.5, 19, 11.5],
            'text-padding': 2,
          },
          paint: { 'text-color': c.textLot, 'text-halo-color': c.halo, 'text-halo-width': 1.3, 'text-halo-blur': 0.3 } },
        { id: 'label-trails', type: 'symbol', source: 'base', 'source-layer': 'trails', minzoom: 15,
          filter: ['has', 'name'],
          layout: {
            'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT.italic,
            'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 12],
            'symbol-spacing': 300, 'text-max-angle': 30,
          },
          paint: { 'text-color': c.textPark, ...halo(1.4) } },

        { id: 'label-streets', type: 'symbol', source: 'base', 'source-layer': 'streets', minzoom: 13,
          // More street names appear as you zoom in.
          filter: ['all', ['has', 'name'],
            ['step', ['zoom'],
              ['in', ['get', 'class'], ['literal', ['trunk', 'primary', 'secondary']]],
              14.5, ['in', ['get', 'class'], ['literal', ['trunk', 'primary', 'secondary', 'tertiary']]],
              15.5, ['in', ['get', 'class'], ['literal', ['trunk', 'primary', 'secondary', 'tertiary', 'residential']]],
              16.5, ['!=', ['get', 'class'], 'motorway'],
            ]],
          layout: {
            'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT.semibold,
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 16, 12, 19, 14],
            'symbol-sort-key': ['-', 0, streetRank], 'symbol-spacing': 350, 'text-max-angle': 30,
            'text-padding': 4,
          },
          paint: { 'text-color': c.text, ...halo(1.2) } },

        { id: 'label-schools', type: 'symbol', source: 'base', 'source-layer': 'labels', minzoom: 15,
          filter: ['==', ['get', 'kind'], 'school'],
          layout: {
            'text-field': ['get', 'name'], 'text-font': FONT.semibold, 'text-size': 11,
            'text-max-width': 8, 'text-padding': 6,
          },
          paint: { 'text-color': c.textSchool, ...halo(1.4) } },

        { id: 'label-parks', type: 'symbol', source: 'base', 'source-layer': 'labels', minzoom: 11,
          filter: ['in', ['get', 'kind'], ['literal', ['park', 'golf', 'cemetery']]],
          layout: {
            'text-field': ['get', 'name'], 'text-font': FONT.italic,
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10.5, 15, 12, 18, 13],
            'text-max-width': 8, 'text-padding': 6,
            'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'acres'], 0]],
          },
          paint: { 'text-color': c.textPark, ...halo(1.4) } },

        { id: 'label-cities', type: 'symbol', source: 'base', 'source-layer': 'labels', maxzoom: 13,
          filter: ['==', ['get', 'kind'], 'city'],
          layout: {
            'text-field': ['get', 'name'], 'text-font': FONT.semibold,
            'text-size': ['interpolate', ['linear'], ['zoom'],
              8, 11,
              10, ['case', ['>', ['get', 'rank'], 20000], 15, 12.5],
              12, 14],
            'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8,
            'symbol-sort-key': ['-', 0, ['get', 'rank']], 'text-padding': 10,
          },
          paint: {
            'text-color': c.textCity, ...halo(1.8),
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 1, 13, 0],
          } },
      ],
    };
  }

  /* ---------- Map ---------- */
  const errorBox = document.getElementById('mapError');
  if (!window.maplibregl || !window.pmtiles) { errorBox.hidden = false; return; }

  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const themeNow = () => (darkQuery.matches ? 'dark' : 'light');

  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(themeNow()),
    center: START.center,
    zoom: START.zoom,
    minZoom: ZOOM.min,
    maxZoom: ZOOM.max,
    maxBounds: BOUNDS,
    hash: 'view',                 // keeps your spot if the page reloads
    attributionControl: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 150,
  });
  window.explorerMap = map;       // handy for debugging in the browser console

  // Farthest zoom-out = the whole Metro area plus a small margin, for this screen size.
  function fitMinZoom() {
    const cam = map.cameraForBounds(METRO, { padding: 24 });
    if (cam) map.setMinZoom(Math.max(ZOOM.min, cam.zoom - 0.6));
  }
  fitMinZoom();
  map.on('load', fitMinZoom);
  map.on('resize', fitMinZoom);

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
    fitBoundsOptions: { maxZoom: 16 },
  }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 90 }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: 'Data: Oregon Metro RLIS',
  }), 'bottom-right');

  // Follow the phone/computer light–dark setting, live.
  darkQuery.addEventListener('change', () => map.setStyle(buildStyle(themeNow())));

  // Only show the error banner if tiles keep failing.
  let tileErrors = 0;
  map.on('error', (e) => {
    console.warn('[map]', e && e.error ? e.error.message : e);
    if (e && e.sourceId && ++tileErrors > 8) errorBox.hidden = false;
  });
})();
