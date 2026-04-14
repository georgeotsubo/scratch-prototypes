#!/bin/bash
# Generate config.js for all prototype directories from environment variables
for dir in prototype-*/; do
  if [ -f "$dir/config.example.js" ]; then
    cat > "$dir/config.js" <<JSEOF
window.MAPBOX_TOKEN = '${MAPBOX_TOKEN}';
window.FOURSQUARE_KEY = '${FOURSQUARE_KEY}';
JSEOF
    echo "Generated $dir/config.js"
  fi
done
