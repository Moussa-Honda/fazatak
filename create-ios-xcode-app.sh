#!/usr/bin/env bash
set -euo pipefail

# Prepare this Capacitor project for Xcode on macOS.
# Usage:
#   ./create-ios-xcode-app.sh          # build web assets, sync iOS, open Xcode
#   ./create-ios-xcode-app.sh --no-open
#   ./create-ios-xcode-app.sh --ipa    # archive and export an IPA

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_DIR="$ROOT_DIR/ios"
XCODE_PROJECT="$IOS_DIR/App/App.xcodeproj"
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"
EXPORT_OPTIONS_EXAMPLE="$IOS_DIR/ExportOptions.plist.example"
SCHEME="App"
CONFIGURATION="Release"
ARCHIVE_PATH="$IOS_DIR/build/App.xcarchive"
EXPORT_PATH="$IOS_DIR/build/export"

MODE="open"

usage() {
  cat <<'USAGE'
Prepare the iOS app for Xcode.

Usage:
  ./create-ios-xcode-app.sh          Prepare and open Xcode
  ./create-ios-xcode-app.sh --no-open Prepare only
  ./create-ios-xcode-app.sh --ipa    Prepare, archive, and export IPA
USAGE
}

case "${1:-}" in
  "")
    ;;
  --no-open)
    MODE="prepare"
    ;;
  --ipa)
    MODE="ipa"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $1"
    usage
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must be run on macOS with Xcode installed."
  echo "Copy the project to a Mac, then run it from the project root."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js first."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx was not found. Install Node.js first."
  exit 1
fi

cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing dependencies..."
  npm ci
fi

echo "Building web app..."
npm run build

if [[ -f "$XCODE_PROJECT/project.pbxproj" ]]; then
  echo "Syncing existing iOS project..."
  npx cap sync ios
else
  echo "Creating iOS project..."
  npx cap add ios
fi

if [[ ! -f "$EXPORT_OPTIONS_EXAMPLE" ]]; then
  mkdir -p "$IOS_DIR"
  cat > "$EXPORT_OPTIONS_EXAMPLE" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>development</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>PUT_YOUR_APPLE_TEAM_ID_HERE</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
PLIST
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Prepared iOS files, but xcodebuild was not found."
  echo "Install Xcode, then open: $XCODE_PROJECT"
  exit 0
fi

if [[ "$MODE" == "ipa" ]]; then
  if [[ ! -f "$EXPORT_OPTIONS" ]]; then
    cp "$EXPORT_OPTIONS_EXAMPLE" "$EXPORT_OPTIONS"
    echo "Created: $EXPORT_OPTIONS"
    echo "Edit teamID in that file, then run this command again:"
    echo "./create-ios-xcode-app.sh --ipa"
    exit 1
  fi

  mkdir -p "$EXPORT_PATH"

  echo "Archiving iOS app..."
  xcodebuild \
    -project "$XCODE_PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    clean archive

  echo "Exporting IPA..."
  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$EXPORT_OPTIONS"

  echo "Done. IPA output:"
  find "$EXPORT_PATH" -maxdepth 2 -name "*.ipa" -print
else
  echo "iOS project is ready:"
  echo "$XCODE_PROJECT"

  if [[ "$MODE" == "open" ]]; then
    open "$XCODE_PROJECT"
  fi
fi
