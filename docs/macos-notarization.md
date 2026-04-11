# macOS Notarization Guide (US-042)

MatSlop's `npm run build:mac` produces a signed + notarized `.dmg` so Gatekeeper
opens it without the scary "MatSlop cannot be opened because Apple cannot check
it for malicious software" warning.

This document explains how to set up your Apple Developer account and which
environment variables to export before running the build.

## Prerequisites

1. **Apple Developer Program membership** (US$99/year) — required to obtain a
   Developer ID Application certificate.
2. **Developer ID Application certificate** installed in your macOS login
   keychain. You can create one from
   [Apple Developer → Certificates](https://developer.apple.com/account/resources/certificates/list).
3. **App-specific password** for your Apple ID. Generate one at
   <https://appleid.apple.com> → "Sign-In and Security" → "App-Specific
   Passwords". NEVER use your real Apple ID password — notarytool requires an
   app-specific password.
4. **Team ID** — your 10-character Apple Developer Team ID, visible in the
   "Membership" tab of <https://developer.apple.com/account>.

## Environment variables

`scripts/notarize.cjs` (the `afterSign` hook wired up in
`package.json → build.afterSign`) reads these env vars and passes them to
`notarytool`:

| Variable                        | Meaning                                                                                      |
|---------------------------------|----------------------------------------------------------------------------------------------|
| `CSC_LINK`                      | Path / URL / base64 blob of the `.p12` containing your Developer ID Application certificate. |
| `CSC_KEY_PASSWORD`              | Passphrase that decrypts the `.p12`.                                                         |
| `APPLE_ID`                      | Apple ID email for the Developer account that owns the certificate.                          |
| `APPLE_APP_SPECIFIC_PASSWORD`   | The app-specific password generated above. (Legacy `APPLE_ID_PASSWORD` is also accepted.)    |
| `APPLE_TEAM_ID`                 | Your 10-character Apple Developer Team ID.                                                   |

## Local usage

```bash
export CSC_LINK="/absolute/path/to/matslop-developer-id.p12"
export CSC_KEY_PASSWORD="super-secret-passphrase"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"

npm run build:mac
```

The final `.dmg` in `release/` will be signed **and** notarized. You can
verify with:

```bash
spctl --assess --type execute -vvv "release/mac/MatSlop.app"
codesign --verify --deep --strict --verbose=2 "release/mac/MatSlop.app"
```

The `spctl` output should say `accepted` and `source=Notarized Developer ID`.

## CI usage (GitHub Actions)

Store the certificate and credentials as repo secrets:

```yaml
- name: Build & notarize macOS dmg
  env:
    CSC_LINK: ${{ secrets.APPLE_CERT_BASE64 }}
    CSC_KEY_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: npm run build:mac
```

## Graceful skip

`scripts/notarize.cjs` checks for `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
and `APPLE_TEAM_ID` at the top of the hook. If ANY of them is missing, it
logs a `[notarize] Skipping macOS notarization (missing env vars: ...)`
message and returns successfully. This matches the unsigned fallback
behavior documented in
[`build-signing.md`](./build-signing.md) so that local developers and
dry-run CI jobs can still produce an unsigned `.app` without errors.

If `@electron/notarize` itself isn't installed (e.g. on a lean Linux-only
CI runner) the hook also skips with an informative message.

## Hardened runtime

`build.mac.hardenedRuntime` is set to `true` in `package.json`. Hardened
runtime is **required** by the Apple notary service — without it
`notarytool` rejects the submission. If you need to load unsigned frameworks
or use DYLD env vars, add the relevant entitlements to a
`build/entitlements.mac.plist` file and reference it via
`build.mac.entitlements`.

## Troubleshooting

- **"The binary is not signed with a valid Developer ID certificate"** —
  your `CSC_LINK` points at a Mac App Store cert, not a Developer ID
  Application cert. Export a new `.p12` from Keychain Access that contains
  the cert with `Apple Development: Developer ID Application:` prefix.
- **"Package Invalid: The executable does not have the hardened runtime
  enabled"** — make sure `hardenedRuntime: true` is still present in
  `package.json → build.mac` (US-042 added it).
- **Notarization hangs > 10 minutes** — Apple's notary service is
  occasionally slow. `notarytool` polls with exponential backoff and will
  eventually succeed or time out on its own; don't kill the job.
