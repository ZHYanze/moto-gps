> **Language:** English · [中文](IOS_SIDELOAD.md)
>
> The Chinese version is authoritative if the two versions differ.

# Install the iPhone app from an IPA

For iPhone users without a Mac or who prefer not to build from source. Requires iOS 17 or later.
The project provides an **unsigned IPA** for an installer to re-sign using your own Apple account.
It is not an App Store or TestFlight package and cannot be installed simply by opening the file.

[Download the sideload preview](https://github.com/mx3353672833-debug/moto-gps-waveshare/releases/tag/v0.3.1-sideload)

Download `MOTO-GPS-0.3.1-6-unsigned.ipa`; use `SHA256SUMS.txt` to verify file integrity.
Source and build steps are in this repository. Do not send your Apple password, signing certificate
or pairing file to the author or other people.

## Install with SideStore

1. Install SideStore following its [official guide](https://docs.sidestore.io/docs/installation/install).
   Initial setup needs a computer. Windows users can follow its supported setup without a Mac to compile this project.
2. Download the IPA to Files on the iPhone, import it from SideStore's My Apps page and sign it with your own account.
3. Follow iOS prompts to trust the developer, enable Developer Mode, and grant MOTO GPS Bluetooth and location permissions.
4. Open MOTO GPS → 网关设置 (Gateway settings), enter your own HTTPS gateway address and save.
5. Verify real searches, round-display pairing, location updates while locked, and reconnection on your actual device.

Free Apple accounts have app-count limits and a roughly seven-day signing period that requires refresh.
See the [SideStore FAQ](https://docs.sidestore.io/docs/faq) for current installation and refresh requirements.
A viable sideloading method does not establish Bluetooth/background navigation compatibility on every iOS or SideStore version.

## Configure your gateway

A clean installation shows 设置导航网关 (Set up navigation gateway). You can also open 网关设置
from the gear icon at the top left of the departure screen.

- Self-hosted server example: `https://nav.example.com/moto-gps/api/`
- Workers example: `https://moto-gps-gateway.YOUR-SUBDOMAIN.workers.dev/`

Replace the example with your actual endpoint. Enter the gateway base URL, **without `/healthz`, `/v1/routes`
or other API endpoint paths**. Do not enter an AMap key, credentials or query parameters. Only HTTPS URLs
can be saved. A trailing slash is added automatically, while prefixes such as `/moto-gps/api/` are preserved.

测试连接 (Test connection) checks `/healthz` and distinguishes configured live navigation from fixture/disabled
services. This does not replace a real search/route test or modify server configuration.
保存 (Save) applies the address immediately without rebuilding or reinstalling. It persists across app launches.
Changing the gateway is blocked during navigation. Switching cancels old place/route requests and pauses map downloads;
existing downloaded maps are retained. The address lives in this app's local data; deleting the app removes it.

The gateway receives place, route and location requests. Use a service you operate or trust.
Choose either deployment:

- [Node.js self-hosted server](GATEWAY_SETUP.en.md)
- [Cloudflare Workers + R2](../backend/cloudflare/README.en.md)

The public IPA does not include the author's private gateway or an AMap key. Installing it does not grant access
to a public navigation service. The demo can still use bundled test data, which is not a real route fallback.

## LiveContainer

LiveContainer can import IPA files, but runs the app inside a container with a different permission/runtime model.
This project requires Bluetooth, continuous location and background operation while locked.
**These features have not been verified in LiveContainer.** Start with standalone installation through SideStore;
LiveContainer compatibility is not claimed. See the [official limitations](https://github.com/LiveContainer/LiveContainer#limitations).

## Build an IPA yourself

On a Mac with full Xcode and XcodeGen, run from the repository root:

```sh
scripts/ios/build_sideload_ipa.sh
```

Output is written to `build/sideload/`. The script creates a Release iPhone arm64 app with developer signing
disabled. It does not need the author's Team, certificate or provisioning profile. It verifies the IPA layout,
unencrypted executable, location/Bluetooth permissions, notices and placeholder default gateway, and generates
SHA-256 checksums. Re-signing is required before it can run on a regular iPhone.

The **iOS sideload build** GitHub Actions workflow runs app unit tests, offline gateway UI tests and the same
packaging script. On a successful run, download `MOTO-GPS-unsigned-IPA` from Artifacts (GitHub login required)
and extract the IPA and checksum file. Public Releases provide direct downloads.

Build and simulator checks establish compilation, settings behavior and request switching. They do not replace
SideStore/LiveContainer installation, BLE, locked-screen location or road tests on real devices.
The preview does not claim those unverified compatibility results.
