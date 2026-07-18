#!/bin/bash
# Regenere les icones depuis build-resources/icon.png (1024x1024)
# .icns (macOS) via iconutil, .ico (Windows) via sips + ImageMagick
set -e
cd "$(dirname "$0")/../build-resources"
[ -f icon.png ] || { echo "icon.png (1024x1024) requis dans build-resources/"; exit 1; }

echo "→ .icns"
ICONSET=$(mktemp -d)/icon.iconset; mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2)); sips -z $d $d icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o icon.icns && echo "  ✓ icon.icns"

echo "→ .ico"
if command -v magick >/dev/null || command -v convert >/dev/null; then
  CONV=$(command -v magick || command -v convert)
  "$CONV" icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico && echo "  ✓ icon.ico"
else
  echo "  ⚠ ImageMagick absent (brew install imagemagick) — icon.ico non regenere"
fi
