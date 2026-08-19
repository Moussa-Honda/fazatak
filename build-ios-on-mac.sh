#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$ROOT_DIR/ios"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Run this script on macOS with Xcode installed."
  exit 1
fi

cd "$ROOT_DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies..."
  npm ci
fi

echo "Building web assets..."
npm run build

echo "Syncing Capacitor iOS project..."
npx cap sync ios

cd "$IOS_DIR"

if [ ! -f "ExportOptions.plist" ]; then
  cp "ExportOptions.plist.example" "ExportOptions.plist"
  echo "Created ios/ExportOptions.plist"
  echo "Set your Apple Team ID in ios/ExportOptions.plist, then run this script again."
  exit 1
fi

chmod +x build-ipa-on-mac.sh
./build-ipa-on-mac.sh
