#!/usr/bin/env node
/**
 * Downloads GNU Octave portable distribution for bundling with MatSlop.
 *
 * Usage: node scripts/download-octave.js [--platform win32|linux|darwin]
 *
 * Downloads to: resources/octave/
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import http from 'http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')
const OCTAVE_DIR = path.join(ROOT, 'resources', 'octave')

// Per-platform pinned versions. Windows uses the current GNU Octave release
// hosted directly on ftp.gnu.org (the GNU mirror redirector returned
// 502 during v3 polish validation). macOS is pinned to the latest octave-app
// release (v9.2 — octave-app has not published a v9.4). Linux is
// intentionally NOT bundled: no maintained, stable AppImage / static tarball
// source exists upstream, so Linux users install via their package manager
// (apt, dnf, pacman, flatpak, brew) and MatSlop falls back to PATH lookup at
// runtime.
//
// NOTE: macOS doesn't have a "portable" Octave archive the way Windows does,
// but the octave-app project ships a notarized Octave.app bundle as a .dmg
// (https://github.com/octave-app/octave-app/releases). We download that .dmg
// and extract Octave.app into resources/octave/ so packaging ends up with
// resources/octave/Octave.app/Contents/Resources/usr/bin/octave-cli.
const WIN_OCTAVE_VERSION = '9.4.0'
// octave-app release ceiling — do not bump past the latest tag at
// https://github.com/octave-app/octave-app/releases (currently v9.2).
const MAC_OCTAVE_VERSION = '9.2'

// Ubuntu Noble 24.04 packages for Linux bundling.
const LINUX_OCTAVE_VERSION = '8.4.0'
const LINUX_DEB_BASE = 'http://archive.ubuntu.com/ubuntu/pool/universe/o/octave'
const LINUX_FONT_BASE = 'http://archive.ubuntu.com/ubuntu/pool/main/f/fonts-freefont'

const LINUX_DEBS = [
  { url: `${LINUX_DEB_BASE}/octave_${LINUX_OCTAVE_VERSION}-1build4_amd64.deb`, filename: `octave_${LINUX_OCTAVE_VERSION}-1build4_amd64.deb` },
  { url: `${LINUX_DEB_BASE}/octave-common_${LINUX_OCTAVE_VERSION}-1build4_all.deb`, filename: `octave-common_${LINUX_OCTAVE_VERSION}-1build4_all.deb` },
  { url: `${LINUX_DEB_BASE}/liboctave-dev_${LINUX_OCTAVE_VERSION}-1build4_amd64.deb`, filename: `liboctave-dev_${LINUX_OCTAVE_VERSION}-1build4_amd64.deb` },
  { url: `${LINUX_FONT_BASE}/fonts-freefont-otf_20211204+svn4273-2_all.deb`, filename: 'fonts-freefont-otf_20211204+svn4273-2_all.deb' }
]

const DOWNLOADS = {
  win32: {
    url: `https://ftp.gnu.org/gnu/octave/windows/octave-${WIN_OCTAVE_VERSION}-w64.zip`,
    filename: `octave-${WIN_OCTAVE_VERSION}-w64.zip`,
    extractedDir: `octave-${WIN_OCTAVE_VERSION}-w64`,
    binary: 'mingw64/bin/octave-cli.exe'
  },
  darwin: {
    url: `https://github.com/octave-app/octave-app/releases/download/v${MAC_OCTAVE_VERSION}/Octave-${MAC_OCTAVE_VERSION}.dmg`,
    filename: `Octave-${MAC_OCTAVE_VERSION}.dmg`,
    // Relative to OCTAVE_DIR, this is the binary we expect after extraction.
    binary: 'Octave.app/Contents/Resources/usr/bin/octave-cli'
  }
  // Linux uses a separate code path with multiple .deb packages — see main().
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = url.startsWith('https') ? https.get : http.get

    function followRedirects(url, redirectCount = 0) {
      if (redirectCount > 10) {
        reject(new Error('Too many redirects'))
        return
      }
      get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          followRedirects(response.headers.location, redirectCount + 1)
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }
        const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedBytes = 0
        let lastPercent = -1

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length
          if (totalBytes > 0) {
            const percent = Math.floor((downloadedBytes / totalBytes) * 100)
            if (percent !== lastPercent && percent % 5 === 0) {
              lastPercent = percent
              process.stdout.write(`\r  Downloading: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`)
            }
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          console.log('')
          resolve()
        })
      }).on('error', (err) => {
        fs.unlink(dest, () => {})
        reject(err)
      })
    }

    followRedirects(url)
  })
}

/**
 * Extract a .deb package into destDir.
 * Tries dpkg-deb first (available on Debian/Ubuntu), then falls back to
 * ar x + tar xf which works on any Linux.
 */
function extractDeb(debPath, destDir) {
  try {
    execSync(`dpkg-deb -x "${debPath}" "${destDir}"`, { stdio: 'pipe', timeout: 120000 })
    return
  } catch {
    // dpkg-deb not available — fall back to ar + tar
  }

  // Fallback: ar x to extract data.tar.*, then tar xf into destDir
  const tmpDir = path.join(destDir, `.deb-extract-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  try {
    execSync(`ar x "${debPath}"`, { cwd: tmpDir, stdio: 'pipe', timeout: 120000 })
    // Find the data tarball (data.tar.xz, data.tar.gz, data.tar.zst, etc.)
    const dataTar = fs.readdirSync(tmpDir).find((f) => f.startsWith('data.tar'))
    if (!dataTar) {
      throw new Error(`No data.tar.* found in ${debPath}`)
    }
    execSync(`tar xf "${path.join(tmpDir, dataTar)}" -C "${destDir}"`, {
      stdio: 'pipe',
      timeout: 120000
    })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Download and extract Octave .deb packages from the Ubuntu archive for Linux.
 */
async function downloadLinuxDebs() {
  const binaryPath = path.join(OCTAVE_DIR, 'usr', 'bin', 'octave-cli')

  // Idempotency check
  if (fs.existsSync(binaryPath)) {
    console.log(`Octave ${LINUX_OCTAVE_VERSION} already downloaded at: ${binaryPath}`)
    return
  }

  console.log(`Downloading GNU Octave ${LINUX_OCTAVE_VERSION} .deb packages for Linux...`)
  fs.mkdirSync(OCTAVE_DIR, { recursive: true })

  // Download all .deb packages
  for (const deb of LINUX_DEBS) {
    const debPath = path.join(OCTAVE_DIR, deb.filename)
    if (!fs.existsSync(debPath)) {
      console.log(`  From: ${deb.url}`)
      await download(deb.url, debPath)
      console.log('  Download complete.')
    } else {
      console.log(`  Already downloaded: ${deb.filename}`)
    }
  }

  // Extract all .deb packages into OCTAVE_DIR
  console.log('  Extracting .deb packages...')
  for (const deb of LINUX_DEBS) {
    const debPath = path.join(OCTAVE_DIR, deb.filename)
    console.log(`    Extracting ${deb.filename}...`)
    extractDeb(debPath, OCTAVE_DIR)
    // Clean up the .deb after extraction
    fs.unlinkSync(debPath)
  }

  // Verify binary
  if (fs.existsSync(binaryPath)) {
    console.log(`  Octave ${LINUX_OCTAVE_VERSION} ready at: ${binaryPath}`)
  } else {
    console.error('  ERROR: Binary not found after extraction:', binaryPath)
    console.log('  Directory contents:', fs.readdirSync(OCTAVE_DIR))
    process.exit(1)
  }

  // Verify fonts
  const fontPath = path.join(OCTAVE_DIR, 'usr', 'share', 'fonts', 'opentype', 'freefont', 'FreeSans.otf')
  if (fs.existsSync(fontPath)) {
    console.log(`  Fonts ready at: ${fontPath}`)
  } else {
    console.warn('  WARNING: FreeSans.otf font not found at expected path:', fontPath)
  }
}

// ── US-B02: font_redirect.so LD_PRELOAD shim ──────────────────────────
// Intercepts openat() calls that reference the hardcoded system font path
// and rewrites them to the bundled font directory. The redirect root is
// read from the MATSLOP_OCTAVE_ROOT env var so the shim is relocatable.
const FONT_REDIRECT_C = `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <stdarg.h>

static const char PREFIX[] = "/usr/share/fonts/opentype/freefont/";
static const int  PREFIX_LEN = sizeof(PREFIX) - 1;

typedef int (*orig_openat_t)(int dirfd, const char *pathname, int flags, ...);

int openat(int dirfd, const char *pathname, int flags, ...) {
    orig_openat_t orig = (orig_openat_t)dlsym(RTLD_NEXT, "openat");

    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }

    if (pathname && strncmp(pathname, PREFIX, PREFIX_LEN) == 0) {
        const char *root = getenv("MATSLOP_OCTAVE_ROOT");
        if (root) {
            /* Build redirected path: <root>/usr/share/fonts/opentype/freefont/<tail> */
            char buf[4096];
            snprintf(buf, sizeof(buf), "%s%s", root, pathname);
            return orig(dirfd, buf, flags, mode);
        }
    }
    return orig(dirfd, pathname, flags, mode);
}
`;

/**
 * Compile the font_redirect LD_PRELOAD shim.
 * Writes the C source, compiles with gcc, then removes the source.
 * If gcc is not available, prints a warning and skips.
 */
function compileFontRedirect() {
  const soPath = path.join(OCTAVE_DIR, 'font_redirect.so')
  if (fs.existsSync(soPath)) {
    console.log('  font_redirect.so already exists, skipping compilation.')
    return
  }

  const cPath = path.join(OCTAVE_DIR, 'font_redirect.c')
  fs.writeFileSync(cPath, FONT_REDIRECT_C)
  try {
    execSync(
      `gcc -shared -fPIC -o "${soPath}" "${cPath}" -ldl`,
      { stdio: 'pipe', timeout: 30000 }
    )
    console.log('  Compiled font_redirect.so')
  } catch (err) {
    console.warn('  WARNING: gcc not available — font_redirect.so not compiled.')
    console.warn('  Plotting with bundled fonts may not work. Install gcc to enable font redirection.')
  } finally {
    // Always clean up the C source
    try { fs.unlinkSync(cPath) } catch { /* ignore */ }
  }
}

/**
 * Create a fontconfig configuration file that includes the bundled fonts
 * and falls back to system fonts.
 */
function createFontsConf() {
  const confPath = path.join(OCTAVE_DIR, 'fonts.conf')
  if (fs.existsSync(confPath)) {
    console.log('  fonts.conf already exists, skipping.')
    return
  }

  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <!-- Bundled FreeFonts (relative to MATSLOP_OCTAVE_ROOT) -->
  <dir prefix="default">usr/share/fonts/opentype/freefont</dir>
  <!-- System fallback -->
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <dir prefix="xdg">fonts</dir>
</fontconfig>
`
  fs.writeFileSync(confPath, xml)
  console.log('  Created fonts.conf')
}

/**
 * Create a wrapper shell script at resources/octave/bin/octave-cli that sets
 * up the environment and execs the real Octave binary.
 */
function createWrapperScript() {
  const binDir = path.join(OCTAVE_DIR, 'bin')
  const wrapperPath = path.join(binDir, 'octave-cli')
  if (fs.existsSync(wrapperPath)) {
    console.log('  Wrapper script already exists, skipping.')
    return
  }

  fs.mkdirSync(binDir, { recursive: true })

  // Use JS interpolation for LINUX_OCTAVE_VERSION; escape bash $vars with \$
  const script = [
    '#!/usr/bin/env bash',
    '# MatSlop Octave wrapper — sets up environment for bundled Linux Octave.',
    '# Auto-generated by download-octave.js (US-B02). Do not edit.',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'OCTAVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"',
    '',
    'export MATSLOP_OCTAVE_ROOT="$OCTAVE_ROOT"',
    'export OCTAVE_HOME="$OCTAVE_ROOT/usr"',
    '',
    '# Library search path — include bundled libs',
    `export LD_LIBRARY_PATH="$OCTAVE_ROOT/usr/lib/x86_64-linux-gnu:$OCTAVE_ROOT/usr/lib/x86_64-linux-gnu/octave/${LINUX_OCTAVE_VERSION}:\${LD_LIBRARY_PATH:-}"`,
    '',
    '# Font redirect shim',
    'if [ -f "$OCTAVE_ROOT/font_redirect.so" ]; then',
    '  export LD_PRELOAD="$OCTAVE_ROOT/font_redirect.so${LD_PRELOAD:+:$LD_PRELOAD}"',
    'fi',
    '',
    '# Fontconfig',
    'export FONTCONFIG_FILE="$OCTAVE_ROOT/fonts.conf"',
    '',
    '# Graphics terminal',
    'export GNUTERM=pngcairo',
    '',
    'exec "$OCTAVE_ROOT/usr/bin/octave-cli" "$@"',
    ''
  ].join('\n')
  fs.writeFileSync(wrapperPath, script, { mode: 0o755 })
  console.log('  Created wrapper script at bin/octave-cli')
}

async function main() {
  const platformArg = process.argv.find((a) => a.startsWith('--platform='))
  const platform = platformArg ? platformArg.split('=')[1] : process.platform

  if (platform === 'linux') {
    await downloadLinuxDebs()
    compileFontRedirect()
    createFontsConf()
    createWrapperScript()
    return
  }

  if (!DOWNLOADS[platform]) {
    console.log(`No bundled Octave distribution configured for platform: ${platform}`)
    console.log('Supported bundled platforms: ' + Object.keys(DOWNLOADS).join(', '))
    console.log('Users will need to install GNU Octave manually on this platform.')
    return
  }

  const config = DOWNLOADS[platform]
  const version = platform === 'win32' ? WIN_OCTAVE_VERSION : MAC_OCTAVE_VERSION
  const binaryPath = path.join(OCTAVE_DIR, config.binary)

  // Check if already downloaded
  if (fs.existsSync(binaryPath)) {
    console.log(`Octave ${version} already downloaded at: ${binaryPath}`)
    return
  }

  console.log(`Downloading GNU Octave ${version} for ${platform}...`)
  fs.mkdirSync(OCTAVE_DIR, { recursive: true })

  const archivePath = path.join(OCTAVE_DIR, config.filename)

  // Download
  if (!fs.existsSync(archivePath)) {
    console.log(`  From: ${config.url}`)
    await download(config.url, archivePath)
    console.log('  Download complete.')
  }

  // Extract
  console.log('  Extracting (this may take a few minutes)...')
  if (platform === 'darwin') {
    // Attach the .dmg to a temporary mount point, copy Octave.app out, detach.
    const mountPoint = path.join(OCTAVE_DIR, `.mount-${Date.now()}`)
    fs.mkdirSync(mountPoint, { recursive: true })
    try {
      execSync(
        `hdiutil attach -nobrowse -readonly -mountpoint "${mountPoint}" "${archivePath}"`,
        { stdio: 'inherit', timeout: 600000 }
      )
      // Find Octave.app inside the mounted volume (it's usually at the root).
      const appSrcCandidates = [
        path.join(mountPoint, 'Octave.app'),
        path.join(mountPoint, `Octave-${MAC_OCTAVE_VERSION}.app`)
      ]
      const appSrc = appSrcCandidates.find((p) => fs.existsSync(p))
      if (!appSrc) {
        throw new Error(
          `Octave.app not found in DMG. Volume contents: ${fs.readdirSync(mountPoint).join(', ')}`
        )
      }
      const appDest = path.join(OCTAVE_DIR, 'Octave.app')
      // Preserve symlinks + permissions via `cp -R` (ditto is also fine).
      execSync(`cp -R "${appSrc}" "${appDest}"`, { stdio: 'inherit', timeout: 1200000 })
    } finally {
      try {
        execSync(`hdiutil detach "${mountPoint}" -force`, {
          stdio: 'inherit',
          timeout: 60000
        })
      } catch {
        // ignore detach errors
      }
      if (fs.existsSync(mountPoint)) {
        try {
          fs.rmdirSync(mountPoint)
        } catch {
          // may not be empty if detach failed; leave it for the user to clean up
        }
      }
    }
  } else if (platform === 'win32') {
    // Use PowerShell to extract on Windows
    execSync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${OCTAVE_DIR}' -Force"`,
      { stdio: 'inherit', timeout: 1200000 }
    )
    // Move contents from extracted subdirectory to octave dir root
    const extractedPath = path.join(OCTAVE_DIR, config.extractedDir)
    if (fs.existsSync(extractedPath)) {
      const entries = fs.readdirSync(extractedPath)
      for (const entry of entries) {
        const src = path.join(extractedPath, entry)
        const dest = path.join(OCTAVE_DIR, entry)
        if (!fs.existsSync(dest)) {
          fs.renameSync(src, dest)
        }
      }
      fs.rmSync(extractedPath, { recursive: true, force: true })
    }
  }

  // Clean up archive
  fs.unlinkSync(archivePath)

  // Verify
  if (fs.existsSync(binaryPath)) {
    console.log(`  Octave ${version} ready at: ${binaryPath}`)
  } else {
    console.error('  ERROR: Binary not found after extraction:', binaryPath)
    console.log('  Directory contents:', fs.readdirSync(OCTAVE_DIR))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Failed to download Octave:', err)
  process.exit(1)
})
