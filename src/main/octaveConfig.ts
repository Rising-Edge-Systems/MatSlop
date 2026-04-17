import Store from 'electron-store'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const store = new Store<{ octavePath: string }>()

function getBundledOctavePath(): string | null {
  // In packaged app: resources are in process.resourcesPath
  // In dev mode: __dirname is dist/main/, so project root is ../../
  const searchPaths = app.isPackaged
    ? [
        path.join(app.getPath('userData'), 'octave'),
        path.join(process.resourcesPath, 'octave'),
      ]
    : [
        path.join(app.getAppPath(), 'resources', 'octave'),
        path.join(__dirname, '..', '..', 'resources', 'octave')
      ]

  for (const base of searchPaths) {
    let candidates: string[]
    if (process.platform === 'win32') {
      candidates = [
        // conda-forge env layout (micromamba install path).
        path.join(base, 'env', 'Library', 'bin', 'octave-cli.exe'),
        path.join(base, 'env', 'bin', 'octave-cli.exe'),
        // Legacy mingw64 portable layout from the pre-conda days.
        path.join(base, 'mingw64', 'bin', 'octave-cli.exe'),
      ]
    } else if (process.platform === 'darwin') {
      candidates = [
        // conda-forge env layout (micromamba install path).
        path.join(base, 'env', 'bin', 'octave-cli'),
        path.join(base, 'env', 'bin', 'octave'),
        // Legacy octave-app DMG layout.
        path.join(base, 'Octave.app', 'Contents', 'Resources', 'usr', 'bin', 'octave-cli'),
        path.join(base, 'Octave.app', 'Contents', 'Resources', 'usr', 'bin', 'octave'),
        path.join(base, 'bin', 'octave-cli'),
        path.join(base, 'bin', 'octave')
      ]
    } else {
      candidates = [
        // conda-forge env layout (micromamba install path).
        path.join(base, 'env', 'bin', 'octave-cli'),
        path.join(base, 'env', 'bin', 'octave'),
        // Legacy .deb extraction layout.
        path.join(base, 'usr', 'bin', 'octave-cli'),
        path.join(base, 'usr', 'bin', 'octave'),
        // Legacy AppImage layout.
        path.join(base, 'squashfs-root', 'usr', 'bin', 'octave-cli'),
        path.join(base, 'squashfs-root', 'usr', 'bin', 'octave'),
        path.join(base, 'bin', 'octave-cli'),
        path.join(base, 'bin', 'octave')
      ]
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

const SEARCH_PATHS_UNIX = [
  '/usr/bin/octave-cli',
  '/usr/bin/octave',
  '/usr/local/bin/octave-cli',
  '/usr/local/bin/octave',
  '/opt/homebrew/bin/octave-cli',
  '/opt/homebrew/bin/octave'
]

function getWindowsSearchPaths(): string[] {
  const paths: string[] = []
  const programDirs = [
    'C:\\Program Files\\GNU Octave',
    'C:\\Program Files (x86)\\GNU Octave'
  ]
  for (const dir of programDirs) {
    try {
      if (fs.existsSync(dir)) {
        const versions = fs.readdirSync(dir)
        for (const ver of versions) {
          paths.push(path.join(dir, ver, 'mingw64', 'bin', 'octave-cli.exe'))
          paths.push(path.join(dir, ver, 'bin', 'octave-cli.exe'))
        }
      }
    } catch {
      // ignore
    }
  }
  return paths
}

function findInPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const ext = process.platform === 'win32' ? '.exe' : ''
  for (const dir of pathEnv.split(sep)) {
    const fullPath = path.join(dir, name + ext)
    try {
      fs.accessSync(fullPath, fs.constants.X_OK)
      return fullPath
    } catch {
      // not found here
    }
  }
  return null
}

export function autoDetectOctavePath(): string | null {
  // Check stored path first
  const stored = store.get('octavePath')
  if (stored && fs.existsSync(stored)) {
    return stored
  }

  // Check for bundled Octave
  const bundled = getBundledOctavePath()
  if (bundled) return bundled

  if (process.platform === 'win32') {
    // Check Windows-specific paths
    for (const p of getWindowsSearchPaths()) {
      if (fs.existsSync(p)) return p
    }
    // Check PATH
    return findInPath('octave-cli') ?? findInPath('octave')
  } else {
    // Check known Unix paths
    for (const p of SEARCH_PATHS_UNIX) {
      try {
        fs.accessSync(p, fs.constants.X_OK)
        return p
      } catch {
        // not found
      }
    }
    // Check PATH
    return findInPath('octave-cli') ?? findInPath('octave')
  }
}

export function validateOctavePath(
  binaryPath: string,
  timeoutMs: number = 120_000,
): Promise<{ valid: boolean; version?: string; error?: string }> {
  // First-run timeout has to absorb macOS Gatekeeper's transitive-dylib scan,
  // which takes ~30–60s on an ad-hoc-signed conda-forge Octave the very first
  // time the binary (and everything it links against) is exec'd. Once the OS
  // caches the assessment, subsequent `--version` calls return in ~200ms.
  //
  // OCTAVE_HOME/OCTAVE_EXEC_HOME: see the long comment in octaveProcess.ts
  // start() — conda-forge's embedded prefix is NUL-padded and, if Octave
  // falls back to it, std::string keeps the NULs and `genpath` recurses into
  // the prefix dir forever. These env vars make Octave use a clean prefix.
  const octaveHome = path.dirname(path.dirname(binaryPath))
  const env = { ...process.env, OCTAVE_HOME: octaveHome, OCTAVE_EXEC_HOME: octaveHome }
  return new Promise((resolve) => {
    try {
      execFile(binaryPath, ['--version'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
        if (err) {
          // Include stderr in the error — Node's default err.message
          // ("Command failed: ...") tells us nothing about what actually
          // went wrong. The real reason (missing dylib, Gatekeeper block,
          // quarantine, etc.) is always in stderr.
          const parts = [err.message]
          const stderrText = (stderr ?? '').toString().trim()
          if (stderrText) parts.push(stderrText)
          resolve({ valid: false, error: parts.join(' — ') })
          return
        }
        const output = stdout || stderr
        const versionMatch = output.match(/GNU Octave,? version (\S+)/i)
        resolve({
          valid: true,
          version: versionMatch ? versionMatch[1] : 'unknown'
        })
      })
    } catch (err) {
      resolve({ valid: false, error: String(err) })
    }
  })
}

/**
 * Resolve the directory containing bundled Octave helper scripts
 * (e.g. `matslop_export_fig.m`). Returns the first existing candidate or
 * `null` if no directory is found.
 *
 * - Packaged: `<resources>/octave-scripts` (wired via electron-builder
 *   `extraResources` in package.json).
 * - Dev: the repo-local `resources/octave-scripts` directory, resolved
 *   relative to either `app.getAppPath()` or `__dirname`.
 */
export function getMatslopScriptsDir(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'octave-scripts')]
    : [
        path.join(app.getAppPath(), 'resources', 'octave-scripts'),
        path.join(__dirname, '..', '..', 'resources', 'octave-scripts')
      ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c
    } catch {
      // ignore
    }
  }
  return null
}

export function getStoredOctavePath(): string | null {
  return store.get('octavePath') ?? null
}

export function setOctavePath(binaryPath: string): void {
  store.set('octavePath', binaryPath)
}
