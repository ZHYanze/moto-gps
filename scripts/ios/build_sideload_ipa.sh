#!/bin/bash
# Build an unsigned, unencrypted iPhone IPA for user-side signing (not TestFlight).
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="${1:-$repo_root/build/sideload}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
derived_dir="$output_dir/DerivedData"
staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT
xcodegen generate --spec "$repo_root/platforms/ios/project.yml"
xcodebuild -project "$repo_root/platforms/ios/MotoGPS.xcodeproj" \
  -scheme MotoGPS -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$derived_dir" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= build
app_path="$derived_dir/Build/Products/Release-iphoneos/MOTO GPS.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Info.plist")"
build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app_path/Info.plist")"
mkdir -p "$staging_dir/Payload"
ditto "$app_path" "$staging_dir/Payload/MOTO GPS.app"
ipa_path="$output_dir/MOTO-GPS-$version-$build_number-unsigned.ipa"
ditto -c -k --keepParent "$staging_dir/Payload" "$ipa_path"
python3 "$repo_root/scripts/ios/verify_sideload_ipa.py" "$ipa_path"
(cd "$output_dir" && shasum -a 256 "$(basename "$ipa_path")" > SHA256SUMS.txt)
echo "Unsigned IPA: $ipa_path"
