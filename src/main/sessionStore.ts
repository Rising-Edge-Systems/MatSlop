/**
 * US-034: Session save/restore.
 *
 * Persists the user's editor session (open tabs + active tab + cursor
 * positions) to `session.json` in the Electron userData directory, so the
 * next launch can reopen the last session. Unsaved changes are stored in
 * the same file (inside `content` while `savedContent` is the last on-disk
 * snapshot) — effectively, session.json doubles as the recovery file for
 * dirty buffers.
 *
 * A companion `recovery.json` is written IFF any tab is dirty at save
 * time, so crash recovery can discriminate "we quit cleanly with unsaved
 * work" from the normal restore path.
 *
 * Kept intentionally dependency-free (plain fs, no electron-store) so the
 * file on disk is literally `session.json` — matching the acceptance
 * criterion wording.
 */

import path from 'path'
import fs from 'fs'

// Lazily resolve Electron's `app` so pure helpers in this module
// (e.g. `normalizeSession`) can be imported from a plain-node vitest
// context without pulling in the whole Electron runtime.
function getApp(): { getPath(name: string): string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { app: { getPath(name: string): string } }
  return electron.app
}

/** A single editor tab snapshot. All fields optional on read for forward compat. */
export interface SessionTabSnapshot {
  /** Stable runtime id (re-used on restore so other stores can key on it). */
  id: string
  filename: string
  /** Absolute path on disk, or null for untitled / unsaved buffers. */
  filePath: string | null
  /** 'script' | 'livescript' — kept loose to avoid cross-imports. */
  mode: string
  /** Live buffer content (may include unsaved changes). */
  content: string
  /** Last known on-disk content (used to detect "dirty" on restore). */
  savedContent: string
  /** 1-based cursor line within the tab. */
  cursorLine?: number
  /** 1-based cursor column within the tab. */
  cursorColumn?: number
}

export interface SessionState {
  version: 1
  savedAt: number
  activeTabId: string | null
  tabs: SessionTabSnapshot[]
}

function getSessionFilePath(): string {
  return path.join(getApp().getPath('userData'), 'session.json')
}

function getRecoveryFilePath(): string {
  return path.join(getApp().getPath('userData'), 'recovery.json')
}

/**
 * Read session state from disk. Returns null when:
 *  - the file doesn't exist,
 *  - the file is unreadable,
 *  - or the content fails basic shape validation.
 *
 * Never throws; callers just render the default layout on null.
 */
export function readSession(): SessionState | null {
  try {
    const p = getSessionFilePath()
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeSession(parsed)
  } catch {
    return null
  }
}

/**
 * Validate a parsed JSON blob and coerce it into a safe `SessionState`.
 * Exported for unit testing — pure; no fs / electron imports.
 */
export function normalizeSession(raw: unknown): SessionState | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) return null
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : []
  const tabs: SessionTabSnapshot[] = []
  for (const t of rawTabs) {
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    const filename = typeof r.filename === 'string' ? r.filename : null
    const mode = typeof r.mode === 'string' ? r.mode : 'script'
    if (!id || !filename) continue
    tabs.push({
      id,
      filename,
      filePath: typeof r.filePath === 'string' ? r.filePath : null,
      mode,
      content: typeof r.content === 'string' ? r.content : '',
      savedContent: typeof r.savedContent === 'string' ? r.savedContent : '',
      cursorLine: typeof r.cursorLine === 'number' ? r.cursorLine : undefined,
      cursorColumn: typeof r.cursorColumn === 'number' ? r.cursorColumn : undefined,
    })
  }
  const activeTabId = typeof obj.activeTabId === 'string' ? obj.activeTabId : null
  // If activeTabId doesn't match any tab, drop it.
  const activeValid = activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : null
  const savedAt = typeof obj.savedAt === 'number' ? obj.savedAt : Date.now()
  return { version: 1, savedAt, tabs, activeTabId: activeValid }
}

export function writeSession(state: SessionState): void {
  try {
    const p = getSessionFilePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8')
    // Mirror dirty buffers into recovery.json so a later crash-investigation
    // tool can recover them even if session.json gets overwritten.
    const dirtyTabs = state.tabs.filter((t) => t.content !== t.savedContent)
    if (dirtyTabs.length > 0) {
      const rp = getRecoveryFilePath()
      fs.writeFileSync(
        rp,
        JSON.stringify({ version: 1, savedAt: state.savedAt, tabs: dirtyTabs }, null, 2),
        'utf-8',
      )
    } else {
      // Clean quit — clear any prior recovery file.
      const rp = getRecoveryFilePath()
      if (fs.existsSync(rp)) fs.unlinkSync(rp)
    }
  } catch {
    // ignore write errors — losing session is non-fatal.
  }
}

export function clearSession(): void {
  try {
    const p = getSessionFilePath()
    if (fs.existsSync(p)) fs.unlinkSync(p)
    const rp = getRecoveryFilePath()
    if (fs.existsSync(rp)) fs.unlinkSync(rp)
  } catch {
    // ignore
  }
}
