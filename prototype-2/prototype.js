(function() {
  // ========== STATE ==========
  let currentScreen = 'screen-map-default';
  let searchTerm = '';
  let locationTerm = '';
  let previousSearchTerm = '';
  let preserveMapView = false;
  let returnScreen = null; // tracks which results screen to go back to when X is tapped
  let activeTab = 'search';

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

  const locationSuggestions = {
    'l': [
      { name: 'Lower East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Lower Manhattan', sub: 'Manhattan, New York, NY USA' },
      { name: 'Long Island City', sub: 'Queens, New York, NY USA' }
    ],
    'lo': [
      { name: 'Lower East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Lower Manhattan', sub: 'Manhattan, New York, NY USA' }
    ],
    'low': [
      { name: 'Lower East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Lower Manhattan', sub: 'Manhattan, New York, NY USA' }
    ],
    'lowe': [
      { name: 'Lower East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Lower Manhattan', sub: 'Manhattan, New York, NY USA' }
    ],
    'lower': [
      { name: 'Lower East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Lower Manhattan', sub: 'Manhattan, New York, NY USA' }
    ],
    'w': [
      { name: 'Williamsburg', sub: 'Brooklyn, New York, NY USA' },
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' }
    ],
    'wi': [
      { name: 'Williamsburg', sub: 'Brooklyn, New York, NY USA' }
    ],
    'we': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' },
      { name: 'West Harlem', sub: 'Manhattan, New York, NY USA' }
    ],
    'wes': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' },
      { name: 'West Harlem', sub: 'Manhattan, New York, NY USA' }
    ],
    'west': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' },
      { name: 'West Harlem', sub: 'Manhattan, New York, NY USA' }
    ],
    'west ': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' }
    ],
    'west v': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' }
    ],
    'west vi': [
      { name: 'West Village', sub: 'Manhattan, New York, NY USA' }
    ],
    'b': [
      { name: 'Brooklyn', sub: 'New York, NY USA' },
      { name: 'Bushwick', sub: 'Brooklyn, New York, NY USA' }
    ],
    'br': [
      { name: 'Brooklyn', sub: 'New York, NY USA' },
      { name: 'Bronx', sub: 'New York, NY USA' }
    ],
    'c': [
      { name: 'Chelsea', sub: 'Manhattan, New York, NY USA' },
      { name: 'Chinatown', sub: 'Manhattan, New York, NY USA' }
    ],
    'ch': [
      { name: 'Chelsea', sub: 'Manhattan, New York, NY USA' },
      { name: 'Chinatown', sub: 'Manhattan, New York, NY USA' }
    ],
    'u': [
      { name: 'Upper East Side', sub: 'Manhattan, New York, NY USA' },
      { name: 'Upper West Side', sub: 'Manhattan, New York, NY USA' }
    ],
    'e': [
      { name: 'East Village', sub: 'Manhattan, New York, NY USA' }
    ],
    's': [
      { name: 'SoHo', sub: 'Manhattan, New York, NY USA' }
    ],
    'n': [
      { name: 'NoHo', sub: 'Manhattan, New York, NY USA' },
      { name: 'Nolita', sub: 'Manhattan, New York, NY USA' }
    ],
    'g': [
      { name: 'Greenpoint', sub: 'Brooklyn, New York, NY USA' },
      { name: 'Gramercy', sub: 'Manhattan, New York, NY USA' }
    ],
    'm': [
      { name: 'Midtown', sub: 'Manhattan, New York, NY USA' },
      { name: 'Murray Hill', sub: 'Manhattan, New York, NY USA' }
    ],
    'f': [
      { name: 'Flatiron', sub: 'Manhattan, New York, NY USA' },
      { name: 'Financial District', sub: 'Manhattan, New York, NY USA' }
    ],
    't': [
      { name: 'Tribeca', sub: 'Manhattan, New York, NY USA' }
    ],
    'h': [
      { name: 'Hell\'s Kitchen', sub: 'Manhattan, New York, NY USA' },
      { name: 'Harlem', sub: 'Manhattan, New York, NY USA' }
    ]
  };

  // ========== LOCATION COORDINATES ==========
  const LOCATIONS = {
    '_default':          { lat: 40.7380, lng: -73.9855, zoom: 13 },
    'Lower East Side':   { lat: 40.7150, lng: -73.9843, zoom: 15 },
    'Lower Manhattan':   { lat: 40.7075, lng: -74.0021, zoom: 14 },
    'Long Island City':  { lat: 40.7425, lng: -73.9234, zoom: 15 },
    'Williamsburg':      { lat: 40.7081, lng: -73.9571, zoom: 15 },
    'West Village':      { lat: 40.7336, lng: -74.0027, zoom: 15 },
    'Brooklyn':          { lat: 40.6782, lng: -73.9442, zoom: 13 },
    'Bushwick':          { lat: 40.6944, lng: -73.9213, zoom: 15 },
    'Bronx':             { lat: 40.8448, lng: -73.8648, zoom: 13 },
    'Chelsea':           { lat: 40.7465, lng: -74.0014, zoom: 15 },
    'Chinatown':         { lat: 40.7158, lng: -73.9970, zoom: 16 },
    'Upper East Side':   { lat: 40.7736, lng: -73.9566, zoom: 15 },
    'Upper West Side':   { lat: 40.7870, lng: -73.9754, zoom: 15 },
    'East Village':      { lat: 40.7265, lng: -73.9815, zoom: 15 },
    'SoHo':              { lat: 40.7233, lng: -73.9991, zoom: 16 },
    'NoHo':              { lat: 40.7264, lng: -73.9927, zoom: 16 },
    'Nolita':            { lat: 40.7237, lng: -73.9957, zoom: 16 },
    'Greenpoint':        { lat: 40.7282, lng: -73.9512, zoom: 15 },
    'Gramercy':          { lat: 40.7367, lng: -73.9845, zoom: 15 },
    'Midtown':           { lat: 40.7549, lng: -73.9840, zoom: 14 },
    'Murray Hill':       { lat: 40.7479, lng: -73.9757, zoom: 15 },
    'Flatiron':          { lat: 40.7395, lng: -73.9903, zoom: 15 },
    'Financial District':{ lat: 40.7075, lng: -74.0089, zoom: 15 },
    'Tribeca':           { lat: 40.7163, lng: -74.0086, zoom: 15 },
    "Hell's Kitchen":    { lat: 40.7638, lng: -73.9918, zoom: 15 },
    'Harlem':            { lat: 40.8116, lng: -73.9465, zoom: 14 },
    '07010':             { lat: 40.8568, lng: -74.1257, zoom: 14 },
    '10019':             { lat: 40.7653, lng: -73.9857, zoom: 15 },
  };

  // ========== PIN GENERATION ==========
  const STUDIO_NAMES = {
    'Yoga':     ['Zen Yoga', 'Y7 Studio', 'Modo Yoga', 'Flow Yoga', 'Lyons Den Yoga', 'Bhakti Yoga', 'CorePower Yoga', 'Sky Ting Yoga'],
    'Pilates':  ['SLT', 'Club Pilates', 'Flex Studios', 'New York Pilates', 'Gramercy Pilates', 'Reform', 'Pilates ProWorks', 'Core Pilates'],
    'Barre':    ['Physique 57', 'Pure Barre', 'The Bar Method', 'Barre3', 'Pop Physique', 'Exhale Barre', 'FlyBarre', 'Xtend Barre'],
    'Boxing':   ['Rumble Boxing', 'Gotham Gym', 'Church Street Boxing', 'Overthrow Boxing', 'EverybodyFights', 'Shadowbox', 'Gleason\'s Gym', 'Hit House'],
    'Cycling':  ['SoulCycle', 'Flywheel', 'Peloton Studio', 'CycleBar', 'Swerve Fitness', 'CYCLEBAR', 'Torque Cycle', 'Revolution Cycling'],
    'Dance':    ['305 Fitness', 'AKT', 'Body By Simone', 'DanceFit', 'Vibe Ride', 'BDC', 'Alvin Ailey', 'Dance Body Fitness'],
    'HIIT':     ['Barry\'s', 'Orangetheory', 'F45 Training', 'Fhitting Room', 'Tone House', 'Switch Playground', '305 HIIT', 'Grit Bxng'],
    'Bootcamp': ['Barry\'s Bootcamp', 'Bootcamp Republic', 'The Fhitting Room', 'Sweat NYC', 'Grit Camp', 'Camp Gladiator', 'Body Space', 'Urban Athlete'],
    'CrossFit': ['CrossFit NYC', 'CrossFit Solace', 'ICE NYC', 'Brick CrossFit', 'CrossFit South Brooklyn', 'WillyB CrossFit', 'CrossFit Outbreak', 'CrossFit Prospect Heights'],
    'Meditation':['MNDFL', 'Inscape', 'The Path', 'NY Insight', 'Kadampa Center', 'Open', 'Calm Studio', 'Breathe Meditation'],
    '_default': ['Playlist Studio', 'FitSpace', 'Movement Lab', 'Sweat Studio', 'The Training Ground', 'Active Life', 'CoreFit', 'Urban Sweat'],
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

  // Pre-vetted offsets that stay on land for NYC neighborhoods.
  // Skewed to avoid due-west (Hudson) and due-south (bay) extremes.
  const LAND_OFFSETS = [
    [ 0.0042,  0.0023], [ 0.0031, -0.0018], [-0.0028,  0.0035], [-0.0039, -0.0014],
    [ 0.0058,  0.0012], [ 0.0015,  0.0048], [-0.0012, -0.0041], [-0.0051,  0.0008],
    [ 0.0025, -0.0032], [-0.0022,  0.0027], [ 0.0068,  0.0019], [-0.0044, -0.0022],
    [ 0.0033,  0.0041], [-0.0036,  0.0015], [ 0.0048, -0.0025], [-0.0019,  0.0052],
    [ 0.0062, -0.0011], [-0.0055,  0.0031], [ 0.0019,  0.0063], [-0.0065, -0.0008],
  ];

  function generatePins(search, location, center, count) {
    const seed = simpleHash((search || '') + (location || ''));
    const rand = seededRandom(seed || 1);
    const names = STUDIO_NAMES[search] || STUDIO_NAMES['_default'];
    // Shuffle offsets using the seeded random so each search/location looks different
    const offsets = LAND_OFFSETS.slice().sort(() => rand() - 0.5);
    const pins = [];
    for (let i = 0; i < count; i++) {
      const [dlat, dlng] = offsets[i % offsets.length];
      pins.push({
        lat: center.lat + dlat,
        lng: center.lng + dlng,
        name: names[i % names.length]
      });
    }
    return pins;
  }

  // ========== MAP OFFSET HELPER ==========
  // Offset the map center so pins appear centered between search bar and sheet
  // Search bar bottom: ~118px, sheet top: ~392px → visible gap center: ~255px
  // Map actual center: 426px → offset needed: 426 - 255 = 171px
  const MAP_CENTER_OFFSET_PX = 195;

  function getOffsetCenter(lat, lng, zoom, mapInstance) {
    const m = mapInstance || map;
    const targetPoint = m.project([lat, lng], zoom);
    const offsetPoint = L.point(targetPoint.x, targetPoint.y + MAP_CENTER_OFFSET_PX);
    return m.unproject(offsetPoint, zoom);
  }

  // ========== MAP SETUP ==========
  const mapDiv = document.getElementById('live-map');
  let userLat = null, userLng = null;
  const DEFAULT_LAT = 40.7380, DEFAULT_LNG = -73.9855;
  let userLocationMarker = null;

  const map = L.map('live-map', {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  const markerGroup = L.layerGroup().addTo(map);
  // Temporary view so Leaflet initializes (tiles won't flash — map is hidden until ready)
  map.setView([40.7380, -73.9855], 13);

  const pinIcon = L.divIcon({
    className: 'playlist-pin',
    html: '<div class="pin-dot"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11]
  });

  const MAP_SCREENS = ['screen-map-default', 'screen-search-results', 'screen-location-results', 'screen-both-results'];

  // Map is now a persistent backdrop — no need to move it between screens
  function attachMapToScreen(screenId) {
    // Just ensure Leaflet knows its size is correct
    setTimeout(() => map.invalidateSize(), 50);
  }

  const VENUE_DESCRIPTIONS = [
    'A welcoming studio offering a variety of classes for all levels, from beginners to advanced practitioners.',
    'Modern facility with state-of-the-art equipment and experienced instructors dedicated to your fitness journey.',
    'Boutique fitness studio known for its intimate class sizes and personalized attention to each member.',
    'Community-focused space offering group classes, workshops, and private sessions in a supportive environment.',
  ];

  function generateVenueCardHTML(pins, search, location) {
    return pins.map((pin, i) => {
      const tags = search || 'Fitness, Wellness';
      const distance = (0.1 + (i * 0.15)).toFixed(1);
      const rating = (4.5 + (i % 5) * 0.1).toFixed(1);
      const reviews = 50 + i * 37;
      const neighborhood = location || 'Manhattan';
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
      if (el && (screenId !== 'screen-map-default' || el.children.length === 0)) {
        el.innerHTML = generateVenueCardHTML(pins, search, location);
      }
    }
  }

  // Current location icon — black circle with white outline
  const userLocIcon = L.divIcon({
    className: 'playlist-pin',
    html: '<div class="user-location-dot"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  // Location search center pin — provided SVG asset
  const locationPinIcon = L.divIcon({
    className: 'playlist-pin',
    html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="12" fill="black"/><path d="M11.8682 5C12.3944 5.00001 12.8742 5.12738 13.3076 5.38281C13.741 5.63835 14.0854 5.98338 14.3408 6.41699C14.5963 6.85068 14.7246 7.3308 14.7246 7.85742C14.7246 8.48472 14.5425 9.04635 14.1787 9.54199C13.8149 10.0298 13.3542 10.3669 12.7969 10.5527V16.4189C12.7969 16.9688 12.7581 17.4917 12.6807 17.9873C12.6033 18.4751 12.4948 18.8739 12.3555 19.1836C12.2239 19.4856 12.0616 19.6367 11.8682 19.6367C11.6746 19.6367 11.5045 19.4817 11.3574 19.1719C11.2181 18.8621 11.1096 18.4634 11.0322 17.9756C10.9626 17.48 10.9277 16.961 10.9277 16.4189V10.5527C10.3704 10.3591 9.90971 10.0182 9.5459 9.53027C9.18209 9.04237 9 8.48472 9 7.85742C9 7.3308 9.12835 6.85465 9.38379 6.42871C9.64697 5.99507 9.99526 5.65008 10.4287 5.39453C10.8621 5.13136 11.3419 5 11.8682 5ZM11.1602 6.18457C10.9202 6.18457 10.7073 6.278 10.5215 6.46387C10.3358 6.64971 10.2422 6.8625 10.2422 7.10254C10.25 7.35028 10.3435 7.56711 10.5215 7.75293C10.7072 7.93095 10.9203 8.02051 11.1602 8.02051C11.4077 8.02043 11.6209 7.93098 11.7988 7.75293C11.9767 7.56715 12.0654 7.35021 12.0654 7.10254C12.0654 6.86264 11.9766 6.64963 11.7988 6.46387C11.6209 6.27808 11.4077 6.18465 11.1602 6.18457Z" fill="white"/></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  function showUserLocation() {
    if (userLat && userLng) {
      if (userLocationMarker) {
        userLocationMarker.setLatLng([userLat, userLng]);
      } else {
        userLocationMarker = L.marker([userLat, userLng], { icon: userLocIcon, zIndexOffset: 1000, interactive: false })
          .addTo(map);
      }
    }
  }

  // Case-insensitive location lookup
  function findLocation(name) {
    if (!name) return null;
    // Try exact match first
    if (LOCATIONS[name]) return LOCATIONS[name];
    // Case-insensitive match
    const lower = name.toLowerCase();
    for (const key in LOCATIONS) {
      if (key.toLowerCase() === lower) return LOCATIONS[key];
    }
    return null;
  }

  function updateMapForCurrentState() {
    const keepView = preserveMapView;
    preserveMapView = false;
    let loc;
    if (currentScreen === 'screen-map-default' && userLat && userLng) {
      loc = { lat: userLat, lng: userLng, zoom: 14 };
    } else if (locationTerm === 'Current location' && userLat && userLng) {
      loc = { lat: userLat, lng: userLng, zoom: 14 };
    } else {
      loc = findLocation(locationTerm) || LOCATIONS['_default'];
    }
    markerGroup.clearLayers();
    // Pick icon: current location → circle dot, searched location → pin badge
    const isCurrentLoc = !locationTerm || locationTerm === 'Current location';
    const centerIcon = isCurrentLoc ? userLocIcon : locationPinIcon;
    if (userLocationMarker) {
      userLocationMarker.setLatLng([loc.lat, loc.lng]);
      userLocationMarker.setIcon(centerIcon);
    } else {
      userLocationMarker = L.marker([loc.lat, loc.lng], { icon: centerIcon, zIndexOffset: 1000, interactive: false })
        .addTo(map);
    }

    // Always show pins — use defaults for the default screen
    const effectiveSearch = searchTerm || (currentScreen === 'screen-map-default' ? '' : '');
    const effectiveLocation = locationTerm || '';
    const pins = generatePins(effectiveSearch, effectiveLocation || 'nearby', loc, 10);
    pins.forEach(pin => {
      L.marker([pin.lat, pin.lng], { icon: pinIcon, interactive: false })
        .addTo(markerGroup);
    });

    // For results screens, fit bounds to show all pins in the visible map area
    const isResultsScreen = currentScreen !== 'screen-map-default';
    if (keepView) {
      // Map is already in the right position — don't animate
    } else if (isResultsScreen && pins.length > 0) {
      const allPoints = pins.map(p => [p.lat, p.lng]);
      allPoints.push([loc.lat, loc.lng]);
      const bounds = L.latLngBounds(allPoints);
      // Pad top for search bar (~120px) and bottom for sheet area (~450px)
      map.flyToBounds(bounds, { paddingTopLeft: [20, 120], paddingBottomRight: [20, 450], duration: 0.8, maxZoom: 15 });
    } else {
      const offsetCenter = getOffsetCenter(loc.lat, loc.lng, loc.zoom);
      if (currentScreen === 'screen-map-default') {
        // Returning to default — restore without animation
        map.setView(offsetCenter, loc.zoom, { animate: false });
      } else {
        map.flyTo(offsetCenter, loc.zoom, { duration: 0.8 });
      }
    }

    populateVenueList(currentScreen, pins, effectiveSearch || 'Fitness', effectiveLocation || 'Nearby');
  }

  // ========== GEOLOCATION (primary init) ==========
  function initDefaultMap(lat, lng, zoom, locationLabel) {
    const oc = getOffsetCenter(lat, lng, zoom);
    map.setView(oc, zoom, { animate: false });
    markerGroup.clearLayers();
    // Show user location marker at map center (real or default)
    if (userLocationMarker) {
      userLocationMarker.setLatLng([lat, lng]);
      userLocationMarker.setIcon(userLocIcon);
    } else {
      userLocationMarker = L.marker([lat, lng], { icon: userLocIcon, zIndexOffset: 1000, interactive: false })
        .addTo(map);
    }
    const pins = generatePins('', 'nearby', { lat: lat, lng: lng }, 10);
    pins.forEach(pin => {
      L.marker([pin.lat, pin.lng], { icon: pinIcon, interactive: false })
        .addTo(markerGroup);
    });
    populateVenueList('screen-map-default', pins, 'Fitness', locationLabel);
  }

  // Show NYC default immediately so venue cards appear right away
  // Use whenReady to ensure map container is sized before projecting pin offsets
  map.whenReady(function() {
    initDefaultMap(40.7380, -73.9855, 14, 'Manhattan');
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
          initDefaultMap(userLat, userLng, 14, 'Nearby');
        }
      },
      function() { /* already showing NYC default */ },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }

  // ========== SCREEN MANAGEMENT ==========
  function showScreen(id, animation) {
    const ANIM_CLASSES = ['anim-fade-in', 'anim-fade-out', 'anim-bg-fade-in', 'anim-bg-fade-out', 'anim-slide-up', 'anim-slide-down', 'anim-screen-fade-in'];
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
    } else {
      // Default: instant swap with bg fade for search-focused from map
      document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active', ...ANIM_CLASSES);
      });
      target.classList.add('active');
      // Map → search-focused: fade the grey background in + slide keyboard up + search bar shrink
      if (id === 'screen-search-focused' && isPrevMap) {
        target.classList.add('anim-bg-fade-in');
        const kb = target.querySelector('.keyboard');
        if (kb) {
          kb.classList.add('anim-kb-slide-up');
          kb.addEventListener('animationend', () => kb.classList.remove('anim-kb-slide-up'), { once: true });
        }
        const sbc = target.querySelector('.search-bar-container');
        if (sbc) {
          sbc.classList.add('anim-search-enter');
          sbc.addEventListener('animationend', () => sbc.classList.remove('anim-search-enter'), { once: true });
        }
      }
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

  function updateSearchUI() {
    const val = searchInput.value;
    searchTerm = val;

    // Show/hide clear button
    if (val.length > 0) {
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
    } else {
      exploreSection.classList.add('hidden');
      searchRecentsSection.classList.add('hidden');
      searchAutocomplete.classList.remove('hidden');
      // Show the typed text as-is suggestion
      renderSearchSuggestions([val], val);
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
    if (!searchTerm && !locationTerm) return;

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

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchTerm = '';
    updateSearchUI();
    searchInput.focus();
  });

  searchClose.addEventListener('click', () => {
    const hasSearch = searchInput.value.trim().length > 0;
    const hasLocation = locationInput.value.trim().length > 0;

    if (!hasSearch && !hasLocation) {
      // Both empty — go to default map
      returnScreen = null;
      searchTerm = '';
      locationTerm = '';
      updateSearchUI();
      updateLocationUI();
      preserveMapView = true;
      showScreen('screen-map-default', 'fade-in');
    } else {
      // Fields have content — go to results
      searchTerm = searchInput.value;
      locationTerm = locationInput.value || locationTerm || '';
      submitSearch();
    }
  });

  searchSubmitBtn.addEventListener('click', () => {
    if (activeTab === 'location') {
      if (locationInput.value.length > 0) { locationTerm = locationInput.value; }
      if (locationTerm) { selectLocation(); }
    } else {
      searchTerm = searchInput.value;
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
  const locationRecents = document.getElementById('location-recents-section');
  const locationAutocomplete = document.getElementById('location-autocomplete');
  const locationAutocompleteList = document.getElementById('location-autocomplete-list');

  function updateLocationUI() {
    const val = locationInput.value;
    const locationCurrentCta = document.getElementById('location-current-cta');

    // Show/hide clear button
    if (val.length > 0) {
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

    // Show recents or autocomplete
    const key = val.toLowerCase();
    const suggestions = locationSuggestions[key];

    if (val.length === 0) {
      locationCurrentCta.classList.remove('hidden');
      if (locationRecentsData.length > 0) locationRecents.classList.remove('hidden');
      locationAutocomplete.classList.add('hidden');
    } else if (suggestions) {
      locationCurrentCta.classList.add('hidden');
      locationRecents.classList.add('hidden');
      locationAutocomplete.classList.remove('hidden');
      renderLocationSuggestions(suggestions, val, true);
    } else {
      locationCurrentCta.classList.add('hidden');
      locationRecents.classList.add('hidden');
      locationAutocomplete.classList.remove('hidden');
      renderLocationSuggestions([{ name: val, sub: 'New York, NY USA' }], val, true);
    }
  }

  // Bind persistent current location row click handler
  document.getElementById('loc-ac-current-location').addEventListener('click', () => {
    locationTerm = 'Current location';
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
        div.style.display = '';
      } else {
        div.style.display = 'none';
      }
    });
  }

  let locationSearched = false;
  const locationRecentsData = [];
  const MAX_LOCATION_RECENTS = 5;

  function addLocationRecent(term) {
    if (!term || term === 'Current location') return;
    const idx = locationRecentsData.indexOf(term);
    if (idx !== -1) locationRecentsData.splice(idx, 1);
    locationRecentsData.unshift(term);
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
    locationRecentsData.forEach(term => {
      const div = document.createElement('div');
      div.className = 'chip';
      div.dataset.location = term;
      div.textContent = term;
      div.addEventListener('click', () => {
        locationTerm = term;
        selectLocation();
      });
      list.appendChild(div);
    });
  }

  document.getElementById('location-clear-recents').addEventListener('click', () => {
    locationRecentsData.length = 0;
    renderLocationRecents();
  });

  function selectLocation() {
    returnScreen = null;
    locationSearched = true;
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

  locationClear.addEventListener('click', () => {
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
    selectLocation();
  });

  // ========== NAV BUTTON (current location) ==========
  document.querySelectorAll('.map-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = userLat ?? DEFAULT_LAT;
      const lng = userLng ?? DEFAULT_LNG;
      locationTerm = 'Current location';

      // Update the search bar label on whichever results screen is active
      if (currentScreen === 'screen-both-results') {
        document.getElementById('both-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Current location</span>';
      } else if (currentScreen === 'screen-location-results') {
        document.getElementById('locresults-search-text').textContent = 'Current location';
      } else if (currentScreen === 'screen-search-results') {
        document.getElementById('results-search-text').innerHTML = searchTerm + ' <span style="color:#90939D">\u00B7 Current location</span>';
      }

      const offsetCenter = getOffsetCenter(lat, lng, 14);
      map.flyTo(offsetCenter, 14, { duration: 0.8 });
      map.once('moveend', () => {
        if (currentScreen === 'screen-map-default') {
          initDefaultMap(lat, lng, 14, userLat ? 'Nearby' : 'Manhattan');
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
    searchTerm = '';
    searchInput.value = '';
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });

  // Search results → search focused (search tab)
  document.getElementById('hotspot-search-results').addEventListener('click', () => {
    returnScreen = 'screen-search-results';
    searchInput.value = searchTerm;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });
  document.getElementById('hotspot-x-results').addEventListener('click', () => {
    searchTerm = '';
    preserveMapView = true;
    showScreen('screen-map-default', 'fade-in');
  });

  // Location results → unified search screen, location tab
  document.getElementById('hotspot-search-locresults').addEventListener('click', () => {
    returnScreen = 'screen-location-results';
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    setActiveTab('location');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => { locationInput.focus(); updateLocationUI(); }, 150);
  });
  document.getElementById('hotspot-x-locresults').addEventListener('click', () => {
    searchTerm = '';
    preserveMapView = true;
    showScreen('screen-map-default', 'fade-in');
  });

  // Both results → search focused (search tab)
  document.getElementById('hotspot-search-both').addEventListener('click', () => {
    returnScreen = 'screen-both-results';
    searchInput.value = searchTerm;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    updateSearchUI();
    updateLocationUI();
    setActiveTab('search');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });
  document.getElementById('hotspot-x-both').addEventListener('click', () => {
    searchTerm = '';
    preserveMapView = true;
    showScreen('screen-map-default', 'fade-in');
  });

  // Search tab hotspots
  document.getElementById('hotspot-search-tab').addEventListener('click', () => {
    searchInput.value = '';
    updateSearchUI();
    setActiveTab('search');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => searchInput.focus(), 300);
  });
  document.getElementById('hotspot-x-tab').addEventListener('click', () => {
    searchTerm = '';
    locationTerm = '';
    preserveMapView = true;
    showScreen('screen-map-default', 'fade-in');
  });

  // ========== SEARCH TAB TOGGLE ==========
  function setActiveTab(tab) {
    activeTab = tab;
    const tabSearch = document.getElementById('tab-search');
    const tabLocation = document.getElementById('tab-location');
    const searchContent = document.getElementById('search-tab-content');
    const locationContent = document.getElementById('location-tab-content');
    const searchField = document.getElementById('unified-search-field');
    const locationField = document.getElementById('unified-location-field');
    const toggle = tabSearch.closest('.search-toggle');

    if (tab === 'search') {
      toggle.classList.remove('tab-location');
      tabSearch.classList.add('active');
      tabLocation.classList.remove('active');
      searchContent.classList.remove('hidden');
      locationContent.classList.add('hidden');
      searchField.style.display = 'flex';
      locationField.style.display = 'none';
      searchInput.focus();
    } else {
      toggle.classList.add('tab-location');
      tabLocation.classList.add('active');
      tabSearch.classList.remove('active');
      locationContent.classList.remove('hidden');
      searchContent.classList.add('hidden');
      locationField.style.display = 'flex';
      searchField.style.display = 'none';
      locationInput.focus();
      updateLocationUI();
    }
  }

  document.getElementById('tab-search').addEventListener('click', () => {
    setActiveTab('search');
  });

  document.getElementById('tab-location').addEventListener('click', () => {
    setActiveTab('location');
  });

  // ========== PREVENT ZOOM ON iOS ==========
  document.querySelectorAll('input').forEach(input => {
    input.style.fontSize = '16px'; // Prevents iOS zoom on focus
  });

})();
