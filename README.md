# X Big Brother

**Your data. Your control.** A local-only Android and iOS app for understanding network usage and reviewing app permissions, built with React, TypeScript, and Capacitor.

## What it can actually do

| Capability | Android | iOS |
| --- | --- | --- |
| Wi-Fi and mobile received + sent totals by app | OS-reported statistics for visible launcher-app UIDs, after you grant Usage access. Mobile requires Android 10+. | Not available for other apps through public iOS APIs. |
| Daily trends | Last 7 or 30 UTC days, including partial today; select an app and network. | Clearly labeled fictional demo only. |
| Permission inventory | Declared permission grant flags for visible apps, even without Usage access. | Cannot inspect other apps’ permission grants. |
| Stop a permission | Opens the selected app’s Android Settings, where **you** revoke eligible permissions. | Opens this app’s Settings; guidance directs you to Privacy & Security for other apps. |
| Device-wide packet capture or traffic blocking | Not implemented. No VPN, root, or interception. | Not implemented. No Network Extension entitlement. |

**An ordinary third-party app cannot promise to track all traffic or revoke every permission on either platform.** This project does not bypass OS isolation, decrypt traffic, infer data sharing from byte counts, or silently populate real dashboards with sample data.

### Coverage and accuracy

- Android uses `NetworkStatsManager.querySummary` on a background worker, one query per network per UTC day. Bytes include both received and sent traffic.
- Android 7–9 expose Wi-Fi only here: mobile queries would need phone identifiers, which this app deliberately does not request. On Android 10+, a null subscriber ID requests aggregate mobile statistics without reading SIM identifiers.
- Totals cover **visible launcher apps in the current profile**, not device totals. Hidden/system apps, uninstalled apps, and other profiles may be missing. Package visibility is limited rather than requesting `QUERY_ALL_PACKAGES`.
- Shared-UID packages form one app group to avoid double-counting. Their traffic cannot be separated; hidden siblings may contribute. Permissions are combined across the visible packages in the group.
- Network statistics can lag, use coarse reporting buckets, vary by OS/OEM, and differ from carrier bills. Daily values are OS estimates, not exact packet timestamps. VPN, tethering, dual-SIM, and work-profile attribution depend on Android.
- Inaccessible networks are labeled **Unavailable**, not measured zero. A failed refresh clears old data and offers retry.
- Permission flags do not capture all App Ops, special access, one-time grants, or background restrictions. Some normal/system permissions cannot be revoked; system Settings remains authoritative.
- iOS Settings → **Cellular** shows system-maintained cellular usage. Settings → **Privacy & Security** manages categories of permissions. iOS does not offer this app public APIs for an all-app Wi-Fi history or permission inventory.

## Run the dashboard

Requires Node.js 22.13+ and npm.

```sh
npm ci
npm run dev
```

The browser starts with an honest unavailable-data state. Select **Explore demo** to use fictional app data. Demo mode is never persisted; it cannot open another app’s settings. There are no accounts, remote fonts, external APIs, or analytics.

## Android

Requires Android Studio, JDK 21, and the Android SDK matching `android/variables.gradle` (compile/target SDK 36). Minimum Android version is 7.0 / API 24; Android 10+ is recommended for both networks.

```sh
npm ci
npm run mobile:sync
npm run android
```

In Android Studio, run the `app` configuration on a device/emulator. On the device, select **Open usage settings**, enable Usage access for **X Big Brother**, then return and refresh if needed. Usage access is optional and can be withdrawn in Settings at any time.

Command-line debug APK and unit tests:

```sh
npm run build
npx cap sync android
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to your SDK, or configure an untracked `android/local.properties`. APK output: `android/app/build/outputs/apk/debug/app-debug.apk`. Use your own signing configuration for releases; never commit keystores.

## iOS

Requires macOS, Xcode with iOS 15+ SDK support compatible with Capacitor 8, and an Apple development team for physical-device signing. Linux cannot compile/sign the iOS app.

```sh
npm ci
npm run mobile:sync
npm run ios
```

Choose the `App` scheme, set your signing team and a unique bundle identifier, then run on a simulator or device. Dependencies use Swift Package Manager. The native `DeviceSettings` bridge uses only `UIApplication.openSettingsURLString`, not private Settings URL schemes. The app has no tracking or data-collection declarations and requests no sensitive iOS permissions.

For an unsigned simulator build on macOS:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Native projects are checked in; generated web assets are not. Always run `npm run mobile:sync` after changing the dashboard. Platform-specific sync commands can be used when only one native toolchain is available.

## Tests and CI

```sh
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover formatting, UTC windows, aggregation, filtering, and deterministic demo data. Playwright exercises desktop/mobile layouts, demo navigation, per-app trends, permissions, unavailable states, and mocked Android/iOS bridge contracts. **Mocked browser tests are not native-device tests.**

GitHub Actions runs these checks, Android build/unit tests/lint, and an unsigned iOS simulator build. The `playwright-report-and-screenshots` artifact contains HTML results and screenshot attachments for both viewports; `android-debug-apk` contains the installable debug build.

Before releasing, test on physical Android devices (usage granted/denied/revoked, Wi-Fi/mobile activity, multiple SIMs, shared UIDs, refresh after permission changes) and iOS (Settings navigation, background/foreground, safe-area layout). The app has not been certified for store distribution; store disclosures, branding/signing, and device validation remain release responsibilities.

## Project layout

- `src/`: dashboard, native bridge contracts, and pure data helpers.
- `android/app/src/main/java/ke/charles/xbigbrother/`: native traffic and permission inventory.
- `ios/App/App/`: native iOS app and safe Settings bridge.
- `tests/`: unit and Playwright browser tests.
- `.github/workflows/ci.yml`: repeatable validation and screenshot artifacts.

## Privacy and security

Measurements and app/permission inventory are read on demand and retained only in process memory. No database, export, remote collection, packet contents, URLs, SIM identifiers, or browsing history is collected. Closing the app clears the dashboard; Android’s own counters remain managed by the OS. Refresh and returning from Settings re-read state.

Release web content is bundled locally and restricted with a Content Security Policy. No remote WebView navigation allowlist is configured. Android backups are disabled and cleartext traffic is disallowed. Development Fast Refresh relaxes the page CSP only in Vite’s development server; do not distribute that server as an app.

See [SECURITY.md](SECURITY.md) for scope, limitations, and private vulnerability reporting.
