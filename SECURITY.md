# Security policy

## Supported versions

This project is pre-release. Security fixes target the latest default-branch code; no older release line is maintained. Do not treat this app as a firewall, anti-malware product, billing meter, or proof that an app has or has not shared information.

## Report a vulnerability privately

Use the repository’s [private vulnerability reporting page](https://github.com/charles2ke/X-Big-Brother/security/advisories/new) if enabled. If unavailable, open a minimal issue asking the maintainer to provide a private reporting channel **without posting vulnerability details or sensitive data**.

Include affected version/commit, platform and OS version, impact, and minimal reproduction steps using synthetic data. Do not attach another person’s app inventory, traffic records, credentials, keystores, packet captures, or personal screenshots. Please avoid public exploit details until a fix and coordinated disclosure are agreed. Response times are not guaranteed.

## Data and trust boundaries

- The UI runs from bundled assets inside a Capacitor WebView. Native plugins expose only an explicit snapshot/settings API, not arbitrary filesystem access or intent execution.
- Android statistics require user-approved Usage access. This app does not request root, Accessibility access, VPN interception, phone identifiers, `READ_PHONE_STATE`, or unrestricted package visibility.
- Android inventories only visible launcher-app packages. Settings requests must match a currently visible installed package. The native plugin validates the requested 7/30-day range and reads statistics off the UI thread.
- Statistics, app names, package IDs, and grant flags are sensitive even without packet contents. They stay in process memory and are not logged by the application, persisted, exported, or transmitted. No advertising, tracking SDK, backend, or cloud account is used.
- Android app backup is disabled and cleartext WebView traffic is disallowed. The app does not request Android’s `INTERNET` permission; the dashboard is served from intercepted bundled resources, not a remote server. Capacitor bridge logging is disabled on both platforms.
- A production Content Security Policy restricts content to the bundled origin and disallows objects and form submission. Inline styles are allowed for chart sizes; inline scripts are not. Development tooling is not a production security boundary.
- iOS cannot expose other apps’ network history or permission grants. Its native settings bridge opens only this app’s public settings URL. No private API, device-management workaround, or Network Extension is included.

## Known limitations

- Grant flags do not model all Android App Ops, special access, one-time permissions, or OS restrictions. Permissions can only be changed by the user through the OS, and not all permissions are revocable.
- Statistics may be delayed, incomplete, misattributed by shared UIDs/VPNs, or unavailable. Hidden apps and other profiles are not fully represented. This is not all-device surveillance or a traffic blocker.
- This app does not decrypt TLS, inspect payloads, identify contacted domains, or determine whether traffic is malicious.
- A rooted/jailbroken or otherwise compromised device can falsify statistics or read process memory. Device screenshots and OS task-switcher previews can expose what is displayed; the app does not promise to prevent OS-level capture.
- Demo data is explicitly labeled, fictional, and separate from real measurements. Tests mocking native responses do not establish correctness on every device/OEM.

## Development and releases

Run the documented lint, tests, browser checks, and native builds before release. Keep dependencies patched and review `npm audit` and GitHub advisories. CI has read-only repository permissions and uploads only synthetic-data browser screenshots and unsigned/debug build artifacts.

Never commit credentials, signing material, device dumps, or real usage data. Use local/CI secret storage for signing; distribute only reviewed release builds, not development servers or debug APKs. Before store submission, verify platform privacy declarations, signing, and behavior on real devices.
