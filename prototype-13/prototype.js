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
  let purchaseFlow = 'B'; // Book opens Select option, then checkout

  // ========== RATING DESIGN SYSTEM HELPERS ==========
  window.__plStarXs = function(name) {
    return '<span class="pl-star-xs"><svg class="pl-icon" aria-hidden="true"><use href="#pl-' + name + '"></use></svg></span>';
  };

  window.__plRatingStarsHtml = function(rating, slots) {
    slots = slots || 5;
    var value = parseFloat(rating) || 0;
    var html = '';
    for (var i = 1; i <= slots; i++) {
      var icon = 'star-outline';
      if (value >= i) icon = 'star-fill';
      else if (value >= i - 0.5) icon = 'star-half';
      html += window.__plStarXs(icon);
    }
    return html;
  };

  window.__plReviewCardStarsHtml = function(starCount) {
    var html = '';
    for (var i = 0; i < starCount; i++) html += window.__plStarXs('star-fill');
    return html;
  };

  window.__plRatingDistributionHtml = function(counts) {
    var total = counts.reduce(function(a, b) { return a + b; }, 0) || 1;
    var html = '';
    for (var star = 5; star >= 1; star--) {
      var pct = Math.round((counts[star - 1] / total) * 100);
      html += '<div class="pl-rating-distribution__row">'
        + '<span class="pl-rating-distribution__label">' + star + '</span>'
        + '<div class="pl-rating-distribution__track"><div class="pl-rating-distribution__fill" style="width:'
        + pct + '%"></div></div>'
        + '</div>';
    }
    return html;
  };

  window.__plReviewCardHtml = function(review, opts) {
    opts = opts || {};
    var extraClass = opts.extraClass ? ' ' + opts.extraClass : '';
    var meta = review.date + (review.source ? ' · ' + review.source : ' · ClassPass');
    var textClass = 'pl-review-card__text' + (opts.clampedBody ? ' cd-review-card-body' : '');
    var seemore = opts.clampedBody
      ? '<span class="cd-review-card-seemore" hidden>see more</span>'
      : '';
    return '<div class="pl-review-card' + extraClass + '">'
      + '<div class="pl-review-card__header">'
      +   '<div class="pl-review-card__avatar">' + review.name.charAt(0) + '</div>'
      +   '<div class="pl-review-card__user">'
      +     '<div class="pl-review-card__name-row">'
      +       '<span class="pl-review-card__name">' + review.name + '</span>'
      +       '<span class="pl-review-card__stars" aria-label="' + review.stars + ' out of 5">'
      +         window.__plReviewCardStarsHtml(review.stars)
      +       '</span>'
      +     '</div>'
      +     '<div class="pl-review-card__meta">' + meta + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="pl-review-card__body">'
      +   '<div class="pl-review-card__title">' + review.title + '</div>'
      +   '<div class="' + textClass + '">' + review.body + '</div>'
      +   seemore
      + '</div>'
      + '</div>';
  };

  window.__plRatingDistributionCounts = function(reviewCount, weights) {
    weights = weights || [0.05, 0.05, 0.12, 0.25, 0.53];
    return weights.map(function(w) { return Math.floor(reviewCount * w); });
  };

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
  let foursquareUnavailable = !FOURSQUARE_KEY;

  async function fetchNearbyPlaces(lat, lng, query) {
    if (foursquareUnavailable) return [];
    if (placesAbort) placesAbort.abort();
    placesAbort = new AbortController();
    const params = new URLSearchParams({
      ll: `${lat},${lng}`,
      radius: 5000,
      limit: 50,
      sort: 'DISTANCE',
    });
    params.set('query', query || 'gym fitness yoga pilates');
    // The /api/foursquare/* rewrite is only set up by vercel.json — it
    // exists when running `vercel dev` (localhost:3000) or on a Vercel
    // deployment. Everywhere else (file://, Cursor's preview browser, Live
    // Server, any random localhost server) we hit the public corsproxy so
    // the prototype works standalone without needing the dev server.
    const baseUrl = `https://places-api.foursquare.com/places/search?${params}`;
    const isVercelDev = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port === '3000';
    const isVercelProd = location.hostname.endsWith('.vercel.app');
    const url = (isVercelDev || isVercelProd)
      ? `/api/foursquare/places/search?${params}`
      : `https://corsproxy.io/?url=${encodeURIComponent(baseUrl)}`;
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
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          foursquareUnavailable = true;
        }
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
    // Only pin the featured demo venue first on the default (unsearched)
    // map screen — an actual search/category query should show real results.
    if (screenId === 'screen-map-default') {
      places = ensureFeaturedVenueFirst(places);
    }
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
    updateClusterSource();
    scheduleWaterCheck();
    populateVenueList(screenId, places, search, location);
  }

  function fallbackPlaces(lat, lng, search, locationLabel) {
    return generatePins(search || '', locationLabel || 'nearby', { lat: lat, lng: lng }, 20).map(function(p, i) {
      return {
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        category: p.category || STUDIO_TAGS[p.name] || '',
        locality: 'New York',
        distance: 200 + i * 180
      };
    });
  }

  // Fetch and display real places, replacing any placeholder pins
  async function loadRealPlaces(lat, lng, search, screenId, locationLabel) {
    displayPlaces(fallbackPlaces(lat, lng, search, locationLabel), screenId, search, locationLabel);
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

  // Per-category studio image library. Each studio is a triple
  // [thumbnail+slide1, slide2, slide3] — the first entry is used as the
  // venue-list thumbnail. Boxing has 3 studios; the rest have 4.
  const STUDIO_IMAGES = {
    'Yoga': [
      ['../images/yoga/studio_1/image01.jpg', '../images/yoga/studio_1/image02.jpg', '../images/yoga/studio_1/image03.jpg'],
      ['../images/yoga/studio_2/image01.jpg', '../images/yoga/studio_2/image02.jpg', '../images/yoga/studio_2/image03.jpg'],
      ['../images/yoga/studio_3/image01.jpg', '../images/yoga/studio_3/image02.jpg', '../images/yoga/studio_3/image03.jpg'],
      ['../images/yoga/studio_4/image01.png', '../images/yoga/studio_4/image02.png', '../images/yoga/studio_4/image03.png'],
    ],
    'Pilates': [
      ['../images/pilates/studio_1/image01.jpg', '../images/pilates/studio_1/image02.jpg', '../images/pilates/studio_1/image03.jpg'],
      ['../images/pilates/studio_2/image01.jpg', '../images/pilates/studio_2/image02.png', '../images/pilates/studio_2/image03.jpg'],
      ['../images/pilates/studio_3/image01.jpg', '../images/pilates/studio_3/image02.jpg', '../images/pilates/studio_3/image03.jpg'],
      ['../images/pilates/studio_4/image01.jpg', '../images/pilates/studio_4/image02.jpg', '../images/pilates/studio_4/image03.jpg'],
    ],
    'Barre': [
      ['../images/barre/studio_1/image01.jpg', '../images/barre/studio_1/image02.jpg', '../images/barre/studio_1/image03.jpg'],
      ['../images/barre/studio_2/image01.jpg', '../images/barre/studio_2/image02.jpg', '../images/barre/studio_2/image03.jpg'],
      ['../images/barre/studio_3/image01.jpg', '../images/barre/studio_3/image02.jpg', '../images/barre/studio_3/image03.jpg'],
      ['../images/barre/studio_4/image01.png', '../images/barre/studio_4/image02.png', '../images/barre/studio_4/image03.png'],
    ],
    'Cycling': [
      ['../images/cycling/studio_1/image01.png', '../images/cycling/studio_1/image02.png', '../images/cycling/studio_1/image03.png'],
      ['../images/cycling/studio_2/image01.jpg', '../images/cycling/studio_2/image02.jpg', '../images/cycling/studio_2/image03.jpg'],
      ['../images/cycling/studio_3/image01.jpg', '../images/cycling/studio_3/image02.jpg', '../images/cycling/studio_3/image03.jpg'],
      ['../images/cycling/studio_4/image01.png', '../images/cycling/studio_4/image02.png', '../images/cycling/studio_4/image03.png'],
    ],
    'Boxing': [
      ['../images/boxing/studio_1/image01.png', '../images/boxing/studio_1/image02.png', '../images/boxing/studio_1/image03.png'],
      ['../images/boxing/studio_2/image01.png', '../images/boxing/studio_2/image02.png', '../images/boxing/studio_2/image03.png'],
      ['../images/boxing/studio_3/image01.png', '../images/boxing/studio_3/image02.png', '../images/boxing/studio_3/image03.png'],
    ],
  };

  // Simple deterministic string hash (djb2-ish, 32-bit).
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Deterministic per-venue studio pick + rotation. Two layers of variation:
  //   1. Studio index — picks one of the 3–4 image sets in the category.
  //   2. Rotation — rotates the 3-photo triple so even when two pins land
  //      on the same studio, the thumbnail and carousel order differ
  //      (e.g. one shows [01, 02, 03], another shows [02, 03, 01]).
  // Key includes lat/lng so Foursquare duplicates (same name, different
  // location) pick different studios instead of colliding.
  function pickVenueImages(pin, idx) {
    if (!pin) return null;
    if (pin.name === 'JetSet Pilates') {
      var heroTriple = STUDIO_IMAGES['Pilates'][0];
      return [heroTriple[0], heroTriple[1], heroTriple[2]];
    }
    // Map raw category strings ("Pilates Studio", "Boxing Gym", etc.) onto
    // one of the 5 keyed image categories. If the category doesn't match
    // (e.g. Foursquare returns a generic "Gym" for "Feel Good Pilates"),
    // fall back to scanning the venue name itself for the keyword.
    var rawCat = STUDIO_TAGS[pin.name] || pin.category || '';
    var name = pin.name || '';
    // The current search query is a strong category hint: if the user
    // searched "yoga", every result in this view should be visually treated
    // as yoga (Foursquare often returns generic-category pins like cafés
    // mixed in with a category-keyword query).
    var searchHint = currentSearchLabel || '';
    // Cache the first resolution on the pin so the detail/class views stay
    // consistent if the user later clears the search.
    var category = pin._resolvedImageCategory || null;
    if (!category) {
      var keys = Object.keys(STUDIO_IMAGES);
      for (var k = 0; k < keys.length; k++) {
        var kw = keys[k].toLowerCase();
        if ((rawCat && rawCat.toLowerCase().indexOf(kw) !== -1)
            || (name && name.toLowerCase().indexOf(kw) !== -1)
            || (searchHint && searchHint.toLowerCase().indexOf(kw) !== -1)) {
          category = keys[k];
          break;
        }
      }
      if (category) pin._resolvedImageCategory = category;
    }
    if (!category) return null;
    var studios = STUDIO_IMAGES[category];
    if (!studios || !studios.length) return null;
    // Include the list index as a tiebreaker so Foursquare duplicates
    // (same name + same coords appearing twice in results) still differ.
    var key = name + '|' + (pin.lat || '') + '|' + (pin.lng || '') + '|' + (idx != null ? idx : '');
    var hStudio = hashStr(key);
    var hRot = hashStr(key + '#rot');
    var idx = (hStudio * 7) % studios.length;
    var triple = studios[idx];
    var rot = hRot % triple.length;
    return [triple[rot], triple[(rot + 1) % triple.length], triple[(rot + 2) % triple.length]];
  }

  // Inline background-shorthand setter. Using the shorthand so it overrides
  // the CSS placeholder rules (which themselves use `background:` shorthand
  // and reset background-size to auto). Passing null clears the inline style
  // so the CSS cascade restores the grey placeholder.
  function setVenuePhotoBg(el, url) {
    if (!el) return;
    if (url) {
      el.style.background = "url('" + url + "') center/cover no-repeat";
    } else {
      el.style.background = '';
    }
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

  // Deterministic per-venue flag for the "Showers" amenity — roughly half
  // of venues have showers. Different hash seed than intro offers so the
  // two flags don't correlate.
  function venueHasShowers(pin) {
    if (!pin || !pin.name) return false;
    var h = 7;
    for (var i = 0; i < pin.name.length; i++) h = ((h << 5) - h) + pin.name.charCodeAt(i);
    return (Math.abs(h) % 2) === 0;
  }

  // iOS-style adaptive title sizing: measure the text width at the default
  // font size using a canvas (deterministic regardless of layout timing or
  // -webkit-line-clamp quirks) and toggle .is-compact when the text won't
  // fit on a single line. Shared by the venue/class sticky nav title and
  // the gallery lightbox title so they behave identically.
  function fitTitleToWidth(el, defaultFontSize) {
    if (!el) return;
    var canvas = fitTitleToWidth._canvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      fitTitleToWidth._canvas = canvas;
    }
    var ctx = canvas.getContext('2d');
    ctx.font = '700 ' + defaultFontSize + 'px "DM Sans", -apple-system, sans-serif';
    var textWidth = ctx.measureText(el.textContent).width;
    // The element's own clientWidth is the available width because the
    // title's CSS pins it to a max width (either via left:0/right:0 inside
    // a sized wrap, or width: calc() on the element itself).
    var availableWidth = el.clientWidth;
    if (availableWidth > 0 && textWidth > availableWidth - 1) {
      el.classList.add('is-compact');
    } else {
      el.classList.remove('is-compact');
    }
  }
  // Preserved name for the sticky nav callers — same logic, 17px default.
  function fitStickyTitle(el) { fitTitleToWidth(el, 17); }
  window.__fitStickyTitle = fitStickyTitle;
  window.__fitTitleToWidth = fitTitleToWidth;

  function renderAmenities(containerId, amenities, pillClass) {
    var el = document.getElementById(containerId);
    if (!el) return;
    // Render each amenity as its own span; the "·" separator is drawn by CSS
    // (::before with an ASCII \00B7 escape). A literal "·" byte joined into
    // textContent rendered as "MatsTowelsShowers" once deployed to Vercel —
    // building the separator from an ASCII-safe CSS escape sidesteps any
    // serving/encoding quirk and keeps the spacing from collapsing.
    el.textContent = '';
    amenities.forEach(function(a) {
      var span = document.createElement('span');
      span.className = 'amenity-item';
      span.textContent = a;
      el.appendChild(span);
    });
  }

  // Average center of the hardcoded NYC studio data
  const STUDIOS_CENTER_LAT = 40.7380, STUDIOS_CENTER_LNG = -73.9855;

  // Hero demo venue — pinned first only on the default (unsearched) map screen.
  const JETSET_PILATES_PIN = {
    name: 'JetSet Pilates',
    lat: 40.7395,
    lng: -73.9865,
    category: 'Pilates',
    locality: 'New York',
    neighborhood: 'Rose Hill',
    distance: 322, // ~0.2 mi (meters, for Foursquare-style distance display)
    _rating: 4.8,
    _reviews: 161,
    _resolvedImageCategory: 'Pilates',
  };

  function getVenueRating(pin, index) {
    if (pin && pin._rating != null) return pin._rating;
    return 4.5 + (index % 5) * 0.1;
  }

  function getVenueReviewCount(pin, index) {
    if (pin && pin._reviews != null) return pin._reviews;
    return 50 + index * 37;
  }

  function ensureFeaturedVenueFirst(places) {
    // Case/whitespace-insensitive: the live Foursquare feed sometimes returns
    // a second listing for the same chain with slightly different casing
    // (e.g. "Jetset Pilates" vs "JetSet Pilates"), which an exact-match
    // filter lets slip through as an apparent duplicate right under the
    // featured pin.
    var normalize = function(name) { return (name || '').trim().toLowerCase(); };
    var excluded = [normalize(JETSET_PILATES_PIN.name), 'power pilates'];
    var seen = {};
    var list = (places || []).filter(function(p) {
      var key = normalize(p.name);
      if (excluded.indexOf(key) !== -1) return false;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    return [Object.assign({}, JETSET_PILATES_PIN)].concat(list);
  }

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
    // Drop every cluster HTML marker too — the new dataset will rebuild
    // its own set on the next sync once `setData` populates the source.
    if (typeof clusterMarkers !== 'undefined' && clusterMarkers.forEach) {
      clusterMarkers.forEach(m => m.remove());
      clusterMarkers.clear();
    }
    // Also empty the GeoJSON source feeding clustering. We empty
    // explicitly (not via updateClusterSource) because callers like
    // initDefaultMap clear markers BEFORE currentPins is overwritten — using
    // updateClusterSource here would repopulate with the stale prior set.
    const src = map.getSource && map.getSource(CLUSTER_SOURCE_ID);
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }

  // ========== CLUSTERING ==========
  // Hybrid: GeoJSON source w/ cluster:true feeds a Mapbox circle+text layer for
  // cluster bubbles, while individual pins stay as HTML `mapboxgl.Marker`s so
  // we keep our custom teardrop SVG + click handler. We hide markers whose
  // features are currently inside a cluster, then show them when zoomed in
  // past the cluster's expansion zoom.
  const CLUSTER_SOURCE_ID = 'pins';
  const CLUSTER_LAYER_ID = 'pin-clusters';
  const CLUSTER_COUNT_LAYER_ID = 'pin-cluster-count';

  function pinsToGeoJSON(pins) {
    return {
      type: 'FeatureCollection',
      features: pins.map((p, i) => ({
        type: 'Feature',
        properties: { idx: i },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
      }))
    };
  }

  function updateClusterSource() {
    if (!map || !map.getSource) return;
    const src = map.getSource(CLUSTER_SOURCE_ID);
    if (!src) return; // not initialized yet — displayPlaces may run before map.on('load')
    src.setData(pinsToGeoJSON(currentPins));
  }

  // Show only markers whose underlying feature is not inside a cluster at the
  // current zoom. Re-queried on moveend + after source data changes.
  // Geometric constants for cluster + pin SVGs — used by syncMarkerVisibility
  // to compute screen-space overlap. The red bubble inside each SVG sits at
  // a known vertical offset from the icon center, and Mapbox places the icon
  // CENTER at the lng/lat (icon-anchor: 'center', HTML marker default).
  //
  // The canvases were enlarged from the original Figma exports to give the
  // drop-shadow blur room to fall off cleanly (the old 52×59 / 37×48 sizes
  // clipped the shadow at the canvas edge, producing visible rectangles).
  // The artwork was translated inside the enlarged canvas, so the bubble
  // offset is recomputed below.
  // pin-cluster.svg (80×80): red bubble cx=40.375, cy=26 → offset from
  // center (40, 40) is (~0, -14); red bubble radius ~14.
  // pin-default.svg (64×64): red bubble cx=31.839, cy=24 → offset from
  // center (32, 32) is (~0, -8); red bubble radius ~10.
  const CLUSTER_BUBBLE_OFFSET_Y = -14;
  const CLUSTER_BUBBLE_R = 14;
  const PIN_BUBBLE_OFFSET_Y = -8;
  const PIN_BUBBLE_R = 10;
  const BUBBLE_OVERLAP_R = CLUSTER_BUBBLE_R + PIN_BUBBLE_R;

  // Cluster bubbles are HTML markers (not Mapbox symbol layers) so the
  // count text can render in DM Sans (Mapbox glyph fonts don't include
  // our app fonts) and so the bubble can scale up on tap via CSS. Keyed
  // by `cluster_id` so we re-use the same marker across syncs and only
  // create/remove on cluster set changes.
  const clusterMarkers = new Map();

  function createClusterElement(count) {
    // .cluster-pin is the outer element Mapbox positions; .cluster-pin-inner
    // is what gets `transform: scale(...)` on tap (would otherwise fight
    // Mapbox's own translate on the outer element).
    const el = document.createElement('div');
    el.className = 'cluster-pin';
    const inner = document.createElement('div');
    inner.className = 'cluster-pin-inner';
    const img = document.createElement('img');
    img.src = PIN_CLUSTER_URL;
    img.width = PIN_CLUSTER_W;
    img.height = PIN_CLUSTER_H;
    img.draggable = false;
    inner.appendChild(img);
    const countEl = document.createElement('span');
    countEl.className = 'cluster-count';
    countEl.textContent = count;
    inner.appendChild(countEl);
    el.appendChild(inner);
    return el;
  }

  // Tapping a cluster enlarges its pin and opens the cluster sheet listing
  // every venue inside it (instead of zooming to expand). The pin stays
  // enlarged (.is-tapped) until the sheet closes — see openClusterSheet /
  // closeClusterSheet below.
  function animateClusterTap(el, lngLat, clusterId) {
    const src = map.getSource(CLUSTER_SOURCE_ID);
    if (!src) return;
    // Pop immediately for tactile feedback; openClusterSheet keeps it enlarged.
    el.classList.add('is-tapped');
    // getClusterLeaves returns the original point features (each carries the
    // `idx` we stamped in pinsToGeoJSON), which maps back to currentPins.
    src.getClusterLeaves(clusterId, 1000, 0, (err, leaves) => {
      if (err || !leaves) { el.classList.remove('is-tapped'); return; }
      const idxs = leaves
        .map(f => (f.properties ? f.properties.idx : null))
        .filter(i => i != null && currentPins[i]);
      if (!idxs.length) { el.classList.remove('is-tapped'); return; }
      openClusterSheet(el, idxs);
    });
  }

  function syncClusterMarkers() {
    if (!map.getSource(CLUSTER_SOURCE_ID)) return;
    const clusters = map.querySourceFeatures(CLUSTER_SOURCE_ID, {
      filter: ['has', 'point_count']
    });
    const seen = new Set();
    clusters.forEach(c => {
      const id = c.properties.cluster_id;
      // querySourceFeatures can yield duplicates across tile boundaries
      // — guard so we don't try to create two markers for the same id.
      if (seen.has(id)) return;
      seen.add(id);
      let marker = clusterMarkers.get(id);
      const countText = c.properties.point_count_abbreviated;
      if (!marker) {
        const el = createClusterElement(countText);
        marker = new mapboxgl.Marker({ element: el })
          .setLngLat(c.geometry.coordinates)
          .addTo(map);
        el.addEventListener('click', e => {
          e.stopPropagation();
          if (wasDragging) return;
          // Use the live lng/lat off the marker (may have shifted since
          // the click handler was first wired) rather than the stale
          // closure over c.geometry.coordinates.
          animateClusterTap(el, marker.getLngLat(), id);
        });
        clusterMarkers.set(id, marker);
      } else {
        // Update count in place if it shifted (e.g., features arrived
        // late) and refresh the geographic center.
        const countEl = marker.getElement().querySelector('.cluster-count');
        if (countEl && String(countEl.textContent) !== String(countText)) {
          countEl.textContent = countText;
        }
        marker.setLngLat(c.geometry.coordinates);
      }
    });
    // Remove markers whose cluster_id no longer exists at this zoom.
    clusterMarkers.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        clusterMarkers.delete(id);
      }
    });
  }

  function syncMarkerVisibility() {
    if (!map.getSource(CLUSTER_SOURCE_ID)) return;
    const unclustered = map.querySourceFeatures(CLUSTER_SOURCE_ID, {
      filter: ['!', ['has', 'point_count']]
    });

    // Defensive: when the cluster worker is mid-rebuild, querySourceFeatures
    // can return [] even though we have pins in currentPins. Without this
    // guard, the sync would hide EVERY marker (the brief flash the user
    // sees on refresh / dev-tools open). Keep the current display state and
    // wait for the next event when the index is stable.
    if (currentPins.length > 0 && !unclustered.length && clusterMarkers.size === 0) return;

    const visibleIdxs = new Set();
    unclustered.forEach(f => visibleIdxs.add(f.properties.idx));

    // HTML cluster markers ARE the cluster bubbles, but DOM-sibling order
    // alone doesn't guarantee stacking — so we also hide any individual
    // pin marker whose red bubble would overlap a cluster's red bubble.
    // ("cluster appears in front" — same intent as before, source of
    // truth is now the live cluster marker set.)
    const clusterBubbles = [];
    clusterMarkers.forEach(m => {
      const p = map.project(m.getLngLat());
      clusterBubbles.push({ x: p.x, y: p.y + CLUSTER_BUBBLE_OFFSET_Y });
    });

    pinMarkers.forEach((m, i) => {
      let show = visibleIdxs.has(i);
      if (show && clusterBubbles.length) {
        const p = map.project(m.getLngLat());
        const bx = p.x, by = p.y + PIN_BUBBLE_OFFSET_Y;
        for (let c of clusterBubbles) {
          const dx = c.x - bx, dy = c.y - by;
          if (Math.sqrt(dx * dx + dy * dy) < BUBBLE_OVERLAP_R) {
            show = false;
            break;
          }
        }
      }
      m.getElement().style.display = show ? '' : 'none';
    });
  }

  // Rasterize an SVG (loaded via URL) into a Mapbox-compatible image and
  // register it under `name`. Renders at 2x pixel ratio so the icon stays
  // crisp on retina displays. No-op if already registered.
  function loadSvgAsMapImage(name, url, w, h) {
    if (map.hasImage(name)) return;
    const img = new Image(w, h);
    img.onload = () => {
      if (map.hasImage(name)) return;
      const pr = 2;
      const c = document.createElement('canvas');
      c.width = w * pr;
      c.height = h * pr;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      map.addImage(name, data, { pixelRatio: pr });
      // Force a redraw so any symbol layer waiting on this icon paints
      // immediately instead of after the next mapbox tick.
      if (map.getLayer(CLUSTER_LAYER_ID)) map.triggerRepaint();
    };
    img.src = url;
  }

  function initClusterLayer() {
    if (map.getSource(CLUSTER_SOURCE_ID)) return;
    map.addSource(CLUSTER_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 14, // pins individualize at zoom > 14
      clusterRadius: 40   // tighter net → most pins stay individual; only very
                          // dense areas form clusters
    });
    // Cluster bubbles are HTML markers (see `syncClusterMarkers`) so the
    // count can render in DM Sans (Mapbox glyph fonts don't include our
    // app fonts) and the bubble can scale up on tap via CSS. We still
    // need ONE layer referencing the clustered source though, otherwise
    // Mapbox's tile worker treats the source as unused and skips the
    // clustering pass entirely — `querySourceFeatures` would return only
    // singletons and `syncClusterMarkers` would find nothing to render.
    // This invisible circle layer is a no-op visually but keeps the
    // worker active.
    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-radius': 1,
        'circle-opacity': 0
      }
    });
    // Sync HTML cluster markers + individual-pin visibility whenever the
    // tile state settles.
    // - `idle` is the most reliable signal — fires only after all tile
    //   workers (including the clustering supercluster pass) have settled.
    //   Without this the FIRST sync after initial data fetch fires too
    //   early: `sourcedata` reports the source as loaded, but
    //   `querySourceFeatures` still returns an empty set, so every pin
    //   marker would be hidden until the user pans.
    // - `moveend` is kept for snappier feedback while panning (idle waits
    //   for tile loads, which can lag a beat behind the pan settling).
    // Cluster markers must sync BEFORE pin visibility — pin visibility
    // reads from `clusterMarkers` to compute its overlap-hide list.
    function syncAll() {
      syncClusterMarkers();
      syncMarkerVisibility();
    }
    map.on('idle', syncAll);
    map.on('moveend', syncAll);
  }

  const VENUE_PIN_SVG = '<svg width="58" height="62" viewBox="0 0 58 62" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#filter0_d_4995_23746)"><path d="M42 23C42 30.1797 36.1797 36 29 36C21.8203 36 16 30.1797 16 23C16 15.8203 21.8203 10 29 10C36.1797 10 42 15.8203 42 23Z" fill="white"/><path d="M27.1274 38.7907C27.8453 39.7676 29.3048 39.7676 30.0227 38.7907L37.3637 28.8003C38.2355 27.6139 37.3883 25.9401 35.9161 25.9401H21.2341C19.7618 25.9401 18.9146 27.6139 19.7864 28.8003L27.1274 38.7907Z" fill="white"/><circle cx="29" cy="23" r="10" fill="url(#paint0_linear_4995_23746)"/><circle cx="29" cy="23" r="3" fill="white"/></g><defs><filter id="filter0_d_4995_23746" x="0" y="0" width="58" height="61.5234" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset dy="6"/><feGaussianBlur stdDeviation="8"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.14 0"/><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4995_23746"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_4995_23746" result="shape"/></filter><linearGradient id="paint0_linear_4995_23746" x1="29" y1="13" x2="29" y2="33" gradientUnits="userSpaceOnUse"><stop stop-color="#FF5858"/><stop offset="1" stop-color="#E10E0E"/></linearGradient></defs></svg>';

  // Pin / cluster artwork (Figma-exported). Same family — clusters are the
  // larger version with room for a count overlay; default is for individual
  // venues. Both include their own drop shadow inside the SVG so there's no
  // separate shadow layer in the map.
  const PIN_DEFAULT_URL = 'figma-screens/pin-default.svg';
  const PIN_CLUSTER_URL = 'figma-screens/pin-cluster.svg';
  // Natural intrinsic sizes (must match the SVG width/height attributes).
  // Canvases were padded out from the original Figma exports (37×48 / 52×59)
  // so the heavy drop-shadow blur has room to fall off without clipping at
  // the canvas edge. Artwork is translated inside the padded canvas.
  const PIN_DEFAULT_W = 64, PIN_DEFAULT_H = 64;
  const PIN_CLUSTER_W = 80, PIN_CLUSTER_H = 80;

  function createPinElement() {
    // Each marker uses an <img> (not inline SVG) so the SVG's filter IDs
    // are scoped to the standalone image document — multiple inline copies
    // would otherwise collide on `filter0_d_*` IDs and render incorrectly.
    const el = document.createElement('div');
    el.className = 'playlist-pin';
    const img = document.createElement('img');
    img.src = PIN_DEFAULT_URL;
    img.width = PIN_DEFAULT_W;
    img.height = PIN_DEFAULT_H;
    img.draggable = false;
    el.appendChild(img);
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
    'JetSet Pilates': 'Modern Pilates studio with top-of-the-line equipment and expert instructors helping you build long, lean muscle through controlled movement.',
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

  function buildVenueCardHTML(pin, i, search, location) {
      const rawTags = search || pin.category || STUDIO_TAGS[pin.name] || 'Fitness';
      const tags = formatTag(rawTags);
      const distance = pin.distance != null ? (pin.distance / 1609.34).toFixed(1) : (0.1 + (i * 0.15)).toFixed(1);
      const rating = getVenueRating(pin, i).toFixed(1);
      const reviews = getVenueReviewCount(pin, i);
      const desc = getVenueDescription(pin.name, tags);
      const venueImgs = pickVenueImages(pin, i);
      const venueImageStyle = venueImgs
        ? ` style="background:url('${venueImgs[0]}') center/cover no-repeat"`
        : '';
      const introBadge = hasVenueIntroOffer(pin)
        ? `<div class="venue-intro-badge"><svg class="pl-icon pl-icon--sm" aria-hidden="true"><use href="#pl-tag"></use></svg><span class="venue-intro-badge-label">Drop in for $25</span></div>`
        : '';
      const locality = pin.neighborhood || pin.locality || '';
      return `<div class="pl-venue-card venue-card" data-venue-index="${i}">
        <div class="pl-venue-card__header venue-header">
          <div class="pl-venue-card__image venue-image"${venueImageStyle}></div>
          <div class="pl-venue-card__info venue-info">
            <div class="pl-venue-card__text venue-info-text">
              <div class="pl-venue-card__headings">
                <div class="pl-venue-card__title venue-title">${pin.name}</div>
                <div class="pl-venue-card__tags venue-tags">${tags}</div>
              </div>
            <div class="pl-venue-card__meta venue-rating"><span class="pl-venue-card__rating"><span class="pl-venue-card__star"><svg class="pl-icon" aria-hidden="true"><use href="#pl-star-fill"></use></svg></span>${rating}<span class="pl-venue-card__reviews venue-rating-reviews">&nbsp;(${reviews})</span></span><span class="pl-venue-card__location venue-rating-distance">${locality ? locality + ' &middot; ' : ''}${distance} mi</span></div>
            </div>
            <div class="pl-btn pl-btn--sm pl-btn--neutral pl-btn--pill venue-action-btn"><span class="pl-btn__icon" aria-hidden="true"><svg class="pl-icon" aria-hidden="true"><use href="#pl-calendar-small"></use></svg></span>Book now</div>
          </div>
        </div>
        ${introBadge}
        <div class="pl-venue-card__desc venue-desc">${desc}</div>
      </div>`;
  }
  function generateVenueCardHTML(pins, search, location) {
    return pins.map((pin, i) => buildVenueCardHTML(pin, i, search, location)).join('');
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
            // If the tap was on the Book now action button, open directly to the schedule tab
            if (e.target.closest('.venue-action-btn') && e.target.closest('.venue-action-btn').textContent.trim().includes('Book now')) {
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
    initClusterLayer();
    initDefaultMap(40.7380, -73.9855, DEFAULT_MAP_ZOOM, 'Manhattan');
    document.querySelectorAll('.map-nav-btn').forEach(b => b.classList.add('active'));
  });

  // Geolocation intentionally disabled — the prototype always boots into
  // the Manhattan default view (see initDefaultMap call above) without
  // prompting the user for their current location.

  // ========== SCREEN MANAGEMENT ==========
  function showScreen(id, animation) {
    const ANIM_CLASSES = ['anim-fade-in', 'anim-fade-out', 'anim-fade-out-behind', 'anim-bg-fade-in', 'anim-bg-fade-out', 'anim-slide-up', 'anim-slide-down', 'anim-screen-fade-in'];
    const previousScreen = currentScreen;
    const previousEl = previousScreen ? document.getElementById(previousScreen) : null;
    const target = document.getElementById(id);
    // The cluster sheet now lives at device-frame level (so it can sit above the
    // tab bar) instead of inside a screen, so it no longer hides automatically
    // when its screen is deactivated — close it explicitly on any navigation.
    closeClusterSheet();
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
      // Search sheet fades in over the persistent #live-map (glass frost, not opaque).
      document.querySelectorAll('.screen').forEach(s => {
        if (s !== previousEl && s !== target) s.classList.remove('active', ...ANIM_CLASSES);
      });
      previousEl.classList.remove('active', ...ANIM_CLASSES);
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

  function focusAtEnd(input) {
    input.focus();
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (_) {}
  }
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
          <svg viewBox="0 0 20 20" fill="none" stroke="var(--pl-neutral-600)" stroke-width="2"><circle cx="8.5" cy="8.5" r="6.5"/><line x1="13.5" y1="13.5" x2="18" y2="18" stroke-linecap="round"/></svg>
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
      div.className = 'pl-chip pl-chip--neutral chip';
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
    focusAtEnd(searchInput);
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.79688 6.64844C8.79688 6.05469 8.9401 5.51562 9.22656 5.03125C9.51302 4.54167 9.89844 4.15104 10.3828 3.85938C10.8672 3.56771 11.4062 3.42188 12 3.42188C12.5938 3.42188 13.1328 3.56771 13.6172 3.85938C14.1016 4.15104 14.487 4.54167 14.7734 5.03125C15.0651 5.51562 15.2109 6.05469 15.2109 6.64844C15.2109 7.13802 15.1094 7.59375 14.9062 8.01562C14.7031 8.43229 14.4271 8.79167 14.0781 9.09375C13.7292 9.39062 13.3307 9.60156 12.8828 9.72656V14.6328C12.8828 15.1328 12.8542 15.5885 12.7969 16C12.7396 16.4062 12.6667 16.7578 12.5781 17.0547C12.4896 17.3516 12.3932 17.5807 12.2891 17.7422C12.1849 17.8984 12.0885 17.9766 12 17.9766C11.9115 17.9766 11.8151 17.8984 11.7109 17.7422C11.612 17.5807 11.5156 17.3516 11.4219 17.0547C11.3333 16.7578 11.2578 16.4062 11.1953 16C11.138 15.5885 11.1094 15.1328 11.1094 14.6328V9.72656C10.6667 9.60156 10.2708 9.39062 9.92188 9.09375C9.57292 8.79167 9.29688 8.43229 9.09375 8.01562C8.89583 7.59375 8.79688 7.13802 8.79688 6.64844ZM11.0938 6.82812C11.3958 6.82812 11.6536 6.71875 11.8672 6.5C12.0859 6.28125 12.1953 6.02344 12.1953 5.72656C12.1953 5.42969 12.0859 5.17448 11.8672 4.96094C11.6536 4.74219 11.3958 4.63281 11.0938 4.63281C10.8021 4.63281 10.5469 4.74219 10.3281 4.96094C10.1094 5.17448 10 5.42969 10 5.72656C10 6.02344 10.1094 6.28125 10.3281 6.5C10.5469 6.71875 10.8021 6.82812 11.0938 6.82812ZM12 21.1875C10.7188 21.1875 9.56771 21.0885 8.54688 20.8906C7.53125 20.6979 6.66406 20.4271 5.94531 20.0781C5.23177 19.7344 4.6849 19.3359 4.30469 18.8828C3.92969 18.4349 3.74219 17.9557 3.74219 17.4453C3.74219 17.0182 3.85938 16.6224 4.09375 16.2578C4.32812 15.8932 4.64583 15.5651 5.04688 15.2734C5.44792 14.9766 5.90625 14.7214 6.42188 14.5078C6.9375 14.2891 7.47917 14.1146 8.04688 13.9844C8.61979 13.8542 9.1849 13.776 9.74219 13.75V15.2969C9.27865 15.3229 8.80469 15.3906 8.32031 15.5C7.84115 15.6094 7.39844 15.7526 6.99219 15.9297C6.59115 16.1068 6.26823 16.3125 6.02344 16.5469C5.77865 16.7812 5.65625 17.0339 5.65625 17.3047C5.65625 17.6432 5.8125 17.9505 6.125 18.2266C6.4375 18.5078 6.8776 18.7474 7.44531 18.9453C8.01302 19.1432 8.68229 19.2969 9.45312 19.4062C10.2292 19.5208 11.0781 19.5781 12 19.5781C12.9167 19.5781 13.7604 19.5208 14.5312 19.4062C15.3073 19.2969 15.9792 19.1406 16.5469 18.9375C17.1146 18.7396 17.5547 18.5026 17.8672 18.2266C18.1849 17.9505 18.3438 17.6432 18.3438 17.3047C18.3438 17.0339 18.2188 16.7812 17.9688 16.5469C17.7188 16.3125 17.3932 16.1068 16.9922 15.9297C16.5911 15.7526 16.151 15.6094 15.6719 15.5C15.1927 15.3906 14.7161 15.3229 14.2422 15.2969V13.75C14.8047 13.776 15.3698 13.8542 15.9375 13.9844C16.5104 14.1146 17.0547 14.2891 17.5703 14.5078C18.0859 14.7214 18.5443 14.9766 18.9453 15.2734C19.3516 15.5651 19.6693 15.8932 19.8984 16.2578C20.1328 16.6224 20.25 17.0182 20.25 17.4453C20.25 17.9557 20.0599 18.4349 19.6797 18.8828C19.3047 19.3359 18.7604 19.7344 18.0469 20.0781C17.3333 20.4271 16.4661 20.6979 15.4453 20.8906C14.4297 21.0885 13.2812 21.1875 12 21.1875Z" fill="var(--pl-neutral-600)"/></svg>
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
      div.className = 'pl-chip pl-chip--neutral chip';
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
    focusAtEnd(locationInput);
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
    setTimeout(() => focusAtEnd(searchInput), 300);
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
    setTimeout(() => focusAtEnd(searchInput), 300);
  });

  // Location results → unified search screen, location tab
  document.getElementById('hotspot-search-locresults').addEventListener('click', () => {
    returnScreen = 'screen-location-results';
    searchOpenedFromDefault = false;
    locationInput.value = (locationTerm && locationTerm !== 'Current location') ? locationTerm : '';
    setActiveTab('location');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => { focusAtEnd(locationInput); updateLocationUI(); }, 150);
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
    setTimeout(() => focusAtEnd(searchInput), 300);
  });

  // Search tab hotspots
  document.getElementById('hotspot-search-tab').addEventListener('click', () => {
    searchInput.value = '';
    updateSearchUI();
    setActiveTab('search');
    searchThisAreaBtn.classList.remove('visible');
    showScreen('screen-search-focused', 'fade-in');
    setTimeout(() => focusAtEnd(searchInput), 300);
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
      focusAtEnd(searchInput);
    } else {
      locationContent.classList.remove('hidden');
      searchContent.classList.add('hidden');
      focusAtEnd(locationInput);
      updateLocationUI();
    }
  }

  searchInput.addEventListener('focus', () => {
    if (activeTab !== 'search') setActiveTab('search');
  });

  locationInput.addEventListener('focus', () => {
    if (activeTab !== 'location') setActiveTab('location');
  });

  // ========== DRAG-TO-SCROLL (desktop only) ==========
  // Lets the mouse pan a scrollable region like a finger on touch. Click-only
  // interactions (chips, autocomplete rows) still work — we only treat motion
  // beyond a small threshold as a drag and suppress the trailing click.
  function enableDragScroll(el) {
    if (!el) return;
    let down = false, startY = 0, startScroll = 0, moved = false;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input, textarea, button, .key, .keyboard')) return;
      down = true;
      moved = false;
      startY = e.clientY;
      startScroll = el.scrollTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!down) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > 4) moved = true;
      if (moved) el.scrollTop = startScroll - dy;
    });
    document.addEventListener('mouseup', () => { down = false; });
    el.addEventListener('click', (e) => {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);
  }
  enableDragScroll(document.getElementById('search-tab-content'));
  enableDragScroll(document.getElementById('location-tab-content'));

  // Show scrollbar only while scrolling, then fade out
  function enableAutoHideScrollbar(el, idleMs = 500) {
    if (!el) return;
    let timer = null;
    el.addEventListener('scroll', () => {
      el.classList.add('is-scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('is-scrolling'), idleMs);
    }, { passive: true });
  }
  enableAutoHideScrollbar(document.getElementById('search-tab-content'));
  enableAutoHideScrollbar(document.getElementById('location-tab-content'));

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

  // ========== CLUSTER SHEET ==========
  // A standalone draggable sheet listing every venue inside a tapped cluster.
  // Mirrors the search results sheet: default ~half-open, drag up to expand to
  // 16px below the search bar (list scrolls under the header), drag down from
  // default to dismiss. Transform is driven inline from here.
  const clusterSheet = document.getElementById('cluster-sheet');
  const clusterListEl = document.getElementById('cluster-sheet-list');
  const clusterTitleEl = document.getElementById('cluster-sheet-title');
  const clusterCloseBtn = document.getElementById('cluster-sheet-close');
  // Y positions match .results-sheet: 0 = default, -266 = expanded (top 126px),
  // 760 = fully off the bottom (hidden).
  const CLUSTER_DEFAULT_Y = 0;
  const CLUSTER_EXPANDED_Y = -266;
  const CLUSTER_HIDDEN_Y = 760;
  const CLUSTER_SNAP = 60;
  let clusterSheetState = 'hidden'; // 'hidden' | 'default' | 'expanded'
  let clusterCurrentY = CLUSTER_HIDDEN_Y;
  let activeClusterEl = null; // the enlarged .cluster-pin element

  function setClusterY(y, animate) {
    clusterCurrentY = y;
    clusterSheet.style.transition = animate ? '' : 'none';
    clusterSheet.style.transform = `translateY(${y}px)`;
  }

  function openClusterSheet(el, idxs) {
    // Build cards using the real currentPins indices so ratings/images match
    // the main list and data-venue-index drives openVenueDetail correctly.
    clusterListEl.innerHTML = idxs
      .map(idx => buildVenueCardHTML(currentPins[idx], idx, currentSearchLabel, currentLocationLabel))
      .join('');
    clusterListEl.scrollTop = 0;
    clusterTitleEl.textContent = idxs.length + (idxs.length === 1 ? ' Place' : ' Places');
    clusterListEl.querySelectorAll('.venue-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', function(e) {
        if (wasDragging) return;
        const idx = parseInt(this.dataset.venueIndex, 10);
        const bookBtn = e.target.closest('.venue-action-btn');
        const isBook = bookBtn && bookBtn.textContent.trim().includes('Book now');
        // Leave the cluster sheet open underneath — the venue detail (z-index
        // 32) opens on top of it (z-index 31), and closing the detail reveals
        // the cluster sheet again.
        if (isBook) openVenueDetail(idx, 'schedule');
        else openVenueDetail(idx);
      });
    });
    // Keep the tapped cluster pin enlarged until the sheet closes.
    if (activeClusterEl && activeClusterEl !== el) activeClusterEl.classList.remove('is-tapped');
    activeClusterEl = el;
    el.classList.add('is-tapped');
    // Keep the sheet at device-frame level (where it lives in the HTML) so its
    // z-index can sit above the tab bar + "Search this area" button. Re-parenting
    // into the active screen would trap it inside that screen's z-index:1
    // stacking context, below the device-level tab bar.
    clusterSheet.setAttribute('aria-hidden', 'false');
    clusterSheet.classList.add('is-open');
    clusterSheet.classList.remove('is-expanded');
    // Snap to the hidden position without animation, force a reflow, then
    // animate up to the default position.
    setClusterY(CLUSTER_HIDDEN_Y, false);
    void clusterSheet.offsetHeight;
    setClusterY(CLUSTER_DEFAULT_Y, true);
    clusterSheetState = 'default';
  }

  function closeClusterSheet() {
    if (clusterSheetState === 'hidden') return;
    clusterSheetState = 'hidden';
    clusterSheet.classList.remove('is-expanded');
    setClusterY(CLUSTER_HIDDEN_Y, true);
    if (activeClusterEl) { activeClusterEl.classList.remove('is-tapped'); activeClusterEl = null; }
    const done = (ev) => {
      if (ev.target !== clusterSheet || ev.propertyName !== 'transform') return;
      if (clusterSheetState === 'hidden') {
        clusterSheet.classList.remove('is-open');
        clusterSheet.setAttribute('aria-hidden', 'true');
      }
      clusterSheet.removeEventListener('transitionend', done);
    };
    clusterSheet.addEventListener('transitionend', done);
  }

  clusterCloseBtn.addEventListener('click', e => { e.stopPropagation(); closeClusterSheet(); });
  // Panning/zooming the map dismisses the cluster sheet (its venues are tied
  // to that map view), matching how map drags collapse the results sheet.
  map.on('dragstart', closeClusterSheet);
  map.on('zoomstart', e => { if (e.originalEvent) closeClusterSheet(); });

  (function wireClusterDrag() {
    let dragging = false;
    let startY = 0;
    let startOffset = 0;

    function shouldDrag(e) {
      const fromList = e.target.closest('.cluster-sheet-list');
      if (!fromList) return true;
      if (clusterSheetState !== 'expanded') return true; // list not scrollable yet
      return fromList.scrollTop <= 0; // expanded: only drag when at top
    }

    function dragStart(clientY) {
      dragging = true;
      startY = clientY;
      startOffset = clusterCurrentY;
      setClusterY(clusterCurrentY, false);
    }

    function dragMove(clientY) {
      if (!dragging) return;
      const delta = clientY - startY;
      const y = Math.max(CLUSTER_EXPANDED_Y, Math.min(CLUSTER_HIDDEN_Y, startOffset + delta));
      setClusterY(y, false);
    }

    function dragEnd(clientY) {
      if (!dragging) return;
      dragging = false;
      const delta = clientY - startY;
      if (Math.abs(delta) >= 10) { wasDragging = true; setTimeout(() => { wasDragging = false; }, 0); }
      if (delta > CLUSTER_SNAP && clusterSheetState !== 'expanded') {
        // Dragged down from default → dismiss.
        closeClusterSheet();
        return;
      }
      let target;
      if (delta < -CLUSTER_SNAP) {
        target = CLUSTER_EXPANDED_Y; // dragged up → expand
      } else if (delta > CLUSTER_SNAP) {
        target = CLUSTER_DEFAULT_Y; // expanded dragged down → default
      } else {
        target = clusterSheetState === 'expanded' ? CLUSTER_EXPANDED_Y : CLUSTER_DEFAULT_Y;
      }
      setClusterY(target, true);
      clusterSheetState = target === CLUSTER_EXPANDED_Y ? 'expanded' : 'default';
      clusterSheet.classList.toggle('is-expanded', clusterSheetState === 'expanded');
      if (clusterSheetState !== 'expanded') clusterListEl.scrollTop = 0;
    }

    clusterSheet.addEventListener('touchstart', e => {
      if (!shouldDrag(e)) return;
      dragStart(e.touches[0].clientY);
    }, { passive: true });
    clusterSheet.addEventListener('touchmove', e => { dragMove(e.touches[0].clientY); }, { passive: true });
    clusterSheet.addEventListener('touchend', e => { dragEnd(e.changedTouches[0].clientY); });

    clusterSheet.addEventListener('mousedown', e => {
      if (!shouldDrag(e)) return;
      dragStart(e.clientY);
      const onMove = ev => dragMove(ev.clientY);
      const onUp = ev => {
        dragEnd(ev.clientY);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Trackpad/wheel: while half-open the list doesn't scroll (overflow-y:hidden),
    // so scrolling up drags the sheet up to expanded — then the content scrolls
    // natively. Scrolling back up at the top of the expanded list does NOT
    // collapse the sheet; it just sits at the top (collapse only via drag-down,
    // the X, or panning the map).
    function snapClusterTo(state) {
      const target = state === 'expanded' ? CLUSTER_EXPANDED_Y : CLUSTER_DEFAULT_Y;
      setClusterY(target, true);
      clusterSheetState = state;
      clusterSheet.classList.toggle('is-expanded', state === 'expanded');
      if (state !== 'expanded') clusterListEl.scrollTop = 0;
    }
    clusterListEl.addEventListener('wheel', e => {
      if (clusterSheetState === 'default' && e.deltaY > 0) {
        snapClusterTo('expanded');
      }
    }, { passive: true });
  })();

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

  // "See full schedule" floating CTA: absolutely positioned at the bottom of
  // the venue-detail sheet (see CSS). No scroll-tracking needed — click
  // handler is wired further down with the other tab-switch buttons.

  // ========== CLASS DETAIL (sub-pane inside the venue sheet) ==========
  // Class detail no longer has its own modal/sheet — its scroll container
  // lives inside .vd-pane-stack as a sibling of .venue-detail-scroll. The
  // sheet toggles `.show-class` to slide it in from the right while the
  // venue pane drifts left underneath, and to crossfade the X/back icons
  // and titles in the shared sticky nav.
  const classDetailScroll = document.getElementById('class-detail-scroll');
  // Alias kept so legacy code that still queries from the "class detail
  // root" continues to work — points at the scroll element since that's
  // what now wraps all class-detail markup.
  const classDetailEl = classDetailScroll;
  const cdBookingBar = document.getElementById('cd-booking-bar');

  // Motion.js helpers — iOS-like spring configs.
  // Motion's UMD bundle recognizes `type: "spring"` as a string literal, NOT
  // a function reference (internally it checks `type === "spring"`). Using
  // the function form silently falls through to a slow default tween.
  var motionAnimate = window.Motion && window.Motion.animate;
  // iOS sheet spring: slightly underdamped for that bouncy feel
  var iosSheetSpring = { type: 'spring', stiffness: 400, damping: 35 };
  // iOS snap-back spring: stiffer for quick snap
  var iosSnapSpring = { type: 'spring', stiffness: 1400, damping: 45 };

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

  function openVenueDetail(index, initialTab, opts) {
    const pin = currentPins[index];
    if (!pin) return;
    var fromBookings = !!(opts && opts.fromBookings);
    window.__currentVenuePin = pin;
    window.__currentVenueIndex = index;
    window.__currentVenueHasIntroOffer = hasVenueIntroOffer(pin);
    // Re-render the Schedule tab so prices reflect this venue's intro-offer flag
    if (window.__renderVdSchedule) window.__renderVdSchedule();
    // Render the Overview's "Available today" list from the same generated
    // classes so it matches the Schedule tab.
    if (window.__renderVdAvailableToday) window.__renderVdAvailableToday();
    // Toggle the Overview intro-offer promo card based on this venue's flag
    const promoEl = document.getElementById('vd-section-promo');
    if (promoEl) promoEl.style.display = hasVenueIntroOffer(pin) ? '' : 'none';

    const search = currentSearchLabel;
    const rawTags = search || pin.category || STUDIO_TAGS[pin.name] || 'Fitness';
    const tags = formatTag(rawTags);
    const distance = pin.distance != null ? (pin.distance / 1609.34).toFixed(1) : (0.1 + (index * 0.15)).toFixed(1);
    const rating = getVenueRating(pin, index).toFixed(1);
    const reviews = getVenueReviewCount(pin, index);
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
    var starsPreviewEl = document.getElementById('vd-stars');
    if (ratingBigEl) ratingBigEl.textContent = rating;
    if (reviewsCountEl) reviewsCountEl.textContent = '(' + reviews + ')';
    if (starsPreviewEl) {
      starsPreviewEl.innerHTML = window.__plRatingStarsHtml(rating);
      starsPreviewEl.setAttribute('aria-label', rating + ' out of 5');
    }

    // Venue header image carousel — 3 photos per venue, drawn from
    // STUDIO_IMAGES via deterministic per-name hash. Falls back to the CSS
    // grey placeholder for venues whose category has no image folder.
    var vdImageEls = document.querySelectorAll('#vd-section-images .vd-image-placeholder');
    var vdTriple = pickVenueImages(pin, index);
    for (var vi = 0; vi < vdImageEls.length; vi++) {
      setVenuePhotoBg(vdImageEls[vi], vdTriple ? vdTriple[vi] : null);
    }

    // Static map thumbnail
    const mapThumb = document.getElementById('vd-map-thumb');
    if (pin.lat && pin.lng && window.MAPBOX_TOKEN) {
      const staticUrl = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/'
        + pin.lng + ',' + pin.lat + ',14,0/353x204@2x?access_token=' + MAPBOX_TOKEN;
      mapThumb.style.backgroundImage = 'url(' + staticUrl + ')';
      mapThumb.style.backgroundSize = 'cover';
      mapThumb.style.backgroundPosition = 'center';
    }
    // Amenities — Mats + Towels for all venues, Showers for some.
    var vdAmenities = ['Mats', 'Towels'];
    if (venueHasShowers(pin)) vdAmenities.push('Showers');
    renderAmenities('vd-amenities', vdAmenities, 'vd-amenity-pill');

    // Address footer under the map thumbnail
    const addressEl = document.getElementById('vd-map-address');
    if (addressEl) {
      const parts = [];
      if (pin.address) parts.push(pin.address);
      if (pin.locality) parts.push(pin.locality + ', NY');
      addressEl.textContent = parts.length ? parts.join(', ') : neighborhood + ', NY';
    }

    var vdStickyTitleEl = document.getElementById('vd-sticky-title');
    vdStickyTitleEl.textContent = pin.name;
    fitStickyTitle(vdStickyTitleEl);
    document.getElementById('vd-sticky-nav').classList.remove('scrolled');
    var vdVenueBg = document.getElementById('vd-pane-nav-bg-venue');
    if (vdVenueBg) vdVenueBg.classList.remove('scrolled');

    // Populate reviews panel with this venue's rating
    if (window.__renderReviewsPanel) {
      window.__renderReviewsPanel(rating, reviews);
    }

    venueDetailScroll.scrollTop = 0;
    venueDetailScroll.scrollLeft = 0;
    venueDetailEl.querySelectorAll('.vd-hscroll').forEach(function(s) { s.scrollLeft = 0; });
    // Reset the sheet to the venue pane (in case a prior session left the
    // class pane visible — e.g. dismissed mid-class-detail). Opening from
    // Bookings starts on the class pane so the sheet rises as class detail
    // with no horizontal push, over a checkout-style scrim.
    venueDetailSheet.classList.toggle('from-bookings', fromBookings);
    venueDetailSheet.classList.toggle('show-class', fromBookings);
    venueDetailEl.classList.toggle('from-bookings', fromBookings);
    classDetailOpen = fromBookings;
    if (fromBookings) void classDetailScroll.offsetWidth;
    if (motionAnimate) venueDetailSheet.getAnimations().forEach(function(a) { a.cancel(); });
    venueDetailEl.style.background = '';
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
          window.__vdPinOffset = tabsRect.top - scrollRect.top - 80;
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

  function resetVenueDetailPanes() {
    venueDetailSheet.classList.remove('show-class', 'from-bookings');
  }

  function closeVenueDetail() {
    var fromBookings = venueDetailSheet.classList.contains('from-bookings');
    venueDetailOpen = false;
    classDetailOpen = false;
    // Keep .from-bookings on the sheet during dismiss so the class pane
    // doesn't slide sideways while the modal drops. Scrim fades with
    // .venue-detail-visible.
    if (!fromBookings) resetVenueDetailPanes();
    venueDetailEl.style.background = '';
    venueDetailEl.classList.remove('venue-detail-visible', 'from-bookings');
    if (typeof window.__hideBookingBar === 'function') window.__hideBookingBar();
    // Get the sheet height so we can animate to a pixel value (avoids % vs px mismatch)
    var sheetHeight = venueDetailSheet.offsetHeight;
    if (motionAnimate) {
      motionAnimate(venueDetailSheet, { transform: 'translateY(' + sheetHeight + 'px)' }, { duration: 0.25, easing: 'cubic-bezier(.25, .46, .45, .94)' }).then(function() {
        venueDetailSheet.style.transform = '';
        venueDetailSheet.style.visibility = '';
        resetVenueDetailPanes();
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
        resetVenueDetailPanes();
      }, { once: true });
    }
  }

  // Close button
  document.getElementById('venue-detail-close').addEventListener('click', closeVenueDetail);

  // Tapping the dimmed Bookings peek (same as checkout scrim) dismisses.
  venueDetailEl.addEventListener('click', function (e) {
    if (e.target !== venueDetailEl) return;
    if (venueDetailEl.classList.contains('from-bookings')) closeVenueDetail();
  });

  // ========== BOOKINGS TAB ==========
  function tabBarLabel(item) {
    var spans = item.querySelectorAll('span');
    return spans.length ? spans[spans.length - 1].textContent.trim() : item.textContent.trim();
  }

  function setBottomTab(name) {
    document.querySelectorAll('.pl-tab-bar .tab-item').forEach(function (item) {
      item.classList.toggle('is-selected', tabBarLabel(item) === name);
    });
  }

  var BOOKINGS_MAP_PREVIEW = '../assets/map_bookings.png';
  window.__reservations = window.__reservations || [];

  function reservationIdentity(r) {
    if (!r) return '';
    return [r.venueKey || '', r.classTitle || '', r.slotTime || '', String(r.absIdx || 0)].join('|');
  }

  function getReservations() {
    return window.__reservations || [];
  }

  window.__addReservation = function (purchased) {
    if (!purchased) return;
    if (!window.__reservations) window.__reservations = [];
    var key = reservationIdentity(purchased);
    var i;
    for (i = 0; i < window.__reservations.length; i++) {
      if (reservationIdentity(window.__reservations[i]) === key) {
        window.__reservations[i] = purchased;
        window.__reservation = purchased;
        return;
      }
    }
    window.__reservations.push(purchased);
    window.__reservation = purchased;
  };

  window.__removeReservation = function (r) {
    if (!window.__reservations) window.__reservations = [];
    if (r) {
      var key = reservationIdentity(r);
      window.__reservations = window.__reservations.filter(function (item) {
        return reservationIdentity(item) !== key;
      });
    }
    window.__reservation = window.__reservations[window.__reservations.length - 1] || null;
  };

  function setBookingsCardMap(img, lat, lng) {
    if (!img) return;
    if (lat && lng && window.MAPBOX_TOKEN) {
      img.src = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/'
        + lng + ',' + lat + ',15,0/334x132@2x?access_token=' + MAPBOX_TOKEN;
    } else {
      img.src = BOOKINGS_MAP_PREVIEW;
    }
  }

  function setBookingsCardThumb(img, url) {
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  }

  function bookingsDateParts(absIdx) {
    var d = new Date();
    d.setDate(d.getDate() + (absIdx || 0));
    var wds = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var mos = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      weekday: wds[d.getDay()],
      day: String(d.getDate()),
      month: mos[d.getMonth()],
      metaDate: mos[d.getMonth()] + ' ' + d.getDate()
    };
  }

  function bookingCardVenueLine(r) {
    var venueName = r.venueTitle || r.venueName || '';
    var hood = r.neighborhood || r.locality || '';
    if (hood && venueName && venueName.indexOf(hood) === -1) {
      return venueName + ' · ' + hood;
    }
    return venueName ? venueName.replace(' - ', ' · ') : '';
  }

  function fillBookingsCard(card, r) {
    var date = bookingsDateParts(r.absIdx);
    var instructor = (r.instructor || '').replace(/\s+/g, ' ').trim();
    var time = r.slotTime || '';
    var meta = date.metaDate
      + (time ? ' · ' + time : '')
      + (instructor ? ' · ' + instructor : '');
    var set = function (sel, text) {
      var el = card.querySelector(sel);
      if (el) el.textContent = text;
    };
    set('.pl-booking-card__weekday', date.weekday);
    set('.pl-booking-card__day', date.day);
    set('.pl-booking-card__month', date.month);
    set('.pl-booking-card__title', r.classTitle || '');
    set('.pl-booking-card__meta', meta);
    set('.pl-booking-card__venue', bookingCardVenueLine(r));
    setBookingsCardMap(card.querySelector('.pl-booking-card__map-img'), r.lat, r.lng);
    var thumb = r.imageUrl;
    if (!thumb) {
      var triple = pickVenueImages({
        name: r.venueTitle || r.venueName,
        lat: r.lat,
        lng: r.lng,
        category: r.category,
        _resolvedImageCategory: r.category
      }, r.venueIndex);
      thumb = triple ? triple[0] : null;
    }
    setBookingsCardThumb(card.querySelector('.pl-booking-card__pin-thumb'), thumb);
  }

  function syncBookingsCard() {
    var list = document.getElementById('bookings-list');
    var tpl = document.getElementById('bookings-card-template');
    if (!list || !tpl) return;
    list.innerHTML = '';
    var reservations = getReservations().slice().sort(function (a, b) {
      var da = a.absIdx || 0;
      var db = b.absIdx || 0;
      if (da !== db) return da - db;
      return (a.slotTime || '').localeCompare(b.slotTime || '');
    });
    reservations.forEach(function (r) {
      var card = tpl.content.firstElementChild.cloneNode(true);
      card.dataset.reservationKey = reservationIdentity(r);
      fillBookingsCard(card, r);
      list.appendChild(card);
    });
  }

  function setBookingsEmptyCopy(tab) {
    var subtitle = document.getElementById('bookings-empty-subtitle');
    if (!subtitle) return;
    subtitle.textContent = tab === 'attended'
      ? 'You have no past reservations'
      : 'You have no upcoming reservations';
  }

  function setBookingsSection(tab) {
    var upcoming = tab !== 'attended';
    var hasUpcoming = getReservations().length > 0;
    var showList = upcoming && hasUpcoming;
    var list = document.getElementById('bookings-list');
    var empty = document.getElementById('bookings-empty');
    if (list) list.hidden = !showList;
    if (empty) empty.hidden = showList;
    setBookingsEmptyCopy(tab);
  }

  function resetBookingsSectionTabs() {
    var tabs = document.querySelectorAll('#bookings-section-tabs .pl-tab-nav__item');
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-bookings-tab') === 'upcoming';
      tab.classList.toggle('is-selected', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    syncBookingsCard();
    setBookingsSection('upcoming');
  }

  function openBookingsTab() {
    if (venueDetailOpen) closeVenueDetail();
    resetBookingsSectionTabs();
    setBottomTab('Bookings');
    if (currentScreen !== 'screen-bookings') showScreen('screen-bookings');
  }

  window.__syncBookingsCard = function () {
    syncBookingsCard();
    var selected = document.querySelector('#bookings-section-tabs .pl-tab-nav__item.is-selected');
    setBookingsSection(selected ? selected.getAttribute('data-bookings-tab') : 'upcoming');
  };

  function openSearchTab() {
    if (venueDetailOpen) closeVenueDetail();
    setBottomTab('Search');
    // From Bookings (or any non-map screen) land on the Search tab's map.
    // Don't yank the user off a results map they already have open.
    if (!MAP_SCREENS.includes(currentScreen)) showScreen('screen-map-default');
  }

  document.querySelectorAll('.pl-tab-bar').forEach(function (bar) {
    bar.addEventListener('click', function (e) {
      var item = e.target.closest('.tab-item');
      if (!item || !bar.contains(item)) return;
      var label = tabBarLabel(item);
      if (label === 'Bookings') openBookingsTab();
      else if (label === 'Search') openSearchTab();
    });
  });

  document.getElementById('bookings-start-exploring').addEventListener('click', openSearchTab);

  var bookingsSectionTabs = document.getElementById('bookings-section-tabs');
  if (bookingsSectionTabs) {
    bookingsSectionTabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.pl-tab-nav__item');
      if (!tab) return;
      bookingsSectionTabs.querySelectorAll('.pl-tab-nav__item').forEach(function (t) {
        var on = t === tab;
        t.classList.toggle('is-selected', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      setBookingsSection(tab.getAttribute('data-bookings-tab'));
    });
  }

  function pinIndexForReservation(r) {
    var pin = r && (r.pin || {
      name: r.venueTitle || r.venueName,
      lat: r.lat,
      lng: r.lng,
      locality: r.neighborhood || r.locality,
      neighborhood: r.neighborhood,
      category: r.category,
      address: r.address,
      _resolvedNeighborhood: r.neighborhood,
      _resolvedImageCategory: r.category
    });
    if (!pin || !pin.name) return -1;
    var i;
    for (i = 0; i < currentPins.length; i++) {
      if (currentPins[i].name === pin.name && currentPins[i].lat === pin.lat) return i;
    }
    currentPins.unshift(pin);
    return 0;
  }

  function openBookedClassDetail(r) {
    r = r || window.__reservation;
    if (!r || typeof window.__openClassDetail !== 'function') return;
    window.__reservation = r;
    var idx = pinIndexForReservation(r);
    if (idx < 0) return;
    var cls = {
      title: r.classTitle,
      time: r.slotTime || '',
      instructor: r.instructor || '',
      rating: r.rating || '4.9 (250)',
      plainPrice: r.plainPrice || '$35',
      absIdx: r.absIdx || 0,
      imageUrl: r.imageUrl
    };
    openVenueDetail(idx, null, { fromBookings: true });
    var generated = window.__lastGeneratedClasses || [];
    var hasTitle = generated.some(function (c) { return c.title === cls.title; });
    if (!hasTitle) {
      generated.unshift({
        time: (cls.time.split(' · ')[0] || cls.time) + ' · 60 min',
        title: cls.title,
        instructor: cls.instructor,
        rating: cls.rating,
        plainPrice: cls.plainPrice
      });
      window.__lastGeneratedClasses = generated;
    }
    window.__openClassDetail(cls, { alreadyOpen: true });
    var venueEl = document.getElementById('cd-venue-text');
    if (venueEl) {
      var name = r.venueTitle || r.venueName || venueEl.textContent;
      var hood = r.neighborhood || r.locality || '';
      venueEl.textContent = (hood && name.indexOf(hood) === -1) ? (name + ' - ' + hood) : name;
    }
    if (window.__resetClassDetailTabs) window.__resetClassDetailTabs();
  }

  var bookingsList = document.getElementById('bookings-list');
  if (bookingsList) {
    bookingsList.addEventListener('click', function (e) {
      if (e.target.closest('.pl-booking-card__actions')) return;
      var card = e.target.closest('.pl-booking-card');
      if (!card) return;
      var key = card.dataset.reservationKey;
      var match = getReservations().filter(function (item) {
        return reservationIdentity(item) === key;
      })[0];
      if (match) openBookedClassDetail(match);
    });
  }

  // Sticky nav: show venue name when scrolled past the header.
  // Also fade tabs in once the user scrolls into the Available today area —
  // threshold is 50% of pinOffset so tabs are visible well before they pin,
  // and tabs are re-hidden when the user scrolls back to the top.
  (function() {
    var stickyNav = document.getElementById('vd-sticky-nav');
    var venuePaneBg = document.getElementById('vd-pane-nav-bg-venue');
    var SCROLL_THRESHOLD = 10;

    venueDetailScroll.addEventListener('scroll', function() {
      if (!venueDetailOpen) return;
      var scrolled = venueDetailScroll.scrollTop > SCROLL_THRESHOLD;
      // The pane-owned grey backdrop is always tied to its own pane's scroll
      // — it stays grey even when the class pane is active, so it slides
      // back into view (still grey) when the user pops the class.
      if (venuePaneBg) venuePaneBg.classList.toggle('scrolled', scrolled);
      // Shared-nav .scrolled drives the icon/title styling. Only the active
      // pane's scroll should drive it — class scroll handler takes over
      // while the class pane is open.
      if (classDetailOpen) return;
      stickyNav.classList.toggle('scrolled', scrolled);
    }, { passive: true });
  })();

  // ========== TAB SWITCHING ==========
  (function() {
    var tabs = venueDetailEl.querySelectorAll('.vd-tabs .pl-tab-nav__item');
    var panels = venueDetailEl.querySelectorAll('.vd-panel');

    function setTabSelected(tab) {
      tabs.forEach(function(t) {
        var on = t === tab;
        t.classList.toggle('is-selected', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    // Animate venueDetailScroll.scrollTop from current → target with an
    // ease-out cubic. Driving scrollTop in rAF lets the sticky nav fade
    // in continuously with the scroll position (the .scrolled class is
    // toggled inside the scroll listener) — without this the previous
    // two-snap (scrollTop=0 then scrollTop=newPinOffset) caused the
    // image gallery to whip past and the nav bg to lag.
    var vdTabScrollRaf = null;
    function cancelVdTabScroll() {
      if (vdTabScrollRaf) {
        cancelAnimationFrame(vdTabScrollRaf);
        vdTabScrollRaf = null;
      }
    }
    venueDetailScroll.addEventListener('wheel', cancelVdTabScroll, { passive: true });
    venueDetailScroll.addEventListener('touchstart', cancelVdTabScroll, { passive: true });
    venueDetailScroll.addEventListener('mousedown', cancelVdTabScroll);
    function smoothScrollVdTo(target, duration) {
      cancelVdTabScroll();
      var start = venueDetailScroll.scrollTop;
      var delta = target - start;
      if (Math.abs(delta) < 1) {
        venueDetailScroll.scrollTop = target;
        return;
      }
      var startTime = performance.now();
      var d = duration || 360;
      function step(now) {
        var t = Math.min(1, (now - startTime) / d);
        var eased = 1 - Math.pow(1 - t, 3);
        venueDetailScroll.scrollTop = start + delta * eased;
        if (t < 1) {
          vdTabScrollRaf = requestAnimationFrame(step);
        } else {
          vdTabScrollRaf = null;
        }
      }
      vdTabScrollRaf = requestAnimationFrame(step);
    }

    function activateTab(tab) {
      setTabSelected(tab);
      var panelName = tab.dataset.tab;
      panels.forEach(function(p) {
        if (p.dataset.panel === panelName) p.classList.add('active');
        else p.classList.remove('active');
      });

      // Venue description (about block) only belongs on the Overview tab.
      var aboutBlock = venueDetailEl.querySelector('.vd-about-block');
      if (aboutBlock) aboutBlock.hidden = (panelName !== 'overview');

      // Floating "See full schedule" CTA is overview-only — CSS hides it on
      // any sheet that doesn't carry .vd-tab-overview.
      if (venueDetailSheet) venueDetailSheet.classList.toggle('vd-tab-overview', panelName === 'overview');

      // Land at the cached pin (top of the new tab's content). Behavior
      // depends on where the user is:
      //   - Above the pin (hero still visible): glide to pinOffset so the
      //     sticky nav fades in alongside the scroll.
      //   - At or past the pin (tabs already pinned): SNAP instantly to
      //     pinOffset. The new tab's content should always start at the
      //     top — but an animated scroll back to pinOffset from a deep
      //     scroll position would feel like "scrolling to initial state".
      //     Instant snap reads as "tabs pinned, content reset, ready".
      // __vdPinOffset was cached at open time (see venueDetailOpen path)
      // and is refreshed whenever the About block expands.
      requestAnimationFrame(function() {
        var pinOffset = window.__vdPinOffset || 0;
        if (pinOffset <= 0) return;
        var maxScroll = venueDetailScroll.scrollHeight - venueDetailScroll.clientHeight;
        var target = Math.min(pinOffset, Math.max(0, maxScroll));
        if (venueDetailScroll.scrollTop < pinOffset - 4) {
          smoothScrollVdTo(target, 360);
        } else {
          cancelVdTabScroll();
          venueDetailScroll.scrollTop = target;
        }
      });

      // Reset horizontal scroll on all carousels
      venueDetailEl.querySelectorAll('.vd-hscroll').forEach(function(s) { s.scrollLeft = 0; });

      // Classes panel descriptions can only be measured once the panel is
      // laid out (display:flex). Run the overflow check on first activation.
      if (panelName === 'classes' && window.__measureClassesSeeMore) {
        requestAnimationFrame(window.__measureClassesSeeMore);
      }
    }

    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        // Suppress clicks that are the tail end of a drag-scroll — otherwise
        // releasing a vertical drag over a tab row switches tabs unintentionally.
        if (wasDragging) return;
        activateTab(tab);
      });
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
    var seeFullScheduleStaticBtn = document.getElementById('vd-see-full-schedule-static');
    if (seeFullScheduleStaticBtn) {
      seeFullScheduleStaticBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.__switchVenueDetailTab('schedule');
      });
    }

    // Tapping an "Available today" card opens the class detail modal — same
    // behavior as Schedule-tab cards. Those cards are hardcoded HTML, so we
    // build the cls object from their DOM instead of __lastGeneratedClasses.
    var availableEl = document.getElementById('vd-available-today');
    if (availableEl) {
      availableEl.addEventListener('click', function(e) {
        var card = e.target.closest('.vd-schedule-card');
        if (!card || card.classList.contains('disabled')) return;
        if (wasDragging) return;
        var titleEl = card.querySelector('.pl-schedule-card__title');
        var timeEl = card.querySelector('.pl-schedule-card__meta');
        var ratingEl = card.querySelector('.pl-schedule-card__rating');
        var finalPriceEl = card.querySelector('.pl-price--offer .pl-price__current');
        var strikePriceEl = card.querySelector('.pl-price__original');
        var plainPriceEl = card.querySelector('.pl-price:not(.pl-price--offer) .pl-price__current');
        // Time line is now "12:00 PM · Wed, Apr 29 · Sarah M." — extract the
        // time via regex (first "h:mm AM/PM" match) and the instructor as the
        // last `·`-delimited segment.
        var timeText = timeEl ? timeEl.textContent : '';
        var timeMatch = timeText.match(/\d{1,2}:\d{2}\s?[AP]M/i);
        var timeSegments = timeText.split(' · ');
        var cls = {
          title: titleEl ? titleEl.textContent.trim() : '',
          instructor: timeSegments.length > 1 ? timeSegments[timeSegments.length - 1].trim() : '',
          time: timeMatch ? timeMatch[0] : timeText.split('·')[0].trim(),
          rating: ratingEl ? ratingEl.textContent.trim() : '4.9 (250)'
        };
        if (finalPriceEl && strikePriceEl) {
          cls.finalPrice = finalPriceEl.textContent.trim();
          cls.strikePrice = strikePriceEl.textContent.trim();
        } else if (plainPriceEl) {
          cls.plainPrice = plainPriceEl.textContent.trim();
        }
        if (typeof window.__openClassDetail === 'function') window.__openClassDetail(cls);
      });
    }

    // Expandable about text: tapping "see more" toggles .expanded and
    // relabels the link. The visibility of the link itself is driven by
    // the overflow measurement performed when the sheet opens.
    var aboutTextEl = document.getElementById('vd-about-text');
    var seeMoreLink = document.getElementById('vd-see-more');
    if (aboutTextEl && seeMoreLink) {
      seeMoreLink.addEventListener('click', function(e) {
        if (wasDragging) return;
        e.stopPropagation();
        var isExpanded = aboutTextEl.classList.toggle('expanded');
        seeMoreLink.textContent = isExpanded ? 'see less' : 'see more';
        // Expanding the About block changes the natural flow position of
        // the tabs. Re-measure __vdPinOffset so the next tab tap still
        // lands the tabs at the pinned position. Safe to use live
        // scrollTop here because the "see more/less" link sits above the
        // tabs, so the user is never scrolled past the pin when tapping it.
        requestAnimationFrame(function() {
          var tabsEl = venueDetailEl.querySelector('.vd-tabs');
          if (!tabsEl) return;
          var scrollRect = venueDetailScroll.getBoundingClientRect();
          var tabsRect = tabsEl.getBoundingClientRect();
          window.__vdPinOffset = tabsRect.top - scrollRect.top + venueDetailScroll.scrollTop - 80;
        });
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
          +   '<button class="pl-btn pl-btn--sm pl-btn--outline pl-btn--pill vd-class-summary-btn" type="button" data-class-idx="' + i + '">View class</button>'
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
            cls.strikePrice = '$35';
            cls.finalPrice = '$25';
          } else {
            cls.plainPrice = '$35';
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
            cls.strikePrice = '$35';
            cls.finalPrice = '$25';
          } else {
            cls.plainPrice = '$35';
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

    // Reset tabs on venue detail open.
    window.__resetVenueDetailTabs = function() {
      var firstTab = tabs[0];
      setTabSelected(firstTab);
      panels.forEach(function(p) {
        if (p.dataset.panel === 'overview') p.classList.add('active');
        else p.classList.remove('active');
      });
      var aboutBlock = venueDetailEl.querySelector('.vd-about-block');
      if (aboutBlock) aboutBlock.hidden = false;
      if (venueDetailSheet) venueDetailSheet.classList.add('vd-tab-overview');
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
          scrollScheduleListToTop();
        });
      });
      // Scroll to the week that contains the selected day
      var selectedWeekIdx = Math.floor(selectedAbsIdx / 7);
      requestAnimationFrame(function() {
        var weekWidth = datePicker.clientWidth;
        if (weekWidth) datePicker.scrollLeft = selectedWeekIdx * weekWidth;
      });
    }

    // After picking a new date, glide the venue scroll so the schedule list's
    // first row sits just below the sticky date picker. Sticky stack height:
    // 80 (shared nav) + 41 (vd-tabs) + 84 (vd-date-picker) = 205.
    var vdScheduleScrollRaf = null;
    function scrollScheduleListToTop() {
      var listRect = scheduleList.getBoundingClientRect();
      var scrollRect = venueDetailScroll.getBoundingClientRect();
      var STICKY_STACK = 209;
      var delta = (listRect.top - scrollRect.top) - STICKY_STACK;
      var target = Math.max(0, venueDetailScroll.scrollTop + delta);
      if (Math.abs(target - venueDetailScroll.scrollTop) < 1) return;
      if (vdScheduleScrollRaf) cancelAnimationFrame(vdScheduleScrollRaf);
      var start = venueDetailScroll.scrollTop;
      var startTime = performance.now();
      var duration = 320;
      function step(now) {
        var t = Math.min(1, (now - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        venueDetailScroll.scrollTop = start + (target - start) * eased;
        if (t < 1) vdScheduleScrollRaf = requestAnimationFrame(step);
        else vdScheduleScrollRaf = null;
      }
      vdScheduleScrollRaf = requestAnimationFrame(step);
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

    var STAR_SVG = window.plStarXsSvg('star-fill');

    function plPriceHtml(c) {
      if (c.finalPrice) {
        return '<span class="pl-price pl-price--offer">'
          + (c.priceLabel ? '<span class="pl-price__label">' + c.priceLabel + '</span>' : '')
          + '<span class="pl-price__amounts">'
          +   '<span class="pl-price__current">' + c.finalPrice + '</span>'
          +   (c.strikePrice ? '<span class="pl-price__original">' + c.strikePrice + '</span>' : '')
          + '</span></span>';
      }
      if (c.plainPrice || c.price) {
        return '<span class="pl-price"><span class="pl-price__amounts">'
          + '<span class="pl-price__current">' + (c.plainPrice || c.price) + '</span>'
          + '</span></span>';
      }
      return '';
    }

    function plScheduleCardHtml(c, attrs) {
      var timeParts = (c.time || '').split(' · ');
      var timeOnly = timeParts[0] || '';
      var duration = timeParts[1] || '';
      var meta = timeOnly + (c.instructor ? ' · ' + c.instructor : '');
      var classes = 'pl-card pl-schedule-card vd-schedule-card';
      if (c.disabled) classes += ' is-dimmed disabled';
      var trailing = c.disabled
        ? '<span class="pl-card__status pl-card__status--sold-out">Sold out</span>'
        : plPriceHtml(c);
      return '<div class="' + classes + '"' + (attrs || '') + '>'
        + '<div class="pl-schedule-card__body">'
        +   '<div class="pl-schedule-card__row">'
        +     '<span class="pl-schedule-card__meta">' + meta + '</span>'
        +     (duration ? '<span class="pl-schedule-card__duration">' + duration + '</span>' : '')
        +   '</div>'
        +   '<div class="pl-schedule-card__title">' + c.title + '</div>'
        +   '<div class="pl-schedule-card__row">'
        +     '<span class="pl-schedule-card__rating"><span class="pl-schedule-card__star">' + STAR_SVG + '</span>' + c.rating + '</span>'
        +     trailing
        +   '</div>'
        + '</div></div>';
    }

    // Titles come from the shared VENUE_CLASSES catalog so Schedule and
    // Classes tab always agree on what this venue offers.
    var CLASS_NAMES = VENUE_CLASSES.map(function(c) { return c.title; });
    var INSTRUCTOR_NAMES = [
      'Sarah M.', 'Chauncie D.', 'Liz K.', 'Marcus J.', 'Priya S.',
      'Jordan T.', 'Kai N.', 'Emma R.', 'David C.', 'Nina L.'
    ];
    var DURATIONS = [45, 50, 60, 75];
    var VENUE_DROPIN_PRICE = '$35';

    function generateClasses() {
      var classes = [];
      // One venue-wide drop-in price for all non-intro classes. Intro venues
      // override this with the $25/$35 pair on each card below.
      // One venue-wide class duration so the start times can be spaced in a way
      // that respects how long each class actually runs (no overlapping slots).
      var venueDuration = DURATIONS[Math.floor(Math.random() * DURATIONS.length)];

      // Each venue offers 3-4 distinct class types, and each title runs at
      // 3-4 time slots through the day so the class-detail picker always has
      // multiple real siblings. If the venue's duration is too long to squeeze
      // the requested totals into the day window, slotsPerTitle is held at 3
      // and a title is dropped before slots-per-title goes below 3.
      var DAY_START = 420;  // 7 AM
      var DAY_END = 1320;   // 10 PM
      var DAY_LEN = DAY_END - DAY_START;
      var maxFit = Math.floor(DAY_LEN / venueDuration);
      var numTitles = Math.min(CLASS_NAMES.length, 3 + Math.floor(Math.random() * 2));
      var slotsPerTitle = 3 + Math.floor(Math.random() * 2);
      if (numTitles * slotsPerTitle > maxFit) {
        slotsPerTitle = 3;
        if (numTitles * slotsPerTitle > maxFit) {
          numTitles = Math.max(1, Math.floor(maxFit / 3));
        }
      }
      var totalSlots = numTitles * slotsPerTitle;

      // Even-spaced start times with the venue's duration as the floor; pick
      // a random offset so different venues don't all start at 7 AM sharp.
      var spacing = Math.max(venueDuration, Math.floor(DAY_LEN / totalSlots));
      var slack = Math.max(0, DAY_LEN - (totalSlots - 1) * spacing - venueDuration);
      var startOffset = Math.floor(Math.random() * (slack + 1));
      var times = [];
      for (var i = 0; i < totalSlots; i++) {
        var t = DAY_START + startOffset + i * spacing;
        // Snap to 15 min for clean times like 10:30 / 11:45.
        t = Math.round(t / 15) * 15;
        // Defensive: enforce min spacing in case snapping pulled adjacent
        // slots within the duration.
        if (i > 0 && t < times[i - 1] + venueDuration) {
          t = times[i - 1] + venueDuration;
        }
        times.push(t);
      }

      // Pick distinct titles and assign cyclically (so each title gets exactly
      // slotsPerTitle slots), then shuffle so the day's order isn't strictly
      // round-robin.
      var shuffledNames = CLASS_NAMES.slice().sort(function() { return Math.random() - 0.5; });
      var venueTitles = shuffledNames.slice(0, numTitles);
      var titleAssignments = [];
      for (var ti = 0; ti < totalSlots; ti++) {
        titleAssignments.push(venueTitles[ti % numTitles]);
      }
      titleAssignments.sort(function() { return Math.random() - 0.5; });

      for (var i = 0; i < times.length; i++) {
        var h = Math.floor(times[i] / 60);
        var m = times[i] % 60;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        var timeStr = h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
        var dur = venueDuration;
        var title = titleAssignments[i];
        var instructor = INSTRUCTOR_NAMES[Math.floor(Math.random() * INSTRUCTOR_NAMES.length)];
        var rating = (4.3 + Math.random() * 0.7).toFixed(1);
        var reviews = 50 + Math.floor(Math.random() * 400);
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
          cls.strikePrice = '$35';
          cls.finalPrice = '$25';
        } else {
          cls.plainPrice = VENUE_DROPIN_PRICE;
        }
        classes.push(cls);
      }
      return classes;
    }

    // Renders the Overview's "Available today" list from the same generated
    // classes as the Schedule tab so the two stay in sync. Filters to the
    // first N non-disabled entries; re-rendered on venue open only (not on
    // Schedule-tab date changes, since Overview is scoped to today).
    function renderAvailableToday() {
      var list = document.getElementById('vd-available-list');
      if (!list) return;
      var classes = window.__lastGeneratedClasses || [];
      var preview = classes.filter(function(c) { return !c.disabled; }).slice(0, 5);
      // Overview cards label as "time · instructor" — the section is already
      // scoped to today, so the date is redundant. The Schedule tab's cards
      // mirror this layout (the date picker above them sets context).
      list.innerHTML = preview.map(function(c) {
        return plScheduleCardHtml(c);
      }).join('');
    }
    window.__renderVdAvailableToday = renderAvailableToday;

    function renderScheduleList() {
      var classes = generateClasses();
      window.__lastGeneratedClasses = classes;
      var html = classes.map(function(c, i) {
        var sTime = (c.time || '').split(' · ')[0];
        var attrs = ' data-class-idx="' + i + '" data-title="' + c.title + '" data-time="' + sTime + '"';
        return plScheduleCardHtml(c, attrs);
      }).join('');
      scheduleList.innerHTML = html;
      if (window.__applyReservedHighlights) window.__applyReservedHighlights();
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
    var REVIEW_NAMES = ['Sara', 'Natalie', 'Jordan', 'Marcus', 'Priya', 'Emma', 'David', 'Liz', 'Kai', 'Nina'];
    // Keep review class titles in sync with VENUE_CLASSES (the shared venue
    // catalog used by the Schedule/Overview lists) so reviews reference classes
    // this venue actually offers.
    var REVIEW_CLASSES = [
      'Power Vinyasa Flow', 'Sculpt & Tone', 'Restorative Yoga', 'HIIT Reformer', 'Candlelit Flow'
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

    var AI_SUMMARIES = [
      "People love this studio for its upbeat, music-driven workouts and motivating instructors who give clear form cues. Reviews highlight an intense full-body burn in a short time and frequent shout-outs to specific coaches for energy and guidance.",
      "Reviewers consistently praise the welcoming atmosphere and knowledgeable instructors. The studio is described as clean and well-maintained, with creative class formats that keep regulars coming back week after week.",
      "Highly rated for its intimate class sizes and personalized attention. Many reviewers mention visible results within weeks and appreciate the variety of class offerings throughout the day."
    ];

    function renderReviewCard(review) {
      return window.__plReviewCardHtml({
        name: review.name,
        stars: review.stars,
        date: review.date,
        title: review.classTitle,
        body: review.body
      });
    }

    window.__renderReviewsPanel = function(rating, reviewCount) {
      var starsEl = document.getElementById('vd-rev-stars');
      if (starsEl) {
        starsEl.innerHTML = window.__plRatingStarsHtml(rating);
        starsEl.setAttribute('aria-label', rating + ' out of 5');
      }

      var scoreEl = document.getElementById('vd-rev-score');
      if (scoreEl) scoreEl.textContent = rating;
      var countEl = document.getElementById('vd-rev-count');
      if (countEl) countEl.textContent = '(' + reviewCount + ')';

      var dist = window.__plRatingDistributionCounts(reviewCount);
      var barsEl = document.getElementById('vd-rev-bars');
      if (barsEl) barsEl.innerHTML = window.__plRatingDistributionHtml(dist);

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
          body: REVIEW_BODIES[Math.floor(Math.random() * REVIEW_BODIES.length)]
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
        classDetailOpen = false;
        venueDetailEl.classList.remove('venue-detail-visible', 'from-bookings');
        venueDetailEl.style.background = '';
        if (typeof window.__hideBookingBar === 'function') window.__hideBookingBar();
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
          resetVenueDetailPanes();
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
      return target.closest('.venue-detail-close, .vd-actions-pill, button, a');
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
    var CD_REVIEW_DATES = ['Last week', '2 weeks ago', '3 weeks ago', 'Last month', '2 months ago'];
    var DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var CD_WEEKS_COUNT = 2; // current week + 1 future (forward-only navigation)
    // Two date trackers:
    //  • cdViewingAbsIdx — the day the user is currently browsing in the
    //    date picker. Updates on date tap; doesn't move the picker's
    //    visual selection (today is the only card with the selected
    //    style).
    //  • cdSelectedAbsIdx — the day matching the booked slot. Drives the
    //    date shown in the booking footer + checkout. Only updates when
    //    the user taps a slot on a different date.
    var cdViewingAbsIdx = 0;
    var cdSelectedAbsIdx = 0;

    function renderCdDatePicker(viewingAbsIdx) {
      var picker = document.getElementById('cd-date-picker');
      var today = new Date();
      var dow = today.getDay();
      // absIdx 0 = today; subsequent indices are future days.
      if (viewingAbsIdx == null) viewingAbsIdx = 0;
      cdViewingAbsIdx = viewingAbsIdx;
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
          if (absIdx === viewingAbsIdx) classes += ' selected';
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
          // Re-render so the visual "selected" highlight follows the user's
          // tap. The booking-footer date stays anchored to whichever date
          // the user picked their slot on (cdSelectedAbsIdx) — only a slot
          // tap updates that. cdViewingAbsIdx tracks the currently-visible
          // date and is what gets baked in on the next slot tap.
          var absIdx = parseInt(cell.dataset.abs, 10);
          renderCdDatePicker(absIdx);
          // Black border on a slot only persists when the user is viewing
          // the date their booked slot is on. Switching to any other date
          // clears the highlight — they have to actively pick a slot for
          // the new date. Coming back restores the highlight on the
          // previously-booked slot.
          var slotsEl = document.getElementById('cd-time-slots');
          if (slotsEl) {
            var slotEls = slotsEl.querySelectorAll('.cd-time-slot');
            if (absIdx === cdSelectedAbsIdx && cdLastSlot) {
              slotEls.forEach(function(s) {
                var t = s.querySelector('.pl-class-card__time');
                var on = !!(t && t.textContent === cdLastSlot.time);
                s.classList.toggle('selected', on);
                s.classList.toggle('is-selected', on);
              });
            } else {
              slotEls.forEach(function(s) {
                s.classList.remove('selected', 'is-selected');
              });
            }
          }
          // Reserved highlight must follow the viewing date. The slot list
          // isn't re-rendered on date switch, so we have to re-run the
          // highlight pass manually — otherwise an `is-reserved` slot from
          // the booked date stays marked across other dates.
          if (window.__applyReservedHighlights) window.__applyReservedHighlights();
        });
      });
      // Scroll to the week containing the day the user is viewing.
      var viewingWeekIdx = Math.floor(viewingAbsIdx / 7);
      requestAnimationFrame(function() {
        var weekWidth = picker.clientWidth;
        picker.scrollLeft = viewingWeekIdx * weekWidth;
      });
    }

    // After picking a new date, glide the class-detail scroll so the first
    // time slot sits flush below the sticky cd-date-picker. Sticky stack
    // height: 80 (shared nav) + 72 (cd-date-picker) = 152.
    var cdSlotsScrollRaf = null;
    function scrollCdTimeSlotsToTop() {
      var slots = document.getElementById('cd-time-slots');
      if (!slots || !classDetailScroll) return;
      var slotsRect = slots.getBoundingClientRect();
      var scrollRect = classDetailScroll.getBoundingClientRect();
      var STICKY_STACK = 152;
      var delta = (slotsRect.top - scrollRect.top) - STICKY_STACK;
      var target = Math.max(0, classDetailScroll.scrollTop + delta);
      if (Math.abs(target - classDetailScroll.scrollTop) < 1) return;
      if (cdSlotsScrollRaf) cancelAnimationFrame(cdSlotsScrollRaf);
      var start = classDetailScroll.scrollTop;
      var startTime = performance.now();
      var duration = 320;
      function step(now) {
        var t = Math.min(1, (now - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        classDetailScroll.scrollTop = start + (target - start) * eased;
        if (t < 1) cdSlotsScrollRaf = requestAnimationFrame(step);
        else cdSlotsScrollRaf = null;
      }
      cdSlotsScrollRaf = requestAnimationFrame(step);
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

    function renderCdTimeSlots(primaryTime, primaryInstructor, primaryTitle) {
      var slots = document.getElementById('cd-time-slots');
      // Strip the duration off if present (e.g. "10:00 AM · 60 min" → "10:00 AM")
      var firstTime = primaryTime.split(' · ')[0];

      // Pull time slots from the venue's actual schedule so the class detail
      // matches the Schedule tab exactly. Filter by class title, skip disabled
      // entries; never inject synthetic slots.
      var collected = {};
      if (primaryTitle && window.__lastGeneratedClasses) {
        window.__lastGeneratedClasses.forEach(function(c) {
          if (c.disabled || c.title !== primaryTitle) return;
          var parts = c.time.split(' · ');
          var t = parts[0];
          var dur = parts[1] || '60 min';
          if (!collected[t]) {
            collected[t] = {
              time: t,
              duration: dur,
              instructor: c.instructor,
              // Price: prefer the intro-offer final price, else the plain price.
              price: c.finalPrice || c.plainPrice || '$35',
              strikePrice: c.strikePrice || null
            };
          }
        });
      }
      // Mark the tapped slot as selected only if it actually exists.
      if (collected[firstTime]) collected[firstTime].primary = true;
      else if (firstTime) {
        collected[firstTime] = {
          time: firstTime,
          duration: '60 min',
          instructor: primaryInstructor || '',
          price: '$35',
          strikePrice: null,
          primary: true
        };
      }

      var data = Object.keys(collected).map(function(k) {
        var s = collected[k];
        return {
          time: s.time,
          duration: s.duration,
          instructor: s.instructor,
          price: s.price,
          strikePrice: s.strikePrice,
          selected: !!s.primary
        };
      });
      data.sort(function(a, b) { return timeToMinutes(a.time) - timeToMinutes(b.time); });

      // Cap at 5 slots. Never pad with synthetic times — the time-slot list
      // must always reflect the venue schedule exactly so a user comparing
      // the two doesn't see fabricated entries here that aren't on the
      // schedule tab. The schedule generator clusters titles so each tapped
      // class has multiple real siblings. Keep the tapped slot in-window so
      // it survives the cap.
      var MAX_SLOTS = 5;
      if (data.length > MAX_SLOTS) {
        var selectedIdx = data.findIndex(function(s) { return s.selected; });
        if (selectedIdx >= MAX_SLOTS) {
          var selected = data[selectedIdx];
          data = data.slice(0, MAX_SLOTS - 1).concat(selected);
        } else {
          data = data.slice(0, MAX_SLOTS);
        }
      }

      slots.innerHTML = data.map(function(s) {
        var priceHtml = s.strikePrice
          ? '<span class="pl-price pl-price--offer"><span class="pl-price__amounts">'
            + '<span class="pl-price__current">' + s.price + '</span>'
            + '<span class="pl-price__original">' + s.strikePrice + '</span>'
            + '</span></span>'
          : '<span class="pl-price"><span class="pl-price__amounts">'
            + '<span class="pl-price__current">' + s.price + '</span>'
            + '</span></span>';
        return '<div class="pl-card pl-class-card cd-time-slot'
          + (s.selected ? ' selected is-selected' : '') + '" data-time="' + s.time + '">'
          +   '<div class="pl-class-card__body">'
          +     '<div class="pl-class-card__row">'
          +       '<span class="pl-class-card__time">' + s.time + '</span>'
          +       '<span class="pl-class-card__duration">' + s.duration + '</span>'
          +     '</div>'
          +     '<div class="pl-class-card__row">'
          +       '<span class="pl-class-card__instructor">' + s.instructor + '</span>'
          +       priceHtml
          +     '</div>'
          +   '</div>'
          + '</div>';
      }).join('');
      // Slot selection cannot be undone — re-tapping a selected card is a
      // no-op. Tapping a different card selects it, and copies the date the
      // user was browsing into cdSelectedAbsIdx so the footer reflects the
      // slot's date.
      if (window.__applyReservedHighlights) window.__applyReservedHighlights();
      slots.querySelectorAll('.cd-time-slot').forEach(function(slot, idx) {
        slot.addEventListener('click', function() {
          if (wasDragging) return;
          if (slot.classList.contains('is-selected')) return;
          slots.querySelectorAll('.cd-time-slot').forEach(function(s) {
            s.classList.remove('selected', 'is-selected');
          });
          slot.classList.add('selected', 'is-selected');
          cdSelectedAbsIdx = cdViewingAbsIdx;
          updateBookingBar(data[idx]);
          if (window.__rerenderCdReviews) window.__rerenderCdReviews(data[idx].instructor);
          syncCdBookingBarVisibility();
        });
      });
      // Initial booking bar state reflects the slot the user actually tapped
      // on the Schedule tab — fall back to the earliest slot if no match.
      var selectedSlot = data.find(function(s) { return s.selected; }) || data[0];
      updateBookingBar(selectedSlot);
      syncCdBookingBarVisibility();
    }

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
      // Spacer always reserves room for the docked booking bar — the bar
      // is now always visible while class detail is open.
      if (spacer) spacer.style.height = '128px';
      var shouldShow = classDetailOpen;
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
        // Match the class-detail push curve/duration so the booking bar
        // slides up in sync with the pane — feels like one motion.
        cdBookingBar.style.transition = 'none';
        cdBookingBar.style.transform = cdBookingHiddenY();
        void cdBookingBar.offsetHeight;
        cdBookingBar.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
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

    // Last selected time slot — kept so we can refresh the booking bar's
    // date string when the user changes the date picker without re-tapping
    // the slot.
    var cdLastSlot = null;

    // Build "Tue, Mar 1" from the currently selected date-picker offset.
    function cdShortDate() {
      var date = new Date();
      date.setDate(date.getDate() + (cdSelectedAbsIdx || 0));
      var dayShort = date.toLocaleDateString('en-US', { weekday: 'short' });
      var monthShort = date.toLocaleDateString('en-US', { month: 'short' });
      return dayShort + ', ' + monthShort + ' ' + date.getDate();
    }

    function updateClassHeaderMeta(slot) {
      if (!slot) return;
      var dt = document.getElementById('cd-meta-datetime');
      var inst = document.getElementById('cd-meta-instructor');
      if (dt) dt.textContent = cdShortDate() + ' · ' + slot.time;
      if (inst) inst.textContent = slot.instructor;
    }

    function updateBookingBar(slot) {
      cdLastSlot = slot;
      // Top row: "Tue, Mar 1 · 2:00 PM" (datetime only — no instructor).
      var timeEl = document.getElementById('cd-booking-time');
      if (timeEl) timeEl.textContent = cdShortDate() + ' · ' + slot.time;
      // Bottom row: instructor sits next to the price as a separator-prefixed
      // suffix ("$25.00 $35 · Regina N.").
      var instructorEl = document.getElementById('cd-booking-instructor');
      if (instructorEl) instructorEl.textContent = slot.instructor;
      updateClassHeaderMeta(slot);
      // CTA label/style is driven by whether the currently-viewed slot
      // matches the reservation — black "Cancel" for the reserved slot,
      // red "Book" for any other.
      if (window.__syncBookingBarCta) window.__syncBookingBarCta();
    }

    // Re-render only the date portion of the booking bar — used when the
    // user picks a different date but keeps the same selected time slot.
    window.__refreshBookingBarDate = function() {
      if (!cdLastSlot) return;
      var timeEl = document.getElementById('cd-booking-time');
      if (timeEl) timeEl.textContent = cdShortDate() + ' · ' + cdLastSlot.time;
      updateClassHeaderMeta(cdLastSlot);
    };

    // Stable review pool generated once per class detail open.
    // Each entry has its own instructor so the Reviews tab can prioritize
    // reviews matching the currently selected time slot's instructor.
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
            date: pick(CD_REVIEW_DATES),
            stars: 4 + Math.floor(Math.random() * 2)
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

    // Carousel cards on the Overview tab: header (avatar + name/stars + date·source)
    // above a body group (class title + clamped body + see-more), mirroring the
    // venue-detail review card layout.
    function reviewCardHTML(title, review) {
      return window.__plReviewCardHtml({
        name: review.name,
        stars: 5,
        date: review.date,
        title: title + ' with ' + review.instructor,
        body: review.body
      }, { extraClass: 'cd-review-card', clampedBody: true });
    }

    function reviewCardListHTML(title, review) {
      return window.__plReviewCardHtml({
        name: review.name,
        stars: review.stars,
        date: review.date,
        title: title + ' with ' + review.instructor,
        body: review.body
      }, { extraClass: 'cd-review-card cd-review-card-list' });
    }

    var CD_REVIEW_SEE_ALL_HTML = '<div class="pl-see-all cd-review-see-all" id="cd-review-see-all">'
      + '<span>See all</span>'
      + '<svg class="pl-icon pl-icon--sm" aria-hidden="true"><use href="#pl-right-chevron"></use></svg>'
      + '</div>';

    function renderCdReviewCards(title, highlight) {
      var container = document.getElementById('cd-review-cards');
      var list = sortedPool(highlight).slice(0, 3);
      container.innerHTML = list.map(function(r) { return reviewCardHTML(title, r); }).join('') + CD_REVIEW_SEE_ALL_HTML;
      var seeAll = document.getElementById('cd-review-see-all');
      if (seeAll) {
        seeAll.addEventListener('click', function() {
          if (wasDragging) return;
          if (typeof window.__cdActivateReviewsTab === 'function') window.__cdActivateReviewsTab();
        });
      }
      // Reveal "see more" only on cards whose body actually clamps past
      // 4 lines. Tapping it toggles .expanded and relabels to "see less".
      // Wait for fonts to load before measuring — otherwise text wraps in
      // the fallback system font (wider than DM Sans) and 4-line copy can
      // appear to overflow when it actually fits once DM Sans resolves.
      var measureOverflow = function() {
        container.querySelectorAll('.cd-review-card').forEach(function(card) {
          var body = card.querySelector('.cd-review-card-body');
          var seeMore = card.querySelector('.cd-review-card-seemore');
          if (!body || !seeMore) return;
          seeMore.hidden = !(body.scrollHeight > body.clientHeight + 1);
        });
      };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() { requestAnimationFrame(measureOverflow); });
      } else {
        requestAnimationFrame(measureOverflow);
      }
      container.querySelectorAll('.cd-review-card-seemore').forEach(function(link) {
        link.addEventListener('click', function(e) {
          if (wasDragging) return;
          e.stopPropagation();
          var body = link.previousElementSibling;
          if (!body) return;
          var isExpanded = body.classList.toggle('expanded');
          link.textContent = isExpanded ? 'see less' : 'see more';
        });
      });
    }

    function renderCdReviewsList(title, highlight) {
      var container = document.getElementById('cd-reviews-list');
      var list = sortedPool(highlight).slice(0, 5);
      container.innerHTML = list.map(function(r) { return reviewCardListHTML(title, r); }).join('');
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
      // The class title now lives in the shared sticky nav (#vd-sticky-nav).
      var cdStickyTitleEl = document.getElementById('cd-sticky-title');
      cdStickyTitleEl.textContent = cls.title;
      fitStickyTitle(cdStickyTitleEl);
      // NOTE: do NOT clear .scrolled here. If the venue nav was scrolled
      // (grey bg), removing it now would fade the bg out mid-slide and
      // expose the class hero's lighter gradient through the transparent
      // nav. __openClassDetail re-evaluates .scrolled after the slide
      // settles instead.
      // rating "4.6 (287)" → split
      var ratingParts = (cls.rating || '4.9 (250)').match(/^([\d.]+)\s*\((\d+)\)$/);
      if (ratingParts) {
        document.getElementById('cd-rating-big').textContent = ratingParts[1];
        document.getElementById('cd-rating-summary-count').textContent = '(' + ratingParts[2] + ')';
        document.getElementById('cd-header-rating-num').textContent = ratingParts[1];
        document.getElementById('cd-header-rating-count').textContent = '(' + ratingParts[2] + ')';
      }
      var venueName = (window.__currentVenuePin && window.__currentVenuePin.name)
        || (currentPins[0] && currentPins[0].name)
        || pick(CD_VENUE_NAMES);
      var hood = (window.__currentVenuePin && window.__currentVenuePin.locality)
        || (currentPins[0] && currentPins[0].locality)
        || pick(CD_NEIGHBORHOODS);
      document.getElementById('cd-venue-text').textContent = venueName;
      updateClassHeaderMeta({ time: cls.time, instructor: cls.instructor });
      // Amenities — inherit the venue's amenity set so a class shows the
      // same Mats / Towels / Showers as its venue.
      var cdAmenitiesList = ['Mats', 'Towels'];
      if (venueHasShowers(window.__currentVenuePin || currentPins[0])) cdAmenitiesList.push('Showers');
      renderAmenities('cd-amenities', cdAmenitiesList, 'cd-amenity-pill');

      // Location card — mirror the venue's static map thumb + address.
      var cdMapThumb = document.getElementById('cd-map-thumb');
      var cdAddressEl = document.getElementById('cd-map-address');
      var venuePin = window.__currentVenuePin || currentPins[0];
      if (cdMapThumb && venuePin && venuePin.lat && venuePin.lng && window.MAPBOX_TOKEN) {
        var cdStaticUrl = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/'
          + venuePin.lng + ',' + venuePin.lat + ',14,0/353x204@2x?access_token=' + MAPBOX_TOKEN;
        cdMapThumb.style.backgroundImage = 'url(' + cdStaticUrl + ')';
        cdMapThumb.style.backgroundSize = 'cover';
        cdMapThumb.style.backgroundPosition = 'center';
      } else if (cdMapThumb) {
        cdMapThumb.style.backgroundImage = '';
      }
      if (cdAddressEl) {
        var cdParts = [];
        if (venuePin && venuePin.address) cdParts.push(venuePin.address);
        if (venuePin && venuePin.locality) cdParts.push(venuePin.locality + ', NY');
        cdAddressEl.textContent = cdParts.length ? cdParts.join(', ') : (hood + ', NY');
      }
      // Price strings in the class detail display dollars with cents ($25.00).
      function cdFormatPrice(p) {
        if (!p) return p;
        return /\.\d{2}$/.test(p) ? p : (p + '.00');
      }
      // Date/slots — picker leads with today unless the class was opened
      // from a booked reservation (absIdx is the reserved day).
      var absIdx = (cls.absIdx != null) ? cls.absIdx : 0;
      cdViewingAbsIdx = absIdx;
      cdSelectedAbsIdx = absIdx;
      renderCdDatePicker(absIdx);
      renderCdTimeSlots(cls.time, cls.instructor, cls.title);
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
      // Ratings summary + distribution (design-system components)
      var ratingValue = ratingParts ? ratingParts[1] : '4.7';
      var reviewCount = ratingParts ? parseInt(ratingParts[2], 10) : 250;
      var starsHtml = window.__plRatingStarsHtml(ratingValue);
      var cdStarsEl = document.getElementById('cd-stars');
      if (cdStarsEl) {
        cdStarsEl.innerHTML = starsHtml;
        cdStarsEl.setAttribute('aria-label', ratingValue + ' out of 5');
      }
      var dist = window.__plRatingDistributionCounts(reviewCount, [0.03, 0.05, 0.12, 0.25, 0.55]);
      var barsHtml = window.__plRatingDistributionHtml(dist);
      var CD_AI_SUMMARIES = [
        "Highly rated for its intimate class sizes and personalized attention. Many reviewers mention visible results within weeks and appreciate the variety of class offerings throughout the day.",
        "People love this studio for its upbeat, music-driven workouts and motivating instructors who give clear form cues. Reviews highlight an intense full-body burn in a short time.",
        "Reviewers consistently praise the welcoming atmosphere and knowledgeable instructors. The studio is described as clean and well-maintained, with creative class formats."
      ];
      var revBigEl = document.getElementById('cd-rating-big-rev');
      if (revBigEl) revBigEl.textContent = ratingValue;
      var revCountEl = document.getElementById('cd-rating-summary-count-rev');
      if (revCountEl) revCountEl.textContent = '(' + reviewCount + ')';
      var revStarsEl = document.getElementById('cd-stars-rev');
      if (revStarsEl) {
        revStarsEl.innerHTML = starsHtml;
        revStarsEl.setAttribute('aria-label', ratingValue + ' out of 5');
      }
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
      // Booking bar price — green discount + strike for intro venues, plain
       // black price otherwise.
      var priceEl = document.getElementById('cd-booking-price');
      if (priceEl) {
        if (cls.finalPrice) {
          priceEl.innerHTML = '<span class="cd-booking-price-final">' + cdFormatPrice(cls.finalPrice) + '</span>'
            + '<span class="cd-booking-price-strike">' + cdFormatPrice(cls.strikePrice) + '</span>';
        } else {
          priceEl.innerHTML = '<span class="cd-booking-price-plain">' + cdFormatPrice(cls.plainPrice || '$35') + '</span>';
        }
      }
      // Reset all scroll positions so the modal always opens fresh
      classDetailScroll.scrollTop = 0;
      classDetailEl.querySelectorAll('.cd-review-cards, .cd-date-picker').forEach(function(el) {
        el.scrollLeft = 0;
      });
      // Reset hero carousel to the first slide (transform-based, no scrollLeft).
      if (typeof window.__resetCdHeroCarousel === 'function') window.__resetCdHeroCarousel();
      // Reset scroll-driven tab bar state
      persistentTabBar.classList.remove('hidden-down');
      var tabBarBlurReset = document.getElementById('tab-bar-blur');
      if (tabBarBlurReset) tabBarBlurReset.classList.remove('hidden-down');
    }

    window.__openClassDetail = function(cls, opts) {
      if (classDetailOpen && !(opts && opts.alreadyOpen)) return;
      // Mark open BEFORE populate so syncCdBookingBarVisibility (called from
      // renderCdTimeSlots during populate) can reveal the booking bar when
      // the default first slot is pre-selected.
      classDetailOpen = true;
      populateClassDetail(cls);
      // Sync the compact header thumb + hidden lightbox slides to the
      // current venue's photos so a class pushed from venue A matches
      // the thumbnail you tapped through.
      var cdHeroSlideEls = document.querySelectorAll('#cd-hero-track .cd-hero-slide');
      var cdTriple = pickVenueImages(window.__currentVenuePin, window.__currentVenueIndex);
      for (var ci = 0; ci < cdHeroSlideEls.length; ci++) {
        setVenuePhotoBg(cdHeroSlideEls[ci], cdTriple ? cdTriple[ci] : null);
      }
      setVenuePhotoBg(document.getElementById('cd-thumb'), (cdTriple && cdTriple[0]) || cls.imageUrl || null);
      // Reset class scroll to the top so the hero is visible on every push.
      classDetailScroll.scrollTop = 0;
      // Drop .scrolled on the shared nav — class scroll is at 0, so the
      // class title shouldn't be visible yet and the icons should drop
      // their white bg. The class pane's own grey backdrop (vd-pane-nav-bg)
      // is reset to transparent here too, since it'll only re-grey once
      // the user scrolls past the title threshold inside the class pane.
      // The venue pane keeps its own .vd-pane-nav-bg state intact and
      // slides left with the venue, so the grey wash literally pushes
      // out instead of fading in place.
      var sharedNav = document.getElementById('vd-sticky-nav');
      if (sharedNav) sharedNav.classList.remove('scrolled');
      var classPaneBg = document.getElementById('vd-pane-nav-bg-class');
      if (classPaneBg) classPaneBg.classList.remove('scrolled');
      venueDetailSheet.classList.add('show-class');
      // Position the tab indicator after layout settles
      if (window.__resetClassDetailTabs) {
        requestAnimationFrame(function() {
          window.__resetClassDetailTabs();
          // Cache the scroll offset where the tabs become sticky.
          // Measured while scroll is at 0 and layout is stable.
          var tabsEl = classDetailScroll.querySelector('.cd-tabs');
          if (tabsEl) {
            var scrollRect = classDetailScroll.getBoundingClientRect();
            var tabsRect = tabsEl.getBoundingClientRect();
            window.__cdPinOffset = tabsRect.top - scrollRect.top - 80;
          }
          if (window.__fitCdActivePanelHeight) window.__fitCdActivePanelHeight();
          // Cache the scroll offset where the class title leaves the viewport
          if (window.__cacheCdTitleThreshold) window.__cacheCdTitleThreshold();
        });
      }
    };

    function closeClassDetail() {
      if (!classDetailOpen) return;
      if (window.__closeCheckoutIfOpen) window.__closeCheckoutIfOpen();
      classDetailOpen = false;
      // Back from class detail always lands at the top of venue detail —
      // don't restore the scroll position the user left on the way in.
      venueDetailScroll.scrollTop = 0;
      venueDetailScroll.scrollLeft = 0;
      var sharedNav = document.getElementById('vd-sticky-nav');
      if (sharedNav) sharedNav.classList.remove('scrolled');
      var venuePaneBg = document.getElementById('vd-pane-nav-bg-venue');
      if (venuePaneBg) venuePaneBg.classList.remove('scrolled');
      venueDetailSheet.classList.remove('show-class');
      // Booking bar: slide back down alongside the pane swap
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
    }

    window.__closeClassDetail = closeClassDetail;

    // Slide the docked booking bar back down — reused by the venue close
    // paths (X button + drag-to-dismiss) so a venue dismiss while a class
    // slot is selected animates the booking footer away too.
    window.__hideBookingBar = function() {
      if (!cdBookingBar) return;
      var wasVisible = cdBookingBar.classList.contains('cd-booking-visible');
      cdBookingBar.classList.remove('cd-booking-visible');
      if (!wasVisible) return;
      if (motionAnimate) {
        cdBookingBar.getAnimations().forEach(function(a) { a.cancel(); });
        motionAnimate(cdBookingBar, {
          transform: [CD_BOOKING_VISIBLE_Y, cdBookingHiddenY()]
        }, { duration: 0.25, easing: 'cubic-bezier(.25,.46,.45,.94)' }).finished.then(function() {
          if (!cdBookingBar.classList.contains('cd-booking-visible')) {
            cdBookingBar.style.visibility = 'hidden';
          }
        });
      } else {
        cdBookingBar.style.transform = cdBookingHiddenY();
        cdBookingBar.style.visibility = 'hidden';
      }
    };

    // === Checkout sheet: morph-in-place from the booking bar ===
    var cdCheckoutSheet = document.getElementById('cd-checkout-sheet');
    var cdCheckoutScrim = document.getElementById('cd-checkout-scrim');
    var cdCheckoutCloseBtn = document.getElementById('cd-checkout-close');
    var cdBookingCta = document.getElementById('cd-booking-cta');
    var cdCheckoutCta = document.getElementById('cd-checkout-cta');
    var cdCheckoutCtaLabel = cdCheckoutCta && cdCheckoutCta.querySelector('.cd-cta-label');
    var cdCheckoutOpen = false;
    // Tapping "Book and Pay" (sheet open) shows a spinner for 2s, then
    // transitions to the design-system success modal. No real booking call.
    var cdCheckoutSuccessTimer = null;
    var cdCheckoutSuccessEl = document.getElementById('cd-checkout-success');
    var cdCheckoutSuccessCloseBtn = document.getElementById('cd-checkout-success-close');
    var cdCheckoutSuccessAddBtn = document.getElementById('cd-checkout-success-add');
    var cdCancelConfirmTimer = null;
    var cdCancelToastTimer = null;
    var cdCancelToastEl = document.getElementById('cd-cancel-toast');
    var cdCancelConfirmEl = document.getElementById('cd-cancel-confirm');
    var cdCancelConfirmCloseBtn = document.getElementById('cd-cancel-confirm-close');
    var cdCancelConfirmDoneBtn = document.getElementById('cd-cancel-confirm-done');
    var cdCancelConfirmFindBtn = document.getElementById('cd-cancel-confirm-find');

    // Payment section expand/collapse: tapping Total reveals Subtotal +
    // Taxes and rotates the chevron. CSS handles the transition via
    // .is-expanded on .pl-payment-section.
    var cdCheckoutPaymentSection = document.getElementById('cd-checkout-payment-section');
    var cdCheckoutTotalToggle = document.getElementById('cd-checkout-total-toggle');
    if (cdCheckoutPaymentSection && cdCheckoutTotalToggle) {
      cdCheckoutTotalToggle.addEventListener('click', function() {
        var open = cdCheckoutPaymentSection.classList.toggle('is-expanded');
        cdCheckoutTotalToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    // === Checkout option picker (Drop-ins / Packs) ===
    var cdCheckoutOptionsPanel = document.getElementById('cd-checkout-options');
    var cdCheckoutPromoBtn = document.getElementById('cd-checkout-promo');
    var cdCheckoutOptionsBack = document.getElementById('cd-checkout-options-back');
    var cdCheckoutOptionsDone = document.getElementById('cd-checkout-options-done');
    var cdCheckoutOptionsScroll = document.getElementById('cd-checkout-options-scroll');
    var cdCheckoutOptionsTabs = document.getElementById('cd-checkout-options-tabs');
    var cdCheckoutSelectedId = null;
    var cdCheckoutPendingId = null;
    var cdCheckoutOptionsCatalog = [];
    var cdOptionsIsEntry = false;

    function cdFormatExpiryDate(monthsFromNow) {
      var d = new Date();
      d.setMonth(d.getMonth() + monthsFromNow);
      var month = d.toLocaleDateString('en-US', { month: 'short' });
      return month + ' ' + d.getDate() + ', ' + d.getFullYear();
    }

    function cdFormatPackExpiry(monthsFromNow) {
      return 'Expires ' + cdFormatExpiryDate(monthsFromNow);
    }

    function cdReservationIsPack(r) {
      return !!(r && r.optionType === 'pack');
    }

    function cdCurrentVenueKey() {
      var p = window.__currentVenuePin;
      return p ? ((p.name || '') + '|' + (p.lat || '') + '|' + (p.lng || '')) : '';
    }

    function cdVenuePackKeys(source) {
      var keys = [];
      function add(key) {
        if (key && keys.indexOf(key) === -1) keys.push(key);
      }
      if (source && source.venueKey) add(source.venueKey);
      add(cdCurrentVenueKey());
      return keys;
    }

    function cdGetVenuePack(venueKey) {
      if (!window.__venuePacks) return null;
      if (venueKey && window.__venuePacks[venueKey]) return window.__venuePacks[venueKey];
      var keys = Object.keys(window.__venuePacks);
      return keys.length === 1 ? window.__venuePacks[keys[0]] : null;
    }

    function cdSetVenuePack(venueKey, pack) {
      if (!pack) return;
      if (!window.__venuePacks) window.__venuePacks = {};
      var keys = cdVenuePackKeys({ venueKey: venueKey || pack.venueKey });
      if (pack.venueKey) keys = cdVenuePackKeys(pack).concat(keys);
      var i;
      for (i = 0; i < keys.length; i++) {
        if (keys[i]) window.__venuePacks[keys[i]] = pack;
      }
    }

    function cdVenueHasRedeemablePack(venueKey) {
      var pack = cdGetVenuePack(venueKey || cdCurrentVenueKey());
      return !!(pack && pack.remaining > 0);
    }

    function cdFillPackCard(pack, ids) {
      if (!pack || !ids) return;
      var titleEl = document.getElementById(ids.title);
      var expiryEl = document.getElementById(ids.expiry);
      var badgeEl = document.getElementById(ids.badge);
      if (titleEl) titleEl.textContent = pack.title || '';
      if (expiryEl) expiryEl.textContent = cdFormatPackExpiry(pack.expiryMonths || 12);
      if (badgeEl) {
        badgeEl.textContent = pack.remaining + ' of ' + pack.classes + ' visits left';
      }
    }

    function cdApplyPackAfterPurchase(purchased) {
      if (!purchased || purchased.optionType !== 'pack') return;
      var venueKey = purchased.venueKey || cdCurrentVenueKey();
      if (!venueKey) return;
      var pack = cdGetVenuePack(venueKey);
      if (pack && pack.remaining > 0) {
        pack.remaining -= 1;
      } else {
        var classes = purchased.classes || 10;
        pack = {
          venueKey: venueKey,
          title: purchased.optionTitle,
          classes: classes,
          remaining: Math.max(0, classes - 1),
          expiryMonths: purchased.expiryMonths || 12,
          optionId: purchased.optionId
        };
      }
      pack.venueKey = venueKey;
      cdSetVenuePack(venueKey, pack);
    }

    function cdReturnPackVisit(reservation) {
      if (!reservation || !cdReservationIsPack(reservation)) return null;
      var venueKey = reservation.venueKey || cdCurrentVenueKey();
      var pack = cdGetVenuePack(venueKey);
      var classes = (pack && pack.classes) || reservation.classes || 10;
      if (!pack) {
        pack = {
          venueKey: venueKey,
          title: reservation.optionTitle,
          classes: classes,
          remaining: Math.max(0, classes - 1),
          expiryMonths: reservation.expiryMonths || 12,
          optionId: reservation.optionId
        };
      }
      pack.remaining = Math.min(pack.classes || classes, (pack.remaining || 0) + 1);
      pack.venueKey = venueKey || pack.venueKey;
      cdSetVenuePack(venueKey, pack);
      return pack;
    }

    function cdCheckoutPrimaryCopy() {
      if (cdCheckoutSheet.classList.contains('is-cancel-mode')) return 'Confirm cancellation';
      if (cdCheckoutSheet.classList.contains('is-pack-redeem')) return 'Confirm reservation';
      return 'Buy and reserve';
    }

    function cdSyncCheckoutPrimaryCopy() {
      var copy = cdCheckoutPrimaryCopy();
      if (cdCheckoutCtaLabel) cdCheckoutCtaLabel.textContent = copy;
      var termsCta = document.getElementById('cd-checkout-terms-cta');
      if (termsCta) termsCta.textContent = copy;
    }

    function cdFormatReservationVenue(r) {
      if (!r) return '';
      if (r.locality && r.venueName) return r.venueName + ' - ' + r.locality;
      return r.venueName || '';
    }

    function cdSnapshotPurchase() {
      var opt = cdGetCheckoutOptionById(cdCheckoutSelectedId);
      var pin = window.__currentVenuePin;
      var titleEl = document.getElementById('cd-title');
      var instructorEl = document.getElementById('cd-booking-instructor');
      var venueEl = document.getElementById('cd-venue-text');
      var timeEl = document.getElementById('cd-checkout-time');
      var venueKey = pin ? ((pin.name || '') + '|' + (pin.lat || '') + '|' + (pin.lng || '')) : '';
      var redeemPack = cdCheckoutSheet.classList.contains('is-pack-redeem')
        ? cdGetVenuePack(venueKey)
        : null;
      var isRedeem = !!(redeemPack && redeemPack.remaining > 0);
      return {
        venueKey: venueKey,
        classTitle: titleEl ? titleEl.textContent : '',
        slotTime: cdLastSlot ? cdLastSlot.time : '',
        absIdx: cdSelectedAbsIdx,
        instructor: instructorEl ? instructorEl.textContent : '',
        venueName: venueEl ? venueEl.textContent : ((pin && pin.name) || ''),
        locality: (pin && pin.locality) || '',
        lat: pin && pin.lat,
        lng: pin && pin.lng,
        address: pin && pin.address,
        neighborhood: pin
          ? (pin._resolvedNeighborhood || pin.neighborhood || pin.locality || '')
          : '',
        venueTitle: pin ? pin.name : '',
        category: pin ? (pin._resolvedImageCategory || pin.category || '') : '',
        imageUrl: (function () {
          var triple = pickVenueImages(pin, window.__currentVenueIndex);
          return triple ? triple[0] : null;
        })(),
        venueIndex: window.__currentVenueIndex,
        rating: (function () {
          var n = document.getElementById('cd-header-rating-num');
          var c = document.getElementById('cd-header-rating-count');
          if (n && c && n.textContent) return n.textContent + ' ' + c.textContent;
          return '4.9 (250)';
        })(),
        plainPrice: (function () {
          var el = document.querySelector('#cd-booking-price .cd-booking-price-plain, #cd-booking-price .cd-booking-price-final');
          return el ? el.textContent.trim() : '$35';
        })(),
        pin: pin ? {
          name: pin.name,
          lat: pin.lat,
          lng: pin.lng,
          locality: pin.locality,
          neighborhood: pin.neighborhood,
          category: pin.category,
          address: pin.address,
          distance: pin.distance,
          _rating: pin._rating,
          _reviews: pin._reviews,
          _resolvedNeighborhood: pin._resolvedNeighborhood,
          _resolvedImageCategory: pin._resolvedImageCategory
        } : null,
        checkoutTime: timeEl ? timeEl.textContent : '',
        optionId: isRedeem ? redeemPack.optionId : (opt ? opt.id : cdDefaultCheckoutOptionId()),
        optionType: isRedeem ? 'pack' : (opt ? opt.type : 'dropin'),
        optionTitle: isRedeem ? redeemPack.title : (opt ? opt.title : ''),
        classes: isRedeem ? redeemPack.classes : (opt && opt.classes ? opt.classes : null),
        expiryMonths: isRedeem ? (redeemPack.expiryMonths || 12) : (opt && opt.expiryMonths ? opt.expiryMonths : 12)
      };
    }

    function cdRefreshVenueIntroOfferFlag() {
      window.__currentVenueHasIntroOffer = !!(window.__hasVenueIntroOffer
        && window.__currentVenuePin
        && window.__hasVenueIntroOffer(window.__currentVenuePin));
    }

    function cdCurrentVenueHasIntroOffer() {
      cdRefreshVenueIntroOfferFlag();
      return !!window.__currentVenueHasIntroOffer;
    }

    function cdBuildCheckoutOptionsCatalog(venueName) {
      var venue = venueName || 'ID Hot Yoga - Chelsea';
      var plainPriceEl = document.querySelector('.cd-booking-price-plain');
      var strikePriceEl = document.querySelector('.cd-booking-price-strike');
      var dropinPrice = plainPriceEl ? plainPriceEl.textContent.trim()
        : (strikePriceEl ? strikePriceEl.textContent.trim() : '$35.00');
      var options = [];
      if (cdCurrentVenueHasIntroOffer()) {
        options.push({ id: 'trial', section: 'dropins', type: 'dropin', title: 'New Member Trial Class', qty: '1 class', price: '$25.00' });
      }
      options.push(
        { id: 'dropin', section: 'dropins', type: 'dropin', title: 'Drop-in Class (inc. Mat + Towel)', qty: '1 class', price: dropinPrice },
        { id: 'pack5', section: 'packs', type: 'pack', badge: '$40 / class', title: '5 class card (mat + towel included)', qty: '5 classes', price: '$200.00', classes: 5, expiryMonths: 6,
          footerLines: ['Expires 6 months after first use.', 'Eligible at ' + venue + '.', 'Valid for all classes.'] },
        { id: 'pack10', section: 'packs', type: 'pack', badge: '$35 / class', title: '10 class card (mat + towel included)', qty: '10 classes', price: '$350.00', classes: 10, expiryMonths: 12,
          footerLines: ['Expires 12 months after first use.', 'Eligible at ' + venue + '.', 'Valid for all classes.'] },
        { id: 'pack20', section: 'packs', type: 'pack', badge: '$27.25 / class', title: '20 class card (mat + towel included)', qty: '20 classes', price: '$545.00', classes: 20, expiryMonths: 12,
          footerLines: ['Expires 12 months after first use.', 'Eligible at ' + venue + '.', 'Valid for all classes.'] }
      );
      return options;
    }

    function cdGetCheckoutOptionById(id) {
      for (var i = 0; i < cdCheckoutOptionsCatalog.length; i++) {
        if (cdCheckoutOptionsCatalog[i].id === id) return cdCheckoutOptionsCatalog[i];
      }
      return null;
    }

    function cdDefaultCheckoutOptionId() {
      return cdCurrentVenueHasIntroOffer() ? 'trial' : 'dropin';
    }

    function cdEnsureValidCheckoutOptionId(id) {
      if (id && cdGetCheckoutOptionById(id)) return id;
      return cdDefaultCheckoutOptionId();
    }

    function cdRenderOptionCard(opt) {
      var selected = opt.id === cdCheckoutPendingId;
      var cls = 'pl-card pl-pack' + (selected ? ' is-selected' : '');
      if (opt.type === 'pack') {
        var footerHtml = (opt.footerLines || []).map(function(line) {
          return '<li>' + line + '</li>';
        }).join('');
        return '<button type="button" class="' + cls + '" data-option-id="' + opt.id + '">'
          + '<span class="pl-pack__body">'
          + '<span class="pl-pack__badge">' + opt.badge + '</span>'
          + '<span class="pl-pack__title">' + opt.title + '</span>'
          + '<span class="pl-pack__row"><span class="pl-pack__qty">' + opt.qty + '</span>'
          + '<span class="pl-pack__price">' + opt.price + '</span></span></span>'
          + '<span class="pl-pack__footer"><ul class="cd-pack-footer-list">' + footerHtml + '</ul></span>'
          + '</button>';
      }
      return '<button type="button" class="' + cls + '" data-option-id="' + opt.id + '">'
        + '<span class="pl-pack__body">'
        + '<span class="pl-pack__title">' + opt.title + '</span>'
        + '<span class="pl-pack__row"><span class="pl-pack__qty">' + opt.qty + '</span>'
        + '<span class="pl-pack__price">' + opt.price + '</span></span></span>'
        + '</button>';
    }

    function cdRenderCheckoutOptionsLists() {
      var dropinsEl = document.getElementById('cd-options-dropins-list');
      var packsEl = document.getElementById('cd-options-packs-list');
      if (!dropinsEl || !packsEl) return;
      var dropHtml = '';
      var packHtml = '';
      cdCheckoutOptionsCatalog.forEach(function(opt) {
        if (opt.section === 'dropins') dropHtml += cdRenderOptionCard(opt);
        else if (opt.section === 'packs') packHtml += cdRenderOptionCard(opt);
      });
      dropinsEl.innerHTML = dropHtml;
      packsEl.innerHTML = packHtml;
    }

    function cdSyncOptionsCta() {
      var isEntry = cdOptionsIsEntry;
      var changed = cdCheckoutPendingId !== cdCheckoutSelectedId;
      if (cdCheckoutOptionsDone) {
        cdCheckoutOptionsDone.textContent = isEntry ? 'Continue' : 'Done';
        cdCheckoutOptionsDone.hidden = isEntry ? false : !changed;
      }
      if (cdCheckoutSheet) {
        cdCheckoutSheet.classList.toggle('is-options-pending', isEntry || changed);
      }
    }

    function cdApplyCheckoutOptionToCard() {
      var opt = cdGetCheckoutOptionById(cdCheckoutSelectedId);
      var paymentBlock = document.getElementById('cd-checkout-payment-block');
      if (!opt || !paymentBlock) return;
      var priceText = opt.price;
      var linePriceEl = document.getElementById('cd-checkout-line-price');
      var totalEl = document.getElementById('cd-checkout-total');
      var subtotalEl = document.getElementById('cd-checkout-subtotal');
      var refundEl = document.getElementById('cd-cancel-refund-amount');
      if (opt.type === 'pack') {
        var remaining = Math.max(0, opt.classes - 1);
        var expiryStr = cdFormatPackExpiry(opt.expiryMonths || 12);
        paymentBlock.innerHTML = ''
          + '<div class="pl-checkout-card__product pl-checkout-card__product--pack" id="cd-checkout-product">' + opt.title + '</div>'
          + '<div class="pl-checkout-card__row pl-checkout-card__row--pack" id="cd-checkout-payment-row">'
          + '<div class="pl-checkout-card__details">'
          + '<div class="pl-checkout-card__detail" id="cd-checkout-qty">' + remaining + ' of ' + opt.classes + ' left after booking</div>'
          + '<div class="pl-checkout-card__detail">' + expiryStr + '</div>'
          + '</div>'
          + '<span class="pl-checkout-card__price pl-checkout-card__price--pack" id="cd-checkout-line-price">' + priceText + '</span>'
          + '</div>';
      } else {
        paymentBlock.innerHTML = ''
          + '<div class="pl-checkout-card__product" id="cd-checkout-product">' + opt.title + '</div>'
          + '<div class="pl-checkout-card__row" id="cd-checkout-payment-row">'
          + '<span class="pl-checkout-card__qty" id="cd-checkout-qty">' + opt.qty + '</span>'
          + '<span class="pl-checkout-card__price" id="cd-checkout-line-price">' + priceText + '</span>'
          + '</div>';
      }
      if (totalEl) totalEl.textContent = priceText;
      if (subtotalEl) subtotalEl.textContent = priceText;
      if (refundEl) refundEl.textContent = priceText;
    }

    function cdPopulateSuccessModal() {
      var classTitleEl = document.getElementById('cd-checkout-class-title');
      var timeEl = document.getElementById('cd-checkout-time');
      var instructorEl = document.getElementById('cd-checkout-instructor');
      var venueEl = document.getElementById('cd-checkout-venue');
      var successClassEl = document.getElementById('cd-success-class-title');
      var successTimeEl = document.getElementById('cd-success-time');
      var successInstructorEl = document.getElementById('cd-success-instructor');
      var successVenueEl = document.getElementById('cd-success-venue');
      if (successClassEl && classTitleEl) successClassEl.textContent = classTitleEl.textContent;
      if (successTimeEl && timeEl) successTimeEl.textContent = timeEl.textContent;
      if (successInstructorEl && instructorEl) successInstructorEl.textContent = instructorEl.textContent;
      if (successVenueEl && venueEl) successVenueEl.textContent = venueEl.textContent;
    }

    function populateCancelModal() {
      var r = (typeof window.__findReservationForCurrentSlot === 'function'
        && window.__findReservationForCurrentSlot()) || window.__reservation;
      var isPack = cdReservationIsPack(r);
      var modal = document.getElementById('cd-cancel-modal');
      if (modal) modal.classList.toggle('pl-cancel-modal--pack', isPack);
      var expiryMonths = (r && r.expiryMonths) || 12;
      var expiryDate = cdFormatExpiryDate(expiryMonths);
      var policyEl = document.getElementById('cd-cancel-policy-text');
      if (policyEl) {
        policyEl.textContent = isPack
          ? 'After canceling, you\'ll get a visit returned to your pack, good until ' + expiryDate + '.'
          : 'After canceling, you\'ll get this visit returned to your balance to rebook, good until ' + expiryDate;
      }
      var titleEl = document.getElementById('cd-cancel-class-title');
      var timeEl = document.getElementById('cd-cancel-time');
      var instructorEl = document.getElementById('cd-cancel-instructor');
      var venueEl = document.getElementById('cd-cancel-venue');
      if (titleEl) titleEl.textContent = r ? r.classTitle : '';
      if (timeEl) timeEl.textContent = r ? (r.checkoutTime || r.slotTime || '') : '';
      if (instructorEl) instructorEl.textContent = r ? (r.instructor || '') : '';
      if (venueEl) {
        venueEl.textContent = r && r.locality && r.venueName
          ? r.venueName + ' · ' + r.locality
          : (r ? (r.venueName || '') : '');
      }
    }

    function populateCancelConfirm(r, returnedPack) {
      var isPack = cdReservationIsPack(r);
      if (cdCancelConfirmEl) {
        cdCancelConfirmEl.classList.toggle('pl-cancel-confirm-modal--pack', isPack);
      }
      var messageEl = document.getElementById('cd-cancel-confirm-message');
      if (messageEl) {
        messageEl.textContent = isPack
          ? 'Your visit is back in your pack'
          : '1 visit was returned to your balance';
      }
      if (!isPack || !r) return;
      var pack = returnedPack || cdGetVenuePack(r.venueKey || cdCurrentVenueKey()) || {
        title: r.optionTitle,
        classes: r.classes || 10,
        remaining: r.classes || 10,
        expiryMonths: r.expiryMonths || 12
      };
      cdFillPackCard(pack, {
        title: 'cd-cancel-confirm-pack-title',
        expiry: 'cd-cancel-confirm-pack-expiry',
        badge: 'cd-cancel-confirm-pack-badge'
      });
    }

    function cdRemeasureCheckoutHeight() {
      if (!cdCheckoutOpen || !cdCheckoutSheet) return;
      cdCheckoutSheet.style.transition = 'none';
      cdCheckoutSheet.style.height = 'auto';
      var viewportH = cdCheckoutSheet.parentElement.getBoundingClientRect().height
        || window.innerHeight;
      var maxH = viewportH - 60;
      var naturalH = cdCheckoutSheet.getBoundingClientRect().height;
      cdCheckoutSheet.style.height = Math.min(naturalH, maxH) + 'px';
      void cdCheckoutSheet.offsetHeight;
      cdCheckoutSheet.style.transition = '';
    }

    function cdAnimateCheckoutHeight(startHOverride) {
      if (!cdCheckoutOpen || !cdCheckoutSheet) return;
      var startH = startHOverride != null
        ? startHOverride
        : cdCheckoutSheet.getBoundingClientRect().height;
      var viewportH = cdCheckoutSheet.parentElement.getBoundingClientRect().height
        || window.innerHeight;
      var maxH = viewportH - 60;

      cdCheckoutSheet.style.height = startH + 'px';
      cdCheckoutSheet.style.height = 'auto';
      var targetH = Math.min(cdCheckoutSheet.getBoundingClientRect().height, maxH);
      cdCheckoutSheet.style.height = startH + 'px';
      void cdCheckoutSheet.offsetHeight;
      cdCheckoutSheet.style.height = targetH + 'px';
    }

    function cdEnterCheckoutSuccess() {
      cdPopulateSuccessModal();
      cdCheckoutCta.classList.remove('is-loading');
      var startH = cdCheckoutSheet.getBoundingClientRect().height;
      cdCheckoutSheet.style.height = startH + 'px';
      cdCheckoutSheet.classList.add('is-success');
      if (cdCheckoutSuccessEl) cdCheckoutSuccessEl.setAttribute('aria-hidden', 'false');
      cdAnimateCheckoutHeight(startH);
    }

    function cdEnterCancelConfirm() {
      cdCheckoutCta.classList.remove('is-loading');
      var startH = cdCheckoutSheet.getBoundingClientRect().height;
      // Keep the cancel-modal height. The confirm UI is an absolute overlay
      // and must not reflow the sheet or the policy/class card jumps up.
      cdCheckoutSheet.style.height = startH + 'px';
      cdCheckoutSheet.classList.add('is-cancel-confirmed');
      if (cdCancelConfirmEl) cdCancelConfirmEl.setAttribute('aria-hidden', 'false');
    }

    function cdSetOptionsTab(section) {
      if (!cdCheckoutOptionsTabs) return;
      cdCheckoutOptionsTabs.querySelectorAll('.pl-tab-nav__item').forEach(function(tab) {
        var on = tab.dataset.section === section;
        tab.classList.toggle('is-selected', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function cdScrollToOptionsSection(section) {
      var target = document.getElementById('cd-options-section-' + section);
      if (target && cdCheckoutOptionsScroll) {
        cdCheckoutOptionsScroll.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
      }
      cdSetOptionsTab(section);
    }

    function cdPrepareCheckoutOptions() {
      var venueText = document.getElementById('cd-venue-text');
      cdCheckoutOptionsCatalog = cdBuildCheckoutOptionsCatalog(venueText ? venueText.textContent : '');
      cdCheckoutSelectedId = cdEnsureValidCheckoutOptionId(cdCheckoutSelectedId);
      cdCheckoutPendingId = cdCheckoutSelectedId;
      cdRenderCheckoutOptionsLists();
      cdSyncOptionsCta();
    }

    function cdPopCheckoutToOptions() {
      cdOptionsIsEntry = true;
      cdPrepareCheckoutOptions();
      cdCheckoutSheet.classList.add('is-popping-to-options', 'is-options-open', 'is-options-entry');
      cdCheckoutSheet.classList.remove('is-pushing-checkout');
      if (cdCheckoutOptionsPanel) cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'false');
      var mainPane = cdCheckoutSheet.querySelector('.cd-checkout-pane--main');
      var onPopEnd = function(ev) {
        if (ev.target !== mainPane || ev.propertyName !== 'transform') return;
        mainPane.removeEventListener('transitionend', onPopEnd);
        cdCheckoutSheet.classList.remove('is-popping-to-options');
      };
      if (mainPane) mainPane.addEventListener('transitionend', onPopEnd);
      setTimeout(function() {
        if (cdCheckoutSheet) cdCheckoutSheet.classList.remove('is-popping-to-options');
      }, 560);
    }

    function cdOpenCheckoutOptions() {
      if (!cdCheckoutOpen || cdCheckoutSheet.classList.contains('is-cancel-mode')) return;
      if (purchaseFlow === 'B' && cdCheckoutSheet.classList.contains('is-pushing-checkout')) {
        cdPopCheckoutToOptions();
        return;
      }
      cdPrepareCheckoutOptions();
      cdCheckoutSheet.classList.add('is-options-open');
      if (cdCheckoutOptionsPanel) {
        cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'false');
      }
      cdSetOptionsTab('dropins');
      if (cdCheckoutOptionsScroll) cdCheckoutOptionsScroll.scrollTop = 0;
    }

    function cdCloseCheckoutOptions(apply) {
      if (!cdCheckoutSheet.classList.contains('is-options-open')) return;
      if (apply) {
        cdCheckoutSelectedId = cdCheckoutPendingId;
        cdApplyCheckoutOptionToCard();
        if (cdOptionsIsEntry) {
          cdOptionsIsEntry = false;
          if (cdCheckoutCtaLabel && !cdCheckoutSheet.classList.contains('is-cancel-mode')) {
            cdSyncCheckoutPrimaryCopy();
          }
          cdCheckoutSheet.classList.add('is-pushing-checkout');
          cdCheckoutSheet.classList.remove('is-options-open', 'is-options-pending', 'is-options-entry', 'is-popping-to-options');
          if (cdCheckoutOptionsPanel) cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'true');
          if (cdCheckoutOptionsDone) cdCheckoutOptionsDone.hidden = true;
          return;
        }
      } else {
        cdCheckoutPendingId = cdCheckoutSelectedId;
      }
      cdCheckoutSheet.classList.remove('is-options-open', 'is-options-pending');
      if (cdCheckoutOptionsPanel) cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'true');
      if (cdCheckoutOptionsDone) cdCheckoutOptionsDone.hidden = true;
    }

    function cdSelectCheckoutOption(id) {
      cdCheckoutPendingId = id;
      cdRenderCheckoutOptionsLists();
      cdSyncOptionsCta();
    }

    if (cdCheckoutPromoBtn) {
      cdCheckoutPromoBtn.addEventListener('click', cdOpenCheckoutOptions);
    }
    if (cdCheckoutOptionsBack) {
      cdCheckoutOptionsBack.addEventListener('click', function() {
        if (cdCheckoutSheet.classList.contains('is-options-open')) {
          cdCloseCheckoutOptions(false);
        } else if (purchaseFlow === 'B') {
          cdOpenCheckoutOptions();
        }
      });
    }
    if (cdCheckoutOptionsDone) {
      cdCheckoutOptionsDone.addEventListener('click', function() { cdCloseCheckoutOptions(true); });
    }
    if (cdCheckoutOptionsTabs) {
      cdCheckoutOptionsTabs.addEventListener('click', function(e) {
        var tab = e.target.closest('.pl-tab-nav__item');
        if (!tab || !tab.dataset.section) return;
        cdScrollToOptionsSection(tab.dataset.section);
      });
    }
    if (cdCheckoutOptionsScroll) {
      cdCheckoutOptionsScroll.addEventListener('click', function(e) {
        var card = e.target.closest('[data-option-id]');
        if (!card) return;
        cdSelectCheckoutOption(card.dataset.optionId);
      });
      // Keep the sticky tab indicator in sync while scrolling long lists.
      cdCheckoutOptionsScroll.addEventListener('scroll', function() {
        var packsSection = document.getElementById('cd-options-section-packs');
        if (!packsSection) return;
        var scrollTop = cdCheckoutOptionsScroll.scrollTop;
        var packsTop = packsSection.offsetTop - 24;
        cdSetOptionsTab(scrollTop >= packsTop ? 'packs' : 'dropins');
      }, { passive: true });
    }
    function showCancelToast() {
      if (!cdCancelToastEl) return;
      if (cdCancelToastTimer) clearTimeout(cdCancelToastTimer);
      cdCancelToastEl.classList.add('is-visible');
      cdCancelToastEl.setAttribute('aria-hidden', 'false');
      cdCancelToastTimer = setTimeout(function() {
        cdCancelToastEl.classList.remove('is-visible');
        cdCancelToastEl.setAttribute('aria-hidden', 'true');
        cdCancelToastTimer = null;
      }, 2000);
    }
    // Reservation record drives BOTH the "Reserved · $X" price prefix on
    // matching time-slot / schedule cards AND the booking-bar CTA state
    // (black "Cancel" when the currently-viewed class+slot matches the
    // reservation; default red "Book" otherwise). Cleared when the user
    // taps Cancel.
    window.__reservations = window.__reservations || [];
    window.__reservation = window.__reservation || null;
    window.__venuePacks = {};
    function currentSlotMatchesReservation() {
      return !!window.__findReservationForCurrentSlot();
    }
    window.__findReservationForCurrentSlot = function() {
      var list = window.__reservations || [];
      var p = window.__currentVenuePin;
      var venueKey = p ? ((p.name || '') + '|' + (p.lat || '') + '|' + (p.lng || '')) : '';
      var cdTitleEl = document.getElementById('cd-title');
      var title = cdTitleEl ? cdTitleEl.textContent : '';
      var slotTime = cdLastSlot ? cdLastSlot.time : '';
      var i;
      for (i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.venueKey === venueKey
          && r.classTitle === title
          && r.slotTime === slotTime
          && r.absIdx === cdSelectedAbsIdx) {
          return r;
        }
      }
      return null;
    };
    window.__syncBookingBarCta = function() {
      if (!cdBookingCta) return;
      if (currentSlotMatchesReservation()) {
        cdBookingCta.textContent = 'Cancel';
        cdBookingCta.classList.add('is-reserved');
      } else {
        cdBookingCta.textContent = 'Book';
        cdBookingCta.classList.remove('is-reserved');
      }
    };
    function clearReservedCard(el) {
      el.classList.remove('is-reserved');
      if (!el.classList.contains('disabled')) el.classList.remove('is-dimmed');
      var status = el.querySelector('.pl-card__status--reserved');
      if (status) status.remove();
      var price = el.querySelector('.pl-price');
      if (price) price.hidden = false;
    }
    function markReservedCard(el) {
      el.classList.add('is-reserved', 'is-dimmed');
      var price = el.querySelector('.pl-price');
      if (price) price.hidden = true;
      if (!el.querySelector('.pl-card__status--reserved')) {
        var row = price && price.parentNode;
        var status = '<span class="pl-card__status pl-card__status--reserved">Reserved</span>';
        if (row) row.insertAdjacentHTML('beforeend', status);
      }
    }
    window.__applyReservedHighlights = function() {
      var list = window.__reservations || [];
      document.querySelectorAll('.cd-time-slot.is-reserved, .vd-schedule-card.is-reserved').forEach(clearReservedCard);
      if (!list.length) return;
      var p = window.__currentVenuePin;
      var venueKey = p ? ((p.name || '') + '|' + (p.lat || '') + '|' + (p.lng || '')) : '';
      var cdTitleEl = document.getElementById('cd-title');
      list.forEach(function(r) {
        if (venueKey !== r.venueKey) return;
        // Class-detail time slots only highlight when the currently-viewed
        // class AND the currently-viewed date match the reservation — without
        // the date check, the same time slot on a different day would falsely
        // show as reserved when the user tabs through the date picker.
        if (cdTitleEl && cdTitleEl.textContent === r.classTitle && cdViewingAbsIdx === r.absIdx) {
          document.querySelectorAll('.cd-time-slot').forEach(function(slot) {
            if (slot.dataset.time === r.slotTime) markReservedCard(slot);
          });
        }
        // Venue-detail schedule cards match on title + time.
        document.querySelectorAll('.vd-schedule-card').forEach(function(card) {
          if (card.dataset.title === r.classTitle && card.dataset.time === r.slotTime) {
            markReservedCard(card);
          }
        });
      });
    };
    if (cdCheckoutCta) {
      cdCheckoutCta.addEventListener('click', function() {
        if (!cdCheckoutOpen) return;
        // Cancel-mode tap ("Confirm cancellation"): show the iOS spinner
        // for 2s, then clear the reservation and crossfade to the
        // pack / drop-in cancel-confirm modal.
        if (cdCheckoutSheet.classList.contains('is-cancel-mode')) {
          cdCheckoutCta.classList.add('is-loading');
          if (cdCancelConfirmTimer) clearTimeout(cdCancelConfirmTimer);
          cdCancelConfirmTimer = setTimeout(function() {
            var canceled = (typeof window.__findReservationForCurrentSlot === 'function'
              && window.__findReservationForCurrentSlot()) || window.__reservation;
            var returnedPack = cdReturnPackVisit(canceled);
            populateCancelConfirm(canceled, returnedPack);
            if (typeof window.__removeReservation === 'function') window.__removeReservation(canceled);
            else window.__reservation = null;
            if (window.__applyReservedHighlights) window.__applyReservedHighlights();
            if (window.__syncBookingBarCta) window.__syncBookingBarCta();
            if (window.__syncBookingsCard) window.__syncBookingsCard();
            cdCancelConfirmTimer = null;
            if (!cdCheckoutOpen) return;
            cdEnterCancelConfirm();
          }, 2000);
          return;
        }
        cdCheckoutCta.classList.add('is-loading');
        if (cdCheckoutSuccessTimer) clearTimeout(cdCheckoutSuccessTimer);
        cdCheckoutSuccessTimer = setTimeout(function() {
          if (!cdCheckoutOpen) return;
          cdEnterCheckoutSuccess();
        }, 2000);
      });
    }

    function populateCheckout() {
      var instructor = document.getElementById('cd-booking-instructor').textContent;
      // The booking-bar time element renders "{shortDate} · {time}", so
      // take only the trailing time portion to avoid duplicating the date.
      var bookingTimeText = document.getElementById('cd-booking-time').textContent;
      var slotTime = (cdLastSlot && cdLastSlot.time)
        || bookingTimeText.split(' · ').pop();
      // Compute the date from the day index the user picked in the
      // cd-date-picker (0 = today, 1 = tomorrow, ...). The booking bar
      // dataset.fullTime is captured at slot-tap time and would go stale
      // if the user changes the date afterwards, so we recompute here.
      var date = new Date();
      date.setDate(date.getDate() + (cdSelectedAbsIdx || 0));
      var dayShort = date.toLocaleDateString('en-US', { weekday: 'short' });
      var monthShort = date.toLocaleDateString('en-US', { month: 'short' });
      var dateStr = dayShort + ', ' + monthShort + ' ' + date.getDate();
      var checkoutTime = dateStr + ' · ' + slotTime;
      var titleEl = document.getElementById('cd-title');
      var classTitle = titleEl ? titleEl.textContent : '';
      var venueText = document.getElementById('cd-venue-text');
      var venueStr = venueText ? venueText.textContent : '';
      // Checkout-mode card copy. Cancel-mode copy is filled from the
      // reservation in populateCancelModal.
      document.getElementById('cd-checkout-class-title').textContent = classTitle;
      document.getElementById('cd-checkout-time').textContent = checkoutTime;
      document.getElementById('cd-checkout-instructor').textContent = instructor;
      document.getElementById('cd-checkout-venue').textContent = venueStr;
      var redeemPack = cdGetVenuePack(cdCurrentVenueKey());
      var redeeming = !cdCheckoutSheet.classList.contains('is-cancel-mode')
        && !!(redeemPack && redeemPack.remaining > 0);
      cdCheckoutSheet.classList.toggle('is-pack-redeem', redeeming);
      if (redeeming) {
        cdFillPackCard(redeemPack, {
          title: 'cd-checkout-pack-title',
          expiry: 'cd-checkout-pack-expiry',
          badge: 'cd-checkout-pack-badge'
        });
      } else {
        cdCheckoutOptionsCatalog = cdBuildCheckoutOptionsCatalog(venueStr);
        cdCheckoutSelectedId = cdEnsureValidCheckoutOptionId(cdCheckoutSelectedId);
        cdApplyCheckoutOptionToCard();
      }
      cdSyncCheckoutPrimaryCopy();
      // "Cancel by <date> at <time> ET" — exactly 12 hours before class
      // start. Computed from the same date/slotTime we populated above so
      // it always stays in sync with the booking.
      var cancelCutoffEl = document.getElementById('cd-checkout-cancel-cutoff');
      if (cancelCutoffEl) {
        var slotMatch = slotTime && slotTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (slotMatch) {
          var slotHour = parseInt(slotMatch[1], 10);
          var slotMin = parseInt(slotMatch[2], 10);
          var slotPeriod = slotMatch[3].toUpperCase();
          if (slotPeriod === 'PM' && slotHour !== 12) slotHour += 12;
          if (slotPeriod === 'AM' && slotHour === 12) slotHour = 0;
          var cutoff = new Date(date);
          cutoff.setHours(slotHour, slotMin, 0, 0);
          cutoff.setHours(cutoff.getHours() - 12);
          var cDay = cutoff.toLocaleDateString('en-US', { weekday: 'short' });
          var cMonth = cutoff.toLocaleDateString('en-US', { month: 'short' });
          var cH = cutoff.getHours();
          var cPeriod = cH >= 12 ? 'PM' : 'AM';
          cH = (cH % 12) || 12;
          var cMin = String(cutoff.getMinutes()).padStart(2, '0');
          cancelCutoffEl.textContent = 'Cancel by ' + cDay + ', ' + cMonth + ' ' + cutoff.getDate() + ' at ' + cH + ':' + cMin + ' ' + cPeriod + ' ET';
        }
      }
    }

    // Pure CSS-driven morph: every animated property (height, left, right,
    // bottom, border-radius, background, shadow, backdrop-filter) uses the
    // same CSS transition rule so they all land on the same frame — no
    // Motion/CSS timing mismatch, no jitter on close.
    var cdCheckoutEndHandler = null;
    var cdCheckoutHideTimer = null;

    function openCheckout(opts) {
      if (cdCheckoutOpen) return;
      opts = opts || {};
      cdCheckoutOpen = true;
      populateCheckout();
      var redeeming = cdCheckoutSheet.classList.contains('is-pack-redeem');
      var openOnOptions = !!opts.openOnOptions
        && !cdCheckoutSheet.classList.contains('is-cancel-mode')
        && !redeeming;
      cdOptionsIsEntry = openOnOptions;
      cdCheckoutSheet.classList.toggle('is-flow-b', purchaseFlow === 'B' && !cdCheckoutSheet.classList.contains('is-cancel-mode') && !redeeming);
      cdCheckoutSheet.classList.toggle('is-options-entry', openOnOptions);
      if (openOnOptions) cdPrepareCheckoutOptions();
      // Clear any lingering transitionend listener or pending hide timer
      // from a cancelled close.
      if (cdCheckoutEndHandler) {
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
        cdCheckoutEndHandler = null;
      }
      if (cdCheckoutHideTimer) {
        clearTimeout(cdCheckoutHideTimer);
        cdCheckoutHideTimer = null;
      }
      cdCheckoutSheet.classList.remove('is-collapsing', 'is-success', 'is-cancel-confirmed');
      if (cdCheckoutSuccessEl) cdCheckoutSuccessEl.setAttribute('aria-hidden', 'true');
      if (cdCancelConfirmEl) cdCancelConfirmEl.setAttribute('aria-hidden', 'true');
      // Reset CTA state from any prior close — the previous closeCheckout
      // may have left the sheet's CTA in the black Cancel state to morph
      // cleanly into the bar. Checkout opens as red Book; cancel mode
      // keeps the inverse pill so it matches Confirm cancellation.
      if (!cdCheckoutSheet.classList.contains('is-cancel-mode')) {
        cdCheckoutCta.classList.remove('is-reserved');
      } else {
        cdCheckoutCta.classList.add('is-reserved');
      }
      // Strip any lingering sheet-overlay flag (e.g. from an interrupted
      // close) before re-applying it below.
      cdBookingBar.classList.remove('is-sheet-overlay');
      // Measure the sheet's natural content height while still hidden. The
      // sheet uses border-box + extra padding when open, so we briefly add
      // is-open (with transitions disabled) to get the true open-state
      // content height, then revert for the animated open.
      var startH = cdBookingBar.getBoundingClientRect().height;
      cdCheckoutSheet.style.transition = 'none';
      // Also pause CTA transitions during the measure-toggle — otherwise the
      // CTA starts a tiny morph toward Book-position and back, which the user
      // sees as a jerk just before the real animation begins.
      cdCheckoutCta.style.transition = 'none';
      if (openOnOptions) {
        cdCheckoutSheet.classList.add('is-options-open', 'is-options-instant');
        if (cdCheckoutOptionsPanel) cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'false');
        cdSetOptionsTab('dropins');
        if (cdCheckoutOptionsScroll) cdCheckoutOptionsScroll.scrollTop = 0;
      }
      cdCheckoutSheet.classList.add('is-open');
      cdCheckoutSheet.style.height = 'auto';
      var naturalH = cdCheckoutSheet.getBoundingClientRect().height;
      cdCheckoutSheet.classList.remove('is-open');
      cdCheckoutSheet.style.height = startH + 'px';
      // Commit the reverted closed state before re-enabling transitions so
      // the animated open below transitions from this committed baseline.
      void cdCheckoutSheet.offsetHeight;
      cdCheckoutSheet.style.transition = '';
      cdCheckoutCta.style.transition = '';
      var viewportH = cdCheckoutSheet.parentElement.getBoundingClientRect().height
        || window.innerHeight;
      var maxH = viewportH - 60;
      var targetH = Math.min(naturalH, maxH);
      cdCheckoutSheet.style.visibility = 'visible';
      cdCheckoutSheet.setAttribute('aria-hidden', 'false');
      cdBookingBar.classList.add('is-under-checkout');
      cdBookingBar.classList.add('is-sheet-overlay');
      cdCheckoutScrim.classList.add('is-visible');
      // Swap the label immediately so the morph from the bar's short pill
      // ("Book" / "Cancel") to the full-width modal CTA reads as a single
      // continuous transition. The pill's overflow:hidden + nowrap clips
      // the wider text during the early frames of the morph, but that
      // reads better than a 200ms-late text swap mid-expansion.
      if (cdCheckoutCtaLabel) {
        cdSyncCheckoutPrimaryCopy();
      }
      // Add is-open to trigger the coordinated CSS transitions.
      cdCheckoutSheet.classList.add('is-open');
      cdCheckoutSheet.style.height = targetH + 'px';
      if (openOnOptions) {
        requestAnimationFrame(function() {
          cdCheckoutSheet.classList.remove('is-options-instant');
        });
      }
    }

    // Open the same sheet but in cancel-reservation mode — pack vs
    // drop-in body from the design-system cancel modal, driven by the
    // option stored on the reservation. Shares morph + close with openCheckout.
    function openCancelCheckout() {
      if (cdCheckoutOpen) return;
      cdCheckoutSheet.classList.add('is-cancel-mode');
      populateCancelModal();
      var titleEl = document.getElementById('cd-checkout-title');
      if (titleEl) titleEl.textContent = 'Cancel reservation';
      // Set the CTA label immediately so the morph from the bar's "Cancel"
      // pill into the full-width modal CTA reads as a single continuous
      // transition. Without this, the 200ms label-swap delay in
      // openCheckout (intended for the "Book" → "Buy and reserve" case)
      // leaves "Cancel" visible until the pill is nearly full width.
      if (cdCheckoutCtaLabel) cdCheckoutCtaLabel.textContent = 'Confirm cancellation';
      openCheckout();
    }

    function closeCheckout() {
      if (!cdCheckoutOpen) return;
      cdCheckoutOpen = false;
      // Round to whole px so the sheet lands at exactly the bar's rendered
      // height — sub-pixel mismatch between the animated target and the
      // bar's integer-rounded height shows up as a 1px jitter at the end
      // of the close.
      var targetH = Math.round(cdBookingBar.getBoundingClientRect().height) || 130;
      // Mirror the bar's datetime + price-row into the sheet's mini-summary
      // so the sheet's end-of-morph visual matches the bar exactly.
      // - mini-meta gets the datetime (bold black, top row)
      // - mini-price gets the price HTML (preserves strike/final spans)
      // - mini-instructor gets the instructor name (gray, suffix on the
      //   bottom row after the "·" separator)
      var miniPrice = document.getElementById('cd-mini-price');
      var miniMeta = document.getElementById('cd-mini-meta');
      var miniInstr = document.getElementById('cd-mini-instructor');
      var barPriceEl = document.getElementById('cd-booking-price');
      var barTimeEl = document.getElementById('cd-booking-time');
      var barInstrEl = document.getElementById('cd-booking-instructor');
      if (miniPrice && barPriceEl) miniPrice.innerHTML = barPriceEl.innerHTML;
      if (miniMeta && barTimeEl) miniMeta.textContent = barTimeEl.textContent;
      if (miniInstr && barInstrEl) miniInstr.textContent = barInstrEl.textContent;
      cdCheckoutSheet.classList.add('is-collapsing');
      cdCheckoutSheet.classList.remove('is-open');
      cdCheckoutScrim.classList.remove('is-visible');
      cdCheckoutSheet.style.height = targetH + 'px';
      // Start fading the bar's content back in NOW so the 0.18s transition
      // completes well before the sheet finishes shrinking. The bar sits
      // below the sheet (z 35 vs 36), so the fade isn't visible yet — but
      // by the time the sheet hides at transitionend, the content is
      // already at opacity 1, eliminating the empty-frame flash that
      // happens if we kick off the fade at sheet-hide.
      cdBookingBar.classList.remove('is-under-checkout');
      cdCheckoutCta.classList.remove('is-loading');
      // Reset the cancel-mode UI so the next open starts in checkout mode.
      cdCheckoutSheet.classList.remove('is-cancel-mode');
      cdCheckoutSheet.classList.remove('is-options-open', 'is-options-pending', 'is-flow-b', 'is-options-entry', 'is-options-instant', 'is-pushing-checkout', 'is-popping-to-options');
      cdOptionsIsEntry = false;
      if (cdCheckoutOptionsPanel) cdCheckoutOptionsPanel.setAttribute('aria-hidden', 'true');
      if (cdCheckoutOptionsDone) {
        cdCheckoutOptionsDone.hidden = true;
        cdCheckoutOptionsDone.textContent = 'Done';
      }
      var purchased = cdSnapshotPurchase();
      cdCheckoutSelectedId = null;
      cdCheckoutPendingId = null;
      // Collapse the total breakdown so re-opening starts in the collapsed
      // state (chevron pointing down, Subtotal/Taxes hidden).
      if (cdCheckoutPaymentSection) {
        cdCheckoutPaymentSection.classList.remove('is-expanded');
        if (cdCheckoutTotalToggle) cdCheckoutTotalToggle.setAttribute('aria-expanded', 'false');
      }
      var titleResetEl = document.getElementById('cd-checkout-title');
      if (titleResetEl) titleResetEl.textContent = 'Review and confirm';
      // Dismissing while in the success state (close, scrim, etc.) commits
      // the reservation so any close path produces the same outcome.
      // Capture happens BEFORE the CTA label/style is set below so the
      // sheet's CTA can morph directly to the final "Cancel" black state
      // (matching the bar underneath) instead of flashing red Book.
      // The purchased option (drop-in vs pack, and which pack) is stored
      // so a later Cancel opens the matching cancel / confirm modals.
      if (cdCheckoutSheet.classList.contains('is-success')) {
        cdApplyPackAfterPurchase(purchased);
        if (typeof window.__addReservation === 'function') window.__addReservation(purchased);
        else window.__reservation = purchased;
        if (window.__applyReservedHighlights) window.__applyReservedHighlights();
        if (window.__syncBookingsCard) window.__syncBookingsCard();
      }
      cdCheckoutSheet.classList.remove('is-success', 'is-cancel-confirmed', 'is-pack-redeem');
      if (cdCheckoutSuccessEl) cdCheckoutSuccessEl.setAttribute('aria-hidden', 'true');
      if (cdCancelConfirmEl) cdCancelConfirmEl.setAttribute('aria-hidden', 'true');
      // Morph the sheet's CTA to whatever state the booking bar will show
      // once revealed — black "Cancel" if a reservation now exists for the
      // viewed slot, red "Book" otherwise. The sheet sits at z 36 over the
      // bar (z 35), so without this the user sees the sheet's red Book
      // collapse and then the bar's black Cancel snap in at end-of-morph.
      var willShowCancel = currentSlotMatchesReservation();
      if (cdCheckoutCtaLabel) cdCheckoutCtaLabel.textContent = willShowCancel ? 'Cancel' : 'Book';
      if (willShowCancel) {
        cdCheckoutCta.classList.add('is-reserved');
      } else {
        cdCheckoutCta.classList.remove('is-reserved');
      }
      // Sync the booking-bar CTA against the (possibly just-committed)
      // reservation — black "Cancel" if the currently-viewed slot is
      // the reserved one, red "Book" otherwise.
      if (window.__syncBookingBarCta) window.__syncBookingBarCta();
      if (cdCheckoutSuccessTimer) {
        clearTimeout(cdCheckoutSuccessTimer);
        cdCheckoutSuccessTimer = null;
      }
      // If the user X-closed during the cancel spinner, abandon the
      // pending cancellation — they backed out of the confirm step.
      if (cdCancelConfirmTimer) {
        clearTimeout(cdCancelConfirmTimer);
        cdCancelConfirmTimer = null;
      }
      // Wait for the full height transitionend (440ms) before hiding the
      // sheet. The mini-summary fades in mid-close so the user sees a bar-
      // looking sheet by the time the sheet swaps to the actual bar — no
      // empty-card gap, no visible height mismatch from snapping early.
      if (cdCheckoutEndHandler) {
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
        cdCheckoutEndHandler = null;
      }
      if (cdCheckoutHideTimer) {
        clearTimeout(cdCheckoutHideTimer);
        cdCheckoutHideTimer = null;
      }
      cdCheckoutEndHandler = function(ev) {
        if (ev.target !== cdCheckoutSheet || ev.propertyName !== 'height') return;
        cdCheckoutSheet.removeEventListener('transitionend', cdCheckoutEndHandler);
        cdCheckoutEndHandler = null;
        cdCheckoutSheet.style.visibility = 'hidden';
        cdCheckoutSheet.setAttribute('aria-hidden', 'true');
        cdCheckoutSheet.classList.remove('is-collapsing');
        // Sheet is now invisible — return the bar's shadow.
        cdBookingBar.classList.remove('is-sheet-overlay');
      };
      cdCheckoutSheet.addEventListener('transitionend', cdCheckoutEndHandler);
    }

    if (cdBookingCta) cdBookingCta.addEventListener('click', function() {
      // If the user is currently viewing the reserved slot, the CTA is
      // showing "Cancel" — open the cancel-reservation sheet so the user
      // can confirm. The actual reservation-clear happens when they tap
      // "Confirm cancellation" inside the sheet.
      if (currentSlotMatchesReservation()) {
        openCancelCheckout();
        return;
      }
      if (purchaseFlow === 'B') {
        openCheckout({ openOnOptions: true });
        return;
      }
      openCheckout();
    });
    if (cdCheckoutCloseBtn) cdCheckoutCloseBtn.addEventListener('click', closeCheckout);
    if (cdCheckoutSuccessCloseBtn) cdCheckoutSuccessCloseBtn.addEventListener('click', closeCheckout);
    if (cdCancelConfirmCloseBtn) cdCancelConfirmCloseBtn.addEventListener('click', closeCheckout);
    if (cdCancelConfirmDoneBtn) {
      cdCancelConfirmDoneBtn.addEventListener('click', function() {
        var fromBookings = venueDetailSheet.classList.contains('from-bookings');
        closeCheckout();
        if (fromBookings) closeVenueDetail();
      });
    }
    if (cdCancelConfirmFindBtn) {
      cdCancelConfirmFindBtn.addEventListener('click', function() {
        var fromBookings = venueDetailSheet.classList.contains('from-bookings');
        closeCheckout();
        if (fromBookings) {
          closeVenueDetail();
          openSearchTab();
          return;
        }
        closeClassDetail();
        if (window.__switchVenueDetailTab) window.__switchVenueDetailTab('schedule');
      });
    }
    if (cdCheckoutSuccessAddBtn) {
      cdCheckoutSuccessAddBtn.addEventListener('click', function() {
        /* Visual affordance only — no calendar integration in the prototype. */
      });
    }
    if (cdCheckoutScrim) cdCheckoutScrim.addEventListener('click', closeCheckout);
    // If class detail closes while checkout is open, dismiss checkout too.
    window.__closeCheckoutIfOpen = function() {
      if (cdCheckoutOpen) closeCheckout();
    };

    // Close button
    document.getElementById('class-detail-close').addEventListener('click', function() {
      if (venueDetailSheet.classList.contains('from-bookings')) closeVenueDetail();
      else closeClassDetail();
    });

    // Tapping the venue link (e.g. "JetSet Pilates · New York ›") dismisses the class detail
    // and returns the user to the venue detail underneath. Keep .from-bookings
    // so the Bookings scrim stays while the venue sheet is still a modal.
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
        // Suppress clicks that are the tail end of a drag-scroll — otherwise
        // releasing a vertical drag over a see-more link toggles it.
        if (wasDragging) return;
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

    // ===== Tabs =====
    var cdTabs = classDetailEl.querySelectorAll('.cd-tabs .pl-tab-nav__item');
    var cdPanels = classDetailEl.querySelectorAll('.cd-panel');

    function setCdTabSelected(tab) {
      cdTabs.forEach(function(t) {
        var on = t === tab;
        t.classList.toggle('is-selected', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    // Sizes the currently active panel just-tall-enough so that scrollTop can
    // reach __cdPinOffset (enabling sticky tab pin), but no taller — short
    // schedules with only a few slots otherwise scroll into a lot of empty
    // grey space below the last slot.
    function fitCdActivePanelHeight() {
      var active = classDetailEl.querySelector('.cd-panel.active');
      if (!active) return;
      active.style.minHeight = '';
      var pinOffset = window.__cdPinOffset || 0;
      if (pinOffset <= 0) return;
      var ch = classDetailScroll.clientHeight;
      var sh = classDetailScroll.scrollHeight;
      var required = pinOffset + ch;
      if (sh < required) {
        var currentH = active.getBoundingClientRect().height;
        active.style.minHeight = Math.ceil(currentH + (required - sh)) + 'px';
      }
    }
    window.__fitCdActivePanelHeight = fitCdActivePanelHeight;

    // Animate classDetailScroll.scrollTop from current to target with an
    // ease-out cubic. Cancels any in-flight tab-switch scroll animation.
    // Any user-initiated scroll (wheel/touch) aborts the animation so the
    // user can grab the scroll mid-glide.
    var cdTabScrollRaf = null;
    function cancelCdTabScroll() {
      if (cdTabScrollRaf) {
        cancelAnimationFrame(cdTabScrollRaf);
        cdTabScrollRaf = null;
      }
    }
    classDetailScroll.addEventListener('wheel', cancelCdTabScroll, { passive: true });
    classDetailScroll.addEventListener('touchstart', cancelCdTabScroll, { passive: true });
    classDetailScroll.addEventListener('mousedown', cancelCdTabScroll);
    function smoothScrollCdTo(target, duration) {
      cancelCdTabScroll();
      var start = classDetailScroll.scrollTop;
      var delta = target - start;
      if (Math.abs(delta) < 1) {
        classDetailScroll.scrollTop = target;
        return;
      }
      var startTime = performance.now();
      var d = duration || 360;
      function step(now) {
        var t = Math.min(1, (now - startTime) / d);
        var eased = 1 - Math.pow(1 - t, 3);
        classDetailScroll.scrollTop = start + delta * eased;
        if (t < 1) {
          cdTabScrollRaf = requestAnimationFrame(step);
        } else {
          cdTabScrollRaf = null;
        }
      }
      cdTabScrollRaf = requestAnimationFrame(step);
    }

    function activateCdTab(tab) {
      setCdTabSelected(tab);
      var name = tab.dataset.cdtab;
      cdPanels.forEach(function(p) { p.classList.toggle('active', p.dataset.cdpanel === name); });
      // Land at the cached pin (top of the new tab's content). Behavior
      // depends on where the user is:
      //   - Above the pin (hero still visible): glide to pinOffset so the
      //     sticky nav fades in alongside the scroll.
      //   - At or past the pin (tabs already pinned): SNAP instantly to
      //     pinOffset. The new tab's content should always start at the
      //     top — but an animated scroll back to pinOffset from a deep
      //     scroll position would feel like "scrolling to initial state".
      //     Instant snap reads as "tabs pinned, content reset, ready".
      // Deferred to next frame so the panel display: none → flex swap
      // has committed layout before we fit the panel's min-height.
      requestAnimationFrame(function() {
        fitCdActivePanelHeight();
        var pinOffset = window.__cdPinOffset || 0;
        if (pinOffset <= 0) return;
        var maxScroll = classDetailScroll.scrollHeight - classDetailScroll.clientHeight;
        var target = Math.min(pinOffset, Math.max(0, maxScroll));
        if (classDetailScroll.scrollTop < pinOffset - 4) {
          smoothScrollCdTo(target, 360);
        } else {
          cancelCdTabScroll();
          classDetailScroll.scrollTop = target;
        }
      });
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

    // Reset to overview tab (called on each open)
    window.__resetClassDetailTabs = function() {
      var overviewTab = Array.prototype.find.call(cdTabs, function(t) { return t.dataset.cdtab === 'overview'; });
      if (overviewTab) setCdTabSelected(overviewTab);
      cdPanels.forEach(function(p) { p.classList.toggle('active', p.dataset.cdpanel === 'overview'); });
    };

    // ===== Shared sticky nav: fade title in on scroll =====
    // The shared nav at the top of the sheet handles BOTH panes' icon and
    // title styling via .scrolled. The grey backdrop now lives in the pane
    // itself (.vd-pane-nav-bg), so it slides with the class pane.
    var cdStickyNav = document.getElementById('vd-sticky-nav');
    var cdPaneBg = document.getElementById('vd-pane-nav-bg-class');
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
      var scrolled = st > cdTitleScrollThreshold;
      // Per-pane backdrop: fades to grey once the user scrolls past the
      // class title. Slides horizontally with the pane on push/pop.
      if (cdPaneBg) cdPaneBg.classList.toggle('scrolled', scrolled);
      // Shared nav title fade-in + icon white-bg state.
      cdStickyNav.classList.toggle('scrolled', scrolled);
    }, { passive: true });

    // Class detail no longer has its own drag-to-dismiss — the venue sheet's
    // drag-down handler dismisses the entire stack, and the back arrow in the
    // class pane's nav slides the user back to the venue pane.
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
        // The cluster sheet's list lives inside .cluster-sheet (not a
        // .results-sheet). Until it's expanded, a drag here must bubble to the
        // cluster sheet's own drag handler so the sheet expands — otherwise
        // stopPropagation below eats it and the sheet can't be dragged up.
        var clusterSheetParent = el.closest('.cluster-sheet');
        if (clusterSheetParent && !clusterSheetParent.classList.contains('is-expanded')) return;
      }
      if (e.target.closest('button, a, .venue-action-btn, .vd-action-pill, .vd-slot-btn, .vd-quick-btn, .venue-detail-close, .vd-nav-back, .venue-detail-handle, .vd-sticky-nav, .vd-actions-pill, .pl-tab-nav__item, .cd-thumb')) return;
      var hscrollChild = e.target.closest('.vd-hscroll, .vd-date-picker, .cd-date-picker');
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
  document.querySelectorAll('.vd-hscroll, .vd-date-picker, .cd-date-picker').forEach(function(el) {
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

    // No vertical→horizontal wheel redirect: it hijacks the page's vertical
    // mouse-wheel scroll whenever the cursor crosses a carousel. Trackpads can
    // still pan carousels horizontally via native deltaX; mouse-wheel users
    // now keep vertical scrolling all the way through the page.
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

  // ========== LIGHTBOX ==========
  // Full-screen image gallery. Opens from venue-detail thumbnails or the
  // class-detail hero. The active slide morphs from the tapped thumbnail's
  // bounding rect into its natural lightbox position via Motion.animate; the
  // header + close button cross-fade in alongside.
  (function() {
    var lightboxEl = document.getElementById('lightbox');
    var lightboxBg = document.getElementById('lightbox-bg');
    var lightboxStatusBar = document.getElementById('lightbox-status-bar');
    var lightboxTrack = document.getElementById('lightbox-track');
    var lightboxViewport = lightboxEl && lightboxEl.querySelector('.lightbox-viewport');
    var lightboxTitle = document.getElementById('lightbox-title');
    var lightboxCounter = document.getElementById('lightbox-counter');
    var lightboxClose = document.getElementById('lightbox-close');
    if (!lightboxEl || !lightboxTrack || !lightboxViewport) return;

    var slidesCount = 0;
    var currentPage = 0;
    // Per-slide thumbnail elements so the dismiss gesture can FLIP back to
    // the thumbnail that matches the currently-visible slide.
    var currentThumbs = [];

    function setCounter(idx, total) {
      lightboxCounter.textContent = (idx + 1) + ' of ' + total;
    }

    function buildSlides(count) {
      var html = '';
      for (var i = 0; i < count; i++) html += '<div class="lightbox-slide"><div class="lightbox-slide-image"></div></div>';
      lightboxTrack.innerHTML = html;
      slidesCount = count;
    }

    function setPage(page, animate) {
      page = Math.max(0, Math.min(slidesCount - 1, page));
      var prev = currentPage;
      currentPage = page;
      if (!animate) lightboxTrack.classList.add('dragging');
      lightboxTrack.style.transform = 'translate3d(' + (-page * 100) + '%, 0, 0)';
      if (!animate) requestAnimationFrame(function() { lightboxTrack.classList.remove('dragging'); });
      setCounter(page, slidesCount);
      // Sync the source-thumb fade: only the thumb matching the active
      // slide is hidden. Restore the previously-active thumb so the rest
      // of the carousel in the venue scroll stays visible.
      if (currentThumbs && currentThumbs.length) {
        if (prev !== page && currentThumbs[prev]) currentThumbs[prev].style.opacity = '';
        if (currentThumbs[page]) currentThumbs[page].style.opacity = '0';
        // If the source is the class-detail hero carousel, page the hero
        // along behind the lightbox so a drag-dismiss FLIPs to the matching
        // thumb (which is visible at the same screen position).
        if (currentThumbs[page] && currentThumbs[page].classList.contains('cd-hero-slide')
            && typeof window.__setCdHeroPage === 'function') {
          window.__setCdHeroPage(page);
        }
        // Same idea for the venue-detail thumbnail carousel: scroll it so
        // the current page's thumb sits at the carousel's initial left
        // position. Subtract thumb[0].offsetLeft so the padding-left isn't
        // double-counted — for page 0 this yields scrollLeft = 0, matching
        // the carousel's natural state when the venue detail first opened.
        // Without this, a drag-dismiss back to image 0 from a scrolled
        // carousel state lands the FLIP at an offscreen thumb.
        else if (currentThumbs[page] && currentThumbs[page].classList.contains('vd-image-placeholder')) {
          var venueCarousel = currentThumbs[page].parentElement;
          if (venueCarousel && currentThumbs[0]) {
            venueCarousel.scrollLeft = currentThumbs[page].offsetLeft - currentThumbs[0].offsetLeft;
          }
        }
      }
    }

    // Compute the FLIP transform that places the slide image at thumbRect's
    // position and size, using center-origin (matches the slide's CSS).
    function flipFromThumb(thumbRect, destRect) {
      var thumbCx = thumbRect.left + thumbRect.width / 2;
      var thumbCy = thumbRect.top + thumbRect.height / 2;
      var destCx = destRect.left + destRect.width / 2;
      var destCy = destRect.top + destRect.height / 2;
      var sx = thumbRect.width / destRect.width;
      var sy = thumbRect.height / destRect.height;
      return 'translate(' + (thumbCx - destCx) + 'px, ' + (thumbCy - destCy) + 'px) scale(' + sx + ', ' + sy + ')';
    }

    function openLightbox(thumbEls, startIdx, title) {
      var startThumb = thumbEls[startIdx];
      if (!startThumb) return;
      var thumbRect = startThumb.getBoundingClientRect();
      currentThumbs = thumbEls.slice();
      lightboxTitle.textContent = title || '';
      fitTitleToWidth(lightboxTitle, 16);
      buildSlides(thumbEls.length);
      // Carry each source thumb's computed background onto its matching
      // lightbox slide so the gallery image colors match the carousel
      // they came from (e.g. the class-detail hero's varying greys).
      var lightboxSlideImgs = lightboxTrack.querySelectorAll('.lightbox-slide-image');
      // Match the lightbox slide's aspect ratio to the source thumb so the
      // FLIP scale during open/dismiss is uniform (sx === sy). Without this,
      // morphing from a square thumb to a 4:3 slide visibly stretches the
      // image horizontally during the animation.
      var thumbAspect = thumbRect.width / thumbRect.height;
      if (isFinite(thumbAspect) && thumbAspect > 0) {
        lightboxSlideImgs.forEach(function(slideImg) {
          // Disable the CSS aspect-ratio transition while we set the
          // initial thumb-aspect — otherwise the change from CSS-default
          // 4/3 to thumb's aspect triggers a transition that fires before
          // the morph begins. Re-enabled inside expandAspect.
          slideImg.style.transition = 'none';
          slideImg.style.aspectRatio = String(thumbAspect);
        });
      }
      thumbEls.forEach(function(t, i) {
        var slideImg = lightboxSlideImgs[i];
        if (!slideImg) return;
        var bg = window.getComputedStyle(t).background;
        if (bg) slideImg.style.background = bg;
      });
      setPage(startIdx, false);
      lightboxEl.classList.add('open');
      // Hide ONLY the active source thumb while the lightbox is open so a
      // drag-dismiss doesn't reveal it sitting behind the morphing slide.
      // The other thumbs stay visible — setPage swaps the hidden thumb as
      // the user pages through the lightbox.
      thumbEls.forEach(function(t) {
        t.style.transition = 'opacity 0.2s ease';
      });
      if (startThumb) startThumb.style.opacity = '0';
      requestAnimationFrame(function() {
        var slideImages = lightboxTrack.querySelectorAll('.lightbox-slide-image');
        var morphSlide = slideImages[startIdx];
        if (!morphSlide) return;
        var destRect = morphSlide.getBoundingClientRect();
        var fromTransform = flipFromThumb(thumbRect, destRect);
        morphSlide.style.transform = fromTransform;
        // Quicker, snappier ease-out for the thumb → lightbox expansion so
        // the open feels responsive instead of drifting in. The quart-out
        // curve front-loads the motion: most of the distance is covered
        // early, then it eases into rest.
        function expandAspect() {
          // Drop the thumb-aspect override on every slide so the CSS
          // aspect-ratio transition (matched to the morph duration/easing)
          // expands them to the natural 4/3 in lockstep with the morph.
          // Re-enable the CSS transition first, force a reflow so the
          // browser commits the transition change before the aspect-ratio
          // change, then clear the inline aspect — the change-to-default
          // is what triggers the transition.
          lightboxSlideImgs.forEach(function(slideImg) {
            slideImg.style.transition = '';
          });
          void lightboxTrack.offsetHeight;
          lightboxSlideImgs.forEach(function(slideImg) {
            slideImg.style.aspectRatio = '';
          });
        }
        if (motionAnimate) {
          expandAspect();
          motionAnimate(morphSlide,
            { transform: [fromTransform, 'translate(0px, 0px) scale(1, 1)'] },
            { duration: 0.22, easing: [0.22, 1, 0.36, 1] }
          );
        } else {
          morphSlide.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
          expandAspect();
          requestAnimationFrame(function() { morphSlide.style.transform = ''; });
        }
      });
    }

    function closeLightbox(skipSlideFade) {
      // X-close: fade the slide image alongside the chrome so it doesn't
      // hang in the air after bg goes transparent. Drag-dismiss passes
      // skipSlideFade=true — its slide is FLIP-ing to the thumb's rect.
      // Transition lives in CSS (.lightbox-slide-image) so the rule is
      // already committed before we change opacity.
      if (!skipSlideFade) {
        lightboxTrack.querySelectorAll('.lightbox-slide-image').forEach(function(s) {
          s.style.opacity = '0';
        });
      }
      // Fade the source thumbs back in.
      //   • Drag-dismiss (skipSlideFade=true): trigger immediately, using
      //     the inline 0.2s transition installed on open. The thumb fades
      //     in behind the still-opaque morphed slide (invisible to the
      //     user, but in place by the time the slide is removed).
      //   • X-close (skipSlideFade=false): wait until the lightbox has
      //     dissolved (~200ms) BEFORE clearing the thumb's inline opacity.
      //     Otherwise the thumb fade-in runs in parallel with the lightbox
      //     fade-out and the user only registers the lightbox vanishing.
      //     We also lengthen the duration to 0.4s ease-out so the thumb
      //     visibly materializes after the lightbox is gone.
      var thumbsToRestore = currentThumbs.slice();
      if (skipSlideFade) {
        // Drag-dismiss: the morph just landed the slide pixel-identical
        // to the thumb (matched aspect-ratio + border-radius). Bring the
        // thumb back instantly (no fade) so the slide can be removed on
        // the very next frame without any visible "linger" at rest.
        thumbsToRestore.forEach(function(t) {
          t.style.transition = 'none';
          t.style.opacity = '';
        });
        if (thumbsToRestore[0]) void thumbsToRestore[0].offsetHeight;
      } else {
        thumbsToRestore.forEach(function(t) {
          t.style.transition = 'opacity 0.4s ease-out';
        });
        setTimeout(function() {
          thumbsToRestore.forEach(function(t) { t.style.opacity = ''; });
        }, 200);
      }
      lightboxEl.classList.remove('open');
      var cleanupDelay = skipSlideFade ? 20 : 620;
      setTimeout(function() {
        lightboxTrack.innerHTML = '';
        lightboxTrack.style.transform = '';
        if (lightboxBg) lightboxBg.style.opacity = '';
        if (lightboxStatusBar) lightboxStatusBar.style.opacity = '';
        lightboxClose.style.opacity = '';
        if (lightboxTitle.parentElement) lightboxTitle.parentElement.style.opacity = '';
        thumbsToRestore.forEach(function(t) { t.style.transition = ''; });
        slidesCount = 0;
        currentPage = 0;
        currentThumbs = [];
      }, cleanupDelay);
    }

    // Clear inline opacities so CSS transitions take over the chrome fade.
    function clearChromeOpacities() {
      lightboxBg.style.opacity = '';
      lightboxStatusBar.style.opacity = '';
      lightboxClose.style.opacity = '';
      lightboxTitle.parentElement.style.opacity = '';
    }

    // Commit dismiss: FLIP slide image back to the thumb's rect, fade the
    // chrome out by removing .open. CSS transitions drive chrome.
    // opts: { duration: ms, easing: cssEasingString } — defaults match the
    // drag-dismiss feel (450ms cubic-bezier). X-close passes a faster
    // configuration that matches the open animation.
    function dismissToThumb(slideImage, fromTransform, opts) {
      opts = opts || {};
      var DURATION = opts.duration || 450;
      var EASING = opts.easing || 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      var DURATION_S = (DURATION / 1000) + 's';
      var thumb = currentThumbs[currentPage];
      // If the source thumb has been scrolled out of view inside its parent
      // scroll container (e.g. class-detail-scroll scrolled down before the
      // user tapped the cd-hero), the FLIP target rect's top is negative
      // and the slide morphs *above* the viewport. Scroll the parent so
      // the thumb is back on screen before computing the target. Snapping
      // here is fine — the lightbox sits on top so the user doesn't see
      // the underlying scroll jump, and it lands the slide where the user
      // expects it.
      if (thumb) {
        var preRect = thumb.getBoundingClientRect();
        if (preRect.top < 0 || preRect.bottom > window.innerHeight) {
          var scrollParent = thumb.closest('.class-detail-scroll, .venue-detail-scroll');
          if (scrollParent) {
            var parentRect = scrollParent.getBoundingClientRect();
            // Align the thumb's top with the scroll container's top edge.
            scrollParent.scrollTop += (preRect.top - parentRect.top);
          }
        }
      }
      slideImage.style.transform = '';
      // The slide is currently at its natural aspect (e.g. 4/3). For the
      // FLIP to land uniformly on the square thumb, measure destRect as if
      // the slide were already at the thumb's aspect, then restore the
      // natural aspect. Disable transitions during this measurement dance
      // so the CSS aspect-ratio transition doesn't pick up the temporary
      // change and run in the background.
      var thumbAspectForDest = null;
      if (thumb) {
        var tRect0 = thumb.getBoundingClientRect();
        if (tRect0.height > 0) thumbAspectForDest = tRect0.width / tRect0.height;
      }
      var savedAspect = slideImage.style.aspectRatio;
      slideImage.style.transition = 'none';
      if (thumbAspectForDest && isFinite(thumbAspectForDest) && thumbAspectForDest > 0) {
        slideImage.style.aspectRatio = String(thumbAspectForDest);
        void slideImage.offsetHeight;
      }
      var destRect = slideImage.getBoundingClientRect();
      slideImage.style.aspectRatio = savedAspect;
      void slideImage.offsetHeight;
      slideImage.style.transform = fromTransform;
      var toTransform;
      if (thumb) {
        var thumbRect = thumb.getBoundingClientRect();
        toTransform = flipFromThumb(thumbRect, destRect);
      } else {
        toTransform = 'translate(0px, 200px) scale(0.6)';
      }
      // Cancel any in-flight WAAPI animations on this slide so they don't
      // fight the CSS transition we're about to commit.
      if (slideImage.getAnimations) {
        slideImage.getAnimations().forEach(function(a) { a.cancel(); });
      }
      // Pin the from-transform, force a reflow, then transition transform
      // Keep the slide fully opaque through the entire morph — it shouldn't
      // start fading out until it has actually landed at the thumb's rect.
      // Once the morph completes, a separate timed fade-out hides the slide
      // at its resting position. The source thumb is fading in alongside,
      // so by the time the slide vanishes the thumb is already there to
      // take over visually with no perceivable handoff.
      slideImage.style.transition = 'none';
      slideImage.style.transform = fromTransform;
      slideImage.style.opacity = '1';
      void slideImage.offsetHeight;
      // Animate the slide's border-radius alongside the transform so the
      // VISUAL radius (post-scale) ends the morph matching the thumb's own
      // border-radius. This includes thumbs with `border-radius: 0` — once
      // the slide carries real photos (not flat gradients), the rounded
      // slide visibly mismatches a sharp-cornered thumb after the morph
      // and reads as the image "lingering" before the slide is removed.
      var slideStartRadiusPx = parseFloat(window.getComputedStyle(slideImage).borderTopLeftRadius) || 24;
      var slideTargetRadiusPx = slideStartRadiusPx;
      if (thumb) {
        var thumbRadiusPx = parseFloat(window.getComputedStyle(thumb).borderTopLeftRadius) || 0;
        var scaleX = destRect.width > 0 ? thumbRect.width / destRect.width : 1;
        if (scaleX > 0) slideTargetRadiusPx = thumbRadiusPx / scaleX;
      }
      var animateRadius = slideTargetRadiusPx !== slideStartRadiusPx;
      // Delay the radius animation so corners stay visually rounded for
      // most of the morph, then sharpen only as the slide settles into the
      // thumb's rect. Without this delay the slide reads as "sharp and
      // mid-flight" through the back half of the morph — the user's
      // "sharp corners before initial state" complaint.
      var radiusDelayMs = Math.round(DURATION * 0.1);
      var radiusDurationMs = DURATION - radiusDelayMs;
      var RADIUS_DURATION_S = (radiusDurationMs / 1000) + 's';
      var RADIUS_DELAY_S = (radiusDelayMs / 1000) + 's';
      slideImage.style.transition =
        'transform ' + DURATION_S + ' ' + EASING +
        ', aspect-ratio ' + DURATION_S + ' ' + EASING +
        (animateRadius
          ? ', border-radius ' + RADIUS_DURATION_S + ' ' + EASING + ' ' + RADIUS_DELAY_S
          : '');
      slideImage.style.transform = toTransform;
      if (thumbAspectForDest && isFinite(thumbAspectForDest) && thumbAspectForDest > 0) {
        slideImage.style.aspectRatio = String(thumbAspectForDest);
      }
      if (animateRadius) {
        slideImage.style.borderRadius = slideTargetRadiusPx + 'px';
      }
      // Don't touch the source thumb here. The closeLightbox call at t=650
      // is what restores it — clearing its inline opacity there triggers
      // the 0.2s ease transition installed on open, which is the only
      // thumb fade-in we want. No parallel/instant restoration during the
      // dismiss morph.
      // Override the chrome's default 0.2s CSS transition with a 0.45s fade
      // so the bg + status + close + header don't disappear before the slide
      // finishes its morph. The dismiss should read as one cohesive motion;
      // a fast chrome fade made the chrome vanish too soon, leaving the
      // slide flying alone over the bare page behind.
      var headerElEarly = lightboxTitle.parentElement;
      var dismissChromeEls = [lightboxBg, lightboxStatusBar, lightboxClose, headerElEarly];
      dismissChromeEls.forEach(function(el) {
        if (el) el.style.transition = 'opacity ' + DURATION_S + ' ease-out';
      });
      clearChromeOpacities();
      lightboxEl.classList.remove('open');
      // Once the slide has landed at the thumb's rect (t=450), hand off to
      // closeLightbox: it triggers the thumb's 0.2s fade-in (behind the
      // still-opaque slide) and schedules the lightbox track to be cleared
      // ~220ms later, at which point the slide is removed from the DOM
      // and the now-visible thumb takes its place. The slide itself never
      // fades — keeping it opaque through to its removal avoids the
      // out-then-in "flash" that a fade-out + thumb fade-in produced.
      setTimeout(function() {
        closeLightbox(true);
        slideImage.style.transition = '';
        dismissChromeEls.forEach(function(el) {
          if (el) el.style.transition = '';
        });
      }, DURATION);
    }

    // Snap back to the natural in-lightbox position. Drives the slide
    // transform AND the chrome opacities with WAAPI on the same duration +
    // easing so the recovery reads as one motion. Two subtle issues this
    // fixes vs a CSS-transition path:
    //   1) Don't clear the inline transform before starting the animation
    //      — there's a 1-frame window between the JS-side clear and the
    //      WAAPI keyframe taking effect, and during that frame the element
    //      paints at identity, producing a visible flash. Keep the inline
    //      transform pinned at fromTransform; the animation overrides
    //      during playback; onfinish clears it so the element rests at
    //      identity with no leftover state.
    //   2) Animate chrome opacity with WAAPI rather than letting CSS
    //      transitions take over after `clearChromeOpacities()`. CSS gave
    //      chrome 0.2s ease-out vs the slide's 0.28s cubic-bezier — close
    //      but enough mismatch to feel like two staggered animations.
    function snapBack(slideImage) {
      var headerEl = lightboxTitle.parentElement;
      // Cancel any in-flight animations on the slide AND the chrome so a
      // mid-flight snap-back / open animation can't fight the new ones.
      if (slideImage.getAnimations) {
        slideImage.getAnimations().forEach(function(a) { a.cancel(); });
      }
      var chromeEls = [lightboxBg, lightboxStatusBar, lightboxClose, headerEl];
      chromeEls.forEach(function(el) {
        if (el && el.getAnimations) el.getAnimations().forEach(function(a) { a.cancel(); });
      });

      var fromTransform = slideImage.style.transform || 'translate(0px, 0px) scale(1)';
      slideImage.style.transition = '';

      // Two-phase recovery:
      //   1) Animate the slide back to identity FIRST. Chrome stays at the
      //      drag-faded opacity throughout — no chrome motion is visible
      //      while the slide is in flight, so the user doesn't perceive a
      //      fade overlapping with the snap.
      //   2) Once the slide lands, clear the chrome's inline opacities so
      //      the default 0.2s CSS transition fades them back to 1. This
      //      reads as "everything settles" after the slide is already home.
      var imgAnim = slideImage.animate(
        [
          { transform: fromTransform },
          { transform: 'translate(0px, 0px) scale(1)' }
        ],
        { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
      );
      imgAnim.onfinish = function() {
        // Clear inline transform first so the element's resting state is
        // identity, then cancel the (forwards-filled) animation so its
        // override is removed. Both synchronous — no paint between them.
        slideImage.style.transform = '';
        imgAnim.cancel();
        // Now that the slide is home, let the chrome fade back to opacity 1
        // via its default CSS transition (0.2s ease-out on each element).
        lightboxBg.style.opacity = '';
        lightboxStatusBar.style.opacity = '';
        lightboxClose.style.opacity = '';
        if (headerEl) headerEl.style.opacity = '';
      };
    }

    // Combined drag handler: detects axis on first ~6px movement and locks
    // into either 'page' (horizontal carousel paging) or 'dismiss' (free 2D
    // drag, scale + bg fade, FLIP back to thumb on commit).
    var dragState = null;
    function dragStart(clientX, clientY) {
      lightboxTrack.classList.add('dragging');
      // Also flag the whole lightbox: CSS uses this to disable chrome
      // transitions so per-frame opacity writes during the drag don't lag.
      lightboxEl.classList.add('dragging');
      dragState = {
        startX: clientX,
        startY: clientY,
        startOffsetPx: -currentPage * lightboxViewport.clientWidth,
        mode: null,
        morphSlide: null,
        moved: false
      };
    }
    function dragMove(clientX, clientY) {
      if (!dragState) return;
      var dx = clientX - dragState.startX;
      var dy = clientY - dragState.startY;
      var absX = Math.abs(dx);
      var absY = Math.abs(dy);
      if (dragState.mode === null && (absX > 6 || absY > 6)) {
        dragState.mode = absX > absY ? 'page' : 'dismiss';
        if (dragState.mode === 'dismiss') {
          var slideImages = lightboxTrack.querySelectorAll('.lightbox-slide-image');
          dragState.morphSlide = slideImages[currentPage];
          // Fade out the X close + the header (title + counter) fully when
          // the dismiss gesture starts. Their opacity is no longer tied to
          // drag distance — they just slide out cleanly at gesture-begin
          // and stay gone for the rest of the drag. Inline transition
          // overrides the .lightbox.dragging `transition: none` so the
          // fade actually animates instead of popping.
          lightboxClose.style.transition = 'opacity 0.2s ease-out';
          lightboxClose.style.opacity = '0';
          var dismissHeaderEl = lightboxTitle.parentElement;
          if (dismissHeaderEl) {
            dismissHeaderEl.style.transition = 'opacity 0.2s ease-out';
            dismissHeaderEl.style.opacity = '0';
          }
        }
      }
      if (absX > 4 || absY > 4) { dragState.moved = true; wasDragging = true; }
      if (dragState.mode === 'page') {
        lightboxTrack.style.transform = 'translate3d(' + (dragState.startOffsetPx + dx) + 'px, 0, 0)';
      } else if (dragState.mode === 'dismiss' && dragState.morphSlide) {
        // Free 2D translate; scale based on downward drag (caps at 0.6).
        var downDy = Math.max(0, dy);
        var scale = Math.max(0.6, 1 - downDy / 800);
        dragState.morphSlide.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
        // Bg + status bar fade in proportion to downward drag (caps at 0).
        // Close + header don't follow the drag — they fully faded on
        // gesture-begin (above).
        var fade = Math.max(0, 1 - downDy / 400);
        lightboxBg.style.opacity = fade;
        lightboxStatusBar.style.opacity = fade;
      }
    }
    function dragEnd(clientX, clientY) {
      if (!dragState) return;
      var moved = dragState.moved;
      var mode = dragState.mode;
      var dx = clientX - dragState.startX;
      var dy = clientY - dragState.startY;
      lightboxTrack.classList.remove('dragging');
      lightboxEl.classList.remove('dragging');
      if (mode === 'page') {
        var pageW = lightboxViewport.clientWidth;
        var nextPage = currentPage;
        if (Math.abs(dx) > pageW * 0.2) nextPage = currentPage + (dx < 0 ? 1 : -1);
        setPage(nextPage, true);
      } else if (mode === 'dismiss' && dragState.morphSlide) {
        var slideImage = dragState.morphSlide;
        var fromTransform = slideImage.style.transform;
        // Commit dismissal when the user has dragged down past 20% of the
        // viewport height; otherwise spring everything back to rest.
        if (dy > lightboxViewport.clientHeight * 0.2) {
          dismissToThumb(slideImage, fromTransform, {
            duration: 320,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
          });
        } else {
          snapBack(slideImage);
        }
      } else {
        // No mode locked (a tap that didn't really move) — leave page where it is.
        setPage(currentPage, true);
      }
      dragState = null;
      if (moved) setTimeout(function() { wasDragging = false; }, 0);
    }

    lightboxViewport.addEventListener('mousedown', function(e) {
      if (e.target.closest('.lightbox-close')) return;
      e.preventDefault();
      dragStart(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function(e) { if (dragState) dragMove(e.clientX, e.clientY); });
    document.addEventListener('mouseup', function(e) { if (dragState) dragEnd(e.clientX, e.clientY); });

    lightboxViewport.addEventListener('touchstart', function(e) {
      if (e.target.closest('.lightbox-close')) return;
      var t = e.touches[0];
      dragStart(t.clientX, t.clientY);
    }, { passive: true });
    lightboxViewport.addEventListener('touchmove', function(e) {
      if (!dragState) return;
      var t = e.touches[0];
      dragMove(t.clientX, t.clientY);
    }, { passive: true });
    lightboxViewport.addEventListener('touchend', function(e) {
      if (!dragState) return;
      var t = e.changedTouches[0];
      dragEnd(t ? t.clientX : dragState.startX, t ? t.clientY : dragState.startY);
    });

    lightboxClose.addEventListener('click', function() {
      // Run the same FLIP-back-to-thumb animation as drag-dismiss instead of
      // a flat fade-out. The slide morphs from its lightbox-state position
      // (identity) to the source thumb's rect, then closeLightbox cleans up
      // — the user visually sees the image return to its original size and
      // place, matching the drag-dismiss feel.
      var slideImages = lightboxTrack.querySelectorAll('.lightbox-slide-image');
      var morphSlide = slideImages[currentPage];
      if (morphSlide && currentThumbs[currentPage]) {
        var fromTransform = morphSlide.style.transform || 'translate(0px, 0px) scale(1, 1)';
        // Match drag-dismiss timing so the X-close feels equally snappy.
        dismissToThumb(morphSlide, fromTransform, {
          duration: 320,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
        });
      } else {
        closeLightbox();
      }
    });

    // Wire venue-detail thumbnails (3 placeholders in the header carousel).
    // Guard with wasDragging so a horizontal drag-scroll that ends on a
    // thumbnail doesn't get treated as a tap.
    var venueThumbs = Array.prototype.slice.call(document.querySelectorAll('#vd-section-images .vd-image-placeholder'));
    venueThumbs.forEach(function(thumb, idx) {
      thumb.style.cursor = 'pointer';
      thumb.addEventListener('click', function() {
        if (wasDragging) return;
        var name = (window.__currentVenuePin && window.__currentVenuePin.name) || 'Venue';
        openLightbox(venueThumbs, idx, name);
      });
    });

    // Compact header thumb opens the lightbox. Hidden #cd-hero-track slides
    // hold the extra photos so paging still works; page 0 FLIPs back to
    // the visible 80×80 thumb.
    var cdThumb = document.getElementById('cd-thumb');
    var cdHeroTrack = document.getElementById('cd-hero-track');
    var cdHeroSlides = cdHeroTrack
      ? Array.prototype.slice.call(cdHeroTrack.querySelectorAll('.cd-hero-slide'))
      : [];
    window.__resetCdHeroCarousel = function() {};
    window.__setCdHeroPage = function() {};
    if (cdThumb) {
      cdThumb.addEventListener('click', function() {
        if (wasDragging) return;
        var titleEl = document.getElementById('cd-title');
        var name = (titleEl && titleEl.textContent) || 'Class';
        var thumbs = [cdThumb].concat(cdHeroSlides.slice(1));
        openLightbox(thumbs, 0, name);
      });
    }
  })();

})();
