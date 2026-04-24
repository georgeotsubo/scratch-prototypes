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
  let venueDetailOpen = false;
  let classDetailOpen = false;
  let currentPins = []; // stores the currently displayed pins for venue detail reference
  let currentSearchLabel = '';
  let currentLocationLabel = '';
  let wasDragging = false; // prevents venue card click after drag scroll

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
    const isFileProtocol = location.protocol === 'file:';
    const baseUrl = `https://places-api.foursquare.com/places/search?${params}`;
    const url = isFileProtocol ? `https://corsproxy.io/?url=${encodeURIComponent(baseUrl)}` : `/api/foursquare/places/search?${params}`;
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
        neighborhood: (p.location && p.location.neighborhood && p.location.neighborhood[0]) || '',
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
    currentPins = places;
    currentSearchLabel = search || '';
    currentLocationLabel = location || '';
    clearMarkers();
    places.forEach((p, i) => {
      const marker = addPinMarker(p.lng, p.lat);
      marker.getElement().addEventListener('click', function(e) {
        e.stopPropagation();
        openVenueDetail(i);
      });
    });
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

  // Shorten raw tag labels for UI: drop trailing " and …" phrases and the
  // trailing " Studio" qualifier so "Gym and Fitness Studio" → "Gym".
  function formatTag(tag) {
    if (!tag) return tag;
    return tag.replace(/\s+and\b.*/i, '').replace(/\s+studio\b/gi, '').trim();
  }

  // NYC neighborhoods used as a deterministic fallback when Foursquare only
  // returns the city ("New York") rather than a neighborhood.
  var NYC_NEIGHBORHOODS = [
    'Lower East Side', 'East Village', 'West Village', 'SoHo', 'NoHo',
    'Chelsea', 'Flatiron', 'Gramercy', 'Midtown', 'Upper East Side',
    'Upper West Side', 'Harlem', 'Tribeca', 'Williamsburg', 'Greenpoint',
    'Park Slope', 'DUMBO', 'Bushwick', 'Long Island City', 'Astoria'
  ];
  function pickNeighborhood(seed) {
    var s = String(seed || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return NYC_NEIGHBORHOODS[Math.abs(h) % NYC_NEIGHBORHOODS.length];
  }

  // Reverse-geocode a pin's lat/lng to an accurate NYC neighborhood via Mapbox.
  // Result is cached on the pin as `_resolvedNeighborhood` so repeat opens are instant.
  function reverseGeocodeNeighborhood(pin) {
    if (!pin || !pin.lat || !pin.lng) return Promise.resolve(null);
    if (pin._resolvedNeighborhood !== undefined) return Promise.resolve(pin._resolvedNeighborhood);
    if (!window.MAPBOX_TOKEN) return Promise.resolve(null);
    var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
      + pin.lng + ',' + pin.lat + '.json?types=neighborhood&access_token=' + window.MAPBOX_TOKEN;
    return fetch(url)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        var name = (data && data.features && data.features[0] && data.features[0].text) || null;
        pin._resolvedNeighborhood = name;
        return name;
      })
      .catch(function() { pin._resolvedNeighborhood = null; return null; });
  }

  // Deterministic per-venue flag: roughly half of venues run an intro offer.
  // Hash by name so it stays stable across re-renders and sessions.
  function hasVenueIntroOffer(pin) {
    if (!pin || !pin.name) return false;
    var h = 0;
    for (var i = 0; i < pin.name.length; i++) h = ((h << 5) - h) + pin.name.charCodeAt(i);
    return (Math.abs(h) % 2) === 0;
  }
  window.__hasVenueIntroOffer = hasVenueIntroOffer;

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

  const VENUE_DESCRIPTIONS_BY_NAME = {
    'Y7 Studio': 'Hip-hop yoga studio combining heated vinyasa flows with curated playlists in a candlelit setting. Classes focus on building strength and flexibility while vibing to the music.',
    'Sky Ting Yoga': 'Downtown yoga studio blending Katonah, vinyasa, and Taoist traditions into creative, alignment-focused sequences. Known for its airy loft spaces and thoughtful community events.',
    'Sky Ting NoHo': 'The NoHo outpost of Sky Ting offering the same blend of Katonah and vinyasa yoga in a bright, welcoming space with natural light and a curated retail corner.',
    'Modo Yoga NYC': 'Hot yoga studio practicing in a sustainably heated room. Classes follow a set sequence designed to work every muscle, joint, and organ in the body.',
    'CorePower Yoga': 'National yoga chain offering heated power yoga, sculpt classes with weights, and restorative sessions. Great for athletes looking to cross-train.',
    'Lyons Den Yoga': 'Power yoga studio in Chelsea with dynamic, music-driven flows. Known for its strong community vibe and challenging sequences that build heat and endurance.',
    'Yoga Vida': 'Donation-based yoga studio making practice accessible to everyone. Offers vinyasa, yin, and meditation classes with experienced teachers in a no-frills setting.',
    'Bhakti Center': 'East Village spiritual center offering kirtan, meditation, and yoga rooted in the bhakti tradition. A welcoming space for seekers of all backgrounds.',
    'Laughing Lotus': 'Colorful, eclectic yoga studio known for its creative flows, live music classes, and joyful community atmosphere. Every class is a unique experience.',
    'Yoga Shanti': 'Upper East Side studio founded by Colleen Saidman Yee, offering alignment-based vinyasa and restorative yoga in an intimate, calming environment.',
    'SLT Flatiron': 'High-intensity, low-impact Megaformer Pilates studio. Slow, controlled movements on a specialized machine that targets every muscle group to failure.',
    'SLT NoHo': 'Megaformer Pilates in the heart of NoHo. Expect a full-body burn with slow, precise movements that shake muscles you didn\'t know you had.',
    'SLT Tribeca': 'Tribeca location of the cult-favorite Megaformer studio. Small class sizes ensure personal attention during the signature slow-and-controlled workout.',
    'SLT West 14th': 'West Village SLT studio offering the same intense Megaformer experience. Great for building lean muscle and improving core stability.',
    'Club Pilates': 'Reformer Pilates studio offering classes for all levels from beginner to advanced. TRX, springboard, and chair exercises complement the reformer work.',
    'New York Pilates': 'Boutique reformer studio on the Upper East Side known for its dynamic, music-driven classes that blend classical Pilates with contemporary fitness.',
    'SLT Brooklyn Hts': 'Brooklyn Heights Megaformer studio bringing the signature SLT burn across the bridge. Convenient for downtown Brooklyn residents.',
    'SLT Williamsburg': 'Williamsburg outpost of SLT with the same intense 50-minute Megaformer classes that sculpt and tone the entire body.',
    'SLT NoMad': 'NoMad location offering SLT\'s signature Megaformer workout in a sleek, modern space. Perfect for a lunch-break burn.',
    'Gramercy Pilates': 'Classical Pilates studio in Gramercy offering private and semi-private sessions on reformer, cadillac, and chair with highly trained instructors.',
    'Physique 57 UES': 'Barre fitness studio combining isometric exercises with orthopedic stretches for a total-body workout. Known for visible results in just 8 sessions.',
    'Physique 57 SoHo': 'SoHo barre studio offering the signature Physique 57 method — interval overload with restorative stretching for a lean, sculpted physique.',
    'Pure Barre Flatiron': 'Low-impact, high-intensity barre workout using small isometric movements to tone and strengthen. Multiple class formats from classic to empower.',
    'Barre3': 'Barre studio combining ballet barre, yoga, and Pilates into a balanced workout. Modifications offered for every move so all levels feel challenged.',
    'Barry\'s Bootcamp': 'High-energy interval training alternating between treadmill sprints and floor exercises with heavy weights. The "Best Workout in the World" according to regulars.',
    'Rumble Boxing': 'Boxing-inspired group fitness with a nightclub atmosphere. Alternate between water-filled bag rounds and strength training on the floor.',
    'Tone House': 'Extreme athletic conditioning inspired by sports training. Turf-based HIIT workouts designed by a former NFL strength coach. Not for the faint of heart.',
    'Fhitting Room': 'Functional high-intensity training using kettlebells, rowers, and ski ergs. Science-backed programming in small groups with expert coaching.',
    'Peloton Studio': 'Home of the live Peloton classes — cycling, running, strength, and yoga all filmed here. Drop in to ride with the instructors you see on screen.',
  };

  const VENUE_DESC_BY_CATEGORY = {
    'Yoga': [
      'A welcoming yoga studio offering heated and unheated classes for all levels, from gentle restorative flows to challenging power sequences.',
      'Thoughtfully designed yoga space with experienced teachers guiding students through creative vinyasa flows, meditation, and breathwork.',
    ],
    'Pilates': [
      'Reformer and mat Pilates studio focused on core strength, flexibility, and body awareness. Small class sizes ensure personalized attention.',
      'Modern Pilates studio with top-of-the-line equipment and expert instructors helping you build long, lean muscle through controlled movement.',
    ],
    'Barre': [
      'Ballet-inspired barre studio blending isometric holds, small range-of-motion movements, and deep stretching for a total-body sculpt.',
      'High-energy barre classes that combine elements of dance, Pilates, and yoga to tone every muscle group in under an hour.',
    ],
    '_default': [
      'Boutique fitness studio known for its intimate class sizes and personalized attention to each member\'s goals.',
      'Community-focused space offering group classes, workshops, and private sessions in a supportive environment.',
      'Modern facility with experienced instructors dedicated to helping you reach your fitness goals through expert programming.',
      'A welcoming studio offering a variety of classes for all levels, from beginners to advanced practitioners.',
    ],
  };

  function getVenueDescription(name, category) {
    if (VENUE_DESCRIPTIONS_BY_NAME[name]) return VENUE_DESCRIPTIONS_BY_NAME[name];
    var descs = VENUE_DESC_BY_CATEGORY[category] || VENUE_DESC_BY_CATEGORY['_default'];
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
    return descs[Math.abs(hash) % descs.length];
  }

  function generateVenueCardHTML(pins, search, location) {
    return pins.map((pin, i) => {
      const rawTags = search || pin.category || STUDIO_TAGS[pin.name] || 'Fitness';
      const tags = formatTag(rawTags);
      const distance = pin.distance != null ? (pin.distance / 1609.34).toFixed(1) : (0.1 + (i * 0.15)).toFixed(1);
      const rating = (4.5 + (i % 5) * 0.1).toFixed(1);
      const reviews = 50 + i * 37;
      const neighborhood = pin.locality || location || 'Manhattan';
      const desc = getVenueDescription(pin.name, tags);
      const introBadge = hasVenueIntroOffer(pin)
        ? `<div class="venue-intro-badge"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.38223 17.1763C4.62285 17.1763 4.05596 16.9891 3.68154 16.6147C3.30713 16.2403 3.11992 15.6708 3.11992 14.9061V13.2529C3.11992 13.1263 3.0751 13.0156 2.98545 12.9207L1.81475 11.75C1.27158 11.2121 1 10.6795 1 10.1521C1 9.62478 1.27158 9.08953 1.81475 8.54636L2.98545 7.36775C3.0751 7.2781 3.11992 7.17 3.11992 7.04343V5.3823C3.11992 4.61238 3.30449 4.04285 3.67363 3.67371C4.04805 3.30457 4.61758 3.12 5.38223 3.12H7.04336C7.17519 3.12 7.2833 3.07517 7.36768 2.98552L8.54629 1.81482C9.08945 1.27166 9.62207 1.00008 10.1441 1.00008C10.6715 0.994802 11.2067 1.26638 11.7499 1.81482L12.9285 2.98552C13.0182 3.07517 13.1263 3.12 13.2528 3.12H14.914C15.6786 3.12 16.2455 3.3072 16.6146 3.68162C16.9891 4.05603 17.1763 4.62293 17.1763 5.3823V7.04343C17.1763 7.17 17.2237 7.2781 17.3187 7.36775L18.4894 8.54636C19.0272 9.08953 19.2962 9.62478 19.2962 10.1521C19.2962 10.6795 19.0272 11.2121 18.4894 11.75L17.3187 12.9207C17.2237 13.0156 17.1763 13.1263 17.1763 13.2529V14.9061C17.1763 15.6761 16.9891 16.2456 16.6146 16.6147C16.2455 16.9891 15.6786 17.1763 14.914 17.1763H13.2528C13.1263 17.1763 13.0182 17.2212 12.9285 17.3108L11.7499 18.4815C11.212 19.0247 10.6794 19.2963 10.1521 19.2963C9.62471 19.2963 9.08945 19.0247 8.54629 18.4815L7.36768 17.3108C7.2833 17.2212 7.17519 17.1763 7.04336 17.1763H5.38223Z" fill="#379062"/><path d="M7.38359 10.2655C6.85889 10.2655 6.43965 10.0875 6.12588 9.73154C5.81475 9.37295 5.65918 8.87988 5.65918 8.25234C5.65918 7.61689 5.81606 7.12515 6.12983 6.7771C6.4436 6.42905 6.86152 6.25503 7.38359 6.25503C7.9083 6.25503 8.32754 6.42905 8.64131 6.7771C8.95508 7.12251 9.11196 7.61294 9.11196 8.24839C9.11196 8.87593 8.9564 9.36899 8.64526 9.72759C8.33413 10.0862 7.91357 10.2655 7.38359 10.2655ZM7.38359 9.32812C7.55762 9.32812 7.68813 9.23848 7.77515 9.05918C7.86216 8.87988 7.90566 8.61094 7.90566 8.25234C7.90566 7.89902 7.86216 7.63403 7.77515 7.45737C7.68813 7.28071 7.55762 7.19238 7.38359 7.19238C7.21221 7.19238 7.08169 7.28071 6.99204 7.45737C6.90503 7.63403 6.86152 7.89902 6.86152 8.25234C6.86152 8.61094 6.90503 8.87988 6.99204 9.05918C7.08169 9.23848 7.21221 9.32812 7.38359 9.32812ZM12.9167 13.7618C12.3894 13.7618 11.9688 13.5838 11.6551 13.2278C11.3439 12.8719 11.1884 12.3788 11.1884 11.7486C11.1884 11.1132 11.3453 10.6214 11.659 10.2734C11.9728 9.92534 12.392 9.75132 12.9167 9.75132C13.4388 9.75132 13.8567 9.92534 14.1705 10.2734C14.4843 10.6214 14.6412 11.1132 14.6412 11.7486C14.6412 12.3735 14.4856 12.8653 14.1745 13.2239C13.8633 13.5825 13.4441 13.7618 12.9167 13.7618ZM12.9167 12.8284C13.0881 12.8284 13.2173 12.7387 13.3043 12.5594C13.394 12.3775 13.4388 12.1072 13.4388 11.7486C13.4388 11.3927 13.394 11.1277 13.3043 10.9537C13.2173 10.777 13.0881 10.6887 12.9167 10.6887C12.7427 10.6887 12.6122 10.777 12.5252 10.9537C12.4382 11.1303 12.3947 11.3953 12.3947 11.7486C12.3947 12.1072 12.4382 12.3775 12.5252 12.5594C12.6122 12.7387 12.7427 12.8284 12.9167 12.8284ZM7.70395 13.7064C7.56157 13.6247 7.4772 13.5073 7.45083 13.3544C7.42446 13.2015 7.46006 13.0512 7.55762 12.9035L11.8251 6.49629C11.9201 6.35654 12.04 6.26953 12.1851 6.23525C12.3301 6.19834 12.4672 6.2168 12.5964 6.29062C12.7414 6.36973 12.8297 6.48838 12.8614 6.64658C12.893 6.80215 12.8601 6.95376 12.7625 7.10142L8.49497 13.5284C8.40532 13.6629 8.28271 13.7446 8.12715 13.7736C7.97422 13.8053 7.83315 13.7829 7.70395 13.7064Z" fill="white"/></svg><span class="venue-intro-badge-label">Intro offer</span><span class="venue-intro-badge-save"> \u00b7 Save $10</span></div>`
        : '';
      return `<div class="venue-card" data-venue-index="${i}">
        <div class="venue-header">
          <div class="venue-image"></div>
          <div class="venue-info">
            <div class="venue-title">${pin.name}</div>
            <div class="venue-tags">${tags}</div>
            <div class="venue-subtitle">${distance} mi &middot; ${neighborhood}</div>
            <div class="venue-rating"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.28261 1.45359C7.57606 0.858991 8.42394 0.858992 8.71739 1.45359L10.165 4.38678C10.2815 4.62289 10.5068 4.78655 10.7674 4.82441L14.0043 5.29477C14.6605 5.39012 14.9225 6.1965 14.4477 6.65933L12.1054 8.9425C11.9169 9.12628 11.8308 9.39108 11.8753 9.6506L12.4283 12.8745C12.5404 13.528 11.8544 14.0264 11.2675 13.7178L8.37227 12.1957C8.13921 12.0732 7.86079 12.0732 7.62773 12.1957L4.73249 13.7178C4.14559 14.0264 3.45965 13.528 3.57174 12.8745L4.12468 9.6506C4.16919 9.39108 4.08315 9.12628 3.8946 8.94249L1.55231 6.65932C1.07749 6.1965 1.3395 5.39012 1.99568 5.29477L5.23265 4.82441C5.49321 4.78655 5.71847 4.62289 5.835 4.38678L7.28261 1.45359Z" fill="#FFB54D"/></svg> ${rating} (${reviews})</div>
          </div>
        </div>
        ${introBadge}
        <div class="venue-desc">${desc}</div>
        <div class="venue-actions">
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
        el.querySelectorAll('.venue-card').forEach(card => {
          card.style.cursor = 'pointer';
          card.addEventListener('click', function(e) {
            if (wasDragging) return;
            const idx = parseInt(this.dataset.venueIndex, 10);
            // If the tap was on the Schedule action button, open directly to the schedule tab
            if (e.target.closest('.venue-action-btn') && e.target.closest('.venue-action-btn').textContent.trim().includes('Schedule')) {
              openVenueDetail(idx, 'schedule');
            } else {
              openVenueDetail(idx);
            }
          });
        });
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
    window.dispatchEvent(new Event('resize'));
    if (++resizeChecks >= 10) clearInterval(resizeInterval);
  }, 200);
  // Force a window resize on load to trigger layout
  window.addEventListener('load', () => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  });

  map.on('load', function() {
    map.resize();

    // Remove text labels, then apply Apple Maps-like colors
    var layers = map.getStyle().layers;
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      // Hide all symbol/label layers
      if (layer.type === 'symbol') {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
        continue;
      }
      try {
        var id = layer.id.toLowerCase();
        // Water — soft sky blue
        if (layer.type === 'fill' && (id.includes('water') || id === 'water')) {
          map.setPaintProperty(layer.id, 'fill-color', '#b8daf0');
        }
        // Parks & green space — only actual parks, not all landuse
        if (layer.type === 'fill' && id.includes('landuse') && !id.includes('industrial')) {
          map.setPaintProperty(layer.id, 'fill-color', [
            'match', ['get', 'class'],
            'park', '#cde4c6',
            'pitch', '#c4dcbc',
            'cemetery', '#d4e4d0',
            'hospital', '#f0e6e6',
            'school', '#ece6da',
            '#f2efe8'  // default to land color for commercial/residential/etc
          ]);
        }
        if (layer.type === 'fill' && id.includes('landcover')) {
          map.setPaintProperty(layer.id, 'fill-color', '#d8e8d0');
          map.setPaintProperty(layer.id, 'fill-opacity', 0.3);
        }
        // Buildings — light tan
        if (layer.type === 'fill' && id.includes('building')) {
          map.setPaintProperty(layer.id, 'fill-color', '#e4ddd4');
          map.setPaintProperty(layer.id, 'fill-opacity', 0.6);
        }
        // Land background — warm cream
        if (layer.type === 'background') {
          map.setPaintProperty(layer.id, 'background-color', '#f2efe8');
        }
        if (layer.type === 'fill' && (id === 'land' || id === 'land-structure-polygon')) {
          map.setPaintProperty(layer.id, 'fill-color', '#f2efe8');
        }
        // Roads — white
        if (layer.type === 'line' && id.includes('road') && !id.includes('label')) {
          map.setPaintProperty(layer.id, 'line-color', '#ffffff');
        }
        // Road fills/cases
        if (layer.type === 'fill' && id.includes('road')) {
          map.setPaintProperty(layer.id, 'fill-color', '#ffffff');
        }
        // Bridge roads
        if (layer.type === 'line' && id.includes('bridge') && !id.includes('label')) {
          map.setPaintProperty(layer.id, 'line-color', '#ffffff');
        }
        // Tunnel roads — slightly off-white
        if (layer.type === 'line' && id.includes('tunnel')) {
          map.setPaintProperty(layer.id, 'line-color', '#ebe8e2');
        }
      } catch(e) { /* layer may not support property */ }
    }
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
    // Hide the persistent tab bar while on input screens — the simulated keyboard
    // sits directly above it otherwise, and there's no room for both.
    const tabBarEl = document.getElementById('tab-bar-persistent');
    if (tabBarEl) tabBarEl.classList.toggle('hidden-down', isTargetInput);
    const tabBarBlurEl = document.getElementById('tab-bar-blur');
    if (tabBarBlurEl) tabBarBlurEl.classList.toggle('hidden-down', isTargetInput);
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
      s.querySelectorAll('.venue-list').forEach(l => { l.scrollTop = 0; });
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
  map.on('zoomstart', (e) => { if (e.originalEvent) { mapPanned = true; collapseSheets(); } });

  function setNavBtnActive(active) {
    allNavBtns.forEach(b => b.classList.toggle('active', active));
  }
  map.on('dragstart', () => setNavBtnActive(false));
  map.on('zoomstart', (e) => { if (!e.originalEvent) return; setNavBtnActive(false); });

  // Venue list interactions: expand collapsed sheet, collapse when dragging down from top
  document.querySelectorAll('.venue-list').forEach(function(list) {
    var dragStartY = 0;
    var isDragging = false;

    function tryExpand() {
      var sheet = list.closest('.results-sheet');
      if (sheet && sheet.classList.contains('collapsed')) {
        expandSheets();
      }
    }

    list.addEventListener('wheel', function(e) {
      tryExpand();
      // If at top and scrolling down (negative deltaY = scroll up in content terms),
      // collapse sheet
      var sheet = list.closest('.results-sheet');
      if (sheet && !sheet.classList.contains('collapsed') && list.scrollTop <= 0 && e.deltaY < 0) {
        collapseSheets();
      }
    }, { passive: true });

    list.addEventListener('touchstart', function(e) {
      tryExpand();
      dragStartY = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });

    list.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      var dy = e.touches[0].clientY - dragStartY;
      var sheet = list.closest('.results-sheet');
      // At scroll top and dragging down → collapse
      if (sheet && !sheet.classList.contains('collapsed') && list.scrollTop <= 0 && dy > 60) {
        isDragging = false;
        collapseSheets();
      }
    }, { passive: true });

    list.addEventListener('touchend', function() { isDragging = false; }, { passive: true });

    list.addEventListener('mousedown', function(e) {
      tryExpand();
      dragStartY = e.clientY;
      isDragging = true;
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      var dy = e.clientY - dragStartY;
      var sheet = list.closest('.results-sheet');
      if (sheet && !sheet.classList.contains('collapsed') && list.scrollTop <= 0 && dy > 60) {
        isDragging = false;
        collapseSheets();
      }
    });

    document.addEventListener('mouseup', function() { isDragging = false; });
  });

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
      // If a real drag occurred, suppress the synthesized click on any underlying
      // venue card so it doesn't open the venue detail after release.
      if (Math.abs(delta) >= 10) {
        wasDragging = true;
        setTimeout(function() { wasDragging = false; }, 0);
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
      // Reset list scroll when leaving expanded state so dragging the sheet works next time
      if (snapTo !== EXPANDED_Y) {
        sheet.querySelectorAll('.venue-list').forEach(l => { l.scrollTop = 0; });
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

    // Should this event start a sheet drag?
    // From handle/filter area — always drag.
    // From venue list — allow if collapsed OR if list is at scroll top (to drag down).
    function shouldDragSheet(e) {
      var fromList = e.target.closest('.venue-list');
      if (!fromList) return true;
      if (sheet.classList.contains('collapsed')) return true;
      // In default/expanded state, allow drag if list is at scroll top
      if (fromList.scrollTop <= 0) return true;
      return false;
    }

    // Touch events
    sheet.addEventListener('touchstart', e => {
      if (!shouldDragSheet(e)) {
        // If collapsed and touching the list, expand instead
        if (sheet.classList.contains('collapsed')) expandSheets();
        return;
      }
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
      if (!shouldDragSheet(e)) {
        if (sheet.classList.contains('collapsed')) expandSheets();
        return;
      }
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

  // ========== VENUE DETAIL MODAL ==========
  const venueDetailEl = document.getElementById('venue-detail');
  const venueDetailSheet = venueDetailEl.querySelector('.venue-detail-sheet');
  const venueDetailScroll = venueDetailEl.querySelector('.venue-detail-scroll');
  const persistentTabBar = document.getElementById('tab-bar-persistent');

  // ========== CLASS DETAIL MODAL ==========
  const classDetailEl = document.getElementById('class-detail');
  const classDetailSheet = classDetailEl.querySelector('.class-detail-sheet');
  const classDetailScroll = classDetailEl.querySelector('.class-detail-scroll');
  const cdBookingBar = document.getElementById('cd-booking-bar');

  // Motion.js helpers — iOS-like spring configs.
  // Motion's UMD bundle recognizes `type: "spring"` as a string literal, NOT
  // a function reference (internally it checks `type === "spring"`). Using
  // the function form silently falls through to a slow default tween.
  var motionAnimate = window.Motion && window.Motion.animate;
  // iOS sheet spring: slightly underdamped for that bouncy feel
  var iosSheetSpring = { type: 'spring', stiffness: 400, damping: 35 };
  // iOS snap-back spring: stiffer for quick snap
  var iosSnapSpring = { type: 'spring', stiffness: 500, damping: 30 };
  // iOS tab indicator spring: fast, no bounce
  var iosTabSpring = { type: 'spring', stiffness: 600, damping: 50 };

  // Shared catalog: the classes this venue offers. Both the Classes panel
  // (static list with descriptions) and the Schedule generator (random
  // time slots) draw titles from this list so they stay in sync.
  var VENUE_CLASSES = [
    {
      title: 'Power Vinyasa Flow',
      description: 'A dynamic, breath-led flow that builds heat and strength through linked postures. Suitable for all levels.'
    },
    {
      title: 'Sculpt & Tone',
      description: 'A full-body sculpting class that blends light weights, pilates-inspired movement, and high reps to build lean strength. Modifications offered throughout.'
    },
    {
      title: 'Restorative Yoga',
      description: 'A slower, supported practice using props to help the body fully relax. Great for recovery days and for anyone new to yoga.'
    },
    {
      title: 'HIIT Reformer',
      description: 'High-intensity intervals on the reformer, fusing cardio bursts with strength and resistance work for a fast, efficient sweat.'
    },
    {
      title: 'Candlelit Flow',
      description: 'A slower, meditative flow set to low light. Perfect for winding down.'
    }
  ];

  function openVenueDetail(index, initialTab) {
    const pin = currentPins[index];
    if (!pin) return;
    window.__currentVenuePin = pin;
    // Re-render the Schedule tab so prices reflect this venue's intro-offer flag
    if (window.__renderVdSchedule) window.__renderVdSchedule();
    // Toggle the Overview intro-offer promo card based on this venue's flag
    const promoEl = document.getElementById('vd-section-promo');
    if (promoEl) promoEl.style.display = hasVenueIntroOffer(pin) ? '' : 'none';

    const search = currentSearchLabel;
    const rawTags = search || pin.category || STUDIO_TAGS[pin.name] || 'Fitness';
    const tags = formatTag(rawTags);
    const distance = pin.distance != null ? (pin.distance / 1609.34).toFixed(1) : (0.1 + (index * 0.15)).toFixed(1);
    const rating = (4.5 + (index % 5) * 0.1).toFixed(1);
    const reviews = 50 + index * 37;
    // Prefer a real neighborhood: cached Mapbox result > Foursquare's field >
    // deterministic hash fallback. Kicks off a reverse-geocode below if needed.
    const neighborhood = pin._resolvedNeighborhood || pin.neighborhood || pickNeighborhood(pin.name);
    const desc = getVenueDescription(pin.name, tags);

    document.getElementById('vd-name').textContent = pin.name;
    document.getElementById('vd-tags').textContent = tags;
    document.getElementById('vd-rating-num').textContent = rating;
    document.getElementById('vd-rating-meta').textContent = '(' + reviews + ') \u00B7 ' + neighborhood;

    // If we haven't yet resolved a real neighborhood for this pin, ask Mapbox.
    // When it returns, update the meta line only if the user is still viewing
    // this same pin (prevents a flash on a different venue after a quick swap).
    if (pin._resolvedNeighborhood === undefined && !pin.neighborhood) {
      reverseGeocodeNeighborhood(pin).then(function(name) {
        if (!name) return;
        if (window.__currentVenuePin !== pin) return;
        document.getElementById('vd-rating-meta').textContent = '(' + reviews + ') \u00B7 ' + name;
      });
    }
    // Populate the Ratings & Reviews preview lockup (big number + count).
    var ratingBigEl = document.getElementById('vd-rating-big');
    var reviewsCountEl = document.getElementById('vd-reviews-count');
    if (ratingBigEl) ratingBigEl.textContent = rating;
    if (reviewsCountEl) reviewsCountEl.textContent = '(' + reviews + ')';

    // Static map thumbnail
    const mapThumb = document.getElementById('vd-map-thumb');
    if (pin.lat && pin.lng && window.MAPBOX_TOKEN) {
      const staticUrl = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/'
        + pin.lng + ',' + pin.lat + ',14,0/353x204@2x?access_token=' + MAPBOX_TOKEN;
      mapThumb.style.backgroundImage = 'url(' + staticUrl + ')';
      mapThumb.style.backgroundSize = 'cover';
      mapThumb.style.backgroundPosition = 'center';
    }
    // Address footer under the map thumbnail
    const addressEl = document.getElementById('vd-map-address');
    if (addressEl) {
      const parts = [];
      if (pin.address) parts.push(pin.address);
      if (pin.locality) parts.push(pin.locality + ', NY');
      addressEl.textContent = parts.length ? parts.join(', ') : neighborhood + ', NY';
    }

    document.getElementById('vd-sticky-title').textContent = pin.name;
    document.getElementById('vd-sticky-nav').classList.remove('scrolled');

    // Populate reviews panel with this venue's rating
    if (window.__renderReviewsPanel) {
      window.__renderReviewsPanel(rating, reviews);
    }

    venueDetailScroll.scrollTop = 0;
    venueDetailEl.querySelectorAll('.vd-hscroll').forEach(function(s) { s.scrollLeft = 0; });
    // Clean slate: if a class-detail-stacking cleanup was interrupted by a
    // subsequent venue drag-dismiss, inline backdrop dim and stacked-sheet
    // styles can persist (committed to inline by Motion's finish handler on
    // the prior open-class animation). Cancel any Web Animations FIRST so
    // their fill:both holds release, THEN wipe inline so the fresh sheet has
    // no residual overlay or visual dimming.
    if (motionAnimate) {
      venueDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
      classDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
    }
    venueDetailEl.style.background = '';
    venueDetailSheet.classList.remove('stacked');
    venueDetailSheet.style.borderRadius = '';
    venueDetailSheet.style.filter = '';
    classDetailEl.classList.remove('class-detail-visible');
    classDetailEl.style.background = '';
    classDetailSheet.style.transform = '';
    classDetailSheet.style.visibility = '';
    // Snap the booking bar back to its hidden resting state — no animation.
    if (motionAnimate) cdBookingBar.getAnimations().forEach(function(a) { a.cancel(); });
    cdBookingBar.classList.remove('cd-booking-visible');
    cdBookingBar.style.transform = '';
    cdBookingBar.style.visibility = '';
    venueDetailEl.classList.add('venue-detail-visible');
    // Animate sheet in with ease-out
    venueDetailSheet.style.visibility = 'visible';
    venueDetailSheet.style.transform = 'translateY(100%)';
    if (motionAnimate) {
      // Animate transform plus filter/border-radius back to their un-stacked
      // values so Motion's commit-on-finish overwrites any inline values that
      // a prior class-stacking animation committed and never got to clean up.
      motionAnimate(venueDetailSheet, {
        transform: ['translateY(100%)', 'translateY(0%)'],
        filter: ['none', 'none'],
        borderRadius: ['32px 32px 0 0', '32px 32px 0 0']
      }, { duration: 0.3, easing: 'cubic-bezier(.25, .46, .45, .94)' }).finished.then(function() {
        // After the commit lands, drop the inline values so the sheet uses
        // the stylesheet defaults and nothing dims on the next open.
        venueDetailSheet.style.filter = '';
        venueDetailSheet.style.borderRadius = '';
      });
    } else {
      void venueDetailSheet.offsetHeight;
      venueDetailSheet.style.transition = 'transform 0.35s cubic-bezier(.25, .46, .45, .94)';
      venueDetailSheet.style.transform = 'translateY(0%)';
    }
    venueDetailOpen = true;
    if (window.__resetVenueDetailTabs) {
      // Defer until after the modal becomes visible so layout is correct
      requestAnimationFrame(function() {
        window.__resetVenueDetailTabs();
        // Tabs are sticky in the scroll flow below the image carousel.
        // Cache the scroll position at which they pin (so tab-tap glides
        // land at the pinned position consistently).
        var tabsEl = venueDetailEl.querySelector('.vd-tabs');
        var scrollRect = venueDetailScroll.getBoundingClientRect();
        if (tabsEl) {
          var tabsRect = tabsEl.getBoundingClientRect();
          window.__vdPinOffset = tabsRect.top - scrollRect.top - 64;
        } else {
          window.__vdPinOffset = 0;
        }
        // Measure the about-text clamp: unhide "see more" only if the copy
        // actually overflows the 3-line limit.
        var aboutText = document.getElementById('vd-about-text');
        var seeMoreEl = document.getElementById('vd-see-more');
        if (aboutText && seeMoreEl) {
          // Re-measure in expanded->collapsed cycles too
          aboutText.classList.remove('expanded');
          seeMoreEl.textContent = 'see more';
          if (aboutText.scrollHeight > aboutText.clientHeight + 1) {
            seeMoreEl.hidden = false;
          } else {
            seeMoreEl.hidden = true;
          }
        }
        // If an initial tab was requested (e.g. "schedule"), switch to it after layout settles
        if (initialTab && window.__switchVenueDetailTab) {
          window.__switchVenueDetailTab(initialTab);
        }
      });
    }
  }

  function closeVenueDetail() {
    venueDetailOpen = false;
    venueDetailEl.style.background = '';
    venueDetailEl.classList.remove('venue-detail-visible');
    // Get the sheet height so we can animate to a pixel value (avoids % vs px mismatch)
    var sheetHeight = venueDetailSheet.offsetHeight;
    if (motionAnimate) {
      motionAnimate(venueDetailSheet, { transform: 'translateY(' + sheetHeight + 'px)' }, { duration: 0.25, easing: 'cubic-bezier(.25, .46, .45, .94)' }).then(function() {
        venueDetailSheet.style.transform = '';
        venueDetailSheet.style.visibility = '';
      });
    } else {
      venueDetailSheet.style.transition = '';
      void venueDetailSheet.offsetHeight;
      venueDetailSheet.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
      venueDetailSheet.style.transform = 'translateY(100%)';
      venueDetailSheet.addEventListener('transitionend', function handler() {
        venueDetailSheet.removeEventListener('transitionend', handler);
        venueDetailSheet.style.transform = '';
        venueDetailSheet.style.transition = '';
        venueDetailSheet.style.visibility = '';
      }, { once: true });
    }
  }

  // Close button
  document.getElementById('venue-detail-close').addEventListener('click', closeVenueDetail);

  // Sticky nav: show venue name when scrolled past the header.
  // Also fade tabs in once the user scrolls into the Available today area —
  // threshold is 50% of pinOffset so tabs are visible well before they pin,
  // and tabs are re-hidden when the user scrolls back to the top.
  (function() {
    var stickyNav = document.getElementById('vd-sticky-nav');
    var SCROLL_THRESHOLD = 10;

    venueDetailScroll.addEventListener('scroll', function() {
      if (!venueDetailOpen) return;
      if (venueDetailScroll.scrollTop > SCROLL_THRESHOLD) {
        stickyNav.classList.add('scrolled');
      } else {
        stickyNav.classList.remove('scrolled');
      }
    }, { passive: true });
  })();

  // ========== TAB SWITCHING WITH ANIMATED INDICATOR ==========
  (function() {
    var tabsContainer = venueDetailEl.querySelector('.vd-tabs');
    var tabs = venueDetailEl.querySelectorAll('.vd-tab');
    var indicator = document.getElementById('vd-tab-indicator');
    var panels = venueDetailEl.querySelectorAll('.vd-panel');

    function moveIndicator(tab, instant) {
      var rect = tab.getBoundingClientRect();
      var parentRect = tabsContainer.getBoundingClientRect();
      var left = rect.left - parentRect.left;
      if (motionAnimate && !instant) {
        motionAnimate(indicator, {
          transform: 'translateX(' + left + 'px)',
          width: rect.width + 'px'
        }, iosTabSpring);
      } else {
        indicator.style.width = rect.width + 'px';
        indicator.style.transform = 'translateX(' + left + 'px)';
      }
    }

    function activateTab(tab) {
      // Use cached pin offset (measured when venue detail opened at scrollTop=0)
      var pinOffset = window.__vdPinOffset || 0;

      tabs.forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      moveIndicator(tab);
      var panelName = tab.dataset.tab;
      panels.forEach(function(p) {
        if (p.dataset.panel === panelName) p.classList.add('active');
        else p.classList.remove('active');
      });

      // Tapping a tab brings the tabs to the pinned position. When the user
      // is far above the pin (e.g. at the header), an instant scroll feels
      // violent — glide with a short ease-out so the tabs rise into place
      // alongside the 200ms panel fade. When already pinned, the delta is
      // ~0 and the loop exits on the first frame.
      if (pinOffset > 0) {
        var startTop = venueDetailScroll.scrollTop;
        var delta = pinOffset - startTop;
        if (Math.abs(delta) < 1) {
          venueDetailScroll.scrollTop = pinOffset;
        } else {
          var startTime = performance.now();
          var duration = 250;
          (function glide() {
            var t = Math.min(1, (performance.now() - startTime) / duration);
            var eased = 1 - Math.pow(1 - t, 3);
            venueDetailScroll.scrollTop = startTop + delta * eased;
            if (t < 1) requestAnimationFrame(glide);
          })();
        }
      }

      // Reset horizontal scroll on all carousels
      venueDetailEl.querySelectorAll('.vd-hscroll').forEach(function(s) { s.scrollLeft = 0; });

      // Classes panel descriptions can only be measured once the panel is
      // laid out (display:flex). Run the overflow check on first activation.
      if (panelName === 'classes' && window.__measureClassesSeeMore) {
        requestAnimationFrame(window.__measureClassesSeeMore);
      }
    }

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() { activateTab(tab); });
    });

    // Expose for external triggers (e.g. "See more" buttons)
    window.__switchVenueDetailTab = function(tabName) {
      var tab = Array.prototype.find.call(tabs, function(t) { return t.dataset.tab === tabName; });
      if (tab) activateTab(tab);
    };

    // "See schedule" button below the Available today cards jumps to Schedule tab.
    var seeScheduleBtn = document.getElementById('vd-see-schedule-btn');
    if (seeScheduleBtn) {
      seeScheduleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.__switchVenueDetailTab('schedule');
      });
    }

    // "See full schedule" CTA in the Available today preview.
    var seeFullScheduleBtn = document.getElementById('vd-see-full-schedule-btn');
    if (seeFullScheduleBtn) {
      seeFullScheduleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.__switchVenueDetailTab('schedule');
      });
    }

    // Expandable about text: tapping "see more" toggles .expanded and
    // relabels the link. The visibility of the link itself is driven by
    // the overflow measurement performed when the sheet opens.
    var aboutTextEl = document.getElementById('vd-about-text');
    var seeMoreLink = document.getElementById('vd-see-more');
    if (aboutTextEl && seeMoreLink) {
      seeMoreLink.addEventListener('click', function(e) {
        e.stopPropagation();
        var isExpanded = aboutTextEl.classList.toggle('expanded');
        seeMoreLink.textContent = isExpanded ? 'see less' : 'see more';
      });
    }

    // Classes panel: render cards from the shared venue class catalog, then
    // reveal "see more" only on cards whose descriptions actually clamp.
    var classesList = document.getElementById('vd-classes-list');
    if (classesList) {
      var classesHtml = VENUE_CLASSES.map(function(c, i) {
        return '<div class="vd-class-summary-card">'
          +   '<div class="vd-class-summary-text">'
          +     '<div class="vd-class-summary-title">' + c.title + '</div>'
          +     '<div class="vd-class-summary-desc">' + c.description + '</div>'
          +     '<span class="vd-class-summary-seemore" hidden>see more</span>'
          +   '</div>'
          +   '<button class="vd-class-summary-btn" type="button" data-class-idx="' + i + '">View class</button>'
          + '</div>';
      }).join('');
      classesList.innerHTML = classesHtml;

      // Wire each "View Class" button to open the class detail page. Uses
      // the same default cls shape as the slot-btn handler so pricing and
      // intro-offer behavior stay consistent.
      classesList.querySelectorAll('.vd-class-summary-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (wasDragging) return;
          var idx = parseInt(btn.dataset.classIdx, 10) || 0;
          var venueClass = VENUE_CLASSES[idx];
          var venueHasIntro = hasVenueIntroOffer(window.__currentVenuePin);
          var cls = {
            time: '10:00 AM · 60 min',
            title: venueClass.title,
            instructor: 'Carolyn',
            rating: '4.8 (250)',
            disabled: false,
            spots: '3 spots left'
          };
          if (venueHasIntro) {
            cls.priceLabel = 'Intro offer';
            cls.strikePrice = '$35';
            cls.finalPrice = '$25';
          } else {
            cls.plainPrice = '$25';
          }
          if (typeof window.__openClassDetail === 'function') window.__openClassDetail(cls);
        });
      });

      // Reveal "see more" only on descriptions that overflow the 3-line clamp.
      // Must run after layout so scrollHeight/clientHeight are measurable —
      // the Classes panel may be hidden initially, so defer to first activation.
      var seeMoreMeasured = false;
      function measureSeeMore() {
        if (seeMoreMeasured) return;
        classesList.querySelectorAll('.vd-class-summary-card').forEach(function(card) {
          var desc = card.querySelector('.vd-class-summary-desc');
          var seeMore = card.querySelector('.vd-class-summary-seemore');
          if (!desc || !seeMore) return;
          if (desc.scrollHeight > desc.clientHeight + 1) {
            seeMore.hidden = false;
          }
        });
        seeMoreMeasured = true;
      }
      window.__measureClassesSeeMore = measureSeeMore;
    }

    // Wire Available today pills: "See more"/"See all" jump to Schedule tab;
    // actual time pills open class detail with the clicked time pre-selected.
    venueDetailEl.querySelectorAll('.vd-slot-btn, .vd-see-all-card').forEach(function(btn) {
      var label = (btn.textContent || '').trim().toLowerCase();
      if (label === 'see more' || label.indexOf('see all') === 0) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          window.__switchVenueDetailTab('schedule');
        });
      } else if (btn.classList.contains('vd-slot-btn')) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (wasDragging) return;
          var card = btn.closest('.vd-class-card');
          var titleEl = card && card.querySelector('.vd-class-name');
          var title = titleEl ? titleEl.textContent.trim() : 'Class';
          var time = btn.textContent.trim();
          var venueHasIntro = hasVenueIntroOffer(window.__currentVenuePin);
          var cls = {
            time: time + ' \u00b7 60 min',
            title: title,
            instructor: 'Carolyn',
            rating: '4.8 (250)',
            disabled: false,
            spots: '3 spots left'
          };
          if (venueHasIntro) {
            cls.priceLabel = 'Intro offer';
            cls.strikePrice = '$35';
            cls.finalPrice = '$25';
          } else {
            cls.plainPrice = '$25';
          }
          if (typeof window.__openClassDetail === 'function') window.__openClassDetail(cls);
        });
      }
    });

    // Tapping "Ratings & Reviews" chevron in Overview → switch to Reviews tab
    var vdReviewsHeader = venueDetailEl.querySelector('.vd-reviews-header');
    if (vdReviewsHeader) {
      vdReviewsHeader.addEventListener('click', function() {
        if (wasDragging) return;
        window.__switchVenueDetailTab('reviews');
      });
    }

    // "See all" card at end of reviews carousel → switch to Reviews tab
    var vdReviewSeeAll = venueDetailEl.querySelector('#vd-review-see-all');
    if (vdReviewSeeAll) {
      vdReviewSeeAll.addEventListener('click', function() {
        window.__switchVenueDetailTab('reviews');
      });
    }

    // Scroll the venue detail to a specific section id or an offset (number).
    // Usage: window.__scrollVenueDetailTo('vd-section-promo')  or  window.__scrollVenueDetailTo(420)
    window.__scrollVenueDetailTo = function(target, offset) {
      offset = offset || 0;
      if (typeof target === 'number') {
        venueDetailScroll.scrollTop = target;
        return;
      }
      var el = typeof target === 'string' ? document.getElementById(target) : target;
      if (!el) return;
      // Get position relative to the scroll container's content
      var top = el.offsetTop + offset;
      venueDetailScroll.scrollTop = top;
    };

    // Position indicator on initial load (after the venue detail opens)
    window.__resetVenueDetailTabs = function() {
      var firstTab = tabs[0];
      tabs.forEach(function(t) { t.classList.remove('active'); });
      firstTab.classList.add('active');
      panels.forEach(function(p) {
        if (p.dataset.panel === 'overview') p.classList.add('active');
        else p.classList.remove('active');
      });
      requestAnimationFrame(function() {
        moveIndicator(firstTab, true); // instant, no spring
      });
    };
  })();

  // ========== SCHEDULE PANEL: DATE PICKER + CLASS LIST ==========
  (function() {
    var datePicker = document.getElementById('vd-date-picker');
    var scheduleList = document.getElementById('vd-schedule-list');
    if (!datePicker || !scheduleList) return;
    var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var VD_WEEKS_COUNT = 2; // current week + 1 future (forward-only navigation)

    function renderDatePicker(selectedAbsIdx) {
      var today = new Date();
      var dow = today.getDay();
      // absIdx 0 = today; subsequent indices are future days.
      if (selectedAbsIdx == null) selectedAbsIdx = 0;
      var html = '';
      for (var w = 0; w < VD_WEEKS_COUNT; w++) {
        html += '<div class="vd-week">';
        for (var i = 0; i < 7; i++) {
          var absIdx = w * 7 + i;
          var date = new Date(today);
          date.setDate(today.getDate() + absIdx);
          var letterIdx = (dow + absIdx) % 7;
          var classes = 'vd-date-cell';
          if (absIdx === 0) classes += ' today';
          if (absIdx === selectedAbsIdx) classes += ' selected';
          html += '<div class="' + classes + '" data-abs="' + absIdx + '">'
            + '<div class="vd-date-letter">' + DAY_LETTERS[letterIdx] + '</div>'
            + '<div class="vd-date-day">' + date.getDate() + '</div>'
            + '</div>';
        }
        html += '</div>';
      }
      datePicker.innerHTML = html;
      datePicker.querySelectorAll('.vd-date-cell').forEach(function(cell) {
        cell.addEventListener('click', function() {
          if (wasDragging) return;
          renderDatePicker(parseInt(cell.dataset.abs, 10));
          renderScheduleList();
        });
      });
      // Scroll to the week that contains the selected day
      var selectedWeekIdx = Math.floor(selectedAbsIdx / 7);
      requestAnimationFrame(function() {
        var weekWidth = datePicker.clientWidth;
        if (weekWidth) datePicker.scrollLeft = selectedWeekIdx * weekWidth;
      });
    }

    // ---- Venue date picker carousel snap (mirrors class detail's logic) ----
    var vdPickerAnimating = false;
    var vdPickerScrollDebounce = null;
    var vdPickerStartScrollLeft = 0;
    var VD_SWIPE_INTENT_THRESHOLD = 20;
    function vdAnimateScrollLeft(el, target, duration) {
      var start = el.scrollLeft;
      var distance = target - start;
      if (Math.abs(distance) < 1) return;
      var startTime = performance.now();
      vdPickerAnimating = true;
      function step(now) {
        var t = Math.min(1, (now - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        el.scrollLeft = start + distance * eased;
        if (t < 1) requestAnimationFrame(step);
        else vdPickerAnimating = false;
      }
      requestAnimationFrame(step);
    }
    function snapVdDatePickerToTarget() {
      if (vdPickerAnimating) return;
      var weekWidth = datePicker.clientWidth;
      if (!weekWidth) return;
      var current = datePicker.scrollLeft;
      var distance = current - vdPickerStartScrollLeft;
      var startWeek = Math.round(vdPickerStartScrollLeft / weekWidth);
      var nearestWeek = Math.round(current / weekWidth);
      if (distance > VD_SWIPE_INTENT_THRESHOLD && nearestWeek <= startWeek) {
        nearestWeek = startWeek + 1;
      } else if (distance < -VD_SWIPE_INTENT_THRESHOLD && nearestWeek >= startWeek) {
        nearestWeek = startWeek - 1;
      }
      var maxWeek = Math.round((datePicker.scrollWidth - weekWidth) / weekWidth);
      nearestWeek = Math.max(0, Math.min(maxWeek, nearestWeek));
      vdAnimateScrollLeft(datePicker, nearestWeek * weekWidth, 400);
    }
    datePicker.addEventListener('scroll', function() {
      if (vdPickerAnimating) return;
      if (!vdPickerScrollDebounce) vdPickerStartScrollLeft = datePicker.scrollLeft;
      clearTimeout(vdPickerScrollDebounce);
      vdPickerScrollDebounce = setTimeout(function() {
        snapVdDatePickerToTarget();
        vdPickerScrollDebounce = null;
      }, 80);
    }, { passive: true });
    // Expose for the desktop mouse-drag handler
    window.__snapVdDatePicker = snapVdDatePickerToTarget;

    var STAR_SVG = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M9.10326 1.81699C9.47008 1.07374 10.5299 1.07374 10.8967 1.81699L12.7063 5.48347C12.8519 5.77862 13.1335 5.98319 13.4592 6.03051L17.5054 6.61846C18.3256 6.73765 18.6531 7.74562 18.0596 8.32416L15.1318 11.1781C14.8961 11.4079 14.7885 11.7389 14.8442 12.0632L15.5353 16.0931C15.6754 16.91 14.818 17.533 14.0844 17.1473L10.4653 15.2446C10.174 15.0915 9.82598 15.0915 9.53466 15.2446L5.91562 17.1473C5.18199 17.533 4.32456 16.91 4.46467 16.0931L5.15585 12.0632C5.21148 11.7389 5.10393 11.4079 4.86825 11.1781L1.94038 8.32416C1.34687 7.74562 1.67438 6.73765 2.4946 6.61846L6.54081 6.03051C6.86652 5.98319 7.14808 5.77862 7.29374 5.48347L9.10326 1.81699Z" fill="#FFB54D"/></svg>';

    // Titles come from the shared VENUE_CLASSES catalog so Schedule and
    // Classes tab always agree on what this venue offers.
    var CLASS_NAMES = VENUE_CLASSES.map(function(c) { return c.title; });
    var INSTRUCTOR_NAMES = [
      'Sarah M.', 'Chauncie D.', 'Liz K.', 'Marcus J.', 'Priya S.',
      'Jordan T.', 'Kai N.', 'Emma R.', 'David C.', 'Nina L.'
    ];
    var DURATIONS = [45, 50, 60, 75];
    var PRICES = [20, 25, 28, 30, 32, 35, 38, 40];

    function generateClasses() {
      var classes = [];
      // Generate 6-9 classes spread from 10:00 AM to 5:00 PM
      var count = 6 + Math.floor(Math.random() * 4);
      // Generate random start times (in minutes from midnight) between 10:00 and 17:00
      var times = [];
      for (var i = 0; i < count; i++) {
        times.push(600 + Math.floor(Math.random() * 420)); // 600=10AM, 1020=5PM
      }
      times.sort(function(a, b) { return a - b; });
      // Round to nearest 15 min
      times = times.map(function(t) { return Math.round(t / 15) * 15; });

      for (var i = 0; i < times.length; i++) {
        var h = Math.floor(times[i] / 60);
        var m = times[i] % 60;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        var timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
        var dur = DURATIONS[Math.floor(Math.random() * DURATIONS.length)];
        var title = i < 4 ? 'Power Vinyasa Flow' : CLASS_NAMES[Math.floor(Math.random() * CLASS_NAMES.length)];
        var instructor = INSTRUCTOR_NAMES[Math.floor(Math.random() * INSTRUCTOR_NAMES.length)];
        var rating = (4.3 + Math.random() * 0.7).toFixed(1);
        var reviews = 50 + Math.floor(Math.random() * 400);
        var price = PRICES[Math.floor(Math.random() * PRICES.length)];
        var isDisabled = Math.random() < 0.15;
        var hasIntro = !isDisabled && hasVenueIntroOffer(window.__currentVenuePin);
        var spotsNum = 1 + Math.floor(Math.random() * 5);
        var spotsLeft = isDisabled ? 'No more spots' : (Math.random() < 0.4 ? spotsNum + (spotsNum === 1 ? ' spot left' : ' spots left') : '');

        var cls = {
          time: timeStr + ' · ' + dur + ' min',
          title: title,
          instructor: instructor,
          rating: rating + ' (' + reviews + ')',
          disabled: isDisabled
        };
        if (spotsLeft) cls.spots = spotsLeft;
        if (hasIntro) {
          cls.priceLabel = 'Intro offer';
          cls.strikePrice = '$35';
          cls.finalPrice = '$25';
        } else {
          cls.plainPrice = '$' + price;
        }
        classes.push(cls);
      }
      return classes;
    }

    function renderScheduleList() {
      var classes = generateClasses();
      window.__lastGeneratedClasses = classes;
      var html = classes.map(function(c, i) {
        var priceHtml = '';
        if (c.finalPrice) {
          priceHtml = '<div class="vd-schedule-price">'
            + (c.priceLabel ? '<span class="vd-schedule-price-label">' + c.priceLabel + '</span>' : '')
            + '<span class="vd-price-final">' + c.finalPrice + '</span>'
            + '<span class="vd-price-strike">' + c.strikePrice + '</span>'
            + '</div>';
        } else if (c.plainPrice) {
          priceHtml = '<span class="vd-price-plain">' + c.plainPrice + '</span>';
        }
        return '<div class="vd-schedule-card' + (c.disabled ? ' disabled' : '') + '" data-class-idx="' + i + '">'
          + '<div class="vd-schedule-top">'
          +   '<span class="vd-schedule-time">' + c.time + '</span>'
          + '</div>'
          + '<div class="vd-schedule-title">' + c.title + '</div>'
          + '<div class="vd-schedule-instructor">' + c.instructor + '</div>'
          + '<div class="vd-schedule-bottom">'
          +   '<div class="vd-schedule-rating">' + STAR_SVG + ' ' + c.rating + '</div>'
          +   priceHtml
          + '</div>'
          + '</div>';
      }).join('');
      scheduleList.innerHTML = html;
    }

    // Delegated click handler — open class detail when a non-disabled card is tapped
    scheduleList.addEventListener('click', function(e) {
      var card = e.target.closest('.vd-schedule-card');
      if (!card || card.classList.contains('disabled')) return;
      if (wasDragging) return;
      var idx = +card.dataset.classIdx;
      var cls = window.__lastGeneratedClasses && window.__lastGeneratedClasses[idx];
      if (cls && typeof window.__openClassDetail === 'function') window.__openClassDetail(cls);
    });

    // Initialize on load — picker leads with today (absIdx = 0)
    renderDatePicker(0);
    renderScheduleList();
    // Expose so the schedule re-renders when the user opens a new venue
    // (intro-offer pricing depends on the currently opened venue).
    window.__renderVdSchedule = renderScheduleList;
  })();

  // ========== REVIEWS PANEL ==========
  (function() {
    var STAR_SVG_20 = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M9.10326 1.81699C9.47008 1.07374 10.5299 1.07374 10.8967 1.81699L12.7063 5.48347C12.8519 5.77862 13.1335 5.98319 13.4592 6.03051L17.5054 6.61846C18.3256 6.73765 18.6531 7.74562 18.0596 8.32416L15.1318 11.1781C14.8961 11.4079 14.7885 11.7389 14.8442 12.0632L15.5353 16.0931C15.6754 16.91 14.818 17.533 14.0844 17.1473L10.4653 15.2446C10.174 15.0915 9.82598 15.0915 9.53466 15.2446L5.91562 17.1473C5.18199 17.533 4.32456 16.91 4.46467 16.0931L5.15585 12.0632C5.21148 11.7389 5.10393 11.4079 4.86825 11.1781L1.94038 8.32416C1.34687 7.74562 1.67438 6.73765 2.4946 6.61846L6.54081 6.03051C6.86652 5.98319 7.14808 5.77862 7.29374 5.48347L9.10326 1.81699Z" fill="#FFB54D"/></svg>';
    var STAR_SVG_16 = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M9.10326 1.81699C9.47008 1.07374 10.5299 1.07374 10.8967 1.81699L12.7063 5.48347C12.8519 5.77862 13.1335 5.98319 13.4592 6.03051L17.5054 6.61846C18.3256 6.73765 18.6531 7.74562 18.0596 8.32416L15.1318 11.1781C14.8961 11.4079 14.7885 11.7389 14.8442 12.0632L15.5353 16.0931C15.6754 16.91 14.818 17.533 14.0844 17.1473L10.4653 15.2446C10.174 15.0915 9.82598 15.0915 9.53466 15.2446L5.91562 17.1473C5.18199 17.533 4.32456 16.91 4.46467 16.0931L5.15585 12.0632C5.21148 11.7389 5.10393 11.4079 4.86825 11.1781L1.94038 8.32416C1.34687 7.74562 1.67438 6.73765 2.4946 6.61846L6.54081 6.03051C6.86652 5.98319 7.14808 5.77862 7.29374 5.48347L9.10326 1.81699Z" fill="#FFB54D"/></svg>';

    var REVIEW_NAMES = ['Sara', 'Natalie', 'Jordan', 'Marcus', 'Priya', 'Emma', 'David', 'Liz', 'Kai', 'Nina'];
    var REVIEW_CLASSES = [
      'Sui Power Soul with Chauncie', 'Heated Vinyasa Flow', 'Slow Burn Reformer',
      'Power Yoga Sculpt', 'Full Body Barre', 'HIIT & Flow', 'Candlelit Yin',
      'Core Fusion Express', 'Athletic Conditioning'
    ];
    var REVIEW_BODIES = [
      "I really appreciate Chauncie's flows. They're physically challenging, often incorporating ashtanga elements, but never aggressive for the sake of it.",
      "This class was exactly what I needed. The instructor was so attentive and gave great modifications. The music was perfect and the energy was high.",
      "Incredible workout! Left feeling so strong and centered. The sequencing was creative and the instructor's cues were super clear throughout.",
      "Such a welcoming studio. First time here and the instructor made me feel right at home. Will definitely be coming back for more classes.",
      "The best reformer class I've taken in NYC. Challenging but accessible, with a great playlist that kept the energy up the whole time.",
      "Love the balance of strength and flexibility work. The instructor really knows their stuff and pushes you in the best way possible."
    ];
    var REVIEW_DATES = ['Last week', '2 weeks ago', '3 weeks ago', 'Last month', '2 months ago'];
    var REVIEW_SOURCES = ['ClassPass', '', '', 'ClassPass', ''];

    var AI_SUMMARIES = [
      "People love this studio for its upbeat, music-driven workouts and motivating instructors who give clear form cues. Reviews highlight an intense full-body burn in a short time and frequent shout-outs to specific coaches for energy and guidance.",
      "Reviewers consistently praise the welcoming atmosphere and knowledgeable instructors. The studio is described as clean and well-maintained, with creative class formats that keep regulars coming back week after week.",
      "Highly rated for its intimate class sizes and personalized attention. Many reviewers mention visible results within weeks and appreciate the variety of class offerings throughout the day."
    ];

    function starsHTML(count, svg) {
      var s = '';
      for (var i = 0; i < count; i++) s += svg;
      return s;
    }

    function renderBars(dist) {
      var max = Math.max.apply(null, dist);
      var html = '';
      for (var i = 4; i >= 0; i--) {
        var pct = max > 0 ? (dist[i] / max) * 100 : 0;
        html += '<div class="vd-rev-bar-row">'
          + '<span class="vd-rev-bar-label">' + (i + 1) + '</span>'
          + '<div class="vd-rev-bar-track"><div class="vd-rev-bar-fill" style="width:' + pct + '%"></div></div>'
          + '</div>';
      }
      return html;
    }

    function renderReviewCard(review) {
      var sourceHTML = '';
      if (review.source) {
        sourceHTML = '<div class="vd-rev-source-badge">'
          + '<svg class="vd-rev-source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 10C0 4.47715 4.47715 0 10 0V0C15.5228 0 20 4.47715 20 10V10C20 15.5228 15.5228 20 10 20V20C4.47715 20 0 15.5228 0 10V10Z" fill="#0055FF"/><path d="M11.8559 5.39815C11.733 5.39222 11.1837 5.38899 10.7913 5.38737C10.6637 5.38703 10.5399 5.43088 10.4409 5.51145C10.342 5.59202 10.274 5.70436 10.2484 5.82939L10.0398 6.82717C10.022 6.91422 9.97477 6.99249 9.90606 7.04883C9.83735 7.10518 9.75135 7.13616 9.66249 7.13658L7.70574 7.14521C5.52853 7.14521 3.53027 8.77745 3.53027 11.0636C3.53027 13.1173 5.24391 14.9657 7.70628 14.9657C7.8335 14.9722 8.54828 14.9706 9.0248 14.9722C9.15246 14.9724 9.27624 14.9283 9.3751 14.8475C9.47396 14.7668 9.5418 14.6542 9.56708 14.5291L9.77569 13.5254C9.79331 13.4382 9.84047 13.3597 9.90921 13.3033C9.97795 13.2468 10.0641 13.2158 10.153 13.2154L11.8548 13.2203C14.2595 13.2203 16.0303 11.3719 16.0303 9.29817C16.0303 7.03416 14.0746 5.39653 11.8543 5.39653L11.8559 5.39815ZM11.8446 11.7196L10.1094 11.7233C9.98344 11.7237 9.86149 11.7675 9.76402 11.8472C9.66654 11.9269 9.59947 12.0377 9.57409 12.1611L9.36494 13.1739C9.34712 13.2607 9.29979 13.3386 9.23099 13.3945C9.1622 13.4503 9.07619 13.4805 8.9876 13.4801C8.54828 13.4801 8.30571 13.4661 7.72569 13.4661C6.41041 13.4661 5.0202 12.5891 5.0202 11.0754C5.0202 9.67389 6.26002 8.64592 7.72138 8.64592L9.70076 8.64215C9.82673 8.64201 9.9488 8.59846 10.0464 8.51882C10.144 8.43919 10.2112 8.32835 10.2366 8.20498L10.4473 7.19588C10.4654 7.10919 10.5127 7.03138 10.5815 6.97559C10.6502 6.9198 10.7361 6.88946 10.8247 6.8897C11.1929 6.8897 11.7648 6.89347 11.8429 6.89994C13.2251 6.89994 14.5441 7.84489 14.5441 9.32566C14.5441 10.6808 13.3631 11.7217 11.8435 11.7217" fill="white"/></svg>'
          + '<span class="vd-rev-source-name">' + review.source + '</span>'
          + '</div>';
      }
      return '<div class="vd-rev-card">'
        + '<div class="vd-rev-card-header">'
        +   '<div class="vd-rev-avatar">' + review.name.charAt(0) + '</div>'
        +   '<div class="vd-rev-card-meta">'
        +     '<div class="vd-rev-name-row">'
        +       '<span class="vd-rev-name">' + review.name + '</span>'
        +       '<div class="vd-rev-card-stars">' + starsHTML(review.stars, STAR_SVG_16) + '</div>'
        +     '</div>'
        +     '<div class="vd-rev-date">' + review.date + '</div>'
        +   '</div>'
        + '</div>'
        + '<div class="vd-rev-class-title">' + review.classTitle + '</div>'
        + '<div class="vd-rev-body">' + review.body + '</div>'
        + sourceHTML
        + '</div>';
    }

    window.__renderReviewsPanel = function(rating, reviewCount) {
      // Stars
      var starsEl = document.getElementById('vd-rev-stars');
      if (starsEl) starsEl.innerHTML = starsHTML(5, STAR_SVG_20);

      // Score & count
      var scoreEl = document.getElementById('vd-rev-score');
      if (scoreEl) scoreEl.textContent = rating;
      var countEl = document.getElementById('vd-rev-count');
      if (countEl) countEl.textContent = '(' + reviewCount + ')';

      // Rating distribution bars (fake but proportional)
      var dist = [
        Math.floor(reviewCount * 0.05),
        Math.floor(reviewCount * 0.05),
        Math.floor(reviewCount * 0.12),
        Math.floor(reviewCount * 0.25),
        Math.floor(reviewCount * 0.53)
      ];
      var barsEl = document.getElementById('vd-rev-bars');
      if (barsEl) barsEl.innerHTML = renderBars(dist);

      // AI summary
      var summaryEl = document.getElementById('vd-rev-ai-summary');
      if (summaryEl) summaryEl.textContent = AI_SUMMARIES[Math.floor(Math.random() * AI_SUMMARIES.length)];

      // Review cards (3-5 random reviews)
      var count = 3 + Math.floor(Math.random() * 3);
      var reviews = [];
      for (var i = 0; i < count; i++) {
        reviews.push({
          name: REVIEW_NAMES[Math.floor(Math.random() * REVIEW_NAMES.length)],
          stars: 4 + Math.floor(Math.random() * 2),
          date: REVIEW_DATES[Math.floor(Math.random() * REVIEW_DATES.length)],
          classTitle: REVIEW_CLASSES[Math.floor(Math.random() * REVIEW_CLASSES.length)],
          body: REVIEW_BODIES[Math.floor(Math.random() * REVIEW_BODIES.length)],
          source: REVIEW_SOURCES[Math.floor(Math.random() * REVIEW_SOURCES.length)]
        });
      }
      var listEl = document.getElementById('vd-rev-list');
      if (listEl) listEl.innerHTML = reviews.map(renderReviewCard).join('');
    };

    // Initial render
    window.__renderReviewsPanel('4.7', 2500);
  })();

  // Drag-to-dismiss: works from handle OR when scroll is at top and user drags down
  (function() {
    let dragStartY = 0;
    let dragDelta = 0;
    let dismissDragging = false;
    let dismissDragInitiated = false; // sheet visual drag has actually started
    var DOWNWARD_INTENT_THRESHOLD = 6; // px downward to confirm dismiss intent
    var UPWARD_ABANDON_THRESHOLD = 10; // px upward to abandon (let native scroll take over)

    function startDismissDrag(y) {
      if (classDetailOpen) return; // venue drag is disabled while class detail is layered on top
      // Just record start state — DON'T touch the sheet yet. The visual drag is deferred
      // until we confirm downward intent in moveDismissDrag, so upward flicks pass cleanly
      // through to native scroll without disrupting the sheet's transform/transition.
      dismissDragging = true;
      dismissDragInitiated = false;
      dragStartY = y;
      dragDelta = 0;
      lastDragY = y;
      lastDragTime = Date.now();
      dragVelocity = 0;
    }
    function moveDismissDrag(y) {
      if (!dismissDragging) return;
      var now = Date.now();
      var dt = now - lastDragTime;
      if (dt > 0) dragVelocity = ((y - lastDragY) / dt) * 1000; // px/s
      lastDragY = y;
      lastDragTime = now;
      var delta = y - dragStartY;
      if (!dismissDragInitiated) {
        // Direction not yet confirmed
        if (delta < -UPWARD_ABANDON_THRESHOLD) {
          // User is flicking up — abandon dismiss; native scroll takes the gesture
          dismissDragging = false;
          return;
        }
        if (delta < DOWNWARD_INTENT_THRESHOLD) {
          // Still ambiguous — wait
          return;
        }
        // Confirmed downward intent — initiate visual drag now
        dismissDragInitiated = true;
        venueDetailSheet.style.transition = 'none';
        if (motionAnimate) {
          venueDetailSheet.style.transform = 'translateY(0px)';
          venueDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
        }
        // Re-anchor start so the sheet doesn't jump by THRESHOLD on first frame
        dragStartY = y;
        delta = 0;
      }
      dragDelta = Math.max(0, delta);
      venueDetailSheet.style.transform = 'translateY(' + dragDelta + 'px)';
    }
    var lastDragY = 0;
    var lastDragTime = 0;
    var dragVelocity = 0;

    function endDismissDrag() {
      if (!dismissDragging) return;
      dismissDragging = false;
      // If the visual drag never actually started (upward flick or no movement),
      // there's nothing to clean up — native scroll handled the gesture.
      if (!dismissDragInitiated) return;
      dismissDragInitiated = false;
      // Dismiss if dragged far enough OR fast enough
      if (dragDelta > 80 || dragVelocity > 500) {
        // Animate from current drag position straight down using CSS transition
        venueDetailOpen = false;
        venueDetailEl.classList.remove('venue-detail-visible');
        // Also strip any leftover class-detail stacking state. If a prior class
        // dismissal animation was interrupted by this drag, its .finished.then
        // cleanup never ran, so `stacked` + inline border-radius/filter (plus
        // the backdrop dim on venueDetailEl) are stuck until we wipe them here.
        venueDetailEl.style.background = '';
        venueDetailSheet.classList.remove('stacked');
        venueDetailSheet.style.borderRadius = '';
        venueDetailSheet.style.filter = '';
        var sheetHeight = venueDetailSheet.offsetHeight;
        // Cancel any Motion animations that might interfere
        if (motionAnimate) {
          venueDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
        }
        // Pin current transform, then transition to dismiss position
        venueDetailSheet.style.transition = 'none';
        venueDetailSheet.style.transform = 'translateY(' + dragDelta + 'px)';
        // Force reflow so the starting transform is committed
        void venueDetailSheet.offsetHeight;
        venueDetailSheet.style.transition = 'transform 0.2s cubic-bezier(.25, .46, .45, .94)';
        venueDetailSheet.style.transform = 'translateY(' + sheetHeight + 'px)';
        venueDetailSheet.addEventListener('transitionend', function handler() {
          venueDetailSheet.removeEventListener('transitionend', handler);
          venueDetailSheet.style.transform = '';
          venueDetailSheet.style.transition = '';
          venueDetailSheet.style.visibility = '';
        }, { once: true });
      } else {
        // Snap back with spring (use px to match current inline transform)
        if (motionAnimate) {
          motionAnimate(venueDetailSheet, { transform: 'translateY(0px)' }, iosSnapSpring);
        } else {
          venueDetailSheet.style.transition = '';
          venueDetailSheet.style.transform = '';
        }
      }
    }

    // Handle: always initiates dismiss drag
    var handle = venueDetailEl.querySelector('.venue-detail-handle');
    handle.addEventListener('touchstart', function(e) {
      startDismissDrag(e.touches[0].clientY);
    }, { passive: true });
    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      startDismissDrag(e.clientY);
    });

    // Sticky nav top bar: also acts as drag target (bigger hit area).
    // Skip drags that start on interactive controls; only initiate when
    // scroll is at top so we don't fight native scroll.
    var stickyNavEl = venueDetailEl.querySelector('.vd-sticky-nav');
    function navIsInteractive(target) {
      return target.closest('.venue-detail-close, .vd-actions-pill, .vd-action-icon, button, a');
    }
    stickyNavEl.addEventListener('touchstart', function(e) {
      if (navIsInteractive(e.target)) return;
      if (venueDetailScroll.scrollTop > 0) return;
      startDismissDrag(e.touches[0].clientY);
    }, { passive: true });
    stickyNavEl.addEventListener('mousedown', function(e) {
      if (navIsInteractive(e.target)) return;
      if (venueDetailScroll.scrollTop > 0) return;
      e.preventDefault();
      startDismissDrag(e.clientY);
    });

    // Global touch/mouse move/up for handle-initiated drags
    document.addEventListener('touchmove', function(e) {
      if (dismissDragging) moveDismissDrag(e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', function() {
      if (dismissDragging) endDismissDrag();
    }, { passive: true });
    document.addEventListener('mousemove', function(e) {
      if (dismissDragging) { e.preventDefault(); moveDismissDrag(e.clientY); }
    });
    document.addEventListener('mouseup', function() {
      if (dismissDragging) endDismissDrag();
    });
  })();

  // ========== CLASS DETAIL: OPEN / CLOSE / DRAG-TO-DISMISS ==========
  (function() {
    var CD_DESCRIPTIONS = [
      "Open to all levels, this signature class is designed to help take your practice to the next level. The instructor will guide you through vinyasa sequences, each repeated 3 times. The 1st time through the sequence focuses on form and alignment, the 2nd adds pace, and the 3rd brings it all together in a full-body flow. Expect to leave feeling open, strong, and grounded.",
      "A dynamic flow linking breath to movement. Expect sun salutations, standing balances, and a supported cool-down. Heated to 95°F to deepen flexibility and release tension. Modifications are offered throughout so every body can find its edge safely.",
      "Build strength and flexibility through controlled, fluid sequences. All levels welcome — modifications offered throughout. Leave feeling longer, stronger, and more centered. Props are provided and the instructor cues breath throughout the class.",
      "A high-energy class combining yoga fundamentals with bodyweight strength training. Expect to sweat, breathe, and build serious core stability over the course of 50 intense minutes. Modifications are offered, but expect to work hard from start to finish."
    ];
    var CD_PREP = "All classes are hot. Mats + towels are complimentary on your first visit and always available for a small rental fee after. Water + electrolytes are available for purchase at the front desk. Arrive 10 minutes early to check in and settle your mat.";
    var CD_INTRO_CHIP_SVG = '<svg class="cd-intro-chip-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.38223 17.1763C4.62285 17.1763 4.05596 16.9891 3.68154 16.6147C3.30713 16.2403 3.11992 15.6708 3.11992 14.9061V13.2529C3.11992 13.1263 3.0751 13.0156 2.98545 12.9207L1.81475 11.75C1.27158 11.2121 1 10.6795 1 10.1521C1 9.62478 1.27158 9.08953 1.81475 8.54636L2.98545 7.36775C3.0751 7.2781 3.11992 7.17 3.11992 7.04343V5.3823C3.11992 4.61238 3.30449 4.04285 3.67363 3.67371C4.04805 3.30457 4.61758 3.12 5.38223 3.12H7.04336C7.17519 3.12 7.2833 3.07517 7.36768 2.98552L8.54629 1.81482C9.08945 1.27166 9.62207 1.00008 10.1441 1.00008C10.6715 0.994802 11.2067 1.26638 11.7499 1.81482L12.9285 2.98552C13.0182 3.07517 13.1263 3.12 13.2528 3.12H14.914C15.6786 3.12 16.2455 3.3072 16.6146 3.68162C16.9891 4.05603 17.1763 4.62293 17.1763 5.3823V7.04343C17.1763 7.17 17.2237 7.2781 17.3187 7.36775L18.4894 8.54636C19.0272 9.08953 19.2962 9.62478 19.2962 10.1521C19.2962 10.6795 19.0272 11.2121 18.4894 11.75L17.3187 12.9207C17.2237 13.0156 17.1763 13.1263 17.1763 13.2529V14.9061C17.1763 15.6761 16.9891 16.2456 16.6146 16.6147C16.2455 16.9891 15.6786 17.1763 14.914 17.1763H13.2528C13.1263 17.1763 13.0182 17.2212 12.9285 17.3108L11.7499 18.4815C11.212 19.0247 10.6794 19.2963 10.1521 19.2963C9.62471 19.2963 9.08945 19.0247 8.54629 18.4815L7.36768 17.3108C7.2833 17.2212 7.17519 17.1763 7.04336 17.1763H5.38223Z" fill="#379062"/><path d="M7.38359 10.2655C6.85889 10.2655 6.43965 10.0875 6.12588 9.73154C5.81475 9.37295 5.65918 8.87988 5.65918 8.25234C5.65918 7.61689 5.81606 7.12515 6.12983 6.7771C6.4436 6.42905 6.86152 6.25503 7.38359 6.25503C7.9083 6.25503 8.32754 6.42905 8.64131 6.7771C8.95508 7.12251 9.11196 7.61294 9.11196 8.24839C9.11196 8.87593 8.9564 9.36899 8.64526 9.72759C8.33413 10.0862 7.91357 10.2655 7.38359 10.2655ZM7.38359 9.32812C7.55762 9.32812 7.68813 9.23848 7.77515 9.05918C7.86216 8.87988 7.90566 8.61094 7.90566 8.25234C7.90566 7.89902 7.86216 7.63403 7.77515 7.45737C7.68813 7.28071 7.55762 7.19238 7.38359 7.19238C7.21221 7.19238 7.08169 7.28071 6.99204 7.45737C6.90503 7.63403 6.86152 7.89902 6.86152 8.25234C6.86152 8.61094 6.90503 8.87988 6.99204 9.05918C7.08169 9.23848 7.21221 9.32812 7.38359 9.32812ZM12.9167 13.7618C12.3894 13.7618 11.9688 13.5838 11.6551 13.2278C11.3439 12.8719 11.1884 12.3788 11.1884 11.7486C11.1884 11.1132 11.3453 10.6214 11.659 10.2734C11.9728 9.92534 12.392 9.75132 12.9167 9.75132C13.4388 9.75132 13.8567 9.92534 14.1705 10.2734C14.4843 10.6214 14.6412 11.1132 14.6412 11.7486C14.6412 12.3735 14.4856 12.8653 14.1745 13.2239C13.8633 13.5825 13.4441 13.7618 12.9167 13.7618ZM12.9167 12.8284C13.0881 12.8284 13.2173 12.7387 13.3043 12.5594C13.394 12.3775 13.4388 12.1072 13.4388 11.7486C13.4388 11.3927 13.394 11.1277 13.3043 10.9537C13.2173 10.777 13.0881 10.6887 12.9167 10.6887C12.7427 10.6887 12.6122 10.777 12.5252 10.9537C12.4382 11.1303 12.3947 11.3953 12.3947 11.7486C12.3947 12.1072 12.4382 12.3775 12.5252 12.5594C12.6122 12.7387 12.7427 12.8284 12.9167 12.8284ZM7.70395 13.7064C7.56157 13.6247 7.4772 13.5073 7.45083 13.3544C7.42446 13.2015 7.46006 13.0512 7.55762 12.9035L11.8251 6.49629C11.9201 6.35654 12.04 6.26953 12.1851 6.23525C12.3301 6.19834 12.4672 6.2168 12.5964 6.29062C12.7414 6.36973 12.8297 6.48838 12.8614 6.64658C12.893 6.80215 12.8601 6.95376 12.7625 7.10142L8.49497 13.5284C8.40532 13.6629 8.28271 13.7446 8.12715 13.7736C7.97422 13.8053 7.83315 13.7829 7.70395 13.7064Z" fill="white"/></svg>';
    var CD_CANCEL = "You must cancel your reservation at least 12 hours prior to the class start time in order to return the credit to your account with no penalty. Late cancellations with less than 12 hours notice will be assessed a $10 charge to your card. The credit will be returned to your account.";
    var CD_VENUE_NAMES = ['ID Hot Yoga', 'Sui Power Yoga', 'Heated Reformer Co.', 'Studio Sweat', 'Mindful Movement'];
    var CD_NEIGHBORHOODS = ['Lower East Side', 'East Village', 'SoHo', 'Williamsburg', 'West Village'];
    var CD_INSTRUCTORS = ['Sarah M.', 'Chauncie D.', 'Liz K.', 'Marcus J.', 'Priya S.', 'Jordan T.', 'Kai N.', 'Emma R.', 'David C.', 'Nina L.', 'Carolyn', 'Sarah Ghilardi', 'Marie Wolf'];
    var CD_REVIEW_NAMES = ['Sara', 'Liz', 'Natalie', 'Jordan', 'Marcus', 'Priya', 'Emma'];
    var CD_REVIEW_BODIES = [
      "I really appreciate Chauncie's flows. They're physically challenging, often incorporating ashtanga elements, but never aggressive for the sake of it. He creates space for everyone to practice at their own pace.",
      "This class was exactly what I needed. The instructor was so attentive and gave great modifications. The music was perfect and the energy was high.",
      "Such a welcoming studio. First time here and the instructor made me feel right at home. Will definitely be coming back for more classes.",
      "Incredible workout! Left feeling so strong and centered. The sequencing was creative and the instructor's cues were super clear throughout."
    ];
    var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    var STAR_GOLD_20 = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M9.10326 1.81699C9.47008 1.07374 10.5299 1.07374 10.8967 1.81699L12.7063 5.48347C12.8519 5.77862 13.1335 5.98319 13.4592 6.03051L17.5054 6.61846C18.3256 6.73765 18.6531 7.74562 18.0596 8.32416L15.1318 11.1781C14.8961 11.4079 14.7885 11.7389 14.8442 12.0632L15.5353 16.0931C15.6754 16.91 14.818 17.533 14.0844 17.1473L10.4653 15.2446C10.174 15.0915 9.82598 15.0915 9.53466 15.2446L5.91562 17.1473C5.18199 17.533 4.32456 16.91 4.46467 16.0931L5.15585 12.0632C5.21148 11.7389 5.10393 11.4079 4.86825 11.1781L1.94038 8.32416C1.34687 7.74562 1.67438 6.73765 2.4946 6.61846L6.54081 6.03051C6.86652 5.98319 7.14808 5.77862 7.29374 5.48347L9.10326 1.81699Z" fill="#FFB54D"/></svg>';
    var STAR_GOLD_16 = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M9.10326 1.81699C9.47008 1.07374 10.5299 1.07374 10.8967 1.81699L12.7063 5.48347C12.8519 5.77862 13.1335 5.98319 13.4592 6.03051L17.5054 6.61846C18.3256 6.73765 18.6531 7.74562 18.0596 8.32416L15.1318 11.1781C14.8961 11.4079 14.7885 11.7389 14.8442 12.0632L15.5353 16.0931C15.6754 16.91 14.818 17.533 14.0844 17.1473L10.4653 15.2446C10.174 15.0915 9.82598 15.0915 9.53466 15.2446L5.91562 17.1473C5.18199 17.533 4.32456 16.91 4.46467 16.0931L5.15585 12.0632C5.21148 11.7389 5.10393 11.4079 4.86825 11.1781L1.94038 8.32416C1.34687 7.74562 1.67438 6.73765 2.4946 6.61846L6.54081 6.03051C6.86652 5.98319 7.14808 5.77862 7.29374 5.48347L9.10326 1.81699Z" fill="#FFB54D"/></svg>';

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var CD_WEEKS_COUNT = 2; // current week + 1 future (forward-only navigation)
    function renderCdDatePicker(selectedAbsIdx) {
      var picker = document.getElementById('cd-date-picker');
      var today = new Date();
      var dow = today.getDay();
      // absIdx 0 = today; subsequent indices are future days.
      if (selectedAbsIdx == null) selectedAbsIdx = 0;
      var html = '';
      for (var w = 0; w < CD_WEEKS_COUNT; w++) {
        html += '<div class="cd-week">';
        for (var i = 0; i < 7; i++) {
          var absIdx = w * 7 + i;
          var d = new Date(today);
          d.setDate(today.getDate() + absIdx);
          var letterIdx = (dow + absIdx) % 7;
          var classes = 'cd-date-cell';
          if (absIdx === 0) classes += ' today';
          if (absIdx === selectedAbsIdx) classes += ' selected';
          html += '<div class="' + classes + '" data-abs="' + absIdx + '">'
            + '<div class="cd-date-letter">' + DAY_LETTERS[letterIdx] + '</div>'
            + '<div class="cd-date-day">' + d.getDate() + '</div>'
            + '</div>';
        }
        html += '</div>';
      }
      picker.innerHTML = html;
      picker.querySelectorAll('.cd-date-cell').forEach(function(cell) {
        cell.addEventListener('click', function() {
          if (wasDragging) return;
          renderCdDatePicker(parseInt(cell.dataset.abs, 10));
          // Smoothly scroll the time chips back to the start so a new day opens at the first slot
          var slotsEl = document.getElementById('cd-time-slots');
          if (slotsEl && slotsEl.scrollLeft > 0) animateScrollLeft(slotsEl, 0, 350);
        });
      });
      // Scroll to the week containing the selected day (preserve user's swipe)
      var selectedWeekIdx = Math.floor(selectedAbsIdx / 7);
      requestAnimationFrame(function() {
        var weekWidth = picker.clientWidth;
        picker.scrollLeft = selectedWeekIdx * weekWidth;
      });
    }

    // ---- Date picker carousel snap ----
    var datePickerAnimating = false;
    var datePickerScrollDebounce = null;
    var datePickerStartScrollLeft = 0;
    var SWIPE_INTENT_THRESHOLD = 20; // px — any movement past this counts as a paginate intent
    function animateScrollLeft(el, target, duration) {
      var start = el.scrollLeft;
      var distance = target - start;
      if (Math.abs(distance) < 1) return;
      var startTime = performance.now();
      datePickerAnimating = true;
      function step(now) {
        var t = Math.min(1, (now - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        el.scrollLeft = start + distance * eased;
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          datePickerAnimating = false;
        }
      }
      requestAnimationFrame(step);
    }
    function snapDatePickerToTarget() {
      if (datePickerAnimating) return;
      var picker = document.getElementById('cd-date-picker');
      if (!picker) return;
      var weekWidth = picker.clientWidth;
      if (!weekWidth) return;
      var current = picker.scrollLeft;
      var distance = current - datePickerStartScrollLeft;
      var startWeek = Math.round(datePickerStartScrollLeft / weekWidth);
      var nearestWeek = Math.round(current / weekWidth);
      // If user swiped past a small intent threshold but the nearest snap point hasn't
      // crossed a page boundary yet, force advance by one page in the swipe direction.
      if (distance > SWIPE_INTENT_THRESHOLD && nearestWeek <= startWeek) {
        nearestWeek = startWeek + 1;
      } else if (distance < -SWIPE_INTENT_THRESHOLD && nearestWeek >= startWeek) {
        nearestWeek = startWeek - 1;
      }
      // Clamp to valid week range
      var maxWeek = Math.round((picker.scrollWidth - weekWidth) / weekWidth);
      nearestWeek = Math.max(0, Math.min(maxWeek, nearestWeek));
      animateScrollLeft(picker, nearestWeek * weekWidth, 400);
    }
    // Debounced scroll listener — fires after native touch momentum settles.
    // Captures the scroll position at the start of each new scroll session so we
    // can determine swipe direction even if the user only moves a small amount.
    (function() {
      var picker = document.getElementById('cd-date-picker');
      if (!picker) return;
      picker.addEventListener('scroll', function() {
        if (datePickerAnimating) return;
        if (!datePickerScrollDebounce) {
          // First scroll event after rest — record near-start position
          datePickerStartScrollLeft = picker.scrollLeft;
        }
        clearTimeout(datePickerScrollDebounce);
        datePickerScrollDebounce = setTimeout(function() {
          snapDatePickerToTarget();
          datePickerScrollDebounce = null;
        }, 80);
      }, { passive: true });
    })();
    // Expose for the desktop mouse-drag handler — uses the same intent logic
    window.__snapDatePicker = snapDatePickerToTarget;

    // Animate a horizontally-scrollable container so the tapped child sits fully in view
    // (with a small inset on each edge so the pill isn't flush against the container edge).
    function scrollPillIntoView(container, pill) {
      var EDGE_INSET = 16;
      var cRect = container.getBoundingClientRect();
      var pRect = pill.getBoundingClientRect();
      var offsetLeftInContent = (pRect.left - cRect.left) + container.scrollLeft;
      var target = container.scrollLeft;
      if (pRect.left < cRect.left + EDGE_INSET) {
        // Pill is clipped on the left → scroll left so it's at the inset
        target = offsetLeftInContent - EDGE_INSET;
      } else if (pRect.right > cRect.right - EDGE_INSET) {
        // Pill is clipped on the right → scroll right so its right edge is at -inset
        target = offsetLeftInContent + pRect.width - container.clientWidth + EDGE_INSET;
      } else {
        return; // already fully in view
      }
      target = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, target));
      animateScrollLeft(container, target, 300);
    }

    // Convert "1:30 PM" → minutes from midnight for sorting
    function timeToMinutes(str) {
      var parts = str.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
      if (!parts) return 0;
      var h = parseInt(parts[1], 10);
      var m = parseInt(parts[2], 10);
      var ampm = parts[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }

    function renderCdTimeSlots(primaryTime, primaryInstructor) {
      var slots = document.getElementById('cd-time-slots');
      // Strip the duration off if present (e.g. "10:00 AM · 60 min" → "10:00 AM")
      var firstTime = primaryTime.split(' · ')[0];
      var primaryMinutes = timeToMinutes(firstTime);
      var pickInst = function(except) {
        var n;
        do { n = pick(CD_INSTRUCTORS); } while (n === except);
        return n;
      };
      // Build the selected primary slot first, then add later time slots from BASE_TIMES
      var BASE_TIMES = ['7:00 AM', '8:30 AM', '10:00 AM', '11:30 AM', '1:30 PM', '3:00 PM', '5:30 PM', '7:00 PM', '8:30 PM'];
      // Start with the primary slot
      var data = [{ time: firstTime, instructor: primaryInstructor, spots: '3 spots left', selected: true }];
      // Add BASE_TIMES that are strictly AFTER the primary time
      var lastInst = primaryInstructor;
      for (var i = 0; i < BASE_TIMES.length; i++) {
        if (timeToMinutes(BASE_TIMES[i]) <= primaryMinutes) continue;
        var inst = pickInst(lastInst);
        lastInst = inst;
        var spotsN = 1 + Math.floor(Math.random() * 6);
        var spots = Math.random() < 0.5 ? spotsN + (spotsN === 1 ? ' spot left' : ' spots left') : '';
        data.push({ time: BASE_TIMES[i], instructor: inst, spots: spots, selected: false });
      }
      slots.innerHTML = data.map(function(s) {
        return '<div class="cd-time-slot' + (s.selected ? ' selected' : '') + '">'
          + '<div class="cd-time-slot-chip">'
          +   '<div class="cd-time-slot-time">' + s.time + '</div>'
          +   '<div class="cd-time-slot-instructor">' + s.instructor + '</div>'
          + '</div>'
          + '</div>';
      }).join('');
      // Toggle selection — re-tapping a selected chip deselects it.
      // When no chip is selected, the booking bar slides down off-screen.
      slots.querySelectorAll('.cd-time-slot').forEach(function(slot, idx) {
        slot.addEventListener('click', function() {
          if (wasDragging) return;
          var wasSelected = slot.classList.contains('selected');
          if (wasSelected) {
            slot.classList.remove('selected');
          } else {
            slots.querySelectorAll('.cd-time-slot').forEach(function(s) { s.classList.remove('selected'); });
            slot.classList.add('selected');
            updateBookingBar(data[idx]);
            scrollPillIntoView(slots, slot);
            if (window.__rerenderCdReviews) window.__rerenderCdReviews(data[idx].instructor);
          }
          syncCdBookingBarVisibility();
        });
      });
      // Initial booking bar state reflects the pre-selected first slot
      updateBookingBar(data[0]);
      syncCdBookingBarVisibility();
    }

    var cdBookingEnterPending = false;
    // Hidden-state translation: computed in pixels at animate time so Motion's
    // keyframe pipeline gets a clean numeric interpolation. calc() expressions
    // have been flaky in this bundle and tend to collapse to step/ease-out.
    var CD_BOOKING_VISIBLE_Y = 'translateY(0px)';
    function cdBookingHiddenY() {
      // 24px = bottom offset from .cd-booking-bar CSS; ensures the bar clears
      // the viewport including its own box-shadow.
      return 'translateY(' + (cdBookingBar.offsetHeight + 24) + 'px)';
    }
    function syncCdBookingBarVisibility() {
      var spacer = document.getElementById('cd-bottom-spacer');
      var hasSelected = !!classDetailEl.querySelector('.cd-time-slot.selected');
      // Spacer clears the fixed booking card when it's visible, or just the
      // persistent tab bar (62px tall + 24px bottom offset) when no slot is
      // selected — 24px alone hides content behind the tab bar.
      if (spacer) spacer.style.height = hasSelected ? '190px' : '110px';
      var shouldShow = classDetailOpen && hasSelected;
      var isShown = cdBookingBar.classList.contains('cd-booking-visible');
      // No-op when the target state matches the current state — otherwise
      // re-selecting a different pill would restart the slide-up every time.
      if (shouldShow === isShown) return;
      // Cancel any in-flight WAAPI animations so a prior frame's keyframes
      // can't fight the CSS transition we're about to install.
      if (cdBookingBar.getAnimations) cdBookingBar.getAnimations().forEach(function(a) { a.cancel(); });
      if (shouldShow) {
        cdBookingBar.classList.add('cd-booking-visible');
        cdBookingBar.style.visibility = 'visible';
        // First reveal after class-detail open gets a delay so the bar slides
        // up after the sheet lands. Later toggles animate immediately.
        // Uses a plain CSS transition with an overshoot cubic-bezier because
        // Motion's keyframe pipeline silently flattens the bounce in this bundle.
        var delay = cdBookingEnterPending ? 0.35 : 0;
        cdBookingEnterPending = false;
        cdBookingBar.style.transition = 'none';
        cdBookingBar.style.transform = cdBookingHiddenY();
        void cdBookingBar.offsetHeight;
        cdBookingBar.style.transition =
          'transform 0.3s cubic-bezier(.25,.46,.45,.94) ' + delay + 's';
        cdBookingBar.style.transform = CD_BOOKING_VISIBLE_Y;
      } else {
        cdBookingBar.classList.remove('cd-booking-visible');
        // Exit: standard ease-out — a bounce on the way out feels wrong.
        cdBookingBar.style.transition = 'transform 0.3s cubic-bezier(.25,.46,.45,.94)';
        cdBookingBar.style.transform = cdBookingHiddenY();
        setTimeout(function() {
          if (!cdBookingBar.classList.contains('cd-booking-visible')) {
            cdBookingBar.style.visibility = 'hidden';
          }
        }, 300);
      }
    }

    function updateBookingBar(slot) {
      var timeEl = document.getElementById('cd-booking-time');
      var instructorEl = document.getElementById('cd-booking-instructor');
      var ctaEl = document.getElementById('cd-booking-cta');
      // Format date as "Tue, Mar 3"
      var today = new Date();
      var dayShort = today.toLocaleDateString('en-US', { weekday: 'short' });
      var monthShort = today.toLocaleDateString('en-US', { month: 'short' });
      var dateStr = dayShort + ', ' + monthShort + ' ' + today.getDate();
      if (timeEl) timeEl.textContent = dateStr + ' · ' + slot.time;
      if (instructorEl) instructorEl.textContent = slot.instructor;
      if (ctaEl) ctaEl.textContent = 'Book';
    }

    // Stable review pool generated once per class detail open.
    // Each entry has its own instructor so the Reviews tab can prioritize
    // reviews matching the currently selected time slot's instructor.
    var CD_REVIEW_SOURCE_SVG = '<svg class="cd-review-card-source-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 10C0 4.47715 4.47715 0 10 0V0C15.5228 0 20 4.47715 20 10V10C20 15.5228 15.5228 20 10 20V20C4.47715 20 0 15.5228 0 10V10Z" fill="#0055FF"/><path d="M11.8559 5.39815C11.733 5.39222 11.1837 5.38899 10.7913 5.38737C10.6637 5.38703 10.5399 5.43088 10.4409 5.51145C10.342 5.59202 10.274 5.70436 10.2484 5.82939L10.0398 6.82717C10.022 6.91422 9.97477 6.99249 9.90606 7.04883C9.83735 7.10518 9.75135 7.13616 9.66249 7.13658L7.70574 7.14521C5.52853 7.14521 3.53027 8.77745 3.53027 11.0636C3.53027 13.1173 5.24391 14.9657 7.70628 14.9657C7.8335 14.9722 8.54828 14.9706 9.0248 14.9722C9.15246 14.9724 9.27624 14.9283 9.3751 14.8475C9.47396 14.7668 9.5418 14.6542 9.56708 14.5291L9.77569 13.5254C9.79331 13.4382 9.84047 13.3597 9.90921 13.3033C9.97795 13.2468 10.0641 13.2158 10.153 13.2154L11.8548 13.2203C14.2595 13.2203 16.0303 11.3719 16.0303 9.29817C16.0303 7.03416 14.0746 5.39653 11.8543 5.39653L11.8559 5.39815ZM11.8446 11.7196L10.1094 11.7233C9.98344 11.7237 9.86149 11.7675 9.76402 11.8472C9.66654 11.9269 9.59947 12.0377 9.57409 12.1611L9.36494 13.1739C9.34712 13.2607 9.29979 13.3386 9.23099 13.3945C9.1622 13.4503 9.07619 13.4805 8.9876 13.4801C8.54828 13.4801 8.30571 13.4661 7.72569 13.4661C6.41041 13.4661 5.0202 12.5891 5.0202 11.0754C5.0202 9.67389 6.26002 8.64592 7.72138 8.64592L9.70076 8.64215C9.82673 8.64201 9.9488 8.59846 10.0464 8.51882C10.144 8.43919 10.2112 8.32835 10.2366 8.20498L10.4473 7.19588C10.4654 7.10919 10.5127 7.03138 10.5815 6.97559C10.6502 6.9198 10.7361 6.88946 10.8247 6.8897C11.1929 6.8897 11.7648 6.89347 11.8429 6.89994C13.2251 6.89994 14.5441 7.84489 14.5441 9.32566C14.5441 10.6808 13.3631 11.7217 11.8435 11.7217" fill="white"/></svg><span>ClassPass</span>';

    var cdReviewPool = [];
    var cdCurrentTitle = '';
    var cdCurrentHighlight = '';

    function generateCdReviewPool() {
      var pool = [];
      // Five reviews per instructor so both the Overview carousel (3) and
      // the Reviews tab list (5) can be fully filled by the selected
      // slot's instructor once their pill is tapped.
      for (var j = 0; j < CD_INSTRUCTORS.length; j++) {
        for (var k = 0; k < 5; k++) {
          pool.push({
            instructor: CD_INSTRUCTORS[j],
            body: pick(CD_REVIEW_BODIES),
            name: pick(CD_REVIEW_NAMES),
            showSource: Math.random() < 0.5
          });
        }
      }
      return pool;
    }

    function sortedPool(highlight) {
      return cdReviewPool.slice().sort(function(a, b) {
        var am = a.instructor === highlight ? 0 : 1;
        var bm = b.instructor === highlight ? 0 : 1;
        return am - bm;
      });
    }

    function reviewCardHTML(title, review, withSource) {
      var stars = '';
      for (var s = 0; s < 5; s++) stars += STAR_GOLD_16;
      return '<div class="cd-review-card">'
        + '<p class="cd-review-card-title">' + title + ' with ' + review.instructor + '</p>'
        + '<p class="cd-review-card-body">' + review.body + '</p>'
        + '<div class="cd-review-card-footer">'
        +   '<div class="cd-review-card-author">'
        +     '<span class="cd-review-card-name">' + review.name + '</span>'
        +     '<div class="cd-review-card-stars">' + stars + '</div>'
        +   '</div>'
        +   (withSource && review.showSource ? '<div class="cd-review-card-source">' + CD_REVIEW_SOURCE_SVG + '</div>' : '')
        + '</div>'
        + '</div>';
    }

    var CD_REVIEW_SEE_ALL_HTML = '<div class="cd-review-see-all" id="cd-review-see-all">'
      + '<span>See all</span>'
      + '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 4L13.6742 10.147C13.8562 10.3442 13.8501 10.6499 13.6603 10.8397L8 16.5" stroke="#020203" stroke-width="2" stroke-linecap="round"/></svg>'
      + '</div>';

    function renderCdReviewCards(title, highlight) {
      var container = document.getElementById('cd-review-cards');
      var list = sortedPool(highlight).slice(0, 3);
      container.innerHTML = list.map(function(r) { return reviewCardHTML(title, r, true); }).join('') + CD_REVIEW_SEE_ALL_HTML;
      var seeAll = document.getElementById('cd-review-see-all');
      if (seeAll) {
        seeAll.addEventListener('click', function() {
          if (wasDragging) return;
          if (typeof window.__cdActivateReviewsTab === 'function') window.__cdActivateReviewsTab();
        });
      }
    }

    function renderCdReviewsList(title, highlight) {
      var container = document.getElementById('cd-reviews-list');
      var list = sortedPool(highlight).slice(0, 5);
      container.innerHTML = list.map(function(r) { return reviewCardHTML(title, r, false); }).join('');
    }

    function rerenderCdReviewsForInstructor(instructor) {
      cdCurrentHighlight = instructor;
      renderCdReviewCards(cdCurrentTitle, instructor);
      renderCdReviewsList(cdCurrentTitle, instructor);
    }
    window.__rerenderCdReviews = rerenderCdReviewsForInstructor;

    function populateClassDetail(cls) {
      // Header
      document.getElementById('cd-title').textContent = cls.title;
      document.getElementById('cd-sticky-title').textContent = cls.title;
      document.getElementById('cd-sticky-nav').classList.remove('scrolled');
      // rating "4.6 (287)" → split
      var ratingParts = (cls.rating || '4.9 (250)').match(/^([\d.]+)\s*\((\d+)\)$/);
      if (ratingParts) {
        document.getElementById('cd-rating-big').textContent = ratingParts[1];
        document.getElementById('cd-rating-summary-count').textContent = '(' + ratingParts[2] + ')';
        document.getElementById('cd-header-rating-num').textContent = ratingParts[1];
        document.getElementById('cd-header-rating-count').textContent = '(' + ratingParts[2] + ')';
      }
      // Venue link — use the venue name if open, fall back to mock
      var venueName = (currentPins[0] && currentPins[0].name) || pick(CD_VENUE_NAMES);
      var hood = (currentPins[0] && currentPins[0].locality) || pick(CD_NEIGHBORHOODS);
      document.getElementById('cd-venue-text').textContent = venueName + ' · ' + hood;
      // Price strings in the class detail display dollars with cents ($25.00).
      function cdFormatPrice(p) {
        if (!p) return p;
        return /\.\d{2}$/.test(p) ? p : (p + '.00');
      }
      // Intro offer chip: intro venues show the pill; others show a plain
      // price in the same slot (no icon, no strike, no pill background).
      var introChipEl = document.getElementById('cd-intro-chip');
      if (introChipEl) {
        if (hasVenueIntroOffer(window.__currentVenuePin)) {
          introChipEl.classList.remove('cd-intro-chip--plain');
          introChipEl.innerHTML = CD_INTRO_CHIP_SVG
            + '<span class="cd-intro-chip-label">Intro offer \u00b7</span>'
            + '<span class="cd-intro-chip-price">' + cdFormatPrice(cls.finalPrice || '$25') + '</span>'
            + '<span class="cd-intro-chip-strike">' + cdFormatPrice(cls.strikePrice || '$35') + '</span>';
        } else {
          introChipEl.classList.add('cd-intro-chip--plain');
          introChipEl.innerHTML = '<span class="cd-intro-chip-plain">' + cdFormatPrice(cls.plainPrice || '$25') + '</span>';
        }
      }
      // Date/slots — picker leads with today (absIdx = 0)
      renderCdDatePicker(0);
      renderCdTimeSlots(cls.time, cls.instructor);
      // Description / prep / cancel
      document.getElementById('cd-description-body').textContent = pick(CD_DESCRIPTIONS);
      document.getElementById('cd-prep-body').textContent = CD_PREP;
      document.getElementById('cd-cancel-body').textContent = CD_CANCEL;
      // Reset all collapsibles to collapsed state
      classDetailEl.querySelectorAll('.cd-collapsible').forEach(function(c) {
        c.classList.add('collapsed');
        c.classList.remove('expanded');
        var toggle = c.querySelector('.cd-see-more');
        if (toggle) toggle.textContent = toggle.dataset.collapsedText || 'see more';
      });
      // Stars in summary
      var starsRow = '';
      for (var i = 0; i < 5; i++) starsRow += STAR_GOLD_20;
      document.getElementById('cd-stars').innerHTML = starsRow;
      // Populate Reviews tab summary card
      var reviewCount = ratingParts ? parseInt(ratingParts[2], 10) : 250;
      var dist = [
        Math.floor(reviewCount * 0.03),
        Math.floor(reviewCount * 0.05),
        Math.floor(reviewCount * 0.12),
        Math.floor(reviewCount * 0.25),
        Math.floor(reviewCount * 0.55)
      ];
      var maxDist = Math.max.apply(null, dist);
      var barsHtml = '';
      for (var b = 4; b >= 0; b--) {
        var pct = maxDist > 0 ? (dist[b] / maxDist) * 100 : 0;
        barsHtml += '<div class="cd-rating-bar-row">'
          + '<span class="cd-rating-bar-label">' + (b + 1) + '</span>'
          + '<div class="cd-rating-bar-track"><div class="cd-rating-bar-fill" style="width:' + pct + '%"></div></div>'
          + '</div>';
      }
      var CD_AI_SUMMARIES = [
        "Highly rated for its intimate class sizes and personalized attention. Many reviewers mention visible results within weeks and appreciate the variety of class offerings throughout the day.",
        "People love this studio for its upbeat, music-driven workouts and motivating instructors who give clear form cues. Reviews highlight an intense full-body burn in a short time.",
        "Reviewers consistently praise the welcoming atmosphere and knowledgeable instructors. The studio is described as clean and well-maintained, with creative class formats."
      ];
      var revBigEl = document.getElementById('cd-rating-big-rev');
      if (revBigEl) revBigEl.textContent = ratingParts ? ratingParts[1] : '4.7';
      var revCountEl = document.getElementById('cd-rating-summary-count-rev');
      if (revCountEl) revCountEl.textContent = '(' + reviewCount + ')';
      var revStarsEl = document.getElementById('cd-stars-rev');
      if (revStarsEl) revStarsEl.innerHTML = starsRow;
      var revBarsEl = document.getElementById('cd-rating-bars-rev');
      if (revBarsEl) revBarsEl.innerHTML = barsHtml;
      var revAiEl = document.getElementById('cd-rating-ai-summary-rev');
      if (revAiEl) revAiEl.textContent = pick(CD_AI_SUMMARIES);
      // Reviews
      cdCurrentTitle = cls.title;
      var revSubtitleEl = document.getElementById('cd-reviews-subtitle');
      if (revSubtitleEl) revSubtitleEl.textContent = 'Reviews for ' + cls.title;
      cdReviewPool = generateCdReviewPool();
      rerenderCdReviewsForInstructor(cls.instructor);
      // Booking bar price + intro-offer label (uses the original class's price info)
      var priceEl = document.getElementById('cd-booking-price');
      var introLabelEl = document.getElementById('cd-booking-intro-label');
      if (priceEl) {
        if (cls.finalPrice) {
          priceEl.innerHTML = '<span class="cd-booking-price-final">' + cdFormatPrice(cls.finalPrice) + '</span>'
            + '<span class="cd-booking-price-strike">' + cdFormatPrice(cls.strikePrice) + '</span>';
        } else {
          priceEl.innerHTML = '<span class="cd-booking-price-plain">' + cdFormatPrice(cls.plainPrice || '$25') + '</span>';
        }
      }
      if (introLabelEl) introLabelEl.hidden = !cls.finalPrice;
      // Reset all scroll positions so the modal always opens fresh
      classDetailScroll.scrollTop = 0;
      classDetailEl.querySelectorAll('.cd-review-cards, .cd-time-slots, .cd-date-picker').forEach(function(el) {
        el.scrollLeft = 0;
      });
      // Reset scroll-driven tab bar state
      persistentTabBar.classList.remove('hidden-down');
      var tabBarBlurReset = document.getElementById('tab-bar-blur');
      if (tabBarBlurReset) tabBarBlurReset.classList.remove('hidden-down');
    }

    window.__openClassDetail = function(cls) {
      if (classDetailOpen) return;
      // Mark open BEFORE populate so syncCdBookingBarVisibility (called from
      // renderCdTimeSlots during populate) can reveal the booking bar when
      // the default first slot is pre-selected. The pending flag tells the
      // sync to apply the entrance-delay so the bar slides up after the
      // sheet has landed.
      classDetailOpen = true;
      cdBookingEnterPending = true;
      populateClassDetail(cls);
      classDetailEl.classList.add('class-detail-visible');
      // Stack the venue detail behind (class is used for handle-hide CSS rule)
      venueDetailSheet.classList.add('stacked');
      // Reduce venue backdrop dim slightly while class detail is on top
      venueDetailEl.style.background = 'rgba(0,0,0,0.08)';
      // Explicitly animate the venue scale-down via Motion so it works regardless
      // of any inline transform that the open animation may have committed
      if (motionAnimate) {
        motionAnimate(venueDetailSheet, {
          transform: 'scale(0.95) translateY(0px)',
          borderRadius: '20px 20px 0 0',
          filter: 'brightness(0.92)'
        }, { duration: 0.35, easing: 'cubic-bezier(.25,.46,.45,.94)' });
      } else {
        venueDetailSheet.style.transition = 'transform 0.35s cubic-bezier(.25,.46,.45,.94), border-radius 0.35s ease, filter 0.35s ease';
        venueDetailSheet.style.transform = 'scale(0.95) translateY(0px)';
        venueDetailSheet.style.borderRadius = '20px 20px 0 0';
        venueDetailSheet.style.filter = 'brightness(0.92)';
      }
      // Animate sheet up — inline visibility keeps sheet visible during later close anim
      classDetailSheet.style.visibility = 'visible';
      classDetailSheet.style.transition = 'none';
      classDetailSheet.style.transform = 'translateY(100%)';
      void classDetailSheet.offsetHeight;
      if (motionAnimate) {
        // Explicit [from, to] keyframes: after a drag-dismiss the CSS transition
        // cancels Motion's Web Animation but leaves its internal state at
        // translateY(0%), so a target-only animate() sees start == end and skips.
        classDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
        motionAnimate(classDetailSheet, { transform: ['translateY(100%)', 'translateY(0%)'] }, { duration: 0.35, easing: 'cubic-bezier(.25,.46,.45,.94)' });
      } else {
        classDetailSheet.style.transition = 'transform 0.35s cubic-bezier(.25,.46,.45,.94)';
        classDetailSheet.style.transform = 'translateY(0%)';
      }
      // Booking bar visibility + animation are driven by Motion inside
      // syncCdBookingBarVisibility() (called from renderCdTimeSlots) based
      // on the selected-slot state. The entrance delay flag is set above.
      // Position the tab indicator after layout settles
      if (window.__resetClassDetailTabs) {
        requestAnimationFrame(function() {
          window.__resetClassDetailTabs();
          // Cache the scroll offset where the tabs become sticky (top: 60px in CSS).
          // This is measured while scroll is at 0 and layout is stable.
          var tabsEl = classDetailEl.querySelector('.cd-tabs');
          if (tabsEl) {
            var scrollRect = classDetailScroll.getBoundingClientRect();
            var tabsRect = tabsEl.getBoundingClientRect();
            window.__cdPinOffset = tabsRect.top - scrollRect.top - 80;
          }
          // Cache the scroll offset where the class title leaves the viewport
          if (window.__cacheCdTitleThreshold) window.__cacheCdTitleThreshold();
        });
      }
    };

    function closeClassDetail() {
      if (!classDetailOpen) return;
      if (window.__closeCheckoutIfOpen) window.__closeCheckoutIfOpen();
      classDetailOpen = false;
      // Class detail's overlay fades out via CSS transition (background 0.3s ease)
      classDetailEl.classList.remove('class-detail-visible');
      classDetailEl.style.background = '';
      // Restore venue's own backdrop dim
      venueDetailEl.style.background = '';
      // Reset the venue detail's scroll position so it looks like a fresh default view
      venueDetailScroll.scrollTop = 0;
      // Remove .scrolled synchronously so the sticky title starts fading out
      // immediately instead of waiting for the async scroll event from
      // scrollTop = 0 to fire and process.
      var vdStickyNav = document.getElementById('vd-sticky-nav');
      if (vdStickyNav) vdStickyNav.classList.remove('scrolled');
      // Force the venue handle to start fading back in NOW rather than waiting
      // for .stacked to be removed at Motion-finish (350ms later). The inline
      // opacity:1 overrides the `.stacked .venue-detail-handle { opacity: 0 }`
      // rule and its own 0.2s transition runs in parallel with the scale-back.
      var vdHandle = venueDetailSheet.querySelector('.venue-detail-handle');
      if (vdHandle) vdHandle.style.opacity = '1';
      // Explicitly animate the venue back to identity via inline transform.
      // Motion picks up the current computed transform (scale 0.95 translateY -12) from .stacked
      // and animates it to translateY(0%) so the venue sheet stays visible AND scales back to 100%.
      if (motionAnimate) {
        motionAnimate(venueDetailSheet, {
          transform: 'translateY(0%)',
          borderRadius: '32px 32px 0 0',
          filter: 'brightness(1)'
        }, { duration: 0.35, easing: 'cubic-bezier(.25,.46,.45,.94)' }).finished.then(function() {
          venueDetailSheet.classList.remove('stacked');
          venueDetailSheet.style.borderRadius = '';
          venueDetailSheet.style.filter = '';
          if (vdHandle) vdHandle.style.opacity = '';
          // Keep transform inline at translateY(0%) so the venue stays anchored
        });
      } else {
        venueDetailSheet.style.transition = 'transform 0.35s cubic-bezier(.25,.46,.45,.94), border-radius 0.35s ease, filter 0.35s ease';
        venueDetailSheet.style.transform = 'translateY(0%)';
        venueDetailSheet.style.borderRadius = '32px 32px 0 0';
        venueDetailSheet.style.filter = 'brightness(1)';
        setTimeout(function() {
          venueDetailSheet.classList.remove('stacked');
          venueDetailSheet.style.borderRadius = '';
          venueDetailSheet.style.filter = '';
          if (vdHandle) vdHandle.style.opacity = '';
        }, 360);
      }
      // Booking bar: slide back down alongside the sheet dismissal.
      cdBookingBar.classList.remove('cd-booking-visible');
      if (motionAnimate) {
        cdBookingBar.getAnimations().forEach(function(a) { a.cancel(); });
        motionAnimate(cdBookingBar, {
          transform: [CD_BOOKING_VISIBLE_Y, cdBookingHiddenY()]
        }, { duration: 0.3, easing: 'cubic-bezier(.25,.46,.45,.94)' }).finished.then(function() {
          if (!cdBookingBar.classList.contains('cd-booking-visible')) {
            cdBookingBar.style.visibility = 'hidden';
          }
        });
      }
      // Animate class detail sheet down
      var sheetHeight = classDetailSheet.offsetHeight;
      if (motionAnimate) {
        motionAnimate(classDetailSheet, { transform: 'translateY(' + sheetHeight + 'px)' }, { duration: 0.3, easing: 'cubic-bezier(.25,.46,.45,.94)' }).finished.then(function() {
          classDetailSheet.style.transform = '';
          classDetailSheet.style.transition = '';
          classDetailSheet.style.visibility = '';
        });
      } else {
        classDetailSheet.style.transition = 'transform 0.3s cubic-bezier(.25,.46,.45,.94)';
        classDetailSheet.style.transform = 'translateY(' + sheetHeight + 'px)';
        classDetailSheet.addEventListener('transitionend', function handler() {
          classDetailSheet.removeEventListener('transitionend', handler);
          classDetailSheet.style.transform = '';
          classDetailSheet.style.transition = '';
          classDetailSheet.style.visibility = '';
        }, { once: true });
      }
    }

    window.__closeClassDetail = closeClassDetail;

    // === Checkout sheet: morph-in-place from the booking bar ===
    var cdCheckoutSheet = document.getElementById('cd-checkout-sheet');
    var cdCheckoutScrim = document.getElementById('cd-checkout-scrim');
    var cdCheckoutCloseBtn = document.getElementById('cd-checkout-close');
    var cdBookingCta = document.getElementById('cd-booking-cta');
    var cdCheckoutOpen = false;

    function populateCheckout() {
      var instructor = document.getElementById('cd-booking-instructor').textContent;
      var time = document.getElementById('cd-booking-time').textContent;
      var titleEl = document.getElementById('cd-title');
      var classTitle = titleEl ? titleEl.textContent : '';
      var venueText = document.getElementById('cd-venue-text');
      var venueStr = venueText ? venueText.textContent : '';
      document.getElementById('cd-checkout-class-title').textContent = classTitle;
      document.getElementById('cd-checkout-time').textContent = time;
      document.getElementById('cd-checkout-instructor').textContent = instructor;
      document.getElementById('cd-checkout-venue').textContent = venueStr;
      // Price: prefer the intro-offer final price, else the plain price.
      var priceFinalEl = document.querySelector('.cd-booking-price-final, .cd-booking-price-plain');
      var priceText = priceFinalEl ? priceFinalEl.textContent.trim() : '$30.00';
      document.getElementById('cd-checkout-subtotal').textContent = priceText;
      document.getElementById('cd-checkout-total').textContent = priceText;
    }

    // Pure CSS-driven morph: every animated property (height, left, right,
    // bottom, border-radius, background, shadow, backdrop-filter) uses the
    // same CSS transition rule so they all land on the same frame — no
    // Motion/CSS timing mismatch, no jitter on close.
    var cdCheckoutEndHandler = null;

    function openCheckout() {
      if (cdCheckoutOpen) return;
      cdCheckoutOpen = true;
      populateCheckout();
      // Clear any lingering transitionend listener from a cancelled close.
      if (cdCheckoutEndHandler) {
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
        cdCheckoutEndHandler = null;
      }
      // Measure the sheet's natural content height while still hidden. The
      // sheet uses border-box + extra padding when open, so we briefly add
      // is-open (with transitions disabled) to get the true open-state
      // content height, then revert for the animated open.
      var startH = cdBookingBar.getBoundingClientRect().height;
      cdCheckoutSheet.style.transition = 'none';
      cdCheckoutSheet.classList.add('is-open');
      cdCheckoutSheet.style.height = 'auto';
      var naturalH = cdCheckoutSheet.getBoundingClientRect().height;
      cdCheckoutSheet.classList.remove('is-open');
      cdCheckoutSheet.style.height = startH + 'px';
      // Commit the reverted closed state before re-enabling transitions so
      // the animated open below transitions from this committed baseline.
      void cdCheckoutSheet.offsetHeight;
      cdCheckoutSheet.style.transition = '';
      var viewportH = cdCheckoutSheet.parentElement.getBoundingClientRect().height
        || window.innerHeight;
      var maxH = viewportH - 60;
      var targetH = Math.min(naturalH, maxH);
      cdCheckoutSheet.style.visibility = 'visible';
      cdCheckoutSheet.setAttribute('aria-hidden', 'false');
      cdBookingBar.classList.add('is-under-checkout');
      cdCheckoutScrim.classList.add('is-visible');
      // Add is-open to trigger the coordinated CSS transitions.
      cdCheckoutSheet.classList.add('is-open');
      cdCheckoutSheet.style.height = targetH + 'px';
    }

    function closeCheckout() {
      if (!cdCheckoutOpen) return;
      cdCheckoutOpen = false;
      var targetH = cdBookingBar.getBoundingClientRect().height || 130;
      cdCheckoutSheet.classList.remove('is-open');
      cdCheckoutScrim.classList.remove('is-visible');
      cdCheckoutSheet.style.height = targetH + 'px';
      // Use transitionend on `height` as the single source of truth for
      // "animation complete" — all properties share the same 0.36s curve.
      if (cdCheckoutEndHandler) {
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
      }
      cdCheckoutEndHandler = function(ev) {
        if (ev.target !== cdCheckoutSheet || ev.propertyName !== 'height') return;
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
        cdCheckoutEndHandler = null;
        cdCheckoutSheet.style.visibility = 'hidden';
        cdCheckoutSheet.style.height = '';
        cdCheckoutSheet.setAttribute('aria-hidden', 'true');
        cdBookingBar.classList.remove('is-under-checkout');
      };
      cdCheckoutSheet.addEventListener('transitionend', cdCheckoutEndHandler);
    }

    if (cdBookingCta) cdBookingCta.addEventListener('click', openCheckout);
    if (cdCheckoutCloseBtn) cdCheckoutCloseBtn.addEventListener('click', closeCheckout);
    if (cdCheckoutScrim) cdCheckoutScrim.addEventListener('click', closeCheckout);
    // If class detail closes while checkout is open, dismiss checkout too.
    window.__closeCheckoutIfOpen = function() {
      if (cdCheckoutOpen) closeCheckout();
    };

    // Close button
    document.getElementById('class-detail-close').addEventListener('click', closeClassDetail);

    // Tapping the venue link (e.g. "Jetset Pilates · New York ›") dismisses the class detail
    // and returns the user to the venue detail underneath.
    var cdVenueLinkEl = document.getElementById('cd-venue-link');
    if (cdVenueLinkEl) {
      cdVenueLinkEl.addEventListener('click', function() {
        if (wasDragging) return;
        closeClassDetail();
      });
    }

    // "See more / see less" toggle for collapsible sections
    classDetailEl.querySelectorAll('.cd-see-more').forEach(function(toggle) {
      toggle.addEventListener('click', function() {
        var collapsible = toggle.closest('.cd-collapsible');
        if (!collapsible) return;
        var isCollapsed = collapsible.classList.contains('collapsed');
        if (isCollapsed) {
          collapsible.classList.remove('collapsed');
          collapsible.classList.add('expanded');
          toggle.textContent = toggle.dataset.expandedText || 'see less';
        } else {
          collapsible.classList.remove('expanded');
          collapsible.classList.add('collapsed');
          toggle.textContent = toggle.dataset.collapsedText || 'see more';
        }
      });
    });

    // ===== Tabs with animated indicator =====
    var cdTabsContainer = document.getElementById('cd-tabs');
    var cdTabs = classDetailEl.querySelectorAll('.cd-tab');
    var cdTabIndicator = document.getElementById('cd-tab-indicator');
    var cdPanels = classDetailEl.querySelectorAll('.cd-panel');

    function moveCdIndicator(tab, instant) {
      var rect = tab.getBoundingClientRect();
      var parentRect = cdTabsContainer.getBoundingClientRect();
      var left = rect.left - parentRect.left;
      if (motionAnimate && !instant) {
        motionAnimate(cdTabIndicator, {
          transform: 'translateX(' + left + 'px)',
          width: rect.width + 'px'
        }, iosTabSpring);
      } else {
        cdTabIndicator.style.width = rect.width + 'px';
        cdTabIndicator.style.transform = 'translateX(' + left + 'px)';
      }
    }

    function activateCdTab(tab) {
      // Tapping a tab always snaps scroll to the pinned position so the tabs
      // stick to the top and the new panel's content starts from the top of view
      var pinOffset = window.__cdPinOffset || 0;
      cdTabs.forEach(function(t) { t.classList.toggle('active', t === tab); });
      moveCdIndicator(tab);
      var name = tab.dataset.cdtab;
      cdPanels.forEach(function(p) { p.classList.toggle('active', p.dataset.cdpanel === name); });
      if (pinOffset > 0) {
        classDetailScroll.scrollTo({ top: pinOffset, behavior: 'auto' });
      }
      // Reset horizontal scroll on review carousels so each tab opens cleanly
      classDetailEl.querySelectorAll('.cd-review-cards').forEach(function(s) { s.scrollLeft = 0; });
    }

    cdTabs.forEach(function(tab) {
      tab.addEventListener('click', function() { activateCdTab(tab); });
    });

    // Expose a helper to activate the Reviews tab — used by the Overview's
    // "See all" review card which renders before this block but needs to
    // route users to the Reviews tab.
    window.__cdActivateReviewsTab = function() {
      var reviewsTab = Array.prototype.find.call(cdTabs, function(t) { return t.dataset.cdtab === 'reviews'; });
      if (reviewsTab) activateCdTab(reviewsTab);
    };

    // Tapping the "Ratings & Reviews" header (or its chevron) jumps to the Reviews tab
    var cdReviewsHeader = classDetailEl.querySelector('.cd-section-reviews .cd-section-header');
    if (cdReviewsHeader) {
      cdReviewsHeader.style.cursor = 'pointer';
      cdReviewsHeader.addEventListener('click', function() {
        // Ignore taps that came from a scroll/drag gesture so users don't
        // jump to Reviews when they're just trying to scroll through Overview.
        if (wasDragging) return;
        var reviewsTab = Array.prototype.find.call(cdTabs, function(t) { return t.dataset.cdtab === 'reviews'; });
        if (reviewsTab) activateCdTab(reviewsTab);
      });
    }

    // Reset to overview tab + position indicator (called on each open)
    window.__resetClassDetailTabs = function() {
      cdTabs.forEach(function(t) { t.classList.toggle('active', t.dataset.cdtab === 'overview'); });
      cdPanels.forEach(function(p) { p.classList.toggle('active', p.dataset.cdpanel === 'overview'); });
      requestAnimationFrame(function() {
        moveCdIndicator(cdTabs[0], true);
      });
    };

    // ===== Sticky nav: fade title in on scroll =====
    // Also: hide the persistent tab bar and lower the booking card when scrolling down,
    // restore them when scrolling up (or when at the very top).
    var cdStickyNav = document.getElementById('cd-sticky-nav');
    var cdTitleEl = document.getElementById('cd-title');
    var cdTitleScrollThreshold = 0; // computed on open

    // Cache the scroll offset where the class title leaves the viewport.
    // Called after layout settles on each open.
    window.__cacheCdTitleThreshold = function() {
      if (!cdTitleEl) return;
      var scrollRect = classDetailScroll.getBoundingClientRect();
      var titleRect = cdTitleEl.getBoundingClientRect();
      var navHeight = cdStickyNav ? cdStickyNav.offsetHeight : 80;
      cdTitleScrollThreshold = (titleRect.top - scrollRect.top) + classDetailScroll.scrollTop - navHeight;
    };

    classDetailScroll.addEventListener('scroll', function() {
      if (!classDetailOpen) return;
      var st = classDetailScroll.scrollTop;
      // Sticky nav title fade-in — only when the class title has scrolled off screen
      if (st > cdTitleScrollThreshold) cdStickyNav.classList.add('scrolled');
      else cdStickyNav.classList.remove('scrolled');
    }, { passive: true });

    // ===== Drag-to-dismiss for class detail =====
    var cdDragStartY = 0;
    var cdDragDelta = 0;
    var cdDismissDragging = false;
    var cdDismissDragInitiated = false;
    var cdLastDragY = 0;
    var cdLastDragTime = 0;
    var cdDragVelocity = 0;
    var CD_DOWNWARD_INTENT = 6;
    var CD_UPWARD_ABANDON = 10;

    function cdStartDrag(y) {
      if (!classDetailOpen) return;
      // Defer visual drag until downward intent is confirmed (see cdMoveDrag).
      // This lets upward flicks pass through to native scroll cleanly.
      cdDismissDragging = true;
      cdDismissDragInitiated = false;
      cdDragStartY = y;
      cdDragDelta = 0;
      cdLastDragY = y;
      cdLastDragTime = Date.now();
      cdDragVelocity = 0;
    }
    function cdMoveDrag(y) {
      if (!cdDismissDragging) return;
      var now = Date.now();
      var dt = now - cdLastDragTime;
      if (dt > 0) cdDragVelocity = ((y - cdLastDragY) / dt) * 1000;
      cdLastDragY = y;
      cdLastDragTime = now;
      var delta = y - cdDragStartY;
      if (!cdDismissDragInitiated) {
        if (delta < -CD_UPWARD_ABANDON) {
          // Upward flick — abandon, native scroll takes over
          cdDismissDragging = false;
          return;
        }
        if (delta < CD_DOWNWARD_INTENT) {
          return; // still ambiguous
        }
        // Confirmed downward intent — initiate visual drag
        cdDismissDragInitiated = true;
        classDetailSheet.style.transition = 'none';
        venueDetailSheet.classList.remove('unstacking');
        cdDragStartY = y; // re-anchor so sheet doesn't jump
        delta = 0;
      }
      cdDragDelta = Math.max(0, delta);
      classDetailSheet.style.transform = 'translateY(' + cdDragDelta + 'px)';
      // Progressive un-stack: scale venue from 0.95 → 1.0 as user drags down
      var t = Math.min(1, cdDragDelta / classDetailSheet.offsetHeight);
      var scale = 0.95 + 0.05 * t;
      var ty = 0;
      venueDetailSheet.style.transition = 'none';
      venueDetailSheet.style.transform = 'scale(' + scale + ') translateY(' + ty + 'px)';
      // Backdrop fade
      var op = Math.max(0, 0.08 * (1 - cdDragDelta / 300));
      classDetailEl.style.background = 'rgba(0,0,0,' + op + ')';
    }
    function cdEndDrag() {
      if (!cdDismissDragging) return;
      cdDismissDragging = false;
      // If the visual drag never started (upward flick or no movement), let native scroll
      // own the gesture — nothing to clean up on the sheet.
      if (!cdDismissDragInitiated) return;
      cdDismissDragInitiated = false;
      classDetailEl.style.background = '';
      if (cdDragDelta > 80 || cdDragVelocity > 500) {
        // Dismiss — pure CSS-transition pattern (mirrors venue detail's drag-dismiss)
        // to avoid the Motion handoff flicker.
        var sheetHeight = classDetailSheet.offsetHeight;
        classDetailOpen = false;
        classDetailEl.classList.remove('class-detail-visible');
        venueDetailEl.style.background = '';
        venueDetailScroll.scrollTop = 0;
        // Cancel any in-progress Motion animations on either sheet
        if (motionAnimate) {
          classDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
          venueDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
        }
        // Booking bar: slide back down alongside the drag-dismiss.
        cdBookingBar.classList.remove('cd-booking-visible');
        if (motionAnimate) {
          cdBookingBar.getAnimations().forEach(function(a) { a.cancel(); });
          motionAnimate(cdBookingBar, {
            transform: [CD_BOOKING_VISIBLE_Y, cdBookingHiddenY()]
          }, { duration: 0.25, easing: 'cubic-bezier(.25,.46,.45,.94)' }).finished.then(function() {
            if (!cdBookingBar.classList.contains('cd-booking-visible')) {
              cdBookingBar.style.visibility = 'hidden';
            }
          });
        }
        // --- Class detail sheet: pin current transform → reflow → CSS transition to dismiss
        classDetailSheet.style.transition = 'none';
        classDetailSheet.style.transform = 'translateY(' + cdDragDelta + 'px)';
        // --- Venue sheet: pin current scale/translate → reflow → CSS transition back to identity
        var ct = Math.min(1, cdDragDelta / sheetHeight);
        var curScale = 0.95 + 0.05 * ct;
        venueDetailSheet.style.transition = 'none';
        venueDetailSheet.style.transform = 'scale(' + curScale + ') translateY(0px)';
        // Force reflow so the pinned starting state is committed before transitions
        void classDetailSheet.offsetHeight;
        void venueDetailSheet.offsetHeight;
        // Apply transitions + targets
        classDetailSheet.style.transition = 'transform 0.25s cubic-bezier(.25, .46, .45, .94)';
        classDetailSheet.style.transform = 'translateY(' + sheetHeight + 'px)';
        venueDetailSheet.style.transition = 'transform 0.3s cubic-bezier(.25, .46, .45, .94), border-radius 0.3s ease, filter 0.3s ease';
        venueDetailSheet.style.transform = 'translateY(0px)';
        venueDetailSheet.style.borderRadius = '32px 32px 0 0';
        venueDetailSheet.style.filter = 'brightness(1)';
        // Cleanup — skip if the sheet has been re-opened during the dismiss
        // transition, otherwise this wipes the re-open's visibility/transform.
        classDetailSheet.addEventListener('transitionend', function handler(e) {
          if (e.propertyName !== 'transform') return;
          classDetailSheet.removeEventListener('transitionend', handler);
          if (classDetailOpen) return;
          classDetailSheet.style.transform = '';
          classDetailSheet.style.transition = '';
          classDetailSheet.style.visibility = '';
        });
        venueDetailSheet.addEventListener('transitionend', function handler(e) {
          if (e.propertyName !== 'transform') return;
          venueDetailSheet.removeEventListener('transitionend', handler);
          if (classDetailOpen) return;
          venueDetailSheet.classList.remove('stacked');
          venueDetailSheet.style.borderRadius = '';
          venueDetailSheet.style.filter = '';
          venueDetailSheet.style.transition = '';
          // Keep venueDetailSheet.style.transform = 'translateY(0px)' so the venue stays anchored
        });
      } else {
        // Snap back: sheet to 0, venue back to scale(0.94)
        if (motionAnimate) {
          motionAnimate(classDetailSheet, { transform: 'translateY(0px)' }, iosSnapSpring);
          motionAnimate(venueDetailSheet, { transform: 'scale(0.95) translateY(0px)' }, iosSnapSpring).finished.then(function() {
            venueDetailSheet.style.transform = '';
            venueDetailSheet.style.transition = '';
            venueDetailSheet.classList.add('stacked');
          });
        } else {
          classDetailSheet.style.transition = 'transform 0.25s cubic-bezier(.25,.46,.45,.94)';
          classDetailSheet.style.transform = 'translateY(0px)';
          venueDetailSheet.style.transition = 'transform 0.25s cubic-bezier(.25,.46,.45,.94)';
          venueDetailSheet.style.transform = 'scale(0.95) translateY(0px)';
          venueDetailSheet.addEventListener('transitionend', function handler() {
            venueDetailSheet.removeEventListener('transitionend', handler);
            venueDetailSheet.style.transform = '';
            venueDetailSheet.style.transition = '';
            venueDetailSheet.classList.add('stacked');
          }, { once: true });
        }
      }
    }

    // Handle: always initiates dismiss drag
    var cdHandle = classDetailEl.querySelector('.class-detail-handle');
    cdHandle.addEventListener('touchstart', function(e) { cdStartDrag(e.touches[0].clientY); }, { passive: true });
    cdHandle.addEventListener('mousedown', function(e) { e.preventDefault(); cdStartDrag(e.clientY); });

    // Sticky nav area: also acts as a drag target when scrolled to top (skip interactive controls)
    function cdNavIsInteractive(target) {
      return target.closest('.cd-icon-btn, .cd-action-icon, .cd-actions-pill');
    }
    cdStickyNav.addEventListener('touchstart', function(e) {
      if (cdNavIsInteractive(e.target)) return;
      if (classDetailScroll.scrollTop > 0) return;
      cdStartDrag(e.touches[0].clientY);
    }, { passive: true });
    cdStickyNav.addEventListener('mousedown', function(e) {
      if (cdNavIsInteractive(e.target)) return;
      if (classDetailScroll.scrollTop > 0) return;
      e.preventDefault();
      cdStartDrag(e.clientY);
    });

    document.addEventListener('touchmove', function(e) {
      if (cdDismissDragging) cdMoveDrag(e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchend', function() {
      if (cdDismissDragging) cdEndDrag();
    }, { passive: true });
    document.addEventListener('mousemove', function(e) {
      if (cdDismissDragging) { e.preventDefault(); cdMoveDrag(e.clientY); }
    });
    document.addEventListener('mouseup', function() {
      if (cdDismissDragging) cdEndDrag();
    });
  })();

  // ========== MOUSE DRAG SCROLL (iOS-like for desktop) ==========
  var activeDragEl = null;
  var pendingDrag = null; // for direction-detection on carousels

  function addVerticalDragScroll(el) {
    var startY, startScroll, velocity, lastY, lastTime, raf;

    function momentum() {
      if (activeDragEl === el) return;
      velocity *= 0.95;
      var max = el.scrollHeight - el.clientHeight;
      var newTop = el.scrollTop - velocity;
      if (newTop < 0) { el.scrollTop = 0; return; }
      if (newTop > max) { el.scrollTop = max; return; }
      el.scrollTop = newTop;
      if (Math.abs(velocity) > 0.5) raf = requestAnimationFrame(momentum);
    }

    el.addEventListener('mousedown', function(e) {
      if (activeDragEl) return;
      // Disable drag-scroll on venue lists when the sheet isn't expanded
      if (el.classList.contains('venue-list')) {
        var parentSheet = el.closest('.results-sheet');
        if (parentSheet && !parentSheet.classList.contains('expanded')) return;
      }
      if (e.target.closest('button, a, .venue-action-btn, .vd-action-pill, .vd-slot-btn, .vd-quick-btn, .venue-detail-close, .venue-detail-handle, .vd-sticky-nav, .cd-icon-btn, .cd-actions-pill, .class-detail-handle, .cd-sticky-nav, .cd-tab')) return;
      var hscrollChild = e.target.closest('.vd-hscroll, .vd-date-picker, .cd-date-picker, .cd-time-slots');
      if (hscrollChild) {
        pendingDrag = { el: el, x: e.clientX, y: e.clientY, scroll: el.scrollTop, time: Date.now(), hscroll: hscrollChild };
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      cancelAnimationFrame(raf);
      activeDragEl = el;
      wasDragging = false;
      startY = e.clientY;
      startScroll = el.scrollTop;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
    });

    document.addEventListener('mousemove', function(e) {
      if (pendingDrag && pendingDrag.el === el) {
        var dx = Math.abs(e.clientX - pendingDrag.x);
        var dy = Math.abs(e.clientY - pendingDrag.y);
        if (dx < 5 && dy < 5) return;
        if (dy >= dx) {
          activeDragEl = el;
          wasDragging = true;
          startY = pendingDrag.y;
          startScroll = pendingDrag.scroll;
          lastY = startY;
          lastTime = pendingDrag.time;
          velocity = 0;
          cancelAnimationFrame(raf);
          pendingDrag = null;
        } else {
          var hel = pendingDrag.hscroll;
          activeDragEl = hel;
          hel._dragStartX = pendingDrag.x;
          hel._dragStartScroll = hel.scrollLeft;
          hel._dragLastX = pendingDrag.x;
          hel._dragLastTime = pendingDrag.time;
          hel._dragVelocity = 0;
          wasDragging = true;
          pendingDrag = null;
        }
      }

      if (activeDragEl !== el) return;
      e.preventDefault();
      var y = e.clientY;
      if (Math.abs(y - startY) > 5) wasDragging = true;
      var now = Date.now();
      var dt = now - lastTime;
      if (dt > 0) velocity = (y - lastY) / dt * 16;
      lastY = y;
      lastTime = now;
      el.scrollTop = startScroll - (y - startY);
    });

    document.addEventListener('mouseup', function() {
      if (pendingDrag && pendingDrag.el === el) pendingDrag = null;
      if (activeDragEl !== el) return;
      activeDragEl = null;
      if (Math.abs(velocity) > 0.5) raf = requestAnimationFrame(momentum);
      if (wasDragging) setTimeout(function() { wasDragging = false; }, 0);
    });
  }

  // Horizontal carousel drag
  document.querySelectorAll('.vd-hscroll, .vd-date-picker, .cd-date-picker, .cd-time-slots').forEach(function(el) {
    var raf;

    function momentum() {
      if (activeDragEl === el) return;
      el._dragVelocity *= 0.95;
      var max = el.scrollWidth - el.clientWidth;
      var newLeft = el.scrollLeft - el._dragVelocity;
      if (newLeft < 0) { el.scrollLeft = 0; return; }
      if (newLeft > max) { el.scrollLeft = max; return; }
      el.scrollLeft = newLeft;
      if (Math.abs(el._dragVelocity) > 0.5) raf = requestAnimationFrame(momentum);
    }

    document.addEventListener('mousemove', function(e) {
      if (activeDragEl !== el) return;
      e.preventDefault();
      var x = e.clientX;
      var now = Date.now();
      var dt = now - el._dragLastTime;
      if (dt > 0) el._dragVelocity = (x - el._dragLastX) / dt * 16;
      el._dragLastX = x;
      el._dragLastTime = now;
      el.scrollLeft = el._dragStartScroll - (x - el._dragStartX);
    });

    document.addEventListener('mouseup', function() {
      if (activeDragEl !== el) return;
      activeDragEl = null;
      // Date picker: paginate to the nearest week with a slow, ease-out carousel feel.
      // Custom JS animation gives a more deliberate carousel transition than the
      // browser's default smooth-scroll easing.
      if (el.classList.contains('cd-date-picker')) {
        if (typeof window.__snapDatePicker === 'function') window.__snapDatePicker();
      } else if (el.classList.contains('vd-date-picker')) {
        if (typeof window.__snapVdDatePicker === 'function') window.__snapVdDatePicker();
      } else if (Math.abs(el._dragVelocity || 0) > 0.5) {
        raf = requestAnimationFrame(momentum);
      }
      if (wasDragging) setTimeout(function() { wasDragging = false; }, 0);
    });

    // Mouse wheel vertical → horizontal scroll (only for true hscroll carousels;
    // skip date picker / time slots so their parent can scroll vertically with the wheel)
    if (el.classList.contains('vd-hscroll')) {
      el.addEventListener('wheel', function(e) {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          var max = el.scrollWidth - el.clientWidth;
          if (max <= 0) return;
          if ((el.scrollLeft <= 0 && e.deltaY < 0) || (el.scrollLeft >= max && e.deltaY > 0)) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      }, { passive: false });
    }
  });

  // Venue detail vertical scroll
  addVerticalDragScroll(venueDetailScroll);

  // Class detail vertical scroll
  addVerticalDragScroll(classDetailScroll);

  // Venue lists
  document.querySelectorAll('.venue-list').forEach(function(list) {
    addVerticalDragScroll(list);
  });

  // ========== PREVENT ZOOM ON iOS ==========
  document.querySelectorAll('input').forEach(input => {
    input.style.fontSize = '16px'; // Prevents iOS zoom on focus
  });

})();
