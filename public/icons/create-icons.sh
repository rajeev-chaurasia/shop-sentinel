#!/bin/bash
# This script shows how to create placeholder icons
# Install ImageMagick first: sudo apt-get install imagemagick

# Create a simple colored square as placeholder
convert -size 16x16 xc:#4F46E5 public/icons/icon-16.png
convert -size 48x48 xc:#4F46E5 public/icons/icon-48.png
convert -size 128x128 xc:#4F46E5 public/icons/icon-128.png

echo "Icons created successfully!"
