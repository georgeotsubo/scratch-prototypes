# Playlist Search UX Prototypes

Rapid prototyping repo for Playlist search UX explorations. Each `prototype-N/` directory is a self-contained, standalone HTML/CSS/JS app. No frameworks, no build tools, no package.json — open HTML files directly in browser.

## Tech stack

- Vanilla HTML/CSS/JS
- Mapbox GL JS v3.4.0 (CDN) for maps (prototype-5+; earlier prototypes use Leaflet 1.9.4)
- Mapbox Geocoding API v5 for location search
- Foursquare Places API for venue data
- Google Fonts (DM Sans, Google Sans Flex)
- Figma-exported PNGs in `figma-screens/`

## File structure

```
prototype-N/
  prototype.html   — markup + structure
  prototype.css    — styles
  prototype.js     — all logic (IIFE pattern, state machine)
  config.js        — API keys (gitignored, generated on Vercel)
  config.example.js — template for local setup
  figma-screens/   — exported Figma assets
index.html         — links to all prototypes with descriptions
vercel.json        — API proxy rewrites for Foursquare
.gitignore         — excludes **/config.js
```

## Rules

- Prototypes are forked sequentially (1→2→3→4); always work on the latest unless told otherwise
- Each prototype is self-contained — don't share code between them
- This is prototype code, not production — prioritize speed over best practices
- Don't add npm, build tools, TypeScript, or frameworks
- Don't refactor across prototypes or "clean up" old ones
- Keep all changes within the active `prototype-N/` directory unless updating `index.html`

## Key patterns

- **State**: global variables at top of `prototype.js` (`currentScreen`, `searchTerm`, `locationTerm`, etc.)
- **Screens**: CSS class toggling (`.active`) to switch between screen states
- **Autocomplete**: hardcoded object lookups keyed by input prefix
- **Map pins**: generated from `LAND_OFFSETS` array around a center point
- **Bottom sheet**: draggable results sheet with collapse/expand states
- **Map flags**: `preserveMapView` / `preserveMapContents` control map animation on navigation
- **Data**: prototype-5 uses live APIs (Foursquare + Mapbox); earlier prototypes use hardcoded/mock data
- **API keys**: stored in gitignored `config.js`, loaded as `window.MAPBOX_TOKEN` / `window.FOURSQUARE_KEY`
- **CORS**: local dev uses `corsproxy.io`; Vercel prod uses `/api/foursquare/*` rewrite proxy
- **Deployment**: Vercel (static site), build command generates `config.js` from env vars
