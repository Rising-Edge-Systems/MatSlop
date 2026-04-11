/**
 * US-034: renderer-side pure helpers for session save/restore.
 *
 * Keeps tab-snapshot <-> EditorTab conversions pure and unit-testable.
 * No React, no window, no main-process imports.
 */

import type { EditorTab, EditorTabMode } from './editorTypes'

/** Wire shape — must match main/sessionStore.ts `SessionTabSnapshot`. */
export interface SessionTabSnapshot {
  id: string
  filename: string
  filePath: string | null
  mode: string
  content: string
  savedContent: string
  cursorLine?: number
  cursorColumn?: number
}

export interface SessionStateWire {
  version: 1
  savedAt: number
  activeTabId: string | null
  tabs: SessionTabSnapshot[]
}

export interface CursorSnapshot {
  line: number
  column: number
}

const ALLOWED_MODES: EditorTabMode[] = ['script', 'livescript', 'welcome']

function normalizeMode(mode: string): EditorTabMode {
  return (ALLOWED_MODES as string[]).includes(mode) ? (mode as EditorTabMode) : 'script'
}

/**
 * Convert an in-memory list of `EditorTab`s + activeTabId + per-tab cursors
 * into a wire-ready session snapshot. Welcome tabs are dropped (they're
 * re-created from the welcome preference on next launch).
 */
export function tabsToSession(
  tabs: EditorTab[],
  activeTabId: string | null,
  cursors: Record<string, CursorSnapshot>,
): SessionStateWire {
  const snaps: SessionTabSnapshot[] = tabs
    .filter((t) => t.mode !== 'welcome')
    .map((t) => {
      const cursor = cursors[t.id]
      return {
        id: t.id,
        filename: t.filename,
        filePath: t.filePath,
        mode: t.mode,
        content: t.content,
        savedContent: t.savedContent,
        cursorLine: cursor?.line,
        cursorColumn: cursor?.column,
      }
    })
  // If the active tab was a welcome tab (dropped), fall back to first non-welcome.
  const activeSurvives =
    activeTabId !== null && snaps.some((s) => s.id === activeTabId)
  return {
    version: 1,
    savedAt: Date.now(),
    tabs: snaps,
    activeTabId: activeSurvives ? activeTabId : snaps[0]?.id ?? null,
  }
}

/**
 * Convert a session wire snapshot back into `EditorTab`s suitable for
 * seeding EditorPanel's tabs state. Returns `null` when the snapshot has
 * no usable tabs, so the caller can fall back to the default welcome/new
 * tab path.
 */
export function sessionToTabs(
  session: SessionStateWire | null,
): { tabs: EditorTab[]; activeTabId: string | null; cursors: Record<string, CursorSnapshot> } | null {
  if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) {
    return null
  }
  const tabs: EditorTab[] = session.tabs.map((s) => ({
    id: s.id,
    filename: s.filename,
    filePath: s.filePath,
    mode: normalizeMode(s.mode),
    content: s.content,
    savedContent: s.savedContent,
  }))
  const cursors: Record<string, CursorSnapshot> = {}
  for (const s of session.tabs) {
    if (typeof s.cursorLine === 'number' && typeof s.cursorColumn === 'number') {
      cursors[s.id] = { line: s.cursorLine, column: s.cursorColumn }
    }
  }
  const activeTabId =
    session.activeTabId && tabs.some((t) => t.id === session.activeTabId)
      ? session.activeTabId
      : tabs[0].id
  return { tabs, activeTabId, cursors }
}

/**
 * Returns true iff any tab in the session has unsaved changes
 * (content !== savedContent). Exposed so callers can decide whether to
 * show "recovered unsaved changes" UI.
 */
export function sessionHasDirtyTabs(session: SessionStateWire | null): boolean {
  if (!session) return false
  return session.tabs.some((t) => t.content !== t.savedContent)
}
