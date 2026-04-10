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
    ? [path.join(process.resourcesPath, 'octave')]
    : [
        path.join(app.getAppPath(), 'resources', 'octave'),
        path.join(__dirname, '..', '..', 'resources', 'octave')
      ]

  for (const base of searchPaths) {
    const candidates =
      process.platform === 'win32'
        ? [path.join(base, 'mingw64', 'bin', 'octave-cli.exe')]
        : [
            path.join(base, 'bin', 'octave-cli'),
            path.join(base, 'bin', 'octave')
          ]

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

export function validateOctavePath(binaryPath: string): Promise<{ valid: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      execFile(binaryPath, ['--version'], { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ valid: false, error: String(err.message) })
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

export function getStoredOctavePath(): string | null {
  return store.get('octavePath') ?? null
}

export function setOctavePath(binaryPath: string): void {
  store.set('octavePath', binaryPath)
}
