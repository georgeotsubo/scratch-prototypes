#!/bin/sh
# Generates config.js from environment variables for Vercel deployment
echo "window.MAPBOX_TOKEN = '${MAPBOX_TOKEN}'; window.FOURSQUARE_KEY = '${FOURSQUARE_KEY}';" > prototype-5/config.js
echo "Generated prototype-5/config.js"
cat prototype-5/config.js
