#!/bin/bash

# Create a simple SVG icon
cat > icon.svg << 'EOF'
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <rect width="128" height="128" fill="#0077b5" rx="20" ry="20"/>
  <text x="64" y="80" font-family="Arial" font-size="100" text-anchor="middle" fill="white">L</text>
</svg>
EOF

# Convert to different sizes
# Requires imagemagick to be installed
# If you don't have imagemagick, manually create these PNG files

# Create icon directories if they don't exist
mkdir -p images

# Create icons of different sizes
convert -background none icon.svg -resize 16x16 images/icon16.png
convert -background none icon.svg -resize 48x48 images/icon48.png
convert -background none icon.svg -resize 128x128 images/icon128.png

echo "Icons created successfully in the images directory." 
