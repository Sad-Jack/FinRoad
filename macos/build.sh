#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$PWD/output/FinRoad.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O macos/Sync/SyncPolicy.swift macos/Sync/SharedDocument.swift macos/Sync/SyncManager.swift macos/main.swift -o "$APP/Contents/MacOS/FinRoad" -framework Cocoa -framework WebKit
cp -R app/. "$APP/Contents/Resources/"
cp macos/assets/FinRoad.icns "$APP/Contents/Resources/FinRoad.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIconFile</key><string>FinRoad.icns</string>
<key>CFBundleExecutable</key><string>FinRoad</string>
<key>CFBundleIdentifier</key><string>ru.finroad.desktop</string>
<key>CFBundleName</key><string>FinRoad</string>
<key>CFBundleDisplayName</key><string>FinRoad</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
