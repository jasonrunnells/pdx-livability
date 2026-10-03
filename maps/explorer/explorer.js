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
      trail:      '#F1F7E8',
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
      textHosp:   '#1F5FAD',
      textFire:   '#B02525',
      halo:       'rgba(255,255,255,0.95)',
      sel:        '#2563EB',   // selected lot outline
      hood:       '#7C5CFA',   // neighborhoods
      tract:      '#0E9CD8',   // census tracts
      city:       '#C2389B',   // city limits
      sas:        '#0FA89A',   // school attendance areas
      pSchool:    '#2B5CE6',   // school points
      pGrocery:   '#148A3C',   // grocery store points
      pFood:      '#8338EC',   // restaurant points
      pHome:      '#E0234E',   // saved homes
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
      textHosp:   '#8DB8F0',
      textFire:   '#F08C8C',
      halo:       'rgba(22,25,28,0.92)',
      sel:        '#60A5FA',
      hood:       '#A792FF',
      tract:      '#4CC3F5',
      city:       '#F07BC8',
      sas:        '#3FD1C1',
      pSchool:    '#6E93FF',
      pGrocery:   '#37C26A',
      pFood:      '#A974FF',
      pHome:      '#FF5C7F',
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

  /* ---------- Shared data (Supabase) ---------- */
  // Same project and key as the home page; the sign-in made there carries over to the map.
  const sb = window.supabase
    ? window.supabase.createClient('https://qstztxydqhuahgivpztx.supabase.co', 'sb_publishable_5MfonGtWBM7R3rgYtEDdkg_TnUOeWJx')
    : null;
  let homesData = null;
  const homesRows = new Map();   // full rows by id, for the home card
  const homeFeature = (r) => ({ type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: { id: r.id, address: r.address || r.title || 'Home', price: r.price, visited: !!r.visited } });
  async function loadHomes() {
    if (!sb) throw new Error('Could not reach the shared database.');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Sign in on the home page to see your saved homes.');
    const { data, error } = await sb.from('places').select('*').eq('kind', 'home');
    if (error) throw error;
    homesRows.clear(); for (const r of data) homesRows.set(r.id, r);
    homesData = { type: 'FeatureCollection', features: data.filter((r) => r.lat != null && r.lng != null).map(homeFeature) };
    return homesData;
  }

  /* ---------- Boundary overlays (toggle on/off) ---------- */
  // Each file loads only the first time you switch it on.
  const OVERLAYS = [
    { key: 'hoods',  name: 'Neighborhoods', desc: 'Home values & your ratings',           color: 'hood',  file: 'data/neighborhoods.geojson' },
    { key: 'tracts', name: 'Census tracts', desc: 'Income, rent & who lives there',           color: 'tract', file: 'data/census.geojson' },
    { key: 'cities', name: 'Cities', desc: 'City limits',                  color: 'city',  file: 'data/cities.geojson' },
    { key: 'sas',    name: 'School attendance areas', desc: 'Assigned schools & grades', color: 'sas',   file: 'data/schoolAttendanceAreas.geojson' },
    // Places (points). Restaurants use a copy of the older file (it has names; the current one only has IDs).
    // It can't load from data/_OLD: GitHub Pages skips folders that start with an underscore.
    { key: 'pSchools', group: 'places', name: 'Schools', desc: 'Grades & test scores',         color: 'pSchool',  file: 'data/schools.geojson',          label: 'Label_Name' },
    { key: 'pGrocery', group: 'places', name: 'Grocery stores', desc: 'Where to shop',  color: 'pGrocery', file: 'data/groceryStores.geojson',    label: 'Name' },
    { key: 'pFood',    group: 'places', name: 'Restaurants', desc: 'Saved restaurants',     color: 'pFood',    file: 'data/restaurants_named.geojson', label: 'USER_NAME' },
    // Homes saved from the home page (Supabase "places" table, kind = home)
    { key: 'pHomes',   group: 'places', name: 'Homes', desc: 'Your saved homes',           color: 'pHome',    load: loadHomes,                       label: 'address' },
  ];
  for (const o of OVERLAYS) o.group = o.group || 'bounds';
  const GROUPS = [{ id: 'bounds', title: 'Boundaries' }, { id: 'places', title: 'Places' }];
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const BFILL = 0.12;   // boundary fill opacity (0 = clear, 1 = solid)
  const SAS_ES = 'SchoolAttendanceAreas_Clipped.Grade_1_Choice1_Name';
  const overlayOn = {}, overlayLoaded = {};
  // Every layer starts off; nothing loads until you switch it on.

  function overlaySources() {
    const out = {};
    for (const o of OVERLAYS) {
      if (overlayOn[o.key] && o.file) overlayLoaded[o.key] = true;
      const data = o.load ? (homesData || EMPTY) : (overlayLoaded[o.key] ? o.file : EMPTY);
      out['ov-' + o.key] = o.group === 'places'
        ? { type: 'geojson', data, cluster: true, clusterRadius: 42, clusterMaxZoom: 15, ...(o.load ? { promoteId: 'id' } : { generateId: true }) }
        : { type: 'geojson', data, generateId: true };
    }
    return out;
  }

  // Layers for each overlay, split into fills (under streets), lines and labels (on top).
  function overlayLayers(c, halo) {
    const vis = (k) => ({ visibility: overlayOn[k] ? 'visible' : 'none' });
    const L = { fills: [], lines: [], labels: [] };

    // Neighborhoods: solid purple outline, faint tint, italic names
    L.fills.push({ id: 'hoods-fill', type: 'fill', source: 'ov-hoods', layout: vis('hoods'),
      paint: { 'fill-color': c.hood, 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.3, BFILL] } });
    L.lines.push({ id: 'hoods-line', type: 'line', source: 'ov-hoods', layout: { ...vis('hoods'), 'line-join': 'round' },
      paint: { 'line-color': c.hood, 'line-opacity': 0.85,
               'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['feature-state', 'sel'], false], 2.6, 1], 14, ['case', ['boolean', ['feature-state', 'sel'], false], 3.4, 1.8], 18, ['case', ['boolean', ['feature-state', 'sel'], false], 4.2, 2.6]] } });
    L.labels.push({ id: 'hoods-label', type: 'symbol', source: 'ov-hoods', minzoom: 11.5,
      layout: { ...vis('hoods'), 'text-field': ['get', 'Name'], 'text-font': FONT.italic,
                'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 11, 15, 13.5],
                'text-max-width': 7, 'text-padding': 8, 'text-letter-spacing': 0.03 },
      paint: { 'text-color': c.hood, ...halo(1.6) } });

    // Census tracts: thin blue line + tint (no names; tract numbers aren't useful on the map)
    L.fills.push({ id: 'tracts-fill', type: 'fill', source: 'ov-tracts', layout: vis('tracts'),
      paint: { 'fill-color': c.tract, 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.3, BFILL] } });
    L.lines.push({ id: 'tracts-line', type: 'line', source: 'ov-tracts', layout: { ...vis('tracts'), 'line-join': 'round' },
      paint: { 'line-color': c.tract, 'line-opacity': 0.9,
               'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['feature-state', 'sel'], false], 2.4, 0.8], 14, ['case', ['boolean', ['feature-state', 'sel'], false], 2.9, 1.3], 18, ['case', ['boolean', ['feature-state', 'sel'], false], 3.6, 2]] } });

    // Cities: rust line + tint
    L.fills.push({ id: 'cities-fill', type: 'fill', source: 'ov-cities', layout: vis('cities'),
      paint: { 'fill-color': c.city, 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.3, BFILL] } });
    L.lines.push({ id: 'cities-line', type: 'line', source: 'ov-cities', layout: { ...vis('cities'), 'line-join': 'round' },
      paint: { 'line-color': c.city, 'line-opacity': 0.9,
               'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['boolean', ['feature-state', 'sel'], false], 2.8, 1.2], 14, ['case', ['boolean', ['feature-state', 'sel'], false], 3.8, 2.2], 18, ['case', ['boolean', ['feature-state', 'sel'], false], 4.6, 3]] } });
    L.labels.push({ id: 'cities-label', type: 'symbol', source: 'ov-cities', minzoom: 12,
      layout: { ...vis('cities'), 'text-field': ['get', 'NAME'], 'text-font': FONT.semibold,
                'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
                'symbol-placement': 'line', 'symbol-spacing': 600, 'text-max-angle': 25, 'text-offset': [0, -0.9] },
      paint: { 'text-color': c.city, ...halo(1.6) } });

    // School attendance areas: teal line + tint, elementary school name inside
    L.fills.push({ id: 'sas-fill', type: 'fill', source: 'ov-sas', layout: vis('sas'),
      paint: { 'fill-color': c.sas, 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.3, BFILL] } });
    L.lines.push({ id: 'sas-line', type: 'line', source: 'ov-sas', layout: { ...vis('sas'), 'line-join': 'round' },
      paint: { 'line-color': c.sas, 'line-opacity': 0.9,
               'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['boolean', ['feature-state', 'sel'], false], 2.6, 1], 14, ['case', ['boolean', ['feature-state', 'sel'], false], 3.4, 1.8], 18, ['case', ['boolean', ['feature-state', 'sel'], false], 4.2, 2.6]] } });
    L.labels.push({ id: 'sas-label', type: 'symbol', source: 'ov-sas', minzoom: 12.5,
      layout: { ...vis('sas'), 'text-field': ['get', SAS_ES], 'text-font': FONT.semibold,
                'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10.5, 16, 12.5],
                'text-max-width': 8, 'text-padding': 8 },
      paint: { 'text-color': c.sas, ...halo(1.6) } });
    // Places: colored dots with a white ring; names appear when zoomed in
    L.points = [];
    for (const o of OVERLAYS.filter((x) => x.group === 'places')) {
      // Clusters: a bigger dot with a count, sized by how many places it holds
      L.points.push({ id: o.key + '-pick', type: 'circle', source: 'ov-' + o.key, filter: ['==', ['id'], '__none__'], layout: vis(o.key),
        paint: { 'circle-color': c[o.color], 'circle-opacity': 0.25, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 17, 16, 26],
                 'circle-stroke-color': c[o.color], 'circle-stroke-width': 2 } });
      L.points.push({ id: o.key + '-cluster', type: 'circle', source: 'ov-' + o.key, filter: ['has', 'point_count'], layout: vis(o.key),
        paint: { 'circle-color': c[o.color], 'circle-opacity': 0.92,
                 'circle-radius': ['step', ['get', 'point_count'], 14, 10, 17, 50, 21],
                 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3 } });
      L.points.push({ id: o.key + '-count', type: 'symbol', source: 'ov-' + o.key, filter: ['has', 'point_count'],
        layout: { ...vis(o.key), 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Bold'],
                  'text-size': 14, 'text-allow-overlap': true, 'text-ignore-placement': true },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': 'rgba(0,0,0,0.28)', 'text-halo-width': 0.8 } });
      L.points.push({ id: o.key + '-dot', type: 'symbol', source: 'ov-' + o.key, filter: ['!', ['has', 'point_count']],
        layout: { ...vis(o.key), 'icon-image': `pt-${o.key}-${c === PALETTE.dark ? 'dark' : 'light'}`,
                  'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 13, 0.9, 16, 1],
                  'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      L.labels.push({ id: o.key + '-label', type: 'symbol', source: 'ov-' + o.key, minzoom: 13.5, filter: ['!', ['has', 'point_count']],
        layout: { ...vis(o.key), 'text-field': ['get', o.label], 'text-font': FONT.semibold,
                  'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 17, 12.5],
                  'text-anchor': 'left', 'text-offset': [1.75, 0], 'text-max-width': 9, 'text-padding': 3,
                  'text-optional': true },
        paint: { 'text-color': c[o.color], ...halo(1.6) } });
    }
    return L;
  }
  const overlayIds = (key) => (key.startsWith('p') ? [key + '-cluster', key + '-count', key + '-dot', key + '-label', key + '-pick'] : null) || ({
    hoods: ['hoods-fill', 'hoods-line', 'hoods-label'],
    tracts: ['tracts-fill', 'tracts-line'],
    cities: ['cities-fill', 'cities-line', 'cities-label'],
    sas: ['sas-fill', 'sas-line', 'sas-label'],
  })[key];

  /* ---------- Style ---------- */
  function buildStyle(theme) {
    const c = PALETTE[theme];
    const halo = (w) => ({ 'text-halo-color': c.halo, 'text-halo-width': w });
    const ov = overlayLayers(c, halo);

    return {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        base:      { type: 'vector', url: 'pmtiles://' + TILES.base },
        buildings: { type: 'vector', url: 'pmtiles://' + TILES.buildings },
        lots:      { type: 'vector', url: 'pmtiles://' + TILES.lots },
        terrain:   { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, maxzoom: 15, encoding: 'terrarium',
                     attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>' },
        ...overlaySources(),
        hospitals: { type: 'geojson', data: 'data/hospitals.geojson' },
        fire:      { type: 'geojson', data: 'data/fireStations.geojson' },
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
        // Invisible tap target for lots, plus the selected-lot outline
        { id: 'lots-hit', type: 'fill', source: 'lots', 'source-layer': 'lots', minzoom: 15, paint: { 'fill-color': '#000', 'fill-opacity': 0.003 } },
        { id: 'lot-sel-fill', type: 'fill', source: 'lots', 'source-layer': 'lots', minzoom: 15, filter: ['==', ['get', 'addr'], '__none__'],
          paint: { 'fill-color': c.sel, 'fill-opacity': 0.12 } },
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

        ...ov.fills,

        /* Trails: fine light dashes (guide color #F1F7E8) */
        { id: 'trails', type: 'line', source: 'base', 'source-layer': 'trails', minzoom: 11,
          layout: { 'line-cap': 'butt', 'line-join': 'round' },
          paint: {
            'line-color': c.trail,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 14, 1],
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

        { id: 'lot-sel', type: 'line', source: 'lots', 'source-layer': 'lots', minzoom: 15, filter: ['==', ['get', 'addr'], '__none__'],
          layout: { 'line-join': 'round' },
          paint: { 'line-color': c.sel, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2, 19, 3.5] } },

        /* Boundary overlays */
        ...ov.lines,
        ...ov.points,

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

        /* Hospitals and fire stations (basemap symbols, not clickable) */
        { id: 'hospitals', type: 'symbol', source: 'hospitals', minzoom: 12,
          layout: {
            'icon-image': 'sym-hospital', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1],
            'icon-allow-overlap': true, 'symbol-sort-key': 0,
            'text-field': ['step', ['zoom'], '', 13, ['get', 'NAME']], 'text-font': FONT.semibold,
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10.5, 17, 12.5],
            'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-max-width': 8, 'text-optional': true,
          },
          paint: { 'text-color': c.textHosp, ...halo(1.6) } },
        { id: 'fire-stations', type: 'symbol', source: 'fire', minzoom: 14,
          layout: {
            'icon-image': 'sym-fire', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 17, 0.95],
            'symbol-sort-key': 1,
            'text-field': ['step', ['zoom'], '', 15.5, 'Fire Station'], 'text-font': FONT.semibold,
            'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10.5, 18, 12],
            'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-optional': true,
          },
          paint: { 'text-color': c.textFire, ...halo(1.6) } },

        ...ov.labels,

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
    bounds: METRO,                // always open on the whole Metro area
    fitBoundsOptions: { padding: 24 },
    minZoom: ZOOM.min,
    maxZoom: ZOOM.max,
    maxBounds: BOUNDS,
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
  // Keep the credits folded into the small "i" button.
  const foldCredits = () => document.querySelectorAll('.maplibregl-ctrl-attrib').forEach((el) => { el.classList.remove('maplibregl-compact-show'); el.removeAttribute('open'); });
  map.on('load', foldCredits); map.once('idle', foldCredits);

  // Place markers: colored disc, white ring, soft shadow, white glyph
  const GLYPH = {
    pHomes:   { fill: 'M12 4.2 3.6 11.3h2.6V19h4.4v-4.6h2.8V19h4.4v-7.7h2.6Z' },
    pSchools: { fill: 'M12 5 2.5 9.8 12 14.6l9.5-4.8ZM6.4 12.6v3.6c0 1.6 2.6 3.2 5.6 3.2s5.6-1.6 5.6-3.2v-3.6L12 15.4Z' },
    pGrocery: { stroke: 'M3.5 5.5h2.3l2 8.6h8.9l1.8-6.4H6.6', dots: [[9.3, 17.6], [15.6, 17.6]] },
    pFood:    { stroke: 'M7.5 4.5v15M5.5 4.5v4.2a2 2 0 0 0 4 0V4.5M16.5 19.5v-15c-2 1.6-2.7 5-2.7 7.8h2.7' },
  };
  function drawPoint(key, theme) {
    const S = 76, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), col = PALETTE[theme][OVERLAYS.find((o) => o.key === key).color], cx = S / 2, cy = S / 2 - 1;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    g.beginPath(); g.arc(cx, cy, 27, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.restore();
    g.beginPath(); g.arc(cx, cy, 23, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    const gl = GLYPH[key], sc = 1.5;
    g.save(); g.translate(cx - 12 * sc, cy - 12 * sc); g.scale(sc, sc);
    g.fillStyle = '#FFFFFF'; g.strokeStyle = '#FFFFFF'; g.lineWidth = 2.1; g.lineCap = 'round'; g.lineJoin = 'round';
    if (gl.fill) g.fill(new Path2D(gl.fill));
    if (gl.stroke) g.stroke(new Path2D(gl.stroke));
    for (const [x, y] of gl.dots || []) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
    g.restore();
    return cv;
  }

  /* ---------- Layers button + panel ---------- */
  function setOverlay(key, on) {
    if (on) {   // only one boundary layer at a time: switch the others off
      const grp = OVERLAYS.find((x) => x.key === key).group;
      for (const o of OVERLAYS) if (o.group === grp && o.key !== key && overlayOn[o.key]) {
        setOverlay(o.key, false);
        const box = document.querySelector(`.layers-switch[data-key="${o.key}"]`);
        if (box) box.checked = false;
      }
    }
    overlayOn[key] = on;
    if (!on && selected && selected.key === key) closeSheet();   // close its card
    const o = OVERLAYS.find((x) => x.key === key);
    const src = map.getSource('ov-' + key);
    if (!src) { map.once('styledata', () => setOverlay(key, overlayOn[key])); return; }  // map still starting up
    if (on && !overlayLoaded[key]) {
      overlayLoaded[key] = true;
      if (o.load) o.load().then((fc) => src.setData(fc)).catch((err) => { overlayLoaded[key] = false; toast(err.message || String(err)); });
      else src.setData(o.file);
    }
    for (const id of overlayIds(key)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  class LayersControl {
    onAdd() {
      const wrap = document.createElement('div');
      wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group layers-ctrl';
      wrap.innerHTML = `
        <button type="button" class="layers-btn" aria-label="Map layers" aria-expanded="false">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.75 3.75 9.1 12 13.45l8.25-4.35z"/><path d="m3.75 13.4 8.25 4.35 8.25-4.35"/></svg>
        </button>`;
      const panel = document.createElement('div');
      panel.className = 'layers-panel'; panel.hidden = true;
      const c = PALETTE[themeNow()];
      const icon = (o, g) => (g.id === 'places'
        ? `<img class="lp-icon" data-key="${o.key}" alt="" src="${drawPoint(o.key, themeNow()).toDataURL()}">`
        : `<span class="lp-area" data-color="${o.color}" style="--sw:${c[o.color]}"></span>`);
      panel.innerHTML = GROUPS.map((g) => `<div class="lp-group">
        <div class="lp-title"><span>${g.title}</span></div>
        ${OVERLAYS.filter((o) => o.group === g.id).map((o) => `
        <label class="lp-row" data-color="${o.color}" style="--sw:${c[o.color]}">
          ${icon(o, g)}
          <span class="lp-text"><b>${o.name}</b>${o.desc ? `<small>${o.desc}</small>` : ''}</span>
          <input type="checkbox" class="layers-switch" data-key="${o.key}" ${overlayOn[o.key] ? 'checked' : ''}>
        </label>`).join('')}</div>`).join('');
      document.body.appendChild(panel);
      const btn = wrap.querySelector('button');
      const toggle = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(panel.hidden); });
      panel.addEventListener('click', (e) => e.stopPropagation());
      panel.addEventListener('change', (e) => { const k = e.target.dataset.key; if (k) setOverlay(k, e.target.checked); });
      document.addEventListener('click', () => toggle(false));
      this.panel = panel;
      return wrap;
    }
    onRemove() { this.panel.remove(); }
    recolor() {
      const c = PALETTE[themeNow()];
      this.panel.querySelectorAll('[data-color]').forEach((el) => el.style.setProperty('--sw', c[el.dataset.color]));
      this.panel.querySelectorAll('.lp-icon').forEach((el) => { el.src = drawPoint(el.dataset.key, themeNow()).toDataURL(); });
    }
  }
  const layersCtrl = new LayersControl();
  map.addControl(layersCtrl, 'top-right');

  /* ---------- Map symbols drawn in code (hospital H, fire station cross) ---------- */
  function drawSymbol(kind) {
    const S = 48, r = 9, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const box = (fill) => {
      g.beginPath(); g.roundRect(3, 3, S - 6, S - 6, r);
      g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.stroke();
    };
    g.fillStyle = '#FFFFFF';
    if (kind === 'sym-hospital') {          // US standard: white H on blue
      box('#1F5FAD'); g.fillStyle = '#FFFFFF';
      g.fillRect(14, 12, 6, 24); g.fillRect(28, 12, 6, 24); g.fillRect(14, 21, 20, 6);
    } else {                                // fire station: red badge with a Maltese cross
      box('#C92A2A'); g.fillStyle = '#FFFFFF';
      const c = S / 2; g.save(); g.translate(c, c);
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(0, -3); g.lineTo(-7, -14); g.quadraticCurveTo(0, -11, 7, -14); g.closePath(); g.fill();
        g.rotate(Math.PI / 2);
      }
      g.beginPath(); g.arc(0, 0, 4.5, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    return g.getImageData(0, 0, S, S);
  }
  map.on('styleimagemissing', (e) => {
    const m = /^pt-(\w+)-(light|dark)$/.exec(e.id);
    if (m && GLYPH[m[1]] && !map.hasImage(e.id)) { const cv = drawPoint(m[1], m[2]); map.addImage(e.id, cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), { pixelRatio: 2 }); return; }
    if ((e.id === 'sym-hospital' || e.id === 'sym-fire') && !map.hasImage(e.id)) map.addImage(e.id, drawSymbol(e.id), { pixelRatio: 2 });
  });

  /* ---------- Messages ---------- */
  const toastBox = document.createElement('div');
  toastBox.className = 'map-toast'; toastBox.hidden = true; document.body.appendChild(toastBox);
  let toastTimer;
  function toast(msg) {
    toastBox.textContent = msg; toastBox.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 4500);
  }

  /* ---------- Helpers ---------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
  const usd = (v) => (num(v) == null ? '–' : '$' + Math.round(v).toLocaleString());
  const pct = (v) => (num(v) == null ? '–' : Math.round(v) + '%');
  const title = (v) => String(v || '').toLowerCase().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
  const mobile = matchMedia('(max-width: 799px)');

  const jsonCache = {};
  const getJSON = (f) => (jsonCache[f] ||= fetch(f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); }));

  // Point-in-polygon lookups (for "which tract / neighborhood / city is this in")
  function inRing(x, y, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) c = !c;
    }
    return c;
  }
  const polysOf = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  function bboxOf(f) {
    if (f._bb) return f._bb;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polysOf(f.geometry)) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return (f._bb = [x0, y0, x1, y1]);
  }
  const inFeature = (f, x, y) => polysOf(f.geometry).some((p) => inRing(x, y, p[0]));
  function featureAt(fc, x, y) {
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const b = bboxOf(f);
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (inFeature(f, x, y)) return f.properties;
    }
    return null;
  }

  /* ---------- Sheet (bottom on phones, side panel on desktop) ---------- */
  document.body.insertAdjacentHTML('beforeend',
    '<section class="sheet" aria-hidden="true"><div class="sheet-top"><div class="grab"></div><button class="x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button></div><div class="body"></div></section>');
  const sheet = document.querySelector('.sheet'), sheetBody = sheet.querySelector('.body');
  let sheetLock = false;   // true while editing, so map taps don't close the form
  function openSheet(html, opts = {}) {
    if (!sheet.classList.contains('open')) { clearDrag(); setFull(false); }
    sheet.dataset.kind = opts.kind || '';
    sheet.classList.toggle('nofull', !!opts.noFull);
    if (opts.noFull && sheetFull) { clearDrag(); setFull(false); }   // a new card always opens at peek height
    sheetLock = false; sheetBody.innerHTML = html; sheetBody.scrollTop = 0;
    sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); document.body.classList.add('sheet-open');
    wireCard();
  }
  function closeSheet() {
    sheetLock = false; sheetBody.onclick = null;
    sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); document.body.classList.remove('sheet-open');
    clearSelection();
  }
  sheet.querySelector('.x').onclick = closeSheet;
  // Opening a dropdown (Property, Schools, Area…) scrolls it up to the top of the card
  let userToggled = null;   // only react to taps, not to dropdowns that start open
  sheetBody.addEventListener('click', (e) => { const sm = e.target.closest('summary'); userToggled = sm ? sm.parentElement : null; }, true);
  sheetBody.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open || d !== userToggled) return;
    userToggled = null;
    if (mobile.matches && !sheetFull && !sheet.classList.contains('nofull')) expandSheet();   // peek can't scroll, so go full screen to show it
    requestAnimationFrame(() => {
      const top = d.getBoundingClientRect().top - sheetBody.getBoundingClientRect().top + sheetBody.scrollTop - 2;
      sheetBody.scrollTo({ top, behavior: 'smooth' });
    });
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  new ResizeObserver(() => document.body.style.setProperty('--sh', sheet.offsetHeight + 'px')).observe(sheet);

  /* ---------- Phone sheet: peek <-> full screen ----------
     Peek = the height a card opens at; its content doesn't scroll.
     Drag up -> full screen, where content scrolls normally.
     At full screen, scrolling up stops at the top; a NEW pull down that starts at the top -> back to peek.
     Pull down at peek -> close. The X and any map tap/drag close it from any state. */
  let sheetFull = false;
  const sheetTop = sheet.querySelector('.sheet-top');
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  function setFull(on) {
    sheetFull = on; sheet.classList.toggle('full', on);
    if (!on) sheetBody.scrollTop = 0;
  }
  function clearDrag() { sheet.style.height = sheet.style.maxHeight = sheet.style.transform = sheet.style.transition = ''; }
  const peekHeight = () => Math.min(sheetTop.offsetHeight + sheetBody.scrollHeight, innerHeight * 0.68);
  // Animate the sheet's height from where it is now to `to` px, then hand back to the CSS.
  function animateHeight(to) {
    const from = sheet.offsetHeight;
    sheet.style.transition = 'none'; sheet.style.maxHeight = 'none'; sheet.style.transform = '';
    sheet.style.height = from + 'px';
    void sheet.offsetHeight;   // lock in the start height
    sheet.style.transition = `height 0.32s ${EASE}, border-radius 0.32s ${EASE}`;
    sheet.style.height = to + 'px';
    clearTimeout(animateHeight.t);
    animateHeight.t = setTimeout(clearDrag, 340);
  }
  function expandSheet() { setFull(true); animateHeight(innerHeight); }
  function collapseSheet() {
    const from = sheet.offsetHeight;
    if (sheet.dataset.kind === 'home') {   // home buttons ride back down with the card
      sheet.classList.add('foot-down');
      clearTimeout(collapseSheet.t); collapseSheet.t = setTimeout(() => sheet.classList.remove('foot-down'), 340);
    }
    setFull(false); sheet.style.height = from + 'px'; animateHeight(peekHeight());
  }
  function snapBack() {
    sheet.style.transition = `height 0.25s ${EASE}, transform 0.25s ${EASE}`;
    sheet.style.transform = '';
    if (sheet.style.height) sheet.style.height = (sheetFull ? innerHeight : peekHeight()) + 'px';
    clearTimeout(animateHeight.t);
    animateHeight.t = setTimeout(clearDrag, 270);
  }
  mobile.addEventListener('change', () => { clearDrag(); setFull(false); });

  let drag = null;
  sheet.addEventListener('touchstart', (e) => {
    if (!mobile.matches || !sheet.classList.contains('open') || e.touches.length > 1) { drag = null; return; }
    if (e.target.closest('.stars, input, textarea, select')) { drag = null; return; }
    const t = e.touches[0];
    drag = {
      x0: t.clientX, y0: t.clientY, t0: e.timeStamp, h0: sheet.offsetHeight, mode: null,
      // at full screen only a pull that STARTS at the top (or on the top bar) shrinks the card
      fromTop: sheetBody.scrollTop <= 0 || !!e.target.closest('.sheet-top'),
    };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!drag || drag.mode === 'none') return;
    const t = e.touches[0], dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
    if (!drag.mode) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { drag.mode = 'none'; return; }            // sideways: photos, charts
      drag.mode = !sheetFull || (dy > 0 && drag.fromTop) ? 'sheet' : 'none';      // otherwise normal scrolling
      if (!sheetFull && dy < 0 && sheet.classList.contains('nofull')) drag.mode = 'none';   // small cards: pull down to close only
      if (drag.mode === 'none') return;
      drag.y0 = t.clientY;   // start following from here, so the card doesn't jump
      sheet.style.transition = 'none';
      return;
    }
    e.preventDefault();
    const d = t.clientY - drag.y0;
    drag.dy = d;
    if (!sheetFull && d > 0) { sheet.style.height = ''; sheet.style.transform = `translateY(${d}px)`; }   // pulling down to close
    else {
      sheet.style.transform = ''; sheet.style.maxHeight = 'none';
      sheet.style.height = Math.max(120, Math.min(innerHeight, drag.h0 - d)) + 'px';
    }
  }, { passive: false });
  sheet.addEventListener('touchend', (e) => {
    const g = drag; drag = null;
    if (!g || g.mode !== 'sheet') return;
    const dy = g.dy || 0, v = dy / Math.max(1, e.timeStamp - g.t0);   // px per ms (+ = down)
    if (sheetFull) {
      if (dy > 70 || v > 0.5) collapseSheet(); else snapBack();
    } else if (dy < 0) {
      if (dy < -50 || v < -0.4) expandSheet(); else snapBack();
    } else {
      if (dy > 80 || v > 0.5) { clearDrag(); closeSheet(); } else snapBack();
    }
  });
  sheet.addEventListener('touchcancel', () => { if (drag && drag.mode === 'sheet') snapBack(); drag = null; });

  /* ---------- Selection highlight ---------- */
  let selected = null;   // { kind: 'point' | 'area', key, id }
  function clearSelection() {
    highlightLot(null);
    if (!selected) return;
    const s = selected; selected = null;
    if (s.kind === 'point') { if (map.getLayer(s.key + '-pick')) map.setFilter(s.key + '-pick', ['==', ['id'], '__none__']); }
    else if (map.getSource('ov-' + s.key)) map.setFeatureState({ source: 'ov-' + s.key, id: s.id }, { sel: false });
  }
  function select(kind, key, id) {
    clearSelection();
    selected = { kind, key, id };
    if (kind === 'point') map.setFilter(key + '-pick', ['==', ['id'], id]);
    else map.setFeatureState({ source: 'ov-' + key, id }, { sel: true });
  }
  // Keep a picked point in view beside the sheet/panel.
  const revealPoint = (ll) => cameraToPoint(ll, 15);

  /* ---------- Card pieces ---------- */
  const stat = (l, v, cls) => `<div class="stat${cls ? ' ' + cls : ''}"><span>${l}</span><b>${v}</b></div>`;
  const dirs = ([lng, lat]) => `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}">Directions</a>`;
  const change = (a, b) => { if (!a || !b) return '<b>–</b>'; const c = (a / b - 1) * 100; return `<b class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '+' : ''}${c.toFixed(1)}%</b>`; };
  const meter = (l, v, o) => `<div class="stat wide"><div class="key" style="font-size:15px;color:var(--ink)"><span>${l}</span><b>${pct(v)}</b></div><div class="meter"><div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>${o ? `<u style="left:${o}%"></u>` : ''}</div>${o ? `<div class="key"><span>Oregon average ${pct(o)}</span></div>` : ''}</div>`;
  const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.55 5.3 5.85.8-4.25 4.05 1.05 5.8L12 16.6l-5.2 2.75 1.05-5.8L3.6 9.5l5.85-.8z"/></svg>';
  const STAR_CELLS = `<span class="star"><span class="s-bg">${STAR_SVG}</span><span class="s-fg">${STAR_SVG}</span></span>`.repeat(5);
  const starsHTML = (attrs, v = 0) => `<div class="stars" ${attrs} data-value="${v}">${STAR_CELLS}</div>`;

  function chart(series) {
    const pts = Object.entries(series || {}).filter(([k, v]) => k >= '2022-01' && num(v) != null).sort(([a], [b]) => (a < b ? -1 : 1));
    if (pts.length < 2) return '';
    const W = 320, H = 88, vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1;
    const xy = pts.map(([, v], i) => [8 + i * (W - 16) / (pts.length - 1), H - 10 - (v - lo) / sp * (H - 30)]);
    const line = xy.map((p) => p.join(',')).join(' ');
    const id = 'c' + Math.random().toString(36).slice(2, 7);
    setTimeout(() => {
      const el = document.getElementById(id); if (!el) return;
      const dot = el.querySelector('.d'), rd = el.querySelector('.rd'), g = el.querySelector('.g'), svg = el.querySelector('svg');
      const show = (e) => {
        const r = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - r.left) / r.width * (pts.length - 1))));
        const [x, y] = xy[i]; dot.setAttribute('cx', x); dot.setAttribute('cy', y); g.setAttribute('x1', x); g.setAttribute('x2', x);
        const d = new Date(pts[i][0] + 'T12:00');
        rd.innerHTML = `<span>${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span><span>${usd(pts[i][1])}</span>`;
      };
      el.addEventListener('pointermove', show); el.addEventListener('pointerdown', show);
    });
    const y0 = pts[0][0].slice(0, 4), y1 = pts.at(-1)[0].slice(0, 4);
    return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Home value ${y0} to ${y1}"><line class="g" x1="8" x2="8" y1="0" y2="${H}"/><polygon class="a" points="8,${H} ${line} ${W - 8},${H}"/><polyline class="l" points="${line}"/><circle class="d" r="5" cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}"/></svg><div class="rd"><span>${y0}</span><span>Touch chart to explore · ${y1}</span></div></div>`;
  }

  /* ---------- Cards: areas ---------- */
  const HK = ['HOMEVAL_ME', 'RENT_MED', 'MORT_COST_', 'MORT_TAX_M', 'YR_BUILT_M', 'INC_HH_MED'];
  function hoodStats(f, tracts, ll) {   // average the census tracts that cover a neighborhood (sampled on a grid)
    const [x0, y0, x1, y1] = bboxOf(f), N = 16, sum = {}, n = {}; let hit = 0;
    const add = (t) => { for (const k of HK) { const v = num(t[k]); if (v > 0) { sum[k] = (sum[k] || 0) + v; n[k] = (n[k] || 0) + 1; } } };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = x0 + (j + 0.5) / N * (x1 - x0), y = y0 + (i + 0.5) / N * (y1 - y0);
      if (!inFeature(f, x, y)) continue;
      const t = featureAt(tracts, x, y); if (t) { add(t); hit++; }
    }
    if (!hit) { const t = featureAt(tracts, ll[0], ll[1]); if (!t) return null; add(t); }
    return Object.fromEntries(HK.filter((k) => n[k]).map((k) => [k, sum[k] / n[k]]));
  }
  async function hoodCard(p, f, ll) {
    const [hist, tracts] = await Promise.all([getJSON('data/zhvi_history.json').catch(() => ({})), getJSON('data/census.geojson').catch(() => null)]);
    const h = hist[p.RegionID] || {}, keys = Object.keys(h).sort(), last = keys.at(-1);
    const now = last ? h[last] : null, yearAgo = h[keys.at(-13)], fiveAgo = h[keys.at(-61)];
    const when = last ? new Date(last + 'T12:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
    const t = tracts ? hoodStats(f, tracts, ll) : null;
    return `<div class="sec"><h2>${esc(p.Name)}</h2><div class="sub">${esc(title(p.City))} · ${esc(p.County)} County</div></div>
    <div class="sec"><div class="price-row"><div class="big">${usd(now)}</div>${starsHTML(`data-region="${esc(p.RegionID)}"`)}</div><div class="sub">Typical home value (Zillow${when ? ', ' + when : ''})</div>
    <div class="pills"><div class="pill">${change(now, yearAgo)}<span>Past year</span></div><div class="pill">${change(now, fiveAgo)}<span>Past 5 years</span></div></div>${chart(h)}</div>
    ${t ? `<div class="sec"><details open><summary>Census estimates</summary><div class="grid">${stat('Median home value', usd(t.HOMEVAL_ME))}${stat('Median rent', usd(t.RENT_MED))}${stat('Monthly mortgage', usd(t.MORT_COST_))}${stat('Yearly property tax', usd(t.MORT_TAX_M))}${stat('Typical year built', t.YR_BUILT_M ? Math.round(t.YR_BUILT_M) : '–')}${stat('Household income', usd(t.INC_HH_MED))}</div><div class="sub">Averaged across the census tracts that cover this neighborhood, so treat as approximate.</div></details></div>` : ''}`;
  }
  function tractSchools(p) {
    const rows = [['Reading', 'English_La', 'Oregon_ELA'], ['Math', 'Mathematic', 'Oregon_Mat'], ['Science', 'Science', 'Oregon_Sci']].filter(([, k]) => +p[k] > 0);
    return `<details open><summary>Schools</summary>${rows.length ? `<div class="grid">${rows.map(([l, k, o]) => meter(l, +p[k], +p[o] || 0)).join('')}</div><div class="sub">Test scores show the share of students meeting standards.</div>` : '<div class="sub" style="padding-bottom:8px">No school data for this tract.</div>'}</details>`;
  }
  function tractCard(p) {
    const gk = Object.keys(p).find((k) => /^[A-F][+-]?$/.test(p[k] || '') && !/FUNC/i.test(k)), own = num(p.OWN_OCC_PC) ?? 0, rent = num(p.RENT_OCC_P) ?? 0;
    const zones = [['Commercial', 'ZONE_Comme'], ['Residential', 'ZONE_Resid'], ['Res. rural', 'ZONE_Res_R'], ['Industrial', 'ZONE_Indus'], ['Parks', 'ZONE_Park_'], ['Farm', 'ZONE_Farmi'], ['Forest', 'ZONE_Fores']].filter(([, k]) => +p[k] >= 1).sort((a, b) => p[b[1]] - p[a[1]]);
    return `<h2>Census tract ${esc(String(p.GEOID || '').slice(-6))}</h2><div class="sub">${num(p.POP_Total)?.toLocaleString() || '–'} people · median age ${num(p.AGE_MED) ?? '–'}</div>
    <div class="big">${usd(p.INC_HH_MED)}</div><div class="sub">Median household income</div>
    <div class="grid">${stat('Median home value', usd(p.HOMEVAL_ME))}${stat('Median rent', usd(p.RENT_MED))}${stat('Monthly mortgage', usd(p.MORT_COST_))}${stat('Yearly property tax', usd(p.MORT_TAX_M))}
    ${gk ? `<div class="stat wide"><span>Niche grade</span><b>${esc(p[gk])}</b></div>` : ''}<div class="stat wide"><span>Own vs. rent</span><div class="bar"><i style="width:${own}%"></i><i style="width:${rent}%"></i></div><div class="key"><span>Own ${pct(own)}</span><span>Rent ${pct(rent)}</span></div></div></div>
    <details open><summary>Demographics</summary><div class="grid">${stat('Under 18', pct(p.AGE_U18_PC))}${stat('65 and older', pct(p.AGE_65P_PC))}<div class="stat wide"><span>Bachelor's degree or higher</span><div class="bar"><i style="width:${num(p.EDU_BA_PCT) ?? 0}%"></i></div><div class="key"><span>${pct(p.EDU_BA_PCT)}</span><span>Poverty ${pct(p.INC_POV_PC)}</span></div></div></div></details>
    ${tractSchools(p)}
    ${zones.length ? `<details open><summary>Land use</summary><div class="grid">${zones.map(([n, k]) => stat(n, pct(p[k]))).join('')}</div></details>` : ''}`;
  }
  const cityCard = (p) => { const t = String(p.NAMELSAD || '').replace(p.NAME, '').trim(); return `<h2>${esc(p.NAME)}</h2><div class="sub">${t === 'CDP' ? 'Census-designated place' : esc(title(t) || 'City')}</div>`; };
  async function sasCard(p) {
    const sa = await schoolsFor(p);
    const pc = (v) => (num(v) == null ? null : Math.round(v * 10) / 10);
    const mean = pc(sa.mean);
    return `<div class="sec"><h2>${esc(sa.district || 'School attendance area')}</h2><div class="sub">School attendance area</div>
    <div class="grid"><div class="stat"><span>Area grade</span><b>${gradeBadge(sa.grade)}</b></div>${stat('Area average', mean != null ? mean + '%' : '–')}</div></div>
    <div class="sec"><div class="grid">${sa.schools.map(({ level, name, pctl, s }) => { const v = pc(pctl); return `<div class="stat wide">
      <div class="key" style="font-size:15px;color:var(--ink);align-items:center;gap:8px"><span>${esc(name)}</span><b style="display:inline-flex;align-items:center;gap:8px;flex:none">${v != null ? v + '%' : '–'}${gradeBadge(s?.GRADE_1)}</b></div>
      ${v != null ? `<div class="meter"><div class="bar"><i style="width:${v}%"></i></div></div>` : ''}<div class="key"><span>${level}</span></div></div>`; }).join('')}</div></div>`;
  }

  /* ---------- Cards: places ---------- */
  const placeCard = (t, sub, ll, extra = '') => `<h2>${esc(t)}</h2><div class="sub">${esc(sub)}</div>${extra}${dirs(ll)}`;
  function schoolCard(p, ll) {
    const rows = [['Reading', 'ELA_PctProf', 'ELA_statePctProf'], ['Math', 'Math_PctProf', 'Math_statePctProf'], ['Science', 'Science_PctProf', 'SCience_statePctProf']].filter(([, k]) => num(p[k]) != null);
    const type = { ES: 'Elementary', MS: 'Middle', HS: 'High' }[p.School_Type] || '';
    const sub = [p.GRADE ? 'Grades ' + p.GRADE : type, p.TYPE, p.DISTRICT ? p.DISTRICT + ' SD' : null].filter(Boolean).join(' · ');
    return `<div class="sec"><h2>${esc(p.Label_Name)}</h2><div class="sub">${esc(sub)}</div><div class="sub">${esc(title([p.ADDRESS, p.CITY].filter(Boolean).join(', ')))}</div></div>
    ${(p.GRADE_1 || num(p.Mean_Percentile) != null) ? `<div class="sec"><div class="grid">${p.GRADE_1 ? stat('Grade', gradeBadge(p.GRADE_1)) : ''}${num(p.Mean_Percentile) != null ? stat('Overall percentile', Math.round(p.Mean_Percentile) + '%') : ''}</div></div>` : ''}
    ${rows.length ? `<div class="sec"><details open><summary>Test scores</summary><div class="grid">${rows.map(([l, k, o]) => meter(l, +p[k], num(p[o]) || 0)).join('')}</div><div class="sub">Share of students meeting standards.</div></details></div>` : ''}
    <div class="foot">${dirs(ll)}</div>`;
  }

  /* Homes and lots: property facts, schools, camera */
  const USE = { 'RP R': 'Residential', SFR: 'Single-family residential', MFR: 'Multi-family residential', Comm: 'Commercial', COM: 'Commercial',
                IND: 'Industrial', VAC: 'Vacant land', PUB: 'Public', AGR: 'Agricultural', RUR: 'Rural', FOR: 'Forest' };
  const longDate = (v) => {   // returns '' when there's no real date
    const t = String(v ?? '').trim(); let y, m, d;
    let x = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (x) [, m, d, y] = x;
    else if ((x = t.match(/^(\d{4})(\d{2})(\d{2})?$/))) [, y, m, d] = x;
    if (!y || +y < 1901) return '';
    const dt = new Date(+y, +m - 1, +(d || 1));
    return dt.toLocaleDateString('en-US', d ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', year: 'numeric' });
  };
  const sqft = (v) => (num(v) ? Math.round(v).toLocaleString() + ' sq ft' : '–');
  const kv = (rows) => `<table class="kv">${rows.filter((r) => r[1] != null && r[1] !== '' && r[1] !== '–').map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  const gradeBadge = (g) => {
    const L = String(g || '').trim().toUpperCase()[0];
    return L ? `<span class="grade g-${esc(L).toLowerCase()}"><i>${esc(L)}</i></span>` : '<span class="grade">–</span>';
  };
  // Center the grade letter exactly: measure this device's font (where its capitals actually sit inside a line)
  // and store the nudge as --grade-dy. Works with whatever system font the phone or computer uses.
  (function gradeNudge() {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `700 13px ${getComputedStyle(sheet).fontFamily}`;
      const m = ctx.measureText('B'), fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent, cap = m.actualBoundingBoxAscent;
      if (!(fa > 0 && fd >= 0 && cap > 0)) return;
      const H = 22, baseline = (H - (fa + fd)) / 2 + fa;   // where the baseline lands in a 22px-tall line
      document.documentElement.style.setProperty('--grade-dy', (H / 2 - (baseline - cap / 2)).toFixed(2) + 'px');
    } catch { /* keep the default */ }
  })();
  const ord = (v) => (num(v) == null ? '–' : Math.round(v) + '%');

  // Property facts from a lot (tile feature properties)
  // Values are the county's "real market value" estimates: 2025 is the latest, 2024 and 2023 are the two years before.
  function propertyHTML(p, hoodName, ctx = {}) {
    if (!p) return '<div class="sub pad">No lot record found at this spot.</div>';
    const units = num(p.units) > 1 ? p.units + ' units' : null;
    const lot = num(p.lotsqft) ? `${Math.round(p.lotsqft).toLocaleString()} sq ft (${(p.lotsqft / 43560).toFixed(2)} ac)` : null;
    const saleDate = longDate(p.saledate), salePrice = num(p.saleprice) > 100 ? usd(p.saleprice) : null;
    // Multnomah County lots carry 2023, 2024 and 2025 values. Washington and Clackamas County lots carry a single,
    // newer value (their 2026 roll), which lands in the first slot of the data, so label it correctly.
    const single = !num(p.total) && !num(p.total24) && num(p.total23);
    const years = single ? [['2026', p.total23]] : [['2025', p.total], ['2024', p.total24], ['2023', p.total23]].filter(([, v]) => num(v));
    const latest = years[0], prev = years[1];
    const delta = latest && prev ? (latest[1] / prev[1] - 1) * 100 : null;
    const latestVal = latest ? latest[1] : null;
    const bsq = num(ctx.homeSqft) || num(p.sqft);
    // good = 'low' (lower is the better deal), 'high' (higher is better, e.g. value gained), or 'none' (just information)
    const pctTxt = (a, b, good = 'high') => {
      const d = (a / b - 1) * 100, cls = good === 'none' ? 'flat' : (good === 'low' ? d <= 0 : d >= 0) ? 'good' : 'bad';
      return `<span class="${cls}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span>`;
    };
    const listSq = ctx.listPrice && bsq ? ctx.listPrice / bsq : null, valSq = latestVal && bsq ? latestVal / bsq : null;
    const saleYear = (longDate(p.saledate).match(/\d{4}$/) || [])[0];
    const yearsAgo = saleYear ? new Date().getFullYear() - +saleYear : null;
    const check = [
      listSq ? ['List price / sq ft', valSq ? `<span class="${listSq <= valSq ? 'good' : 'bad'}">${usd(listSq)}</span>` : usd(listSq)] : null,
      latestVal && bsq ? ['County value / sq ft', usd(latestVal / bsq)] : null,
      ctx.listPrice && latestVal ? ['List vs. county value', pctTxt(ctx.listPrice, latestVal, 'low')] : null,
      num(ctx.typical) ? [(ctx.listPrice ? 'List' : 'County value') + ' vs. neighborhood value', pctTxt(ctx.listPrice || latestVal || 0, ctx.typical, ctx.listPrice ? 'low' : 'none') + `<small class="below">${usd(ctx.typical)}</small>`] : null,
    ].filter((r) => r && !(r[0].includes('neighborhood') && !(ctx.listPrice || latestVal)));
    const box = (titleTxt, body) => body ? `<div class="pgroup"><div class="ptitle">${titleTxt}</div>${body}</div>` : '';
    return box('Value check', check.length ? kv(check) : '')
      + box('Last sale', salePrice || saleDate ? kv([['Price', salePrice], ['Date', saleDate || null],
          ['Owned for', yearsAgo != null ? (yearsAgo < 1 ? 'Under a year' : yearsAgo + (yearsAgo === 1 ? ' year' : ' years')) : null],
          ['Value since sale', num(p.saleprice) > 100 && latestVal ? pctTxt(latestVal, p.saleprice) : null]]) : '<div class="sub pad">No sale on record.</div>')
      + box('County market value', latest ? `<div class="pval"><b>${usd(latest[1])}</b><span>${latest[0]} value${delta != null ? ` · <em class="${delta >= 0 ? 'good' : 'bad'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% from ${prev[0]}</em>` : ''}</span></div>`
          + kv([['Land', latest[0] === '2025' ? usd(p.land) : null], ['Building', latest[0] === '2025' ? usd(p.bldg) : null], ...years.slice(1).map(([y, v]) => [y + ' value', usd(v)])]) : '<div class="sub pad">No value on record.</div>')
      + box('Building', kv([['Year built', num(p.year) > 1800 ? p.year : null], ['Use', [USE[p.use] || p.use, units].filter(Boolean).join(' · ') || null],
          ['Building area', num(p.sqft) ? sqft(p.sqft) : null], ['Bedrooms', p.beds || null], ['Floors', num(p.floors) ? p.floors : null],
          ['Lot size', lot], ['Neighborhood', hoodName ? `<span class="nb-hood">${esc(hoodName)}</span>` : null]]));
  }

  // Schools for a location: its attendance area + the three assigned schools
  const normName = (v) => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/\b(school|sch)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  async function schoolsAt(lng, lat) {
    const areas = await getJSON('data/schoolAttendanceAreas.geojson').catch(() => null);
    const a = areas && featureAt(areas, lng, lat);
    return a ? schoolsFor(a) : null;
  }
  async function schoolsFor(a) {   // a = attendance-area properties
    const schools = await getJSON('data/schools.geojson').catch(() => null);
    const g = (k) => a['SchoolAttendanceAreas_Clipped.' + k], q = (k) => a['SAA_with_percentiles.csv.' + k];
    // Match a school by name, but only among schools of the right level (and prefer the same district),
    // so e.g. "Lincoln" (a high school) never matches "Lincoln Park Elementary".
    const district = normName(g('Unified_SD_Name')).split(' ')[0];
    const find = (name, type) => {
      const n = normName(name); if (!n || !schools) return null;
      const all = schools.features.map((f) => f.properties);
      const pool = all.filter((x) => x.School_Type === type);
      const rank = (list) => {
        const hits = list.filter((x) => { const m = normName(x.Label_Name); return m === n || m.startsWith(n + ' ') || n.startsWith(m + ' '); });
        return hits.find((x) => normName(x.Label_Name) === n) || hits.find((x) => normName(x.DISTRICT).startsWith(district)) || hits[0] || null;
      };
      return rank(pool) || rank(all.filter((x) => normName(x.DISTRICT).startsWith(district))) || null;
    };
    const lv = [['Elementary', g('Grade_1_Choice1_Name'), q('ES_Percentile')], ['Middle', g('Grade_6_Choice1_Name'), q('MS_Percentile')], ['High', g('Grade_10_Choice1_Name'), q('HS_Percentile')]]
      .filter((r) => r[1]).map(([level, name, pctl]) => ({ level, name, pctl, s: find(name, { Elementary: 'ES', Middle: 'MS', High: 'HS' }[level]) }));
    return { district: g('Unified_SD_Name'), grade: q('SAA_Grade'), mean: q('SAA_Mean_Percentile'), url: g('SD_Catchment_URL'), schools: lv };
  }
  function schoolStrip(sa) {   // two tiles matching the beds/baths tiles: high school + attendance area
    if (!sa) return '';
    const hs = sa.schools.find((x) => x.level === 'High');
    const short = (n) => String(n || '').replace(/\s+(Senior\s+)?High School$/i, ' High').replace(/\s+School$/i, '');
    return `<div class="facts schools">
      ${hs ? `<div class="wide"><span>High school</span><b><em class="nm">${esc(short(hs.name))}</em>${gradeBadge(hs.s?.GRADE_1)}</b></div>` : ''}
      <div><span>Area grade</span><b>${gradeBadge(sa.grade)}</b></div>
    </div>`;
  }
  function schoolsHTML(sa) {
    if (!sa) return '<div class="sub pad">No attendance area found here.</div>';
    return `<div class="area-row"><span>${esc(sa.district || '')}</span></div>
      ${sa.schools.map(({ level, name, s }) => `<div class="sch">
        <div class="sch-top"><div><div class="sch-nm">${esc(name)}</div><div class="sub">${level}${s?.GRADE ? ' · Grades ' + esc(s.GRADE) : ''}</div></div>${gradeBadge(s?.GRADE_1)}</div>
        ${s ? `<div class="sch-scores"><span>Reading <b>${ord(s.ELA_Percentile)}</b></span><span>Math <b>${ord(s.Math_Percentile)}</b></span><span>Science <b>${ord(s.Science_Percentile)}</b></span></div>` : '<div class="sub">No score data for this school.</div>'}
      </div>`).join('')}
`;
  }

  // Zillow typical home value for a neighborhood (latest month)
  async function typicalFor(hood) {
    if (!hood) return null;
    const hist = await getJSON('data/zhvi_history.json').catch(() => ({}));
    const h = hist[hood.RegionID]; if (!h) return null;
    const k = Object.keys(h).sort().at(-1); return h[k];
  }
  // Census tract facts for the spot
  async function areaHTML(lng, lat) {
    const tracts = await getJSON('data/census.geojson').catch(() => null);
    const t = tracts && featureAt(tracts, lng, lat);
    if (!t) return '<div class="sub pad">No census data here.</div>';
    const own = num(t.OWN_OCC_PC) ?? 0, rent = num(t.RENT_OCC_P) ?? 0;
    return `<div class="pgroup"><div class="ptitle">Census tract ${esc(String(t.GEOID || '').slice(-6))}</div>${kv([
        ['Median household income', usd(t.INC_HH_MED)], ['Median home value', usd(t.HOMEVAL_ME)], ['Median rent', usd(t.RENT_MED)],
        ['Typical year built', num(t.YR_BUILT_M) ? Math.round(t.YR_BUILT_M) : null], ['People', num(t.POP_Total)?.toLocaleString()],
        ['Median age', num(t.AGE_MED)], ['Under 18', pct(t.AGE_U18_PC)], ['65 and older', pct(t.AGE_65P_PC)],
        ["Bachelor's degree or higher", pct(t.EDU_BA_PCT)], ['Below poverty line', pct(t.INC_POV_PC)]])}
      <div class="ownrent"><div class="bar"><i style="width:${own}%"></i><i style="width:${rent}%"></i></div><div class="key"><span>Own ${pct(own)}</span><span>Rent ${pct(rent)}</span></div></div></div>
      <div class="sub">Census estimates for the tract this spot is in.</div>`;
  }
  // Closest grocery, hospital, fire station and school (straight-line distance)
  const miles = ([x1, y1], [x2, y2]) => { const R = 3958.8, r = Math.PI / 180, a = Math.sin((y2 - y1) * r / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin((x2 - x1) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };
  async function nearbyHTML(lng, lat) {   // closest of each; tap a name for Google Maps directions
    const sets = [
      ['Grocery store', 'data/groceryStores.geojson', (q) => q.Name, (q) => [q.Address, q.City, q.State].filter(Boolean).join(', ')],
      ['School', 'data/schools.geojson', (q) => q.Label_Name, (q) => [q.ADDRESS, q.CITY, q.STATE].filter(Boolean).join(', ')],
      ['Hospital', 'data/hospitals.geojson', (q) => q.NAME, (q) => [q.ADDRESS, q.CITY, 'OR'].filter(Boolean).join(', ')],
      ['Fire station', 'data/fireStations.geojson', (q) => title(q.DISTRICT || 'Fire station'), (q) => [q.ADDRESS, q.CITY, q.STATE].filter(Boolean).join(', ')],
    ];
    const rows = await Promise.all(sets.map(async ([label, file, nameOf, addrOf]) => {
      const fc = await getJSON(file).catch(() => null); if (!fc) return null;
      let best = null, bd = Infinity;
      for (const f of fc.features) { if (!f.geometry) continue; const d = miles([lng, lat], f.geometry.coordinates); if (d < bd) { bd = d; best = f; } }
      if (!best) return null;
      const q = best.properties, [x, y] = best.geometry.coordinates, addr = addrOf(q);
      const dest = addr ? encodeURIComponent(addr) : `${y},${x}`;
      return [label, `<a class="go" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${dest}">${esc(nameOf(q) || label)}</a>`];
    }));
    return `<div class="pgroup"><div class="ptitle">Closest</div>${kv(rows.filter(Boolean))}</div>`;
  }
  // Fill the Area and Nearby dropdowns (they don't depend on the lot tiles)
  function fillExtras(ll, token) {
    areaHTML(ll[0], ll[1]).then((h) => { const el = token === openToken && sheetBody.querySelector('[data-sec="area"]'); if (el) el.innerHTML = h; });
    nearbyHTML(ll[0], ll[1]).then((h) => { const el = token === openToken && sheetBody.querySelector('[data-sec="nearby"]'); if (el) el.innerHTML = h; });
  }
  const EXTRAS = `<details class="sec"><summary>Area</summary><div data-sec="area"><div class="sub pad">Loading…</div></div></details>
    <details class="sec"><summary>Nearby</summary><div data-sec="nearby"><div class="sub pad">Loading…</div></div></details>`;

  // Find the lot under a point (lot tiles load at street zoom)
  function lotAt(lng, lat) {
    if (!map.getSource('lots')) return null;
    for (const f of map.querySourceFeatures('lots', { sourceLayer: 'lots' })) if (inFeature(f, lng, lat)) return f;
    return null;
  }
  // Outline the chosen lot (match on its stored facts so every tile piece lights up)
  function lotFilter(p) {
    const keys = ['addr', 'total', 'lotsqft', 'saledate', 'year'];
    return ['all', ...keys.map((k) => (p[k] != null ? ['==', ['get', k], p[k]] : ['!', ['has', k]]))];
  }
  const NOLOT = ['==', ['get', 'addr'], '__none__'];
  function highlightLot(p) { for (const id of ['lot-sel', 'lot-sel-fill']) if (map.getLayer(id)) map.setFilter(id, p ? lotFilter(p) : NOLOT); }

  // Camera: phones keep the target in the top half (sheet covers the bottom half); desktop centers it beside the panel
  const sheetPad = () => (mobile.matches
    ? { top: 40, bottom: Math.round(map.getContainer().clientHeight * 0.68) + 16, left: 30, right: 30 }
    : { top: 60, bottom: 60, left: 380 + 16 + 50, right: 60 });
  function cameraToPoint(ll, zoom) {
    const pad = sheetPad(), box = map.getContainer();
    const offset = [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
    map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), zoom), offset, duration: 700 });
    void box;
  }
  function cameraToLot(f) {
    const [x0, y0, x1, y1] = bboxOf(f);
    map.fitBounds([[x0, y0], [x1, y1]], { padding: sheetPad(), maxZoom: 19, duration: 700 });
  }

  async function homeCard(r, sa) {
    const [hoods, cities] = await Promise.all([getJSON('data/neighborhoods.geojson').catch(() => null), getJSON('data/cities.geojson').catch(() => null)]);
    const hood = hoods && featureAt(hoods, r.lng, r.lat), city = cities && featureAt(cities, r.lng, r.lat);
    const nb = [hood ? `<span class="nb-hood">${esc(hood.Name)}</span>` : null, city ? `<span class="nb-city">${esc(city.NAME)}</span>` : null].filter(Boolean).join(' · ');
    const who = [r.created_by_name, r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null].filter(Boolean).join(' · ');
    const photos = r.photos || [];
    return { hood, html: `<div class="sec"><h2 class="addr">${esc(r.address || r.title || 'Home')}</h2>${nb ? `<div class="sub">${nb}</div>` : ''}<div class="sub">Home${r.visited ? ' · Visited' : ''}${who ? ' · ' + esc(who) : ''}</div></div>
    <div class="sec"><div class="price-row"><div class="big">${r.price ? usd(r.price) : 'No price'}</div>${starsHTML(`data-kind="home" data-id="${esc(r.id)}"`, r.rating || 0)}</div>
      <div class="facts"><div><span>Beds</span><b>${esc(r.beds ?? '–')}</b></div><div><span>Baths</span><b>${esc(r.baths ?? '–')}</b></div><div><span>Sq ft</span><b>${r.sqft ? r.sqft.toLocaleString() : '–'}</b></div></div>
      ${schoolStrip(sa)}</div>
    ${(photos.length || r.note) ? `<div class="sec">${photos.length ? `<div class="photowrap"><div class="photos">${photos.map((u) => `<img loading="lazy" alt="Photo" src="${esc(u)}">`).join('')}</div>${photos.length > 1 ? '<button type="button" class="parrow prev" aria-label="Previous photo">&#8249;</button><button type="button" class="parrow next" aria-label="Next photo">&#8250;</button>' : ''}</div>` : ''}${r.note ? `<button type="button" class="note clamp" aria-expanded="false">${esc(r.note)}</button>` : ''}</div>` : ''}
    <details class="sec" data-sec="property" open><summary>Property</summary><div class="prop-body"><div class="sub pad">Loading…</div></div></details>
    <details class="sec" open><summary>Schools</summary>${schoolsHTML(sa)}</details>
    ${EXTRAS.replaceAll('<details class="sec">', '<details class="sec" open>')}
    <div class="foot"><div class="pills two">${dirs([r.lng, r.lat])}${r.link ? `<a class="btn alt" target="_blank" rel="noopener" href="${esc(r.link)}">Open listing</a>` : ''}</div>
    <div class="acts"><button data-act="visit">${r.visited ? 'Undo visited' : 'Mark visited'}</button><button data-act="edit">Edit</button><button data-act="del" class="danger">Delete</button></div></div>` };
  }
  // Fill the Property section once the lot under the point has loaded
  function fillProperty(ll, hood, token, ctx) {
    const run = async () => {
      if (token !== openToken) return;
      const f = lotAt(ll[0], ll[1]);
      const typical = await typicalFor(hood);
      if (token !== openToken) return;
      const el = sheetBody.querySelector('[data-sec="property"] .prop-body');
      if (el) el.innerHTML = propertyHTML(f && f.properties, hood?.Name, { ...ctx, typical });
      if (f) highlightLot(f.properties);
    };
    if (map.getZoom() >= 15 && map.areTilesLoaded()) run(); else map.once('idle', run);
  }
  let openToken = 0;
  async function openHome(id) {
    const r = homesRows.get(id); if (!r) return;
    const token = ++openToken;
    select('point', 'pHomes', id);
    cameraToPoint([r.lng, r.lat], 17.5);
    const sa = await schoolsAt(r.lng, r.lat);
    const { html, hood } = await homeCard(r, sa);
    if (token !== openToken) return;
    openSheet(html, { kind: 'home' });
    sheetBody.onclick = (e) => homeAction(e, id);
    fillProperty([r.lng, r.lat], hood, token, { listPrice: num(r.price), homeSqft: num(r.sqft) });
    fillExtras([r.lng, r.lat], token);
  }
  async function openLot(f, ll) {
    const token = ++openToken, p = f.properties;
    clearSelection(); highlightLot(p);
    cameraToLot(f);
    const [hoods, sa] = await Promise.all([getJSON('data/neighborhoods.geojson').catch(() => null), schoolsAt(ll[0], ll[1])]);
    const hood = hoods && featureAt(hoods, ll[0], ll[1]);
    const typical = await typicalFor(hood);
    if (token !== openToken) return;
    const val = num(p.total) || num(p.total24) || num(p.total23);
    openSheet(`<div class="sec"><h2 class="addr">${esc(p.addr || 'Lot')}</h2><div class="sub">${hood ? `<span class="nb-hood">${esc(hood.Name)}</span> · ` : ''}${esc([p.city, p.zip].filter(Boolean).join(' '))}${p.use ? ' · ' + esc(USE[p.use] || p.use) : ''}</div></div>
      <div class="sec"><div class="big">${val ? usd(val) : '–'}</div><div class="sub">County market value</div>${schoolStrip(sa)}</div>
      <details class="sec" open><summary>Property</summary><div class="prop-body">${propertyHTML(p, hood?.Name, { typical })}</div></details>
      <details class="sec"><summary>Schools</summary>${schoolsHTML(sa)}</details>
      ${EXTRAS}
      <div class="foot">${dirs(ll)}</div>`);
    sheetBody.onclick = null;
    fillExtras(ll, token);
  }
  function refreshHomes() {
    homesData = { type: 'FeatureCollection', features: [...homesRows.values()].filter((r) => r.lat != null && r.lng != null).map(homeFeature) };
    const src = map.getSource('ov-pHomes'); if (src) src.setData(homesData);
  }
  async function homeAction(e, id) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const r = homesRows.get(id);
    if (b.dataset.act === 'edit') return homeForm({ ...r });
    if (b.dataset.act === 'del') {
      if (!confirm('Delete this home?')) return;
      const { error } = await sb.from('places').delete().eq('id', id);
      if (error) return toast(error.message);
      homesRows.delete(id); refreshHomes(); closeSheet(); return;
    }
    const { data, error } = await sb.from('places').update({ visited: !r.visited }).eq('id', id).select().single();
    if (error) return toast(error.message);
    homesRows.set(id, data); refreshHomes(); openHome(id);
  }
  const norm = (v) => (v && !/^https?:\/\//i.test(v) ? 'https://' + v : v);
  async function shrink(file) {
    const img = await createImageBitmap(file, { imageOrientation: 'from-image' }), s = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
  }
  async function upload(file) {
    const path = `${crypto.randomUUID()}.jpg`, { error } = await sb.storage.from('photos').upload(path, await shrink(file), { contentType: 'image/jpeg' });
    if (error) throw error; return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }
  function homeForm(o) {
    const pics = [...(o.photos || [])], files = [], v = (x) => esc(x ?? '');
    openSheet(`<h2>Edit home</h2><form class="pf">
      <input name="address" placeholder="Address" value="${v(o.address)}">
      <input name="link" inputmode="url" placeholder="Listing link" value="${v(o.link)}">
      <input name="price" inputmode="numeric" placeholder="Price" value="${v(o.price)}">
      <div class="pr"><input name="beds" inputmode="decimal" placeholder="Beds" value="${v(o.beds)}"><input name="baths" inputmode="decimal" placeholder="Baths" value="${v(o.baths)}"><input name="sqft" inputmode="numeric" placeholder="Sq ft" value="${v(o.sqft)}"></div>
      <textarea name="note" rows="3" placeholder="Notes">${v(o.note)}</textarea>
      <label class="pph">Add photos<input type="file" accept="image/*" multiple hidden></label><div class="pth"></div>
      <div class="perr"></div><button class="btn">Save</button></form>`);
    sheetLock = true; sheetBody.onclick = null;
    if (mobile.matches && !sheetFull) expandSheet();   // forms need room to scroll
    const f = sheetBody.querySelector('form'), btn = f.querySelector('.btn'), th = f.querySelector('.pth'), err = f.querySelector('.perr');
    const gv = (n) => f.elements[n]?.value.trim() || '';
    const thumbs = () => { th.innerHTML = [...pics.map((u, i) => `<img data-p="${i}" src="${esc(u)}">`), ...files.map((x, i) => `<img data-f="${i}" src="${URL.createObjectURL(x)}">`)].join(''); };
    th.onclick = (e) => { const i = e.target; if (i.dataset.p != null) pics.splice(+i.dataset.p, 1); else if (i.dataset.f != null) files.splice(+i.dataset.f, 1); else return; thumbs(); };
    f.querySelector('input[type=file]').onchange = (e) => { files.push(...e.target.files); e.target.value = ''; thumbs(); };
    thumbs();
    f.onsubmit = async (ev) => {
      ev.preventDefault(); btn.disabled = true; btn.textContent = 'Saving…'; err.textContent = '';
      try {
        const urls = []; for (const x of files) urls.push(await upload(x));
        const val = (n) => gv(n) || null;
        const rec = { address: val('address'), link: norm(val('link')), price: num(gv('price')), beds: num(gv('beds')), baths: num(gv('baths')), sqft: num(gv('sqft')), note: val('note'), photos: [...pics, ...urls] };
        const { data, error } = await sb.from('places').update(rec).eq('id', o.id).select().single();
        if (error) throw error;
        homesRows.set(o.id, data); refreshHomes(); openHome(o.id);
      } catch (x) { err.textContent = x.message || 'Could not save. Check your connection.'; btn.disabled = false; btn.textContent = 'Save'; }
    };
  }

  /* Star ratings: drag or hover across the row, release/click to set (half-star steps, 0 clears) */
  function setFill(el, v) { el.querySelectorAll('.star').forEach((cell, i) => { const p = Math.max(0, Math.min(100, (v - i) * 100)); cell.querySelector('.s-fg').style.clipPath = `inset(0 ${100 - p}% 0 0)`; }); }
  function paintStars(el, v) { el.dataset.value = v; setFill(el, v); }
  function revealStars(el, v) { el.classList.add('revealing'); setFill(el, 0); void el.offsetHeight; requestAnimationFrame(() => { paintStars(el, v); setTimeout(() => el.classList.remove('revealing'), 550); }); }
  const valueAt = (el, x) => { const r = el.getBoundingClientRect(); return Math.round(Math.min(5, Math.max(0, (x - r.left) / r.width * 5)) * 2) / 2; };
  function wireStars(el, onChange) {
    let dragging = false;
    el.addEventListener('pointerdown', (e) => { dragging = true; el.setPointerCapture(e.pointerId); setFill(el, valueAt(el, e.clientX)); });
    el.addEventListener('pointermove', (e) => { if (dragging || e.pointerType === 'mouse') setFill(el, valueAt(el, e.clientX)); });
    el.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; const v = valueAt(el, e.clientX); paintStars(el, v); onChange(v); });
    el.addEventListener('pointercancel', () => { dragging = false; setFill(el, +el.dataset.value || 0); });
    el.addEventListener('pointerleave', () => { if (!dragging) setFill(el, +el.dataset.value || 0); });
  }
  async function signedInUser() { if (!sb) return null; const { data: { session } } = await sb.auth.getSession(); return session?.user || null; }
  function wireCard() {
    sheetBody.querySelectorAll('.stars').forEach(async (el) => {
      if (el.dataset.kind === 'home') {
        revealStars(el, +el.dataset.value || 0);
        wireStars(el, async (v) => {
          const { data, error } = await sb.from('places').update({ rating: v || null }).eq('id', el.dataset.id).select().single();
          if (error) return toast(error.message);
          homesRows.set(data.id, data);
        });
      } else if (el.dataset.region) {
        const user = await signedInUser();
        if (!user) { el.classList.add('locked'); el.insertAdjacentHTML('afterend', '<div class="stars-hint">Sign in on the home page to rate neighborhoods</div>'); return; }
        const region = +el.dataset.region;
        const { data } = await sb.from('neighborhood_ratings').select('rating').eq('region_id', region).maybeSingle();
        revealStars(el, data?.rating || 0);
        wireStars(el, async (v) => {
          const q = v ? sb.from('neighborhood_ratings').upsert({ region_id: region, rating: v, updated_by_name: user.user_metadata?.name || null })
                      : sb.from('neighborhood_ratings').delete().eq('region_id', region);
          const { error } = await q; if (error) toast(error.message);
        });
      }
    });
    sheetBody.querySelectorAll('.note.clamp').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true')); };
    });
    sheetBody.querySelectorAll('.photowrap').forEach((wrap) => {
      const row = wrap.querySelector('.photos'), prev = wrap.querySelector('.prev'), next = wrap.querySelector('.next');
      if (!prev) return;
      const update = () => { prev.disabled = row.scrollLeft <= 2; next.disabled = row.scrollLeft >= row.scrollWidth - row.clientWidth - 2; };
      prev.onclick = () => row.scrollBy({ left: -row.clientWidth, behavior: 'smooth' });
      next.onclick = () => row.scrollBy({ left: row.clientWidth, behavior: 'smooth' });
      row.addEventListener('scroll', update); update();
    });
  }

  /* ---------- Clicking the map ---------- */
  const visibleLayers = (suffixes, group) => OVERLAYS.filter((o) => o.group === group && overlayOn[o.key])
    .flatMap((o) => suffixes.map((s) => o.key + s)).filter((id) => map.getLayer(id));
  function openPlace(key, f) {
    openToken++;
    const p = f.properties, ll = f.geometry.coordinates;
    if (key === 'pHomes') return openHome(p.id);
    select('point', key, f.id);
    let html = '';
    if (key === 'pGrocery') html = placeCard(p.Name, [p.Address, p.City].filter(Boolean).join(', '), ll, p.Notes ? `<div class="note">${esc(p.Notes)}</div>` : '');
    else if (key === 'pFood') html = placeCard(p.USER_NAME, [p.USER_CATEGORY, p.USER_ADDRESS].filter(Boolean).join(' · '), ll);
    else if (key === 'pSchools') html = schoolCard(p, ll);
    openSheet(html, { noFull: key !== 'pSchools' }); sheetBody.onclick = null;
    revealPoint(ll);
  }
  async function openArea(key, f, ll) {
    openToken++;
    select('area', key, f.id);
    const p = f.properties;
    sheetBody.onclick = null;
    if (key === 'hoods') {
      openSheet('<div class="sub">Loading…</div>');
      const fc = await getJSON('data/neighborhoods.geojson');   // full shape (what the map hands back can be clipped to tiles)
      const full = fc.features.find((x) => x.properties.RegionID === p.RegionID) || f;
      const html = await hoodCard(p, full, ll);
      if (selected && selected.key === key && selected.id === f.id) { openSheet(html); if (mobile.matches) map.easeTo({ center: ll, offset: [0, -map.getContainer().clientHeight * 0.34], duration: 500 }); }
    } else if (key === 'tracts') openSheet(tractCard(p));
    else if (key === 'cities') openSheet(cityCard(p), { noFull: true });
    else if (key === 'sas') { const html = await sasCard(p); if (selected && selected.key === key && selected.id === f.id) openSheet(html); }
    const shape = key === 'hoods' ? null : f;   // neighborhoods fit themselves below
    if (shape && mobile.matches) map.easeTo({ center: ll, offset: [0, -map.getContainer().clientHeight * 0.34], duration: 500 });
  }
  // A tap on the map while a card or the layers panel is open only closes it (nothing gets selected).
  // Decided at touch-down, before the card/panel closes, so the next tap selects as normal.
  let dismissTap = false;
  map.getContainer().addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    if (e.target !== map.getCanvas()) { dismissTap = false; return; }   // buttons and controls don't count
    const panelOpen = [...document.querySelectorAll('.layers-panel')].some((el) => !el.hidden);
    // desktop: only the layers panel blocks the tap; an open card doesn't (clicking elsewhere just picks the next thing)
    dismissTap = panelOpen || searchOpen || searchClosedAt === e.timeStamp || (mobile.matches && sheet.classList.contains('open') && !sheetLock);
  }, true);
  map.on('click', async (e) => {
    if (dismissTap) { dismissTap = false; if (!sheetLock) closeSheet(); return; }
    // 1) places: clusters zoom in, dots open a card
    const pts = map.queryRenderedFeatures(e.point, { layers: visibleLayers(['-cluster', '-dot'], 'places') });
    if (pts.length) {
      const f = pts[0], key = f.layer.id.replace(/-(cluster|dot)$/, '');
      if (f.layer.id.endsWith('-cluster')) {
        const zoom = await map.getSource('ov-' + key).getClusterExpansionZoom(f.properties.cluster_id);
        map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.3, ZOOM.max) });
      } else openPlace(key, f);
      return;
    }
    const ll = [e.lngLat.lng, e.lngLat.lat];
    const areas = map.queryRenderedFeatures(e.point, { layers: visibleLayers(['-fill'], 'bounds') });
    const lots = map.getLayer('lots-hit') && map.getZoom() >= 15 ? map.queryRenderedFeatures(e.point, { layers: ['lots-hit'] }) : [];
    // 2) at street zoom a lot wins (unless a boundary layer is on and you're zoomed out a bit)
    if (lots.length && !(areas.length && map.getZoom() < 16)) { openLot(lots[0], ll); return; }
    // 3) boundary areas
    if (areas.length) { const f = areas[0]; openArea(f.layer.id.replace(/-fill$/, ''), f, ll); return; }
    // 4) empty map
    if (!sheetLock) closeSheet();
  });
  map.on('dragstart', () => { if (!sheetLock) closeSheet(); });
  map.on('mousemove', (e) => {
    const ids = [...visibleLayers(['-cluster', '-dot'], 'places'), ...visibleLayers(['-fill'], 'bounds')];
    if (map.getZoom() >= 15 && map.getLayer('lots-hit')) ids.push('lots-hit');
    map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? 'pointer' : '';
  });

  /* ---------- Search ----------
     Magnifier button opens a bar. Suggests saved homes, places (neighborhoods, cities, schools, restaurants,
     grocery stores, attendance areas) and lot addresses (data/addr/<first 2 chars of house number>.json).
     Picking one closes the bar, switches on its layer if needed, flies there and opens its card. */
  const WORDS = { street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl',
    terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w',
    northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw', saint: 'st', mount: 'mt' };
  const sNorm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 -]/g, ' ').replace(/-/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w).join(' ');
  // every typed word must start some word of the name; names that start with the whole query rank first
  function score(name, q, qw) {
    const n = sNorm(name); if (!n) return -1;
    const words = n.split(' ');
    if (!qw.every((t) => words.some((w) => w.startsWith(t)))) return -1;
    return n.startsWith(q) ? 0 : words.some((w) => w.startsWith(qw[0])) && n.includes(q) ? 1 : 2;
  }
  const SEARCH_SETS = [   // [layer key, label, file, name, sub]
    ['hoods', 'Neighborhood', 'data/neighborhoods.geojson', (p) => p.Name, (p) => title(p.City)],
    ['cities', 'City', 'data/cities.geojson', (p) => p.NAME, (p) => (/CDP$/.test(p.NAMELSAD || '') ? 'Census-designated place' : '')],
    ['pSchools', 'School', 'data/schools.geojson', (p) => p.Label_Name, (p) => title(p.CITY)],
    ['pFood', 'Restaurant', 'data/restaurants_named.geojson', (p) => p.USER_NAME, (p) => [p.USER_CATEGORY, p.USER_CITY].filter(Boolean).join(' · ')],
    ['pGrocery', 'Grocery store', 'data/groceryStores.geojson', (p) => p.Name, (p) => p.City],
    ['sas', 'Attendance area', 'data/schoolAttendanceAreas.geojson', (p) => p[SAS_ES] && p[SAS_ES] + ' area', (p) => p['SchoolAttendanceAreas_Clipped.Unified_SD_Name']],
  ];
  const SEARCH_ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.75" cy="10.75" r="6"/><path d="m15.25 15.25 4.25 4.25"/></svg>';
  document.body.insertAdjacentHTML('beforeend', `
    <button type="button" class="fab fab-search" aria-label="Search">${SEARCH_ICON}</button>
    <div class="search" hidden>
      <div class="search-bar">${SEARCH_ICON}<input type="search" placeholder="Search address, place, school…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search">
        <button type="button" class="search-x" aria-label="Clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div>
      <div class="search-list" role="listbox"></div>
    </div>`);
  const sBtn = document.querySelector('.fab-search'), sBox = document.querySelector('.search'),
        sInput = sBox.querySelector('input'), sList = sBox.querySelector('.search-list'), sX = sBox.querySelector('.search-x');
  let searchOpen = false, searchClosedAt = -1, sResults = [], sSeq = 0, sTimer = 0;
  function openSearch() {
    searchOpen = true; sBox.hidden = false; sBtn.hidden = true;
    sInput.focus(); runSearch();
    if (sb && !homesRows.size) loadHomes().catch(() => {});   // saved homes, if signed in
    SEARCH_SETS.forEach((s) => getJSON(s[2]).catch(() => null));   // warm up the name lists
  }
  function closeSearch() {
    if (!searchOpen) return;
    searchOpen = false; sBox.hidden = true; sBtn.hidden = false;
    sInput.value = ''; sList.innerHTML = ''; sResults = []; sInput.blur();
  }
  sBtn.addEventListener('click', openSearch);
  sX.addEventListener('click', () => { if (sInput.value) { sInput.value = ''; runSearch(); sInput.focus(); } else closeSearch(); });
  sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 120); });
  sInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
    if (e.key === 'Enter' && sResults[0]) { e.preventDefault(); pickResult(sResults[0]); }
  });
  document.addEventListener('pointerdown', (e) => {   // tap anywhere outside closes it (map taps are swallowed below)
    if (searchOpen && !sBox.contains(e.target) && e.target !== sBtn) { searchClosedAt = e.timeStamp; closeSearch(); }
  }, true);
  sList.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) pickResult(sResults[+li.dataset.i]); });

  async function runSearch() {
    const seq = ++sSeq, raw = sInput.value.trim(), q = sNorm(raw), qw = q ? q.split(' ') : [];
    sX.style.visibility = raw ? 'visible' : 'hidden';
    if (!q) { sResults = []; sList.innerHTML = ''; return; }
    const out = [];
    // saved homes
    for (const r of homesRows.values()) {
      const s = score(r.address || r.title, q, qw);
      if (s >= 0 && r.lat != null) out.push({ kind: 'home', s: -1, name: r.address || r.title || 'Home', sub: 'Saved home', id: r.id });
    }
    // named places
    const sets = await Promise.all(SEARCH_SETS.map((s) => getJSON(s[2]).catch(() => null)));
    if (seq !== sSeq) return;
    const named = [];
    SEARCH_SETS.forEach(([key, label, , nameOf, subOf], si) => {
      const fc = sets[si]; if (!fc) return;
      fc.features.forEach((f, i) => {
        if (!f.geometry) return;
        const name = nameOf(f.properties); const s = score(name, q, qw);
        if (s >= 0) named.push({ kind: 'feature', key, s, name, sub: [label, subOf(f.properties)].filter(Boolean).join(' · '), i });
      });
    });
    named.sort((a, b) => a.s - b.s || a.name.length - b.name.length);
    const seen = new Set();
    out.push(...named.filter((r) => { const k = r.key + '|' + sNorm(r.name); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8));
    // lot addresses (start with a house number)
    if (/^\d/.test(q) && (qw[0].length >= 2 || qw.length > 1)) {
      const rows = await getJSON('data/addr/' + qw[0].slice(0, 2) + '.json').catch(() => []);
      if (seq !== sSeq) return;
      const hits = [];
      for (const r of rows) {
        const n = (r._n ||= sNorm(r[0] + ' ' + r[1] + ' ' + r[2])); const words = n.split(' ');
        if (!words[0].startsWith(qw[0]) || !qw.slice(1).every((t) => words.some((w, k) => k > 0 && w.startsWith(t)))) continue;
        hits.push(r); if (hits.length > 400) break;
      }
      hits.sort((a, b) => (sNorm(a[0]).startsWith(q) ? 0 : 1) - (sNorm(b[0]).startsWith(q) ? 0 : 1) || a[0].length - b[0].length);
      for (const r of hits.slice(0, 8)) out.push({ kind: 'lot', s: 3, name: r[0], sub: [r[1], r[2]].filter(Boolean).join(' '), ll: [r[3], r[4]] });
    }
    sResults = out;
    const ICON = { home: 'pHomes', hoods: 'hood', cities: 'city', sas: 'sas', tracts: 'tract' };
    sList.innerHTML = out.length ? out.map((r, i) => {
      const k = r.kind === 'home' ? 'pHomes' : r.kind === 'lot' ? 'lot' : r.key;
      const ic = /^p[A-Z]/.test(k) ? `<img alt="" src="${drawPoint(k, themeNow()).toDataURL()}">` : k === 'lot' ? `<span class="si-pin">${PIN_SVG}</span>` : `<span class="si-area" style="--sw:${PALETTE[themeNow()][ICON[k]]}"></span>`;
      return `<button type="button" class="search-item" data-i="${i}">${ic}<span class="si-text"><b>${esc(r.name)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></button>`;
    }).join('') : `<div class="search-empty">No matches${/^\d/.test(q) && qw.length === 1 && qw[0].length < 2 ? ' yet' : ''}</div>`;
  }
  const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>';

  // Switch a layer on (and tick its box), then wait for its data to be on the map
  function layerOn(key) {
    if (!overlayOn[key]) { setOverlay(key, true); const box = document.querySelector(`.layers-switch[data-key="${key}"]`); if (box) box.checked = true; }
    return new Promise((res) => {
      const id = 'ov-' + key, t = setTimeout(res, 4000);
      const check = () => { if (map.getSource(id) && map.isSourceLoaded(id)) { clearTimeout(t); map.off('sourcedata', check); res(); } };
      map.on('sourcedata', check); check();
    });
  }
  async function pickResult(r) {
    closeSearch();
    if (!r) return;
    try {
      if (r.kind === 'home') {
        await layerOn('pHomes');
        openHome(r.id);
      } else if (r.kind === 'lot') {
        if (!sheetLock) closeSheet();
        map.easeTo({ center: r.ll, zoom: Math.max(map.getZoom(), 18), duration: 900 });
        await new Promise((res) => map.once('idle', res));
        const want = sNorm(r.name);
        const lots = map.getSource('lots') ? map.querySourceFeatures('lots', { sourceLayer: 'lots' }).filter((f) => sNorm(f.properties.addr) === want) : [];
        const f = lots.find((x) => inFeature(x, r.ll[0], r.ll[1])) || lots[0];
        if (f) openLot(f, r.ll); else toast('Couldn’t find that lot on the map.');
      } else {
        const set = SEARCH_SETS.find((s) => s[0] === r.key), fc = await getJSON(set[2]);
        const src = fc.features[r.i], f = { ...src, id: r.i };
        await layerOn(r.key);
        if (r.key.startsWith('p')) openPlace(r.key, f);
        else {
          const [x0, y0, x1, y1] = bboxOf(src), ll = [(x0 + x1) / 2, (y0 + y1) / 2];
          await openArea(r.key, f, ll);
          map.fitBounds([[x0, y0], [x1, y1]], { padding: sheetPad(), maxZoom: 16, duration: 800 });
        }
      }
    } catch (err) { toast(err.message || String(err)); }
  }

  // Opened from a home card on the home page (?pin=<id>): show Homes and go to it.
  const pinId = new URLSearchParams(location.search).get('pin');
  if (pinId) {
    const sw = () => document.querySelector('.layers-switch[data-key="pHomes"]');
    map.once('load', async () => {
      if (sw()) sw().checked = true;
      setOverlay('pHomes', true);
      try {
        const fc = homesData || await loadHomes();
        const f = fc.features.find((x) => String(x.id) === pinId);
        if (f) { map.jumpTo({ center: f.geometry.coordinates, zoom: 17 }); map.getSource('ov-pHomes').setData(fc); map.once('idle', () => openHome(f.id)); }
      } catch (err) { toast(err.message || String(err)); }
    });
  }

  // Follow the phone/computer light–dark setting, live.
  darkQuery.addEventListener('change', () => { map.setStyle(buildStyle(themeNow())); layersCtrl.recolor(); });

  // Only show the error banner if tiles keep failing.
  let tileErrors = 0;
  map.on('error', (e) => {
    console.warn('[map]', e && e.error ? e.error.message : e);
    if (e && e.sourceId && ++tileErrors > 8) errorBox.hidden = false;
  });
})();
