/**
 * US-P05: Window state persistence.
 *
 * Persists the main BrowserWindow's bounds (x/y/width/height) and
 * maximized flag to `window-state.json` in the Electron userData
 * directory so the next launch can reopen at the same size and
 * location. Kept dependency-free (plain fs) to match the rest of
 * the project's storage modules (sessionStore, appConfig).
 */

import path from 'path'
import fs from 'fs'

function getApp(): { getPath(name: string): string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { app: { getPath(name: string): string } }
  return electron.app
}

export interface WindowStateSnapshot {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function getWindowStateFilePath(): string {
  return path.join(getApp().getPath('userData'), 'window-state.json')
}

/** Read persisted window state. Returns null when missing or malformed. */
export function readWindowState(): WindowStateSnapshot | null {
  try {
    const p = getWindowStateFilePath()
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeWindowState(parsed)
  } catch {
    return null
  }
}

/** Pure validator — exported for unit tests. */
export function normalizeWindowState(raw: unknown): WindowStateSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const width = typeof obj.width === 'number' ? obj.width : null
  const height = typeof obj.height === 'number' ? obj.height : null
  if (width === null || height === null) return null
  if (width < 200 || height < 200) return null
  return {
    width,
    height,
    x: typeof obj.x === 'number' ? obj.x : undefined,
    y: typeof obj.y === 'number' ? obj.y : undefined,
    maximized: typeof obj.maximized === 'boolean' ? obj.maximized : undefined,
  }
}

export function writeWindowState(state: WindowStateSnapshot): void {
  try {
    const p = getWindowStateFilePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // ignore write errors — losing window state is non-fatal.
  }
}
