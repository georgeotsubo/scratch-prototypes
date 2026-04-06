(function() {
  // ========== STATE ==========
  let currentScreen = 'screen-map-default';
  let searchTerm = '';
  let locationTerm = '';
  let previousSearchTerm = '';
  let preserveMapView = false;
  let preserveMapContents = false; // skip pin/marker update when returning to map
  let returnScreen = null; // tracks which results screen to go back to when X is tapped
  let searchOpenedFromDefault = false; // true when search opened from map default (no fly needed on back)
  let activeTab = 'search';
  let mapPanned = false; // true when user has dragged the map from its original position

  // Autocomplete data
  const searchSuggestions = {
    'y': ['Yoga', 'Yoga Nidra'],
    'yo': ['Yoga', 'Yoga Nidra'],
    'yog': ['Yoga', 'Prenatal Yoga', 'Acro Yoga'],
    'yoga': ['Yoga', 'Prenatal Yoga', 'Acro Yoga'],
    'p': ['Pilates', 'Prenatal', 'Personal Training'],
    'pi': ['Pilates', 'Pilates Reformer'],
    'pil': ['Pilates', 'Pilates Reformer'],
    'b': ['Barre', 'Boxing', 'Bootcamp'],
    'ba': ['Barre', 'Barry\'s Bootcamp'],
    'bar': ['Barre', 'Barry\'s Bootcamp'],
    'bo': ['Boxing', 'Bootcamp'],
    'box': ['Boxing'],
    'c': ['Cycling', 'CrossFit'],
    'cy': ['Cycling', 'Cycling HIIT'],
    'd': ['Dance', 'Dance Cardio'],
    'da': ['Dance', 'Dance Cardio'],
    'h': ['HIIT', 'Hot Yoga'],
    'hi': ['HIIT'],
    'm': ['Meditation', 'Martial Arts'],
    'me': ['Meditation'],
    'ma': ['Martial Arts'],
    'r': ['Running', 'Reformer Pilates'],
    'ru': ['Running'],
    's': ['Sports recovery', 'Stretching'],
    'sp': ['Sports recovery', 'Spinning'],
    'g': ['Gym time'],
    'gy': ['Gym time'],
    'o': ['Outdoors'],
    'ou': ['Outdoors'],
    'cr': ['CrossFit'],
    'pe': ['Personal Training', 'Peloton'],
    'pr': ['Prenatal', 'Prenatal Yoga']
  };

  // ========== MAPBOX GEOCODING ==========
  const MAPBOX_TOKEN = window.MAPBOX_TOKEN;
  let geocodeAbort = null;
  let selectedLocationCenter = null; // [lng, lat] from geocoding
  let locationDebounceTimer = null;

  async function fetchLocationSuggestions(query) {
    if (geocodeAbort) geocodeAbort.abort();
    geocodeAbort = new AbortController();
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
      + `?access_token=${MAPBOX_TOKEN}`
      + `&autocomplete=true`
      + `&types=neighborhood,locality,place,postcode,address`
      + `&bbox=-74.3,40.4,-73.7,40.95`
      + `&limit=5`
      + `&country=US`;
    try {
      const res = await fetch(url, { signal: geocodeAbort.signal });
      const data = await res.json();
      return data.features.map(f => ({
        name: f.text,
        sub: f.place_name.replace(f.text + ', ', ''),
        center: f.center // [lng, lat]
      }));
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.error('Geocoding error:', e);
      return [];
    }
  }

  // ========== FOURSQUARE PLACES API ==========
  const FOURSQUARE_KEY = window.FOURSQUARE_KEY;
  let placesAbort = null;

  async function fetchNearbyPlaces(lat, lng, query) {
    if (placesAbort) placesAbort.abort();
    placesAbort = new AbortController();
    const params = new URLSearchParams({
      ll: `${lat},${lng}`,
      radius: 5000,
      limit: 50,
      sort: 'DISTANCE',
    });
    params.set('query', query || 'gym fitness yoga pilates');
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
    const baseUrl = `https://places-api.foursquare.com/places/search?${params}`;
    const url = isLocal ? `https://corsproxy.io/?url=${encodeURIComponent(baseUrl)}` : `/api/foursquare/places/search?${params}`;
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${FOURSQUARE_KEY}`,
          'Accept': 'application/json',
          'X-Places-Api-Version': '2025-06-17'
        },
        signal: placesAbort.signal
      });
      if (!res.ok) {
        console.warn('Foursquare API returned', res.status);
        return [];
      }
      const data = await res.json();
      if (!data.results) return [];
      return data.results.filter(p => p.latitude && p.longitude).map(p => ({
        name: p.name,
        lat: p.latitude,
        lng: p.longitude,
        category: (p.categories && p.categories[0] && p.categories[0].name) || '',
        address: (p.location && p.location.address) || '',
        locality: (p.location && p.location.locality) || '',
        distance: p.distance
      }));
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.warn('Foursquare error:', e);
      return [];
    }
  }

  // Display real places on map and in venue list
  function displayPlaces(places, screenId, search, location) {
    clearMarkers();
    places.forEach(p => addPinMarker(p.lng, p.lat));
    scheduleWaterCheck();
    populateVenueList(screenId, places, search, location);
  }

  // Fetch and display real places, replacing any placeholder pins
  async function loadRealPlaces(lat, lng, search, screenId, locationLabel) {
    const places = await fetchNearbyPlaces(lat, lng, search || '');
    console.log('Foursquare returned', places ? places.length : 0, 'places', places && places[0]);
    if (!places || places.length === 0) return; // keep existing pins as fallback
    displayPlaces(places, screenId, search, locationLabel);
  }

  // ========== PIN GENERATION (fallback/placeholder) ==========
  const REAL_STUDIOS = {
    'Yoga': [
      { name: 'Y7 Studio',         lat: 40.7422, lng: -73.9904 },
      { name: 'Sky Ting Yoga',      lat: 40.7155, lng: -73.9919 },
      { name: 'Sky Ting NoHo',      lat: 40.7265, lng: -73.9958 },
      { name: 'Modo Yoga NYC',      lat: 40.7338, lng: -73.9985 },
      { name: 'CorePower Yoga',     lat: 40.7349, lng: -73.9916 },
      { name: 'Lyons Den Yoga',     lat: 40.7390, lng: -74.0012 },
      { name: 'Yoga Vida',          lat: 40.7275, lng: -73.9957 },
      { name: 'Bhakti Center',      lat: 40.7230, lng: -73.9882 },
      { name: 'Laughing Lotus',     lat: 40.7410, lng: -73.9945 },
      { name: 'Yoga Shanti',        lat: 40.7660, lng: -73.9680 },
    ],
    'Pilates': [
      { name: 'SLT Flatiron',       lat: 40.7381, lng: -73.9914 },
      { name: 'SLT NoHo',           lat: 40.7298, lng: -73.9910 },
      { name: 'SLT Tribeca',        lat: 40.7155, lng: -74.0038 },
      { name: 'SLT West 14th',      lat: 40.7398, lng: -74.0018 },
      { name: 'Club Pilates',       lat: 40.7545, lng: -73.9920 },
      { name: 'New York Pilates',   lat: 40.7660, lng: -73.9641 },
      { name: 'SLT Brooklyn Hts',   lat: 40.6935, lng: -73.9910 },
      { name: 'SLT Williamsburg',   lat: 40.7135, lng: -73.9615 },
      { name: 'SLT NoMad',          lat: 40.7450, lng: -73.9860 },
      { name: 'Gramercy Pilates',   lat: 40.7370, lng: -73.9835 },
    ],
    'Barre': [
      { name: 'Physique 57 UES',    lat: 40.7646, lng: -73.9725 },
      { name: 'Physique 57 SoHo',   lat: 40.7233, lng: -73.9985 },
      { name: 'Pure Barre Flatiron',lat: 40.7445, lng: -73.9896 },
      { name: 'Barre3',             lat: 40.7808, lng: -73.9793 },
      { name: 'The Bar Method',     lat: 40.7440, lng: -73.9960 },
      { name: 'FlyBarre',           lat: 40.7200, lng: -74.0090 },
      { name: 'Exhale Barre',       lat: 40.7657, lng: -73.9790 },
      { name: 'Pop Physique',       lat: 40.7178, lng: -73.9575 },
    ],
    'Boxing': [
      { name: 'Rumble Chelsea',     lat: 40.7432, lng: -73.9966 },
      { name: 'Rumble NoHo',        lat: 40.7285, lng: -73.9935 },
      { name: 'Rumble UES',         lat: 40.7775, lng: -73.9540 },
      { name: 'Gotham Gym',         lat: 40.7370, lng: -73.9968 },
      { name: 'Church St Boxing',   lat: 40.7135, lng: -74.0082 },
      { name: 'Overthrow Boxing',   lat: 40.7258, lng: -73.9934 },
      { name: 'Gleason\'s Gym',     lat: 40.7025, lng: -73.9890 },
      { name: 'Shadowbox',          lat: 40.7493, lng: -73.9910 },
    ],
    'Cycling': [
      { name: 'SoulCycle 19th St',  lat: 40.7390, lng: -73.9932 },
      { name: 'SoulCycle NoHo',     lat: 40.7285, lng: -73.9925 },
      { name: 'SoulCycle Bryant Pk',lat: 40.7548, lng: -73.9860 },
      { name: 'SoulCycle E 63rd',   lat: 40.7638, lng: -73.9660 },
      { name: 'SoulCycle E 83rd',   lat: 40.7780, lng: -73.9550 },
      { name: 'SoulCycle W 77th',   lat: 40.7810, lng: -73.9795 },
      { name: 'CycleBar FiDi',      lat: 40.7075, lng: -74.0070 },
      { name: 'Peloton Studio',     lat: 40.7560, lng: -74.0040 },
      { name: 'Swerve Fitness',     lat: 40.7420, lng: -73.9950 },
    ],
    'Dance': [
      { name: '305 Fitness',        lat: 40.7355, lng: -73.9928 },
      { name: 'AKT',                lat: 40.7432, lng: -73.9958 },
      { name: 'Body By Simone',     lat: 40.7610, lng: -73.9860 },
      { name: 'BDC',                lat: 40.7588, lng: -73.9890 },
      { name: 'Alvin Ailey',        lat: 40.7660, lng: -73.9900 },
      { name: 'DanceFit Studio',    lat: 40.7395, lng: -73.9935 },
      { name: 'Vibe Ride',          lat: 40.7425, lng: -73.9912 },
      { name: 'Dance Body Fitness', lat: 40.7460, lng: -73.9920 },
    ],
    'HIIT': [
      { name: 'Barry\'s Chelsea',   lat: 40.7420, lng: -73.9920 },
      { name: 'Barry\'s UES',       lat: 40.7640, lng: -73.9610 },
      { name: 'Barry\'s E 86th',    lat: 40.7790, lng: -73.9545 },
      { name: 'Orangetheory FiDi',  lat: 40.7090, lng: -74.0070 },
      { name: 'F45 W 42nd',         lat: 40.7588, lng: -73.9955 },
      { name: 'Fhitting Room',      lat: 40.7445, lng: -73.9900 },
      { name: 'Tone House',         lat: 40.7770, lng: -73.9542 },
      { name: 'Switch Playground',  lat: 40.7548, lng: -73.9920 },
    ],
    'Bootcamp': [
      { name: 'Barry\'s Bootcamp',  lat: 40.7420, lng: -73.9920 },
      { name: 'The Fhitting Room',  lat: 40.7445, lng: -73.9900 },
      { name: 'Bootcamp Republic',  lat: 40.7548, lng: -73.9922 },
      { name: 'Sweat NYC',          lat: 40.7818, lng: -73.9790 },
      { name: 'Body Space Fitness', lat: 40.7545, lng: -73.9880 },
      { name: 'Camp Gladiator',     lat: 40.7680, lng: -73.9800 },
      { name: 'Grit Bxng',          lat: 40.7285, lng: -73.9940 },
      { name: 'Urban Athlete',      lat: 40.7200, lng: -74.0050 },
    ],
    'CrossFit': [
      { name: 'CrossFit Solace',    lat: 40.7465, lng: -73.9830 },
      { name: 'CrossFit Wall St',   lat: 40.7065, lng: -74.0100 },
      { name: 'CrossFit NYC',       lat: 40.7455, lng: -73.9922 },
      { name: 'ICE NYC',            lat: 40.7222, lng: -73.9985 },
      { name: 'Brick CrossFit',     lat: 40.7515, lng: -74.0040 },
      { name: 'CF South Brooklyn',  lat: 40.6730, lng: -73.9790 },
      { name: 'CF Prospect Heights',lat: 40.6810, lng: -73.9760 },
      { name: 'WillyB CrossFit',    lat: 40.7285, lng: -73.9510 },
    ],
    'Meditation': [
      { name: 'MNDFL',              lat: 40.7310, lng: -73.9930 },
      { name: 'Inscape',            lat: 40.7410, lng: -73.9935 },
      { name: 'The Path',           lat: 40.7210, lng: -73.9988 },
      { name: 'NY Insight',         lat: 40.7448, lng: -73.9898 },
      { name: 'Kadampa Center',     lat: 40.7460, lng: -73.9985 },
      { name: 'Open Center',        lat: 40.7450, lng: -73.9852 },
      { name: 'Calm Studio',        lat: 40.7395, lng: -74.0005 },
      { name: 'Breathe Meditation', lat: 40.7098, lng: -74.0115 },
    ],
    '_default': [
      { name: 'Equinox Flatiron',   lat: 40.7392, lng: -73.9900 },
      { name: 'Crunch Fitness',     lat: 40.7360, lng: -73.9940 },
      { name: 'TMPL Gym',           lat: 40.7580, lng: -73.9810 },
      { name: 'Peloton Studio',     lat: 40.7560, lng: -74.0040 },
      { name: 'Rumble Boxing',      lat: 40.7432, lng: -73.9966 },
      { name: 'SoulCycle',          lat: 40.7390, lng: -73.9932 },
      { name: 'Barry\'s',           lat: 40.7420, lng: -73.9920 },
      { name: 'Physique 57',        lat: 40.7233, lng: -73.9985 },
      { name: 'SLT',                lat: 40.7381, lng: -73.9914 },
      { name: 'CrossFit Solace',    lat: 40.7465, lng: -73.9830 },
      { name: 'Orangetheory',       lat: 40.7090, lng: -74.0070 },
      { name: 'Fhitting Room',      lat: 40.7445, lng: -73.9900 },
    ],
  };

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function seededRandom(seed) {
    let s = seed || 1;
    return function() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // Evenly-distributed offsets for spreading pins around a center point
  const LAND_OFFSETS = [
    [ 0.0052,  0.0038], [ 0.0038, -0.0055], [-0.0048,  0.0042], [-0.0060, -0.0035],
    [ 0.0075,  0.0025], [ 0.0028,  0.0068], [-0.0032, -0.0060], [-0.0070,  0.0018],
    [ 0.0090,  0.0050], [-0.0065, -0.0048], [ 0.0045,  0.0085], [-0.0085,  0.0030],
    [ 0.0080, -0.0042], [-0.0055,  0.0075], [ 0.0035,  0.0095], [-0.0042, -0.0080],
    [ 0.0062,  0.0070], [-0.0095,  0.0010], [ 0.0100, -0.0028], [-0.0025,  0.0100],
  ];

  // Build a name → category lookup from REAL_STUDIOS
  const STUDIO_TAGS = {
    'Equinox Flatiron': 'Gym',
    'Crunch Fitness': 'Gym',
    'TMPL Gym': 'Gym',
    'Peloton Studio': 'Cycling',
    'Rumble Boxing': 'Boxing',
    'SoulCycle': 'Cycling',
    "Barry's": 'HIIT',
    'Physique 57': 'Barre',
    'SLT': 'Pilates',
    'CrossFit Solace': 'CrossFit',
    'Orangetheory': 'HIIT',
    'Fhitting Room': 'HIIT',
  };
  for (const [category, studios] of Object.entries(REAL_STUDIOS)) {
    if (category === '_default') continue;
    studios.forEach(s => { if (!STUDIO_TAGS[s.name]) STUDIO_TAGS[s.name] = category; });
  }

  // Average center of the hardcoded NYC studio data
  const STUDIOS_CENTER_LAT = 40.7380, STUDIOS_CENTER_LNG = -73.9855;

  function generatePins(search, location, center, count) {
    const studios = REAL_STUDIOS[search] || REAL_STUDIOS['_default'];
    const seed = simpleHash((search || '') + (location || ''));
    const rand = seededRandom(seed || 1);
    const shuffled = studios.slice().sort(() => rand() - 0.5);
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));

    // If the center is far from the default NYC area, spread pins evenly around the new center
    const dLat = center.lat - STUDIOS_CENTER_LAT;
    const dLng = center.lng - STUDIOS_CENTER_LNG;
    if (Math.abs(dLat) > 0.02 || Math.abs(dLng) > 0.02) {
      const offsets = LAND_OFFSETS.slice().sort(() => rand() - 0.5);
      return selected.map((s, i) => ({
        name: s.name,
        lat: center.lat + offsets[i % offsets.length][0],
        lng: center.lng + offsets[i % offsets.length][1]
      }));
    }
    return selected;
  }

  // ========== MAP OFFSET HELPER ==========
  const MAP_CENTER_OFFSET_PX = 195;

  // ========== MAP SETUP ==========
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const mapDiv = document.getElementById('live-map');
  let userLat = null, userLng = null;
  const DEFAULT_LAT = 40.7380, DEFAULT_LNG = -73.9855;
  /** Single knob for initial + reset map zoom (constructor zoom is overridden on load by initDefaultMap). Lower = zoomed out. */
  const DEFAULT_MAP_ZOOM = 13;
  let userLocationMarker = null;

  const map = new mapboxgl.Map({
    container: 'live-map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [DEFAULT_LNG, DEFAULT_LAT],
    zoom: DEFAULT_MAP_ZOOM,
    attributionControl: false,
    scrollZoom: true,
    doubleClickZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: true
  });

  // Marker tracking (replaces Leaflet's layerGroup)
  let pinMarkers = [];

  function clearMarkers() {
    pinMarkers.forEach(m => m.remove());
    pinMarkers = [];
  }

  function createPinElement() {
    const el = document.createElement('div');
    el.className = 'playlist-pin';
    el.innerHTML = '<div class="pin-dot"></div>';
    return el;
  }

  function addPinMarker(lng, lat) {
    const m = new mapboxgl.Marker({ element: createPinElement() })
      .setLngLat([lng, lat])
      .addTo(map);
    pinMarkers.push(m);
    return m;
  }

  // Remove pins that landed on water after map tiles have rendered
  function isOnWater(lngLat) {
    const point = map.project(lngLat);
    const container = map.getContainer();
    // Pin is off-screen — can't query features, assume land
    if (point.x < 0 || point.y < 0 || point.x > container.clientWidth || point.y > container.clientHeight) return false;
    const bbox = [
      [point.x - 3, point.y - 3],
      [point.x + 3, point.y + 3]
    ];
    const features = map.queryRenderedFeatures(bbox);
    if (!features.length) return false;
    for (const f of features) {
      const src = f.sourceLayer || '';
      const id = f.layer.id || '';
      if (src === 'water' || id.startsWith('water')) return true;
      if (src === 'landuse' || src === 'building' || src === 'road' || id.startsWith('road') || id.startsWith('building') || id.startsWith('land')) return false;
    }
    return features.some(f => (f.sourceLayer || '').includes('water') || (f.layer.id || '').includes('water'));
  }

  function removeWaterPins() {
    pinMarkers = pinMarkers.filter(marker => {
      if (isOnWater(marker.getLngLat())) {
        marker.remove();
        return false;
      }
      return true;
    });
  }

  function scheduleWaterCheck() {
    // Small delay to ensure tiles are rendered before querying features
    setTimeout(() => {
      if (map.loaded()) {
        removeWaterPins();
      } else {
        map.once('idle', removeWaterPins);
      }
    }, 300);
  }

  const MAP_SCREENS = ['screen-map-default', 'screen-search-results', 'screen-location-results', 'screen-both-results'];

  // Map is now a persistent backdrop — no need to move it between screens
  function attachMapToScreen(screenId) {
    setTimeout(() => map.resize(), 50);
  }

  const VENUE_DESCRIPTIONS = [
    'A welcoming studio offering a variety of classes for all levels, from beginners to advanced practitioners.',
    'Modern facility with state-of-the-art equipment and experienced instructors dedicated to your fitness journey.',
    'Boutique fitness studio known for its intimate class sizes and personalized attention to each member.',
    'Community-focused space offering group classes, workshops, and private sessions in a supportive environment.',
  ];

  function generateVenueCardHTML(pins, search, location) {
    return pins.map((pin, i) => {
      const tags = search || pin.category || STUDIO_TAGS[pin.name] || 'Fitness';
      const distance = pin.distance != null ? (pin.distance / 1609.34).toFixed(1) : (0.1 + (i * 0.15)).toFixed(1);
      const rating = (4.5 + (i % 5) * 0.1).toFixed(1);
      const reviews = 50 + i * 37;
      const neighborhood = pin.locality || location || 'Manhattan';
      const desc = VENUE_DESCRIPTIONS[i % VENUE_DESCRIPTIONS.length];
      return `<div class="venue-card">
        <div class="venue-header">
          <div class="venue-image"></div>
          <div class="venue-info">
            <div class="venue-title">${pin.name}</div>
            <div class="venue-tags">${tags}</div>
            <div class="venue-subtitle">${distance} mi &middot; ${neighborhood}</div>
            <div class="venue-rating"><svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.93356 15.5117C3.79684 15.4102 3.71285 15.2734 3.6816 15.1016C3.65426 14.9336 3.67965 14.7344 3.75778 14.5039L4.96481 10.9238L1.88864 8.71484C1.68942 8.57422 1.55075 8.42773 1.47262 8.27539C1.3945 8.11914 1.38278 7.95898 1.43746 7.79492C1.49215 7.63477 1.59567 7.51562 1.74801 7.4375C1.90035 7.35547 2.09957 7.31641 2.34567 7.32031L6.11325 7.34375L7.26168 3.74609C7.3359 3.51172 7.43356 3.33398 7.55465 3.21289C7.67965 3.08789 7.82614 3.02539 7.9941 3.02539C8.16598 3.02539 8.31246 3.08789 8.43356 3.21289C8.55856 3.33398 8.65817 3.51172 8.73239 3.74609L9.88082 7.34375L13.6484 7.32031C13.8945 7.31641 14.0937 7.35547 14.2461 7.4375C14.3984 7.51562 14.5019 7.63477 14.5566 7.79492C14.6113 7.95898 14.5996 8.11914 14.5214 8.27539C14.4433 8.42773 14.3047 8.57422 14.1054 8.71484L11.0293 10.9238L12.2363 14.5039C12.3144 14.7344 12.3379 14.9336 12.3066 15.1016C12.2793 15.2734 12.1972 15.4102 12.0605 15.5117C11.9238 15.6211 11.7695 15.6602 11.5976 15.6289C11.4257 15.5977 11.2422 15.5117 11.0468 15.3711L7.9941 13.127L4.94723 15.3711C4.75192 15.5117 4.56832 15.5977 4.39645 15.6289C4.22457 15.6602 4.07028 15.6211 3.93356 15.5117Z" fill="#020203"/></svg> ${rating} (${reviews})</div>
          </div>
        </div>
        <div class="venue-desc">${desc}</div>
        <div class="venue-actions">
          <div class="venue-action-btn"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.53906 19.2969C5.14323 19.2969 4.82552 19.1667 4.58594 18.9062C4.34635 18.651 4.22656 18.3099 4.22656 17.8828V4.14062C4.22656 3.30729 4.44792 2.66927 4.89062 2.22656C5.33854 1.77865 5.97656 1.55469 6.80469 1.55469H13.1953C14.0182 1.55469 14.651 1.77865 15.0938 2.22656C15.5417 2.66927 15.7656 3.30729 15.7656 4.14062V17.8828C15.7656 18.3099 15.6458 18.651 15.4062 18.9062C15.1667 19.1667 14.849 19.2969 14.4531 19.2969C14.2031 19.2969 13.9792 19.2344 13.7812 19.1094C13.5833 18.9844 13.3281 18.7708 13.0156 18.4688L10.0625 15.5234C10.0208 15.4818 9.97917 15.4818 9.9375 15.5234L6.98438 18.4688C6.67708 18.7708 6.41927 18.9844 6.21094 19.1094C6.00781 19.2344 5.78385 19.2969 5.53906 19.2969ZM6.46094 16.0078L9.32031 13.2344C9.54948 13.0156 9.77604 12.9062 10 12.9062C10.224 12.9062 10.4505 13.0156 10.6797 13.2344L13.5391 16.0078C13.5911 16.0547 13.6406 16.0703 13.6875 16.0547C13.7344 16.0391 13.7578 15.9974 13.7578 15.9297V4.34375C13.7578 4.07292 13.6927 3.875 13.5625 3.75C13.4375 3.625 13.2396 3.5625 12.9688 3.5625H7.03125C6.75521 3.5625 6.55469 3.625 6.42969 3.75C6.30469 3.875 6.24219 4.07292 6.24219 4.34375V15.9297C6.24219 15.9974 6.26562 16.0391 6.3125 16.0547C6.35938 16.0703 6.40885 16.0547 6.46094 16.0078Z" fill="#020203"/></svg> Save</div>
          <div class="venue-action-btn"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.86719 17.7031C3.20312 17.7031 2.29688 16.8047 2.29688 15.1484V6.19531C2.29688 4.53906 3.20312 3.64844 4.86719 3.64844H15.1328C16.7969 3.64844 17.6953 4.54688 17.6953 6.19531V15.1484C17.6953 16.8047 16.7969 17.7031 15.1328 17.7031H4.86719ZM4.96875 15.8984H15.0234C15.5859 15.8984 15.8984 15.6172 15.8984 15.0234V8.39062C15.8984 7.78906 15.5859 7.51562 15.0234 7.51562H4.96875C4.40625 7.51562 4.10156 7.78906 4.10156 8.39062V15.0234C4.10156 15.6172 4.40625 15.8984 4.96875 15.8984ZM8.60156 9.95312C8.33594 9.95312 8.24219 9.86719 8.24219 9.59375V9.16406C8.24219 8.89062 8.33594 8.8125 8.60156 8.8125H9.03906C9.30469 8.8125 9.39844 8.89062 9.39844 9.16406V9.59375C9.39844 9.86719 9.30469 9.95312 9.03906 9.95312H8.60156ZM10.9688 9.95312C10.6953 9.95312 10.6016 9.86719 10.6016 9.59375V9.16406C10.6016 8.89062 10.6953 8.8125 10.9688 8.8125H11.3984C11.6719 8.8125 11.7656 8.89062 11.7656 9.16406V9.59375C11.7656 9.86719 11.6719 9.95312 11.3984 9.95312H10.9688ZM13.3359 9.95312C13.0625 9.95312 12.9688 9.86719 12.9688 9.59375V9.16406C12.9688 8.89062 13.0625 8.8125 13.3359 8.8125H13.7656C14.0391 8.8125 14.1328 8.89062 14.1328 9.16406V9.59375C14.1328 9.86719 14.0391 9.95312 13.7656 9.95312H13.3359ZM6.24219 12.2734C5.96875 12.2734 5.875 12.1953 5.875 11.9219V11.4922C5.875 11.2188 5.96875 11.1328 6.24219 11.1328H6.67188C6.94531 11.1328 7.03906 11.2188 7.03906 11.4922V11.9219C7.03906 12.1953 6.94531 12.2734 6.67188 12.2734H6.24219ZM8.60156 12.2734C8.33594 12.2734 8.24219 12.1953 8.24219 11.9219V11.4922C8.24219 11.2188 8.33594 11.1328 8.60156 11.1328H9.03906C9.30469 11.1328 9.39844 11.2188 9.39844 11.4922V11.9219C9.39844 12.1953 9.30469 12.2734 9.03906 12.2734H8.60156ZM10.9688 12.2734C10.6953 12.2734 10.6016 12.1953 10.6016 11.9219V11.4922C10.6016 11.2188 10.6953 11.1328 10.9688 11.1328H11.3984C11.6719 11.1328 11.7656 11.2188 11.7656 11.4922V11.9219C11.7656 12.1953 11.6719 12.2734 11.3984 12.2734H10.9688ZM13.3359 12.2734C13.0625 12.2734 12.9688 12.1953 12.9688 11.9219V11.4922C12.9688 11.2188 13.0625 11.1328 13.3359 11.1328H13.7656C14.0391 11.1328 14.1328 11.2188 14.1328 11.4922V11.9219C14.1328 12.1953 14.0391 12.2734 13.7656 12.2734H13.3359ZM6.24219 14.6016C5.96875 14.6016 5.875 14.5156 5.875 14.25V13.8125C5.875 13.5469 5.96875 13.4609 6.24219 13.4609H6.67188C6.94531 13.4609 7.03906 13.5469 7.03906 13.8125V14.25C7.03906 14.5156 6.94531 14.6016 6.67188 14.6016H6.24219ZM8.60156 14.6016C8.33594 14.6016 8.24219 14.5156 8.24219 14.25V13.8125C8.24219 13.5469 8.33594 13.4609 8.60156 13.4609H9.03906C9.30469 13.4609 9.39844 13.5469 9.39844 13.8125V14.25C9.39844 14.5156 9.30469 14.6016 9.03906 14.6016H8.60156ZM10.9688 14.6016C10.6953 14.6016 10.6016 14.5156 10.6016 14.25V13.8125C10.6016 13.5469 10.6953 13.4609 10.9688 13.4609H11.3984C11.6719 13.4609 11.7656 13.5469 11.7656 13.8125V14.25C11.7656 14.5156 11.6719 14.6016 11.3984 14.6016H10.9688Z" fill="#020203"/></svg> Schedule</div>
        </div>
      </div>`;
    }).join('');
  }

  function populateVenueList(screenId, pins, search, location) {
    const listMap = {
      'screen-map-default': 'venue-list-default',
      'screen-search-results': 'venue-list-search',
      'screen-location-results': 'venue-list-location',
      'screen-both-results': 'venue-list-both'
    };
    const listId = listMap[screenId];
    if (listId) {
      const el = document.getElementById(listId);
      if (el) {
        el.innerHTML = generateVenueCardHTML(pins, search, location);
      }
    }
  }

  const LOCATION_PIN_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="12" fill="#E03C31"/><path d="M11.8682 5C12.3944 5.00001 12.8742 5.12738 13.3076 5.38281C13.741 5.63835 14.0854 5.98338 14.3408 6.41699C14.5963 6.85068 14.7246 7.3308 14.7246 7.85742C14.7246 8.48472 14.5425 9.04635 14.1787 9.54199C13.8149 10.0298 13.3542 10.3669 12.7969 10.5527V16.4189C12.7969 16.9688 12.7581 17.4917 12.6807 17.9873C12.6033 18.4751 12.4948 18.8739 12.3555 19.1836C12.2239 19.4856 12.0616 19.6367 11.8682 19.6367C11.6746 19.6367 11.5045 19.4817 11.3574 19.1719C11.2181 18.8621 11.1096 18.4634 11.0322 17.9756C10.9626 17.48 10.9277 16.961 10.9277 16.4189V10.5527C10.3704 10.3591 9.90971 10.0182 9.5459 9.53027C9.18209 9.04237 9 8.48472 9 7.85742C9 7.3308 9.12835 6.85465 9.38379 6.42871C9.64697 5.99507 9.99526 5.65008 10.4287 5.39453C10.8621 5.13136 11.3419 5 11.8682 5ZM11.1602 6.18457C10.9202 6.18457 10.7073 6.278 10.5215 6.46387C10.3358 6.64971 10.2422 6.8625 10.2422 7.10254C10.25 7.35028 10.3435 7.56711 10.5215 7.75293C10.7072 7.93095 10.9203 8.02051 11.1602 8.02051C11.4077 8.02043 11.6209 7.93098 11.7988 7.75293C11.9767 7.56715 12.0654 7.35021 12.0654 7.10254C12.0654 6.86264 11.9766 6.64963 11.7988 6.46387C11.6209 6.27808 11.4077 6.18465 11.1602 6.18457Z" fill="white"/></svg>';

  function createUserLocationElement() {
    const el = document.createElement('div');
    el.className = 'playlist-pin user-location-wrapper';
    el.innerHTML = '<div class="user-location-dot"></div>';
    return el;
  }

  function createLocationPinElement() {
    const el = document.createElement('div');
    el.className = 'playlist-pin';
    el.innerHTML = LOCATION_PIN_SVG;
    return el;
  }

  // Persistent current-location marker — always visible when we have geolocation
  let currentLocMarker = null;

  function ensureCurrentLocMarker(lng, lat) {
    const mLng = lng != null ? lng : (userLng != null ? userLng : DEFAULT_LNG);
    const mLat = lat != null ? lat : (userLat != null ? userLat : DEFAULT_LAT);
    if (currentLocMarker) {
      currentLocMarker.setLngLat([mLng, mLat]);
    } else {
      currentLocMarker = new mapboxgl.Marker({ element: createUserLocationElement() })
        .setLngLat([mLng, mLat])
        .addTo(map);
    }
  }

  // Searched-location pin marker (red pin) — shown when a location is searched
  let userMarkerType = 'user'; // 'user' or 'location'

  function setUserMarker(lng, lat, type) {
    if (type === 'user') {
      // No separate marker needed — current location dot handles this
      if (userLocationMarker) {
        userLocationMarker.remove();
        userLocationMarker = null;
      }
      ensureCurrentLocMarker(lng, lat);
      return;
    }
    // Show the red location pin for searched locations
    if (userLocationMarker && userMarkerType === type) {
      userLocationMarker.setLngLat([lng, lat]);
    } else {
      if (userLocationMarker) userLocationMarker.remove();
      userLocationMarker = new mapboxgl.Marker({ element: createLocationPinElement() })
        .setLngLat([lng, lat])
        .addTo(map);
    }
    userMarkerType = type;
    ensureCurrentLocMarker();
  }

  function showUserLocation() {
    if (userLat && userLng) {
      ensureCurrentLocMarker();
    }
  }

  function updateMapForCurrentState() {
    expandSheets();
    let keepView = preserveMapView;
    preserveMapView = false;
    if (preserveMapContents) { preserveMapContents = false; return; }
    let loc;
    if (locationTerm === 'Mapped area') {
      const center = map.getCenter();
      const centerPx = map.project(center);
      const visibleCenterPx = new mapboxgl.Point(centerPx.x, centerPx.y - MAP_CENTER_OFFSET_PX);
      const visibleCenter = map.unproject(visibleCenterPx);
      loc = { lat: visibleCenter.lat, lng: visibleCenter.lng, zoom: map.getZoom() };
      keepView = true;
    } else if (selectedLocationCenter) {
      loc = { lat: selectedLocationCenter[1], lng: selectedLocationCenter[0], zoom: DEFAULT_MAP_ZOOM };
    } else if (locationTerm === 'Current location' && userLat && userLng) {
      loc = { lat: userLat, lng: userLng, zoom: map.getZoom() };
    } else if (!locationTerm || currentScreen === 'screen-map-default') {
      // No explicit location — use current visible map center so panning is preserved
      const center = map.getCenter();
      const centerPx = map.project(center);
      const visibleCenterPx = new mapboxgl.Point(centerPx.x, centerPx.y - MAP_CENTER_OFFSET_PX);
      const visibleCenter = map.unproject(visibleCenterPx);
      loc = { lat: visibleCenter.lat, lng: visibleCenter.lng, zoom: map.getZoom() };
      keepView = true;
    } else {
      loc = { lat: DEFAULT_LAT, lng: DEFAULT_LNG, zoom: DEFAULT_MAP_ZOOM };
    }
    clearMarkers();
    // Pick icon: current location → circle dot, searched location → pin badge
    const isCurrentLoc = !locationTerm || locationTerm === 'Current location';
    setUserMarker(loc.lng, loc.lat, isCurrentLoc ? 'user' : 'location');

    const effectiveSearch = searchTerm || (currentScreen === 'screen-map-default' ? '' : '');
    const effectiveLocation = locationTerm || '';

    // Animate map to target location
    const isResultsScreen = currentScreen !== 'screen-map-default';
    if (keepView) {
      // Map is already in the right position — don't animate
    } else if (isResultsScreen) {
      map.flyTo({ center: [loc.lng, loc.lat], zoom: DEFAULT_MAP_ZOOM, offset: [0, -MAP_CENTER_OFFSET_PX], duration: 800 });
    } else {
      if (currentScreen === 'screen-map-default') {
        map.easeTo({ center: [loc.lng, loc.lat], zoom: loc.zoom, offset: [0, -MAP_CENTER_OFFSET_PX], duration: 0 });
      } else {
        map.flyTo({ center: [loc.lng, loc.lat], zoom: loc.zoom, offset: [0, -MAP_CENTER_OFFSET_PX], duration: 800 });
      }
    }

    // Fetch real places from Foursquare (no placeholder pins)
    loadRealPlaces(loc.lat, loc.lng, effectiveSearch, currentScreen, effectiveLocation || 'Nearby');
  }

  // ========== GEOLOCATION (primary init) ==========
  function initDefaultMap(lat, lng, zoom, locationLabel, skipSetView) {
    if (!skipSetView) {
      map.easeTo({ center: [lng, lat], zoom: zoom, offset: [0, -MAP_CENTER_OFFSET_PX], duration: 0 });
    }
    clearMarkers();
    ensureCurrentLocMarker(lng, lat);

    // Load real places from Foursquare directly (no placeholder pins)
    loadRealPlaces(lat, lng, '', 'screen-map-default', locationLabel);
  }

  // Show NYC default immediately so venue cards appear right away
  // Force map to render correctly — Mapbox can miss initial paint in some contexts
  window.addEventListener('load', () => {
    map.resize();
    // Belt-and-suspenders: also resize after a few frames
    requestAnimationFrame(() => {
      map.resize();
      requestAnimationFrame(() => map.resize());
    });
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) map.resize(); });
  // Periodic resize check for the first 2 seconds
  let resizeChecks = 0;
  const resizeInterval = setInterval(() => {
    map.resize();
    if (++resizeChecks >= 10) clearInterval(resizeInterval);
  }, 200);

  map.on('load', function() {
    map.resize();

    // Remove all text labels from the map
    map.getStyle().layers.forEach(layer => {
      if (layer.type === 'symbol') {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });
    initDefaultMap(40.7380, -73.9855, DEFAULT_MAP_ZOOM, 'Manhattan');
    document.querySelectorAll('.map-nav-btn').forEach(b => b.classList.add('active'));
  });

  // Then try to get actual location and update
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        if (!locationTerm) {
          locationTerm = 'Current location';
        }
        if (currentScreen === 'screen-map-default') {
          initDefaultMap(userLat, userLng, DEFAULT_MAP_ZOOM, 'Nearby');
        }
      },
      function() { /* already showing NYC default */ },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  // ========== SCREEN MANAGEMENT ==========
  function showScreen(id, animation) {
    const ANIM_CLASSES = ['anim-fade-in', 'anim-fade-out', 'anim-fade-out-behind', 'anim-bg-fade-in', 'anim-bg-fade-out', 'anim-slide-up', 'anim-slide-down', 'anim-screen-fade-in'];
    const previousScreen = currentScreen;
    const previousEl = previousScreen ? document.getElementById(previousScreen) : null;
    const target = document.getElementById(id);
    const isTargetInput = target.classList.contains('input-screen');
    const isPrevInput = previousEl && previousEl.classList.contains('input-screen');
    const isTargetMap = MAP_SCREENS.includes(id);
    const isPrevMap = MAP_SCREENS.includes(previousScreen);
    const isLocation = false;
    const shouldSearchSlideUp = false;
    const shouldGoBackToLocation = false;
    const wasLocation = false;

    // Helper: deactivate all screens except specific ones
    function deactivateOthers(keep) {
      document.querySelectorAll('.screen').forEach(s => {
        if (!keep.includes(s)) {
          s.classList.remove('active', ...ANIM_CLASSES);
          const sb = s.querySelector('.status-bar');
          if (sb) sb.style.visibility = '';
        }
      });
    }

    // --- BACK: search-focused fades OUT back to location-focused ---
    if (shouldGoBackToLocation && id === 'screen-location-focused' && previousEl) {
      document.querySelectorAll('.screen').forEach(s => {
        if (s !== previousEl) s.classList.remove('active', ...ANIM_CLASSES);
      });
      target.classList.add('active');
      previousEl.classList.add('anim-bg-fade-out');
      previousEl.addEventListener('animationend', function handler() {
        previousEl.removeEventListener('animationend', handler);
        previousEl.classList.remove('active', ...ANIM_CLASSES);
      }, { once: true });
      currentScreen = id;
      return;
    }

    // --- ENTER: search-focused fades IN over location-focused ---
    if (shouldSearchSlideUp && id === 'screen-search-focused' && previousEl) {
      document.querySelectorAll('.screen').forEach(s => { if (s !== previousEl) s.classList.remove('active', ...ANIM_CLASSES); });
      target.classList.add('active', 'anim-screen-fade-in');
      const kb = target.querySelector('.keyboard');
      if (kb) { kb.classList.add('anim-kb-slide-up'); kb.addEventListener('animationend', () => kb.classList.remove('anim-kb-slide-up'), { once: true }); }
      const sbc = target.querySelector('.search-bar-container');
      if (sbc) { sbc.classList.add('anim-search-enter'); sbc.addEventListener('animationend', () => sbc.classList.remove('anim-search-enter'), { once: true }); }
      target.addEventListener('animationend', function handler() {
        target.removeEventListener('animationend', handler);
        target.classList.remove('anim-screen-fade-in');
        previousEl.classList.remove('active', ...ANIM_CLASSES);
      }, { once: true });
      currentScreen = id;
      return;
    }

    // --- EXIT: location screen slides down (map targets only) ---
    const needsSlideDown = isPrevInput && previousEl && wasLocation && isTargetMap && !shouldSearchSlideUp;
    if (needsSlideDown) {
      deactivateOthers([previousEl, target]);
      target.classList.add('active');
      previousEl.classList.add('anim-slide-down');
      previousEl.addEventListener('animationend', function handler() {
        previousEl.removeEventListener('animationend', handler);
        previousEl.classList.remove('active', ...ANIM_CLASSES);
      }, { once: true });
      currentScreen = id;
      attachMapToScreen(id);
      updateMapForCurrentState();
      return;
    }

    // --- EXIT: location screen fades out to search-focused ---
    const needsFadeOutToSearch = isPrevInput && previousEl && wasLocation && !isTargetMap && !isLocation && !shouldSearchSlideUp;
    if (needsFadeOutToSearch) {
      // Reveal search-focused immediately underneath, fade location out on top
      document.querySelectorAll('.screen').forEach(s => { if (s !== previousEl) s.classList.remove('active', ...ANIM_CLASSES); });
      target.classList.add('active');
      const sbc = target.querySelector('.search-bar-container');
      if (sbc) { sbc.classList.add('anim-search-enter'); sbc.addEventListener('animationend', () => sbc.classList.remove('anim-search-enter'), { once: true }); }
      previousEl.classList.add('anim-fade-out');
      previousEl.addEventListener('animationend', function handler() {
        previousEl.removeEventListener('animationend', handler);
        previousEl.classList.remove('active', ...ANIM_CLASSES);
        const prevSbc = previousEl.querySelector('.search-bar-container');
        if (prevSbc) prevSbc.classList.remove('anim-search-exit');
      }, { once: true });
      currentScreen = id;
      return;
    }

    // --- EXIT: search-focused → map: reverse enter animations ---
    const isSearchExit = previousScreen === 'screen-search-focused' && isTargetMap && previousEl;
    if (isSearchExit) {
      deactivateOthers([previousEl, target]);
      target.classList.add('active');
      // Clear any leftover enter animation classes before applying exit
      previousEl.classList.remove(...ANIM_CLASSES);
      // Fade out background and content (toggle, content-area) — keyboard excluded via CSS
      previousEl.classList.add('anim-bg-fade-out');
      // Slide keyboard down (reverse of slide-up on enter)
      const prevKb = previousEl.querySelector('.keyboard');
      if (prevKb) {
        prevKb.classList.add('anim-kb-slide-down');
        prevKb.addEventListener('animationend', function handler() {
          prevKb.removeEventListener('animationend', handler);
          prevKb.classList.remove('anim-kb-slide-down');
          previousEl.classList.remove('active', ...ANIM_CLASSES);
          attachMapToScreen(id);
          updateMapForCurrentState();
        }, { once: true });
      } else {
        previousEl.addEventListener('animationend', function handler() {
          previousEl.removeEventListener('animationend', handler);
          previousEl.classList.remove('active', ...ANIM_CLASSES);
          attachMapToScreen(id);
          updateMapForCurrentState();
        }, { once: true });
      }
      // Slide close button out (reverse of slide-in on enter)
      const prevSbc = previousEl.querySelector('.search-bar-container');
      if (prevSbc) {
        prevSbc.classList.add('anim-search-exit');
        prevSbc.addEventListener('animationend', () => prevSbc.classList.remove('anim-search-exit'), { once: true });
      }
      currentScreen = id;
      return;
    }

    // --- ENTER: location screen fades in ---
    if (isLocation && previousEl) {
      document.querySelectorAll('.screen').forEach(s => { if (s !== previousEl) s.classList.remove('active', ...ANIM_CLASSES); });
      target.classList.add('active');
      const kb = target.querySelector('.keyboard');
      if (kb) { kb.classList.add('anim-kb-slide-up'); kb.addEventListener('animationend', () => kb.classList.remove('anim-kb-slide-up'), { once: true }); }
      const sbc = target.querySelector('.search-bar-container');
      if (sbc) { sbc.classList.add('anim-search-enter'); sbc.addEventListener('animationend', () => sbc.classList.remove('anim-search-enter'), { once: true }); }
      if (isPrevInput) {
        // Direct reveal: previous input screen fades out on top
        previousEl.classList.add('anim-fade-out');
        previousEl.addEventListener('animationend', function handler() {
          previousEl.removeEventListener('animationend', handler);
          previousEl.classList.remove('active', ...ANIM_CLASSES);
        }, { once: true });
      } else {
        // From map: fade the grey background in
        target.classList.add('anim-bg-fade-in');
        previousEl.classList.remove('active', ...ANIM_CLASSES);
      }
    } else if (id === 'screen-search-focused' && isPrevMap) {
      // Cross-fade: map fades out behind while search fades in on top
      document.querySelectorAll('.screen').forEach(s => {
        if (s !== previousEl && s !== target) s.classList.remove('active', ...ANIM_CLASSES);
      });
      // Map fades out (no z-index boost so search screen paints on top)
      previousEl.classList.add('anim-fade-out-behind');
      previousEl.addEventListener('animationend', function handler() {
        previousEl.removeEventListener('animationend', handler);
        previousEl.classList.remove('active', ...ANIM_CLASSES);
      }, { once: true });
      // Search screen fades in on top
      target.classList.add('active', 'anim-bg-fade-in');
      const kb = target.querySelector('.keyboard');
      if (kb) {
        kb.classList.add('anim-kb-slide-up');
        kb.addEventListener('animationend', () => kb.classList.remove('anim-kb-slide-up'), { once: true });
      }
    } else {
      // Default: instant swap
      document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active', ...ANIM_CLASSES);
      });
      target.classList.add('active');
    }

    currentScreen = id;

    if (isTargetMap) {
      attachMapToScreen(id);
      updateMapForCurrentState();
    }

  }

  // ========== HINT ==========
  const hint = document.getElementById('hint');
  if (hint) {
    setTimeout(() => hint.classList.add('fade-out'), 3000);
    setTimeout(() => hint.remove(), 3500);
  }

  // ========== SEARCH INPUT LOGIC ==========
  const searchInput = document.getElementById('search-input-field');
  const searchClear = document.getElementById('search-clear');
  const searchClose = document.getElementById('search-close');
  const exploreSection = document.getElementById('explore-section');
  const searchAutocomplete = document.getElementById('search-autocomplete');
  const searchAutocompleteList = document.getElementById('search-autocomplete-list');
  const searchSubmitBtn = document.getElementById('search-submit-btn');
  const searchBackspace = document.getElementById('search-backspace');
  let searchInputFocused = false;

  searchInput.addEventListener('focus', () => { searchInputFocused = true; updateSearchUI(); });
  searchInput.addEventListener('blur', () => { searchInputFocused = false; updateSearchUI(); });

  function updateSearchUI() {
    const val = searchInput.value;
    searchTerm = val;

    // Show/hide clear button — only when field is focused and has text
    if (val.length > 0 && searchInputFocused) {
      searchClear.classList.remove('hidden');
    } else {
      searchClear.classList.add('hidden');
    }

    // Update search button style
    if (val.length > 0) {
      searchSubmitBtn.classList.add('active-search');
    } else {
      searchSubmitBtn.classList.remove('active-search');
    }

    // Show explore or autocomplete
    const key = val.toLowerCase();
    const suggestions = searchSuggestions[key];

    const searchRecentsSection = document.getElementById('search-recents-section');
    if (val.length === 0) {
      exploreSection.classList.remove('hidden');
      searchAutocomplete.classList.add('hidden');
      if (searchRecents.length > 0) searchRecentsSection.classList.remove('hidden');
    } else if (suggestions) {
      exploreSection.classList.add('hidden');
      searchRecentsSection.classList.add('hidden');
      searchAutocomplete.classList.remove('hidden');
      renderSearchSuggestions(suggestions, val);
    } else if (val.trim().length > 0) {
      exploreSection.classList.add('hidden');
      searchRecentsSection.classList.add('hidden');
      searchAutocomplete.classList.remove('hidden');
      renderSearchSuggestions([val.trim()], val);
    } else {
      exploreSection.classList.add('hidden');
      searchRecentsSection.classList.add('hidden');
      searchAutocomplete.classList.add('hidden');
    }
  }

  function renderSearchSuggestions(items, query) {
    searchAutocompleteList.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      const displayText = highlightMatch(item, query);
      div.innerHTML = `
        <div class="ac-icon">
          <svg viewBox="0 0 20 20" fill="none" stroke="#8e8e93" stroke-width="2"><circle cx="8.5" cy="8.5" r="6.5"/><line x1="13.5" y1="13.5" x2="18" y2="18" stroke-linecap="round"/></svg>
        </div>
        <div class="ac-text">${displayText}</div>
      `;
      div.addEventListener('click', () => {
        searchTerm = item;
        submitSearch();
      });
      searchAutocompleteList.appendChild(div);
    });
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${before}<strong>${match}</strong>${after}`;
  }

  const searchRecents = [];
  const MAX_SEARCH_RECENTS = 5;

  function addSearchRecent(term) {
    if (!term) return;
    // Remove duplicate if exists
    const idx = searchRecents.indexOf(term);
    if (idx !== -1) searchRecents.splice(idx, 1);
    // Add to front
    searchRecents.unshift(term);
    if (searchRecents.length > MAX_SEARCH_RECENTS) searchRecents.pop();
    renderSearchRecents();
  }

  function renderSearchRecents() {
    const section = document.getElementById('search-recents-section');
    const list = document.getElementById('search-recents-list');
    if (searchRecents.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    list.innerHTML = '';
    searchRecents.forEach(term => {
      const div = document.createElement('div');
      div.className = 'chip';
      div.textContent = term;
      div.addEventListener('click', () => {
        searchTerm = term;
        submitSearch();
      });
      list.appendChild(div);
    });
  }

  function submitSearch() {
    if (!searchTerm) {
      locationTerm = locationTerm || 'Current location';
    }

    // If user panned the map and didn't explicitly set a location, use "Mapped area"
    if (mapPanned && (!locationTerm || locationTerm === 'Current location')) {
      locationTerm = 'Mapped area';
    }

    if (searchTerm) addSearchRecent(searchTerm);
    const loc = locationTerm || 'Current location';

    if (searchTerm && locationTerm) {
      document.getElementById('both-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 ' + locationTerm + '</span>';
      showScreen('screen-both-results', 'fade-in');
    } else if (locationTerm && !searchTerm) {
      document.getElementById('locresults-search-text').textContent = locationTerm;
      showScreen('screen-location-results', 'fade-in');
    } else {
      document.getElementById('results-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 ' + loc + '</span>';
      showScreen('screen-search-results', 'fade-in');
    }
  }

  // Search input events
  searchInput.addEventListener('input', updateSearchUI);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchTerm = searchInput.value;
      if (!locationInput.value) locationTerm = '';
      submitSearch();
    }
  });

  searchClear.addEventListener('mousedown', (e) => {
    e.preventDefault();
    searchInput.value = '';
    searchTerm = '';
    updateSearchUI();
    searchInput.focus();
  });

  searchClose.addEventListener('click', () => {
    const hasSearch = searchInput.value.trim().length > 0;
    const hasLocation = locationInput.value.trim().length > 0;

    if (!hasSearch && !hasLocation) {
      // Both empty — go to default map, keep map where it is
      returnScreen = null;
      searchOpenedFromDefault = false;
      searchTerm = '';
      // keep locationTerm so the location field placeholder persists on next open
      document.querySelector('#hotspot-search-default span:last-child').textContent = 'Search for yoga, barre, cycling...';
      updateSearchUI();
      updateLocationUI();
      preserveMapView = true;
      preserveMapContents = true;
      showScreen('screen-map-default', 'fade-in');
    } else {
      // Fields have content — go to results
      searchTerm = searchInput.value;
      locationTerm = locationInput.value || locationTerm || '';
      submitSearch();
    }
  });

  searchSubmitBtn.addEventListener('click', () => {
    if (activeTab === 'location' && locationInput.value.length > 0) {
      locationTerm = locationInput.value;
      selectLocation();
    } else {
      searchTerm = searchInput.value;
      if (!locationInput.value) locationTerm = '';
      submitSearch();
    }
  });

  searchBackspace.addEventListener('click', () => {
    if (activeTab === 'location') {
      const val = locationInput.value;
      if (val.length > 0) { locationInput.value = val.slice(0, -1); updateLocationUI(); }
    } else {
      const val = searchInput.value;
      if (val.length > 0) { searchInput.value = val.slice(0, -1); updateSearchUI(); }
    }
  });

  // Visual keyboard keys — route to active tab's input
  document.querySelectorAll('#keyboard-search .key[data-key]').forEach(key => {
    key.addEventListener('click', () => {
      if (activeTab === 'location') {
        locationInput.value += key.dataset.key;
        updateLocationUI();
      } else {
        searchInput.value += key.dataset.key;
        updateSearchUI();
      }
    });
  });

  // Category chips
  document.querySelectorAll('.chip[data-search]').forEach(chip => {
    chip.addEventListener('click', () => {
      searchTerm = chip.dataset.search;
      searchInput.value = searchTerm;
      submitSearch();
    });
  });

  // ========== LOCATION INPUT LOGIC ==========
  const locationInput = document.getElementById('location-input-field');
  const locationClear = document.getElementById('location-clear');

  let locationInputFocused = false;

  locationInput.addEventListener('focus', () => {
    locationInputFocused = true;
    locationInput.placeholder = 'Enter neighborhood or zip';
    updateLocationUI();
    if (locationInput.value === 'Mapped area') {
      setTimeout(() => locationInput.setSelectionRange(0, 0), 0);
    }
  });
  locationInput.addEventListener('blur', () => { locationInputFocused = false; locationInput.placeholder = locationTerm || 'Current location'; updateLocationUI(); });
  const locationRecents = document.getElementById('location-recents-section');
  const locationAutocomplete = document.getElementById('location-autocomplete');
  const locationAutocompleteList = document.getElementById('location-autocomplete-list');

  function updateLocationUI() {
    const val = locationInput.value;
    const locationCurrentCta = document.getElementById('location-current-cta');

    // Show/hide clear button — only when field is focused and has text
    if (val.length > 0 && locationInputFocused) {
      locationClear.classList.remove('hidden');
    } else {
      locationClear.classList.add('hidden');
    }

    // Update search button style
    if (val.length > 0) {
      searchSubmitBtn.classList.add('active-search');
    } else {
      searchSubmitBtn.classList.remove('active-search');
    }

    if (val.length === 0) {
      locationCurrentCta.classList.remove('hidden');
      if (locationRecentsData.length > 0) locationRecents.classList.remove('hidden');
      locationAutocomplete.classList.add('hidden');
    } else if (val === 'Mapped area') {
      locationCurrentCta.classList.remove('hidden');
      locationRecents.classList.add('hidden');
      locationAutocomplete.classList.add('hidden');
    } else if (val.length >= 2) {
      // Debounced Mapbox geocoding
      clearTimeout(locationDebounceTimer);
      locationDebounceTimer = setTimeout(async () => {
        const suggestions = await fetchLocationSuggestions(val);
        if (suggestions && suggestions.length > 0) {
          locationCurrentCta.classList.add('hidden');
          locationRecents.classList.add('hidden');
          locationAutocomplete.classList.remove('hidden');
          renderLocationSuggestions(suggestions, val, true);
        }
      }, 250);
    } else {
      // 1 character — not enough for geocoding
      locationCurrentCta.classList.remove('hidden');
      locationRecents.classList.add('hidden');
      locationAutocomplete.classList.add('hidden');
    }
  }

  // Bind persistent current location row click handler
  document.getElementById('loc-ac-current-location').addEventListener('click', () => {
    locationTerm = 'Current location';
    selectedLocationCenter = null;
    selectLocation();
  });

  const locAcSuggestions = document.getElementById('loc-ac-suggestions');

  function renderLocationSuggestions(items, query, showCurrentLocation) {
    // Show/hide the persistent current location row
    const clRow = document.getElementById('loc-ac-current-location');
    clRow.style.display = showCurrentLocation ? '' : 'none';

    // Reuse existing DOM nodes to avoid img flash
    const existing = Array.from(locAcSuggestions.children);
    // Ensure we have enough rows
    while (existing.length < items.length) {
      const div = document.createElement('div');
      div.className = 'loc-autocomplete-item';
      div.innerHTML = `
        <div class="loc-ac-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.79688 6.64844C8.79688 6.05469 8.9401 5.51562 9.22656 5.03125C9.51302 4.54167 9.89844 4.15104 10.3828 3.85938C10.8672 3.56771 11.4062 3.42188 12 3.42188C12.5938 3.42188 13.1328 3.56771 13.6172 3.85938C14.1016 4.15104 14.487 4.54167 14.7734 5.03125C15.0651 5.51562 15.2109 6.05469 15.2109 6.64844C15.2109 7.13802 15.1094 7.59375 14.9062 8.01562C14.7031 8.43229 14.4271 8.79167 14.0781 9.09375C13.7292 9.39062 13.3307 9.60156 12.8828 9.72656V14.6328C12.8828 15.1328 12.8542 15.5885 12.7969 16C12.7396 16.4062 12.6667 16.7578 12.5781 17.0547C12.4896 17.3516 12.3932 17.5807 12.2891 17.7422C12.1849 17.8984 12.0885 17.9766 12 17.9766C11.9115 17.9766 11.8151 17.8984 11.7109 17.7422C11.612 17.5807 11.5156 17.3516 11.4219 17.0547C11.3333 16.7578 11.2578 16.4062 11.1953 16C11.138 15.5885 11.1094 15.1328 11.1094 14.6328V9.72656C10.6667 9.60156 10.2708 9.39062 9.92188 9.09375C9.57292 8.79167 9.29688 8.43229 9.09375 8.01562C8.89583 7.59375 8.79688 7.13802 8.79688 6.64844ZM11.0938 6.82812C11.3958 6.82812 11.6536 6.71875 11.8672 6.5C12.0859 6.28125 12.1953 6.02344 12.1953 5.72656C12.1953 5.42969 12.0859 5.17448 11.8672 4.96094C11.6536 4.74219 11.3958 4.63281 11.0938 4.63281C10.8021 4.63281 10.5469 4.74219 10.3281 4.96094C10.1094 5.17448 10 5.42969 10 5.72656C10 6.02344 10.1094 6.28125 10.3281 6.5C10.5469 6.71875 10.8021 6.82812 11.0938 6.82812ZM12 21.1875C10.7188 21.1875 9.56771 21.0885 8.54688 20.8906C7.53125 20.6979 6.66406 20.4271 5.94531 20.0781C5.23177 19.7344 4.6849 19.3359 4.30469 18.8828C3.92969 18.4349 3.74219 17.9557 3.74219 17.4453C3.74219 17.0182 3.85938 16.6224 4.09375 16.2578C4.32812 15.8932 4.64583 15.5651 5.04688 15.2734C5.44792 14.9766 5.90625 14.7214 6.42188 14.5078C6.9375 14.2891 7.47917 14.1146 8.04688 13.9844C8.61979 13.8542 9.1849 13.776 9.74219 13.75V15.2969C9.27865 15.3229 8.80469 15.3906 8.32031 15.5C7.84115 15.6094 7.39844 15.7526 6.99219 15.9297C6.59115 16.1068 6.26823 16.3125 6.02344 16.5469C5.77865 16.7812 5.65625 17.0339 5.65625 17.3047C5.65625 17.6432 5.8125 17.9505 6.125 18.2266C6.4375 18.5078 6.8776 18.7474 7.44531 18.9453C8.01302 19.1432 8.68229 19.2969 9.45312 19.4062C10.2292 19.5208 11.0781 19.5781 12 19.5781C12.9167 19.5781 13.7604 19.5208 14.5312 19.4062C15.3073 19.2969 15.9792 19.1406 16.5469 18.9375C17.1146 18.7396 17.5547 18.5026 17.8672 18.2266C18.1849 17.9505 18.3438 17.6432 18.3438 17.3047C18.3438 17.0339 18.2188 16.7812 17.9688 16.5469C17.7188 16.3125 17.3932 16.1068 16.9922 15.9297C16.5911 15.7526 16.151 15.6094 15.6719 15.5C15.1927 15.3906 14.7161 15.3229 14.2422 15.2969V13.75C14.8047 13.776 15.3698 13.8542 15.9375 13.9844C16.5104 14.1146 17.0547 14.2891 17.5703 14.5078C18.0859 14.7214 18.5443 14.9766 18.9453 15.2734C19.3516 15.5651 19.6693 15.8932 19.8984 16.2578C20.1328 16.6224 20.25 17.0182 20.25 17.4453C20.25 17.9557 20.0599 18.4349 19.6797 18.8828C19.3047 19.3359 18.7604 19.7344 18.0469 20.0781C17.3333 20.4271 16.4661 20.6979 15.4453 20.8906C14.4297 21.0885 13.2812 21.1875 12 21.1875Z" fill="#8e8e93"/></svg>
        </div>
        <div class="loc-ac-info">
          <div class="loc-ac-name"></div>
          <div class="loc-ac-sub"></div>
        </div>
      `;
      div.addEventListener('click', () => {
        locationTerm = div.dataset.location;
        selectedLocationCenter = JSON.parse(div.dataset.center || 'null');
        selectLocation();
      });
      locAcSuggestions.appendChild(div);
      existing.push(div);
    }
    // Update text and show/hide
    existing.forEach((div, i) => {
      if (i < items.length) {
        div.querySelector('.loc-ac-name').innerHTML = highlightMatch(items[i].name, query);
        div.querySelector('.loc-ac-sub').textContent = items[i].sub;
        div.dataset.location = items[i].name;
        div.dataset.center = JSON.stringify(items[i].center || null);
        div.style.display = '';
      } else {
        div.style.display = 'none';
      }
    });
  }

  let locationSearched = false;
  const locationRecentsData = []; // Array of { name, center }
  const MAX_LOCATION_RECENTS = 5;

  function addLocationRecent(term) {
    if (!term || term === 'Current location' || term === 'Mapped area') return;
    const idx = locationRecentsData.findIndex(r => r.name === term);
    if (idx !== -1) locationRecentsData.splice(idx, 1);
    locationRecentsData.unshift({ name: term, center: selectedLocationCenter });
    if (locationRecentsData.length > MAX_LOCATION_RECENTS) locationRecentsData.pop();
    renderLocationRecents();
  }

  function renderLocationRecents() {
    const section = document.getElementById('location-recents-section');
    const list = document.getElementById('location-recents-chips');
    if (locationRecentsData.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    list.innerHTML = '';
    locationRecentsData.forEach(recent => {
      const div = document.createElement('div');
      div.className = 'chip';
      div.dataset.location = recent.name;
      div.textContent = recent.name;
      div.addEventListener('click', () => {
        locationTerm = recent.name;
        selectedLocationCenter = recent.center;
        selectLocation();
      });
      list.appendChild(div);
    });
  }

  document.getElementById('search-clear-recents').addEventListener('click', () => {
    searchRecents.length = 0;
    renderSearchRecents();
  });

  document.getElementById('location-clear-recents').addEventListener('click', () => {
    locationRecentsData.length = 0;
    renderLocationRecents();
  });

  function selectLocation() {
    returnScreen = null;
    locationSearched = true;
    mapPanned = false;
    addLocationRecent(locationTerm);
    locationInput.value = '';

    const currentSearch = searchInput.value.trim();
    if (currentSearch) {
      searchTerm = currentSearch;
      document.getElementById('both-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 ' + locationTerm + '</span>';
      showScreen('screen-both-results', 'fade-in');
    } else {
      document.getElementById('locresults-search-text').textContent = locationTerm;
      showScreen('screen-location-results', 'fade-in');
    }
  }

  // Location input events
  locationInput.addEventListener('input', updateLocationUI);

  locationInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      if (locationInput.value.trim()) {
        locationTerm = locationInput.value.trim();
        // Geocode the typed text if no suggestion was selected
        if (!selectedLocationCenter) {
          const results = await fetchLocationSuggestions(locationTerm);
          if (results && results.length > 0) {
            locationTerm = results[0].name;
            selectedLocationCenter = results[0].center;
          }
        }
        selectLocation();
      } else {
        submitSearch();
      }
    }
  });

  locationClear.addEventListener('mousedown', (e) => {
    e.preventDefault();
    locationInput.value = '';
    locationInput.placeholder = 'Enter neighborhood or zip';
    updateLocationUI();
    locationInput.focus();
  });

  // Recent location chips
  document.querySelectorAll('.chip[data-location]').forEach(chip => {
    chip.addEventListener('click', () => {
      locationTerm = chip.dataset.location;
      selectLocation();
    });
  });

  // Current location CTA on location screen
  document.getElementById('location-current-cta').addEventListener('click', () => {
    locationTerm = 'Current location';
    selectedLocationCenter = null;
    selectLocation();
  });

  // ========== NAV BUTTON (current location) ==========
  document.querySelectorAll('.map-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = userLat ?? DEFAULT_LAT;
      const lng = userLng ?? DEFAULT_LNG;
      locationTerm = 'Current location';
      selectedLocationCenter = null;
      mapPanned = false;

      // Update the search bar label on whichever screen is active
      if (currentScreen === 'screen-map-default') {
        document.querySelector('#hotspot-search-default span:last-child').textContent = 'Current location';
      } else if (currentScreen === 'screen-both-results') {
        document.getElementById('both-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Current location</span>';
      } else if (currentScreen === 'screen-location-results') {
        document.getElementById('locresults-search-text').textContent = 'Current location';
      } else if (currentScreen === 'screen-search-results') {
        document.getElementById('results-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Current location</span>';
      }

      setNavBtnActive(true);
      map.easeTo({ center: [lng, lat], zoom: DEFAULT_MAP_ZOOM, offset: [0, -MAP_CENTER_OFFSET_PX], duration: 400 });
      map.once('moveend', () => {
        preserveMapView = true;
        if (currentScreen === 'screen-map-default') {
          initDefaultMap(lat, lng, DEFAULT_MAP_ZOOM, userLat ? 'Nearby' : 'Manhattan', true);
        } else {
          updateMapForCurrentState();
        }
      });
    });
  });

  // ========== MAP SCREEN HOTSPOTS ==========

  // Map default → search focused (search tab)
  document.getElementById('hotspot-search-default').addEventListener('click', () => {
    returnScreen = null;
    searchOpenedFromDefault = true;
    searchTerm = '';
    searchInput.value = '';
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });

  // Search results → search focused (search tab)
  document.getElementById('hotspot-search-results').addEventListener('click', () => {
    returnScreen = 'screen-search-results';
    searchOpenedFromDefault = false;
    searchInput.value = searchTerm;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });

  // Location results → unified search screen, location tab
  document.getElementById('hotspot-search-locresults').addEventListener('click', () => {
    returnScreen = 'screen-location-results';
    searchOpenedFromDefault = false;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    setActiveTab('location');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => { locationInput.focus(); updateLocationUI(); }, 150);
  });

  // Both results → search focused (search tab)
  document.getElementById('hotspot-search-both').addEventListener('click', () => {
    returnScreen = 'screen-both-results';
    searchOpenedFromDefault = false;
    searchInput.value = searchTerm;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });

  // Search tab hotspots
  document.getElementById('hotspot-search-tab').addEventListener('click', () => {
    searchInput.value = '';
    updateSearchUI();
    setActiveTab('search');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });
  document.getElementById('hotspot-x-tab').addEventListener('click', () => {
    searchTerm = '';
    locationTerm = '';
    selectedLocationCenter = null;
    mapPanned = false;
    document.querySelector('#hotspot-search-default span:last-child').textContent = 'Search for yoga, barre, cycling...';
    preserveMapView = true;
    preserveMapContents = true;
    // Remove location marker — only shown after an explicit location search
    if (userLocationMarker) {
      userLocationMarker.remove();
      userLocationMarker = null;
    }
    showScreen('screen-map-default', 'fade-in');
  });

  // ========== SEARCH TAB TOGGLE ==========
  function setActiveTab(tab) {
    activeTab = tab;
    const searchContent = document.getElementById('search-tab-content');
    const locationContent = document.getElementById('location-tab-content');

    if (tab === 'search') {
      searchContent.classList.remove('hidden');
      locationContent.classList.add('hidden');
      searchInput.focus();
    } else {
      locationContent.classList.remove('hidden');
      searchContent.classList.add('hidden');
      locationInput.focus();
      updateLocationUI();
    }
  }

  searchInput.addEventListener('focus', () => {
    if (activeTab !== 'search') setActiveTab('search');
  });

  locationInput.addEventListener('focus', () => {
    if (activeTab !== 'location') setActiveTab('location');
  });

  // ========== SEARCH THIS AREA ==========
  const searchThisAreaBtn = document.getElementById('search-this-area');
  const allSheets = document.querySelectorAll('.results-sheet');
  const allNavBtns = document.querySelectorAll('.map-nav-btn');

  function collapseSheets() {
    if (!MAP_SCREENS.includes(currentScreen)) return;
    allSheets.forEach(s => {
      s.style.transform = '';
      s.style.transition = '';
      s.classList.remove('expanded');
      s.classList.add('collapsed');
    });
    allNavBtns.forEach(b => {
      b.classList.add('collapsed');
      b.style.transform = '';
      b.style.opacity = '';
    });
    searchThisAreaBtn.classList.add('visible');
  }

  function expandSheets() {
    allSheets.forEach(s => {
      s.classList.remove('collapsed', 'expanded');
      s.style.transform = '';
      s.style.transition = '';
    });
    allNavBtns.forEach(b => {
      b.classList.remove('collapsed');
      b.style.transform = '';
      b.style.transition = '';
      b.style.opacity = '';
    });
    searchThisAreaBtn.classList.remove('visible');
  }

  map.on('dragstart', () => { mapPanned = true; collapseSheets(); });
  map.on('drag', collapseSheets);

  function setNavBtnActive(active) {
    allNavBtns.forEach(b => b.classList.toggle('active', active));
  }
  map.on('dragstart', () => setNavBtnActive(false));
  map.on('zoomstart', (e) => { if (!e.originalEvent) return; setNavBtnActive(false); });

  // Draggable sheet — follows finger/mouse, snaps on release
  const COLLAPSED_Y = 291; // px, matches CSS .collapsed translateY
  // EXPANDED_Y: sheet top lands 16px below search bar bottom (110px) → top at 126px
  // Sheet at y=0 has top = 852 - 460 = 392px → delta = 126 - 392 = -266px
  const EXPANDED_Y = -266;
  const SNAP_THRESHOLD = 60; // px drag distance to trigger state change

  allSheets.forEach(sheet => {
    let dragging = false;
    let startY = 0;
    let startOffset = 0; // translateY at drag start
    let currentOffset = 0;
    let prevSheetY = null; // tracks last sheet Y for incremental map panning

    function getSheetOffset() {
      if (sheet.classList.contains('collapsed')) return COLLAPSED_Y;
      if (sheet.classList.contains('expanded')) return EXPANDED_Y;
      return 0;
    }

    function setSheetY(y, animate) {
      sheet.style.transition = animate ? '' : 'none';
      sheet.style.transform = `translateY(${y}px)`;
      allNavBtns.forEach(b => {
        b.style.transition = animate ? '' : 'none';
        if (y >= 0) {
          // Sheet moving down — nav button follows sheet
          b.style.transform = `translateY(${y}px)`;
          b.style.opacity = '1';
        } else {
          // Sheet moving up above default — nav button stays put, fades out
          b.style.transform = 'translateY(0px)';
          const progress = Math.min(1, Math.abs(y) / Math.abs(EXPANDED_Y));
          b.style.opacity = String(1 - progress);
        }
      });
      // Pan map so content stays centered in the visible area between search bar and sheet.
      // The visible center shifts by Δy/2 for every pixel the sheet moves, so pan by Δy/2.
      if (prevSheetY !== null && prevSheetY !== y) {
        const mapPanDelta = (prevSheetY - y) / 2;
        map.panBy([0, mapPanDelta], { animate: animate, duration: 350 });
        prevSheetY = y;
      }
    }

    function onDragStart(clientY) {
      dragging = true;
      startY = clientY;
      startOffset = getSheetOffset();
      currentOffset = startOffset;
      prevSheetY = startOffset;
      setSheetY(currentOffset, false);
    }

    function onDragMove(clientY) {
      if (!dragging) return;
      const delta = clientY - startY;
      currentOffset = Math.max(EXPANDED_Y, Math.min(COLLAPSED_Y, startOffset + delta));
      setSheetY(currentOffset, false);
    }

    function onDragEnd(clientY) {
      if (!dragging) return;
      dragging = false;
      const delta = clientY - startY;
      let snapTo;
      if (Math.abs(delta) < 10) {
        // Treat as tap — don't change state
        snapTo = startOffset;
      } else if (delta < -SNAP_THRESHOLD) {
        // Dragged up enough
        if (startOffset >= COLLAPSED_Y) {
          snapTo = 0; // collapsed → default
        } else {
          snapTo = EXPANDED_Y; // default → fully expanded up
        }
      } else if (delta > SNAP_THRESHOLD) {
        // Dragged down enough
        if (startOffset <= EXPANDED_Y) {
          snapTo = 0; // fully expanded up → default
        } else {
          snapTo = COLLAPSED_Y; // default or collapsed → collapsed
        }
      } else {
        // Not far enough — snap back to original state
        snapTo = startOffset;
      }
      // Re-enable CSS transition for snap animation
      setSheetY(snapTo, true);
      if (snapTo === EXPANDED_Y) {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
        allNavBtns.forEach(b => { b.classList.remove('collapsed'); });
        searchThisAreaBtn.classList.remove('visible');
      } else if (snapTo === 0) {
        sheet.classList.remove('collapsed', 'expanded');
        allNavBtns.forEach(b => { b.classList.remove('collapsed'); });
        searchThisAreaBtn.classList.remove('visible');
      } else {
        sheet.classList.remove('expanded');
        sheet.classList.add('collapsed');
        allNavBtns.forEach(b => { b.classList.add('collapsed'); });
        // Don't show "Search this area" on sheet drag — only on map pan
      }
      // After transition ends, clear inline styles so CSS classes are in control
      const cleanup = () => {
        sheet.style.transform = '';
        sheet.style.transition = '';
        allNavBtns.forEach(b => {
          b.style.transform = '';
          b.style.transition = '';
          if (snapTo === EXPANDED_Y) {
            b.style.opacity = '0'; // keep hidden when sheet is fully expanded up
          } else {
            b.style.opacity = '';
          }
        });
        sheet.removeEventListener('transitionend', cleanup);
      };
      sheet.addEventListener('transitionend', cleanup);
    }

    // Touch events
    sheet.addEventListener('touchstart', e => {
      onDragStart(e.touches[0].clientY);
    }, { passive: true });

    sheet.addEventListener('touchmove', e => {
      onDragMove(e.touches[0].clientY);
    }, { passive: true });

    sheet.addEventListener('touchend', e => {
      onDragEnd(e.changedTouches[0].clientY);
    });

    // Mouse events (for desktop testing)
    sheet.addEventListener('mousedown', e => {
      onDragStart(e.clientY);
      const onMove = ev => onDragMove(ev.clientY);
      const onUp = ev => {
        onDragEnd(ev.clientY);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });

  searchThisAreaBtn.addEventListener('click', () => {
    // Fade out button, keep sheet (and nav button) in collapsed position
    searchThisAreaBtn.classList.remove('visible');

    // Derive the geographic center of the visible area (between search bar and sheet).
    // When sheet is collapsed the visible area extends much further down, so use a
    // smaller offset (sheet top ~683px vs ~392px normal → visible center ~396px vs ~251px).
    const sheetCollapsed = allSheets[0] && allSheets[0].classList.contains('collapsed');
    const offsetPx = sheetCollapsed ? 30 : MAP_CENTER_OFFSET_PX;
    const mapCenter = map.getCenter();
    const centerPx = map.project(mapCenter);
    const visibleCenterPx = new mapboxgl.Point(centerPx.x, centerPx.y - offsetPx);
    const visibleCenter = map.unproject(visibleCenterPx);
    const loc = { lat: visibleCenter.lat, lng: visibleCenter.lng };

    // Set location to "Mapped area" in the search field
    locationTerm = 'Mapped area';
    selectedLocationCenter = null;
    locationInput.value = 'Mapped area';
    if (currentScreen === 'screen-map-default') {
      document.querySelector('#hotspot-search-default span:last-child').textContent = 'Mapped area';
    } else if (currentScreen === 'screen-search-results') {
      document.getElementById('results-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Mapped area</span>';
    } else if (currentScreen === 'screen-location-results') {
      document.getElementById('locresults-search-text').textContent = 'Mapped area';
    } else if (currentScreen === 'screen-both-results') {
      document.getElementById('both-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Mapped area</span>';
    }
    if (userLocationMarker) {
      if (userLat && userLng) {
        setUserMarker(userLng, userLat, 'user');
      } else {
        userLocationMarker.remove();
        userLocationMarker = null;
      }
    }

    clearMarkers();

    // Fetch real places from Foursquare directly (no placeholder pins)
    loadRealPlaces(loc.lat, loc.lng, searchTerm || '', currentScreen, 'Nearby');
  });

  // ========== RESULTS PILL X BUTTONS ==========
  // Clear search term, stay at current map position, hide location pin
  function clearSearchFromResults(e) {
    e.stopPropagation();
    searchTerm = '';
    searchInput.value = '';
    // keep locationTerm so the location field placeholder persists on next open
    document.querySelector('#hotspot-search-default span:last-child').textContent = 'Search for yoga, barre, cycling...';
    if (userLocationMarker) {
      userLocationMarker.remove();
      userLocationMarker = null;
    }
    preserveMapView = true;
    preserveMapContents = true;
    showScreen('screen-map-default');
  }

  document.getElementById('pill-clear-results').addEventListener('click', clearSearchFromResults);
  document.getElementById('pill-clear-locresults').addEventListener('click', clearSearchFromResults);
  document.getElementById('pill-clear-both').addEventListener('click', clearSearchFromResults);

  // ========== PREVENT ZOOM ON iOS ==========
  document.querySelectorAll('input').forEach(input => {
    input.style.fontSize = '16px'; // Prevents iOS zoom on focus
  });

})();
