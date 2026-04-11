# Build & Code-Signing Guide (US-040)

MatSlop uses [`electron-builder`](https://www.electron.build/) to produce
installers. This document explains how to sign the Windows installer so
Windows SmartScreen doesn't warn your users when they run it.

## Windows Authenticode signing

Electron-builder auto-detects the following environment variables and will
pipe them into `signtool.exe` automatically when you run `npm run build:win`
(or the equivalent CI step):

| Variable            | Meaning                                                                                             |
|---------------------|-----------------------------------------------------------------------------------------------------|
| `CSC_LINK`          | Path OR `https://…` URL OR base64 blob of your code-signing certificate (`.p12` / `.pfx`).          |
| `CSC_KEY_PASSWORD`  | The passphrase that decrypts the certificate file referenced by `CSC_LINK`.                         |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Set to `false` on CI machines that shouldn't fall back to the keychain for macOS builds.  |

The `build.win` block in `package.json` pins the signing hash algorithm to
`sha256` (required for SmartScreen) and uses DigiCert's RFC-3161 timestamp
server so signatures stay valid after the cert expires.

### Supplying the cert locally

```bash
# one-time: export your .pfx from Windows Certificate Manager or purchase one
# from a CA like DigiCert, Sectigo, SSL.com, etc.
export CSC_LINK="/absolute/path/to/matslop-codesign.pfx"
export CSC_KEY_PASSWORD="super-secret-passphrase"

npm run build:win
```

`release/MatSlop Setup <version>.exe` will come out Authenticode-signed.

### Supplying the cert on CI (GitHub Actions)

Store the `.pfx` in the repo's GitHub Actions secrets as a base64 blob
(`base64 -w0 matslop-codesign.pfx`) and add a step like:

```yaml
- name: Build & sign Windows installer
  env:
    CSC_LINK: ${{ secrets.WINDOWS_CERT_BASE64 }}
    CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
  run: npm run build:win
```

Electron-builder recognizes the base64 form of `CSC_LINK` and will decode
it to a temporary file before handing it to `signtool.exe`.

### Unsigned fallback (local dev)

If **neither** `CSC_LINK` nor `WIN_CSC_LINK` are set, electron-builder
emits an **unsigned** installer and prints a warning. This is fine for
local development and CI dry-runs — you just lose SmartScreen reputation.
No additional configuration is required.

## macOS / Linux notes

- macOS DMG signing is controlled by `CSC_LINK` + `CSC_KEY_PASSWORD` (same
  envelope, but for a Developer ID Application certificate). Notarization
  is covered separately by US-042.
- Linux AppImage / `.deb` packages are **not** code-signed; they rely on
  the distribution's own trust model (`gpg --sign` of the file is done
  out-of-band if desired).

## Verifying a signed build

After building, verify the signature with:

```powershell
Get-AuthenticodeSignature "release/MatSlop Setup 0.1.0.exe"
```

The `Status` field should read `Valid` and `SignerCertificate.Subject`
should match the CN of your code-signing cert.
