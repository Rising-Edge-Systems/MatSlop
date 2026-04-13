import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

/**
 * Returns the path to the bundled Octave binary for the current platform,
 * or `null` if the bundle is not present in the workspace. The Octave bundle
 * is downloaded on-demand by `npm run download:octave` from the packaging
 * scripts, so it will be absent in clean dev checkouts. Tests that need it
 * should use `describe.skipIf(!hasBundledOctaveBinary())` to skip gracefully.
 */
export function getBundledOctaveBinaryPath(): string {
  const root = path.resolve(__dirname, '..', '..')
  return process.platform === 'win32'
    ? path.join(root, 'resources', 'octave', 'mingw64', 'bin', 'octave-cli.exe')
    : path.join(root, 'resources', 'octave', 'bin', 'octave-cli')
}

/**
 * @returns `true` if the bundled Octave binary exists on disk AND can
 * actually execute (has all shared library dependencies satisfied).
 * Use with `describe.skipIf(!hasBundledOctaveBinary())` to skip gracefully.
 *
 * On Linux, the .deb-extracted binary depends on system libraries (libhdf5,
 * libcholmod, etc.) that may not be installed. A file-existence-only check
 * would cause tests to fail with "error while loading shared libraries"
 * instead of skipping gracefully.
 */
export function hasBundledOctaveBinary(): boolean {
  const binPath = getBundledOctaveBinaryPath()
  if (!fs.existsSync(binPath)) return false

  // Verify the binary can actually start by running --version
  try {
    execSync(`"${binPath}" --version`, {
      stdio: 'pipe',
      timeout: 15000,
      env: { ...process.env }
    })
    return true
  } catch {
    // Binary exists but can't execute (missing shared libs, wrong arch, etc.)
    return false
  }
}

/**
 * Returns the path to the bundled Octave binary and throws if it is missing.
 * Prefer `hasBundledOctaveBinary()` + `describe.skipIf(...)` to keep tests
 * resilient on clean dev checkouts.
 */
export function getBundledOctaveBinary(): string {
  const binPath = getBundledOctaveBinaryPath()
  if (!fs.existsSync(binPath)) {
    throw new Error(`Bundled Octave binary not found at: ${binPath}`)
  }
  return binPath
}
