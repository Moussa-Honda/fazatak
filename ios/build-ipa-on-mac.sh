#!/usr/bin/env bash
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$IOS_DIR/App"
PROJECT="$PROJECT_DIR/App.xcodeproj"
SCHEME="App"
CONFIGURATION="Release"
BUILD_DIR="$IOS_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/Fazatak.xcarchive"
EXPORT_PATH="$BUILD_DIR/export"
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Run this script on macOS with Xcode installed."
  exit 1
fi

if [ ! -f "$EXPORT_OPTIONS" ]; then
  cp "$IOS_DIR/ExportOptions.plist.example" "$EXPORT_OPTIONS"
  echo "Created $EXPORT_OPTIONS"
  echo "Edit teamID in ExportOptions.plist, then run this script again."
  exit 1
fi

mkdir -p "$BUILD_DIR" "$EXPORT_PATH"

echo "Archiving iOS app..."
xcodebuild \
  -project "$PROJECT" \
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

echo "Done. IPA files:"
find "$EXPORT_PATH" -name "*.ipa" -maxdepth 2 -print
