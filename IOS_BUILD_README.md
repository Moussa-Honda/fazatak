# iOS Build Package

This project is ready to open on macOS with Xcode.

## GitHub Actions (signed installable IPA)

The repository includes `.github/workflows/build-ios-ipa.yml`. Add these
repository secrets in **Settings > Secrets and variables > Actions**:

- `IOS_TEAM_ID`: your Apple Developer Team ID.
- `IOS_CERTIFICATE_BASE64`: the Base64 content of the exported `.p12` signing certificate.
- `IOS_CERTIFICATE_PASSWORD`: the password used when exporting the `.p12` file.
- `IOS_PROVISIONING_PROFILE_BASE64`: the Base64 content of the `.mobileprovision` file for `com.installment.app`.

Optionally add the repository variable `IOS_EXPORT_METHOD`. It defaults to
`development`; use `ad-hoc` when the supplied profile is an Ad Hoc profile.

Then open **Actions > Build signed iOS IPA > Run workflow**. The signed IPA is
uploaded to the workflow run as the `Fazatak-iOS-*` artifact. For direct device
installation, the iPhone UDID must be included in a Development or Ad Hoc
provisioning profile.

## Files

- iOS project: `ios/App/App.xcodeproj`
- Full Mac build script: `build-ios-on-mac.sh`
- Mac build script: `ios/build-ipa-on-mac.sh`
- Export options template: `ios/ExportOptions.plist.example`

## Build on Mac

1. Copy this project or the prepared ZIP to a Mac.
2. Open `ios/App/App.xcodeproj` in Xcode.
3. Select the `App` target.
4. Set your Apple Team in `Signing & Capabilities`.
5. Connect an iPhone or choose a generic iOS destination.
6. Build from Xcode, or run the scripted flow below.

## One Command Flow on Mac

From the project root:

```bash
chmod +x build-ios-on-mac.sh
./build-ios-on-mac.sh
```

The first run creates:

```text
ios/ExportOptions.plist
```

Replace `PUT_YOUR_APPLE_TEAM_ID_HERE` with your Apple Team ID, then run the script again.

## Manual IPA Export

```bash
cd ios
cp ExportOptions.plist.example ExportOptions.plist
open ExportOptions.plist
chmod +x build-ipa-on-mac.sh
./build-ipa-on-mac.sh
```

The exported `.ipa` will be in:

```text
ios/build/export
```

## Important

iOS installation files must be signed by Apple. A Windows machine can prepare the project files, but only macOS with Xcode can create a signed installable `.ipa`.
