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

const OCTAVE_VERSION = '9.4.0'

const DOWNLOADS = {
  win32: {
    url: `https://ftpmirror.gnu.org/octave/windows/octave-${OCTAVE_VERSION}-w64.zip`,
    filename: `octave-${OCTAVE_VERSION}-w64.zip`,
    extractedDir: `octave-${OCTAVE_VERSION}`,
    binary: 'mingw64/bin/octave-cli.exe'
  }
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

async function main() {
  const platformArg = process.argv.find((a) => a.startsWith('--platform='))
  const platform = platformArg ? platformArg.split('=')[1] : process.platform

  if (!DOWNLOADS[platform]) {
    console.log(`No bundled Octave distribution configured for platform: ${platform}`)
    console.log('Supported platforms: ' + Object.keys(DOWNLOADS).join(', '))
    console.log('Users will need to install GNU Octave manually on this platform.')
    process.exit(0)
  }

  const config = DOWNLOADS[platform]
  const binaryPath = path.join(OCTAVE_DIR, config.binary)

  // Check if already downloaded
  if (fs.existsSync(binaryPath)) {
    console.log(`Octave ${OCTAVE_VERSION} already downloaded at: ${binaryPath}`)
    return
  }

  console.log(`Downloading GNU Octave ${OCTAVE_VERSION} for ${platform}...`)
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
  if (platform === 'win32') {
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
    console.log(`  Octave ${OCTAVE_VERSION} ready at: ${binaryPath}`)
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
