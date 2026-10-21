#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
APP="$ROOT/build/Dots/Build/Products/Debug-iphoneos/Client.app"
OUT="$ROOT/build/ipa"
test -d "$APP/WaygroundDotsResources"
test -f "$APP/WaygroundDotsResources/page.js"
test ! -d "$APP/PlugIns" || { echo 'Guest extensions unexpectedly embedded'; exit 1; }
mkdir -p "$OUT/Payload"
ditto "$APP" "$OUT/Payload/WaygroundBrowser.app"
find "$OUT/Payload/WaygroundBrowser.app" -name '*.framework' -type d -depth -exec codesign --force --sign - {} \;
codesign --force --sign - "$OUT/Payload/WaygroundBrowser.app"
cd "$OUT"
zip -q -r ../WaygroundBrowser.ipa Payload
shasum -a 256 ../WaygroundBrowser.ipa > ../WaygroundBrowser.ipa.sha256
