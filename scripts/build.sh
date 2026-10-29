#!/usr/bin/env bash
# Builds Gesto Studio into dist/: Vibe DAW at the root (/studio), Gesture Synth at /gesto/,
# and the launcher (hub/) at /. Needs `npm ci` done once in gesture-synth/ and vibe-daw/.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

echo "▸ Gesture Synth"
(cd gesture-synth && npx tsc -b && npx vite build --logLevel warn)

echo "▸ Vibe DAW"
(cd vibe-daw && npx tsc -b --noEmit && npx vite build --logLevel warn)

echo "▸ Armando dist/"
rm -rf dist && mkdir dist
cp -r vibe-daw/dist/. dist/
# Vibe's empty app shell: every studio route uses it (its own landing page is replaced by the launcher).
cp dist/index.html dist/app.html
mkdir -p dist/studio/assets && cp dist/index.html dist/studio/index.html
# Copy studio-specific assets so /studio/assets/ serves them too.
cp dist/assets/studio-*.js dist/assets/studio-*.css dist/studio/assets/ 2>/dev/null || true
# Replace asset references in studio/index.html with the studio-specific hashes found in the build.
STUDIO_JS=$(ls dist/assets/studio-*.js 2>/dev/null | head -1 | xargs -I{} basename {})
STUDIO_CSS=$(ls dist/assets/studio-*.css 2>/dev/null | head -1 | xargs -I{} basename {})
MAIN_JS=$(ls dist/assets/index-*.js 2>/dev/null | head -1 | xargs -I{} basename {})
if [ -n "$STUDIO_JS" ]; then
  sed -i "s|/assets/${MAIN_JS}|/assets/${STUDIO_JS}|g" dist/studio/index.html
fi
if [ -n "$STUDIO_CSS" ]; then
  sed -i "s|/assets/index-*.css|/assets/${STUDIO_CSS}|g" dist/studio/index.html
fi
cp -r gesture-synth/dist dist/gesto
cp hub/index.html hub/hub.css hub/hub.js hub/hub-icon.svg dist/
BUILD=$(date -u +%Y%m%d%H%M)
sed -i "s/__BUILD__/$BUILD/g" dist/index.html

cat > dist/_headers << 'HEADERS'
/sw.js
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/gesto/assets/*
  Cache-Control: public, max-age=31536000, immutable
/gesto/v1.0.1/*
  Cache-Control: public, max-age=31536000, immutable
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(self)
HEADERS

# Cloudflare Pages rejects files over 25 MiB.
big=$(find dist -type f -size +25M)
if [ -n "$big" ]; then echo "✗ Archivos de más de 25 MiB: $big"; exit 1; fi
echo "✓ dist/ listo ($(du -sh dist | cut -f1), $(find dist -type f | wc -l) archivos, build $BUILD)"
