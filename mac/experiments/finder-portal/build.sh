#!/bin/bash
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
out="${1:?Usage: build.sh absolute-output-directory}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
app="$out/Finder Portal Probe.app"
mkdir -p "$app/Contents/MacOS" "$out/module-cache"
swiftc -parse-as-library -module-cache-path "$out/module-cache" "$src/Capture.swift" "$src/Interaction.swift" "$src/Viewer.swift" "$src/RawInputProbe.swift" "$src/NativePointer.swift" "$src/EdgeObserver.swift" "$src/RemoteReceiver.swift" -o "$app/Contents/MacOS/FinderPortalCapture"
swiftc -parse-as-library -module-cache-path "$out/module-cache" -I "$src/../../../mac-helper/Sources/VirtualDisplayBridge/include" "$src/BackingDisplay.swift" "$src/../../../mac-helper/Sources/macshare-helper/Screens.swift" -o "$app/Contents/MacOS/FinderPortalBacking"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.travismackinnon.finderportalprobe</string>
<key>CFBundleExecutable</key><string>FinderPortalCapture</string>
<key>CFBundleName</key><string>Finder Portal Probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Measure whether a dedicated Finder test window updates while out of sight.</string>
</dict></plist>
PLIST
if [ -n "${MAC_IDENTITY:-}" ]; then
  codesign --force --sign "$MAC_IDENTITY" --timestamp=none "$app/Contents/MacOS/FinderPortalBacking"
  codesign --force --sign "$MAC_IDENTITY" --timestamp=none "$app"
else
  codesign --force --sign - "$app/Contents/MacOS/FinderPortalBacking"
  codesign --force --sign - "$app"
fi
receiver="$out/Window Portal Receiver.app"
mkdir -p "$receiver/Contents/MacOS"
cp "$app/Contents/MacOS/FinderPortalCapture" "$receiver/Contents/MacOS/WindowPortalReceiver"
cat > "$receiver/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.travismackinnon.windowportalreceiver</string>
<key>CFBundleExecutable</key><string>WindowPortalReceiver</string>
<key>CFBundleName</key><string>Window Portal Receiver</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
PLIST
codesign --force --sign "${MAC_IDENTITY:--}" --timestamp=none "$receiver"
codesign --verify --deep --strict "$receiver"
codesign --verify --deep --strict "$app"
printf '%s\n' "$app/Contents/MacOS/FinderPortalCapture"
