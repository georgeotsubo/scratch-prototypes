# Playlist Search UX Prototypes

Rapid prototyping repo for Playlist search UX explorations. Each `prototype-N/` directory is a self-contained, standalone HTML/CSS/JS app. No frameworks, no build tools, no package.json — open HTML files directly in browser.

## Tech stack

- Vanilla HTML/CSS/JS
- Leaflet.js 1.9.4 (CDN) for maps
- Google Fonts (DM Sans, Google Sans Flex)
- Figma-exported PNGs in `figma-screens/`

## File structure

```
prototype-N/
  prototype.html   — markup + structure
  prototype.css    — styles
  prototype.js     — all logic (IIFE pattern, state machine)
  figma-screens/   — exported Figma assets
index.html         — links to all prototypes with descriptions
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
- **Data**: all hardcoded/mock — no real API calls
