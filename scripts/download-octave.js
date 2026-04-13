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

async function main() {
  const platformArg = process.argv.find((a) => a.startsWith('--platform='))
  const platform = platformArg ? platformArg.split('=')[1] : process.platform

  if (platform === 'linux') {
    await downloadLinuxDebs()
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
