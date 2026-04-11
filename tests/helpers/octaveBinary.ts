import path from 'path'
import fs from 'fs'

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
 * @returns `true` if the bundled Octave binary exists on disk for the
 * current platform. Use with `describe.skipIf(!hasBundledOctaveBinary())`.
 */
export function hasBundledOctaveBinary(): boolean {
  return fs.existsSync(getBundledOctaveBinaryPath())
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
