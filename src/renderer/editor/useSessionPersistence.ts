import { useEffect, useRef, useCallback } from 'react'
import type { EditorTab } from './editorTypes'
import {
  tabsToSession,
  sessionToTabs,
  type CursorSnapshot,
  type SessionStateWire,
} from './sessionState'

/** Data returned by sessionToTabs when a valid session is found. */
export interface RestoredSession {
  tabs: EditorTab[]
  activeTabId: string | null
  cursors: Record<string, CursorSnapshot>
}

interface UseSessionPersistenceOptions {
  /** Current tab list — reactive input for debounced save. */
  tabs: EditorTab[]
  /** Current active tab ID — reactive input for debounced save. */
  activeTabId: string | null
  /**
   * Called once on mount when a session has been restored (or null if no
   * restorable session was found / restore is disabled / data is corrupt).
   */
  onRestore: (session: RestoredSession | null) => void
}

interface UseSessionPersistenceReturn {
  /** True once the initial restore attempt has completed. */
  sessionReady: boolean
  /** Per-tab cursor positions, updated via updateCursor. */
  tabCursors: Record<string, CursorSnapshot>
  /** Call to update the cursor snapshot for a specific tab. */
  updateCursor: (tabId: string, line: number, column: number) => void
}

/**
 * Hook that encapsulates session save/restore logic.
 *
 * - On mount, checks restore preference and conditionally restores from
 *   the persisted session via `window.matslop.sessionGet()`.
 * - Debounce-saves the session whenever `tabs` or `activeTabId` change.
 * - Flushes immediately on `beforeunload` and on unmount.
 */
export function useSessionPersistence({
  tabs,
  activeTabId,
  onRestore,
}: UseSessionPersistenceOptions): UseSessionPersistenceReturn {
  // ── Refs ─────────────────────────────────────────────────────────────
  const sessionReadyRef = useRef(false)
  const tabCursorsRef = useRef<Record<string, CursorSnapshot>>({})
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const onRestoreRef = useRef(onRestore)
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  // Keep refs up to date so flush can read latest values.
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  onRestoreRef.current = onRestore

  // ── Restore on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    ;(async () => {
      let restored: RestoredSession | null = null
      try {
        const enabled = await window.matslop.sessionGetRestoreEnabled()
        if (enabled) {
          const session: SessionStateWire | null = await window.matslop.sessionGet()
          const loaded = sessionToTabs(session)
          if (loaded) {
            restored = loaded
          }
        }
      } catch {
        // ignore — treat as no session
      }
      onRestoreRef.current(restored)
      sessionReadyRef.current = true
    })()
  }, [])

  // ── Debounced save on tab/activeTabId changes ───────────────────────
  useEffect(() => {
    if (!sessionReadyRef.current) return
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      try {
        const state = tabsToSession(tabs, activeTabId, tabCursorsRef.current)
        void window.matslop.sessionSet(state)
      } catch {
        // ignore
      }
    }, 400)
    return () => {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    }
  }, [tabs, activeTabId])

  // ── Flush on beforeunload + unmount ─────────────────────────────────
  useEffect(() => {
    const flush = (): void => {
      if (!sessionReadyRef.current) return
      try {
        const state = tabsToSession(
          tabsRef.current,
          activeTabIdRef.current,
          tabCursorsRef.current,
        )
        void window.matslop.sessionSet(state)
      } catch {
        // ignore
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  // ── Test hooks for e2e specs ────────────────────────────────────────
  useEffect(() => {
    ;(
      window as unknown as {
        __matslopSessionFlush?: () => void
        __matslopSessionSetCursor?: (tabId: string, line: number, column: number) => void
      }
    ).__matslopSessionFlush = (): void => {
      try {
        const state = tabsToSession(
          tabsRef.current,
          activeTabIdRef.current,
          tabCursorsRef.current,
        )
        void window.matslop.sessionSet(state)
      } catch {
        // ignore
      }
    }
    ;(
      window as unknown as {
        __matslopSessionSetCursor?: (tabId: string, line: number, column: number) => void
      }
    ).__matslopSessionSetCursor = (tabId, line, column): void => {
      tabCursorsRef.current = {
        ...tabCursorsRef.current,
        [tabId]: { line, column },
      }
    }
    return () => {
      const w = window as unknown as {
        __matslopSessionFlush?: () => void
        __matslopSessionSetCursor?: (tabId: string, line: number, column: number) => void
      }
      delete w.__matslopSessionFlush
      delete w.__matslopSessionSetCursor
    }
  }, [])

  // ── updateCursor ────────────────────────────────────────────────────
  const updateCursor = useCallback(
    (tabId: string, line: number, column: number): void => {
      tabCursorsRef.current = {
        ...tabCursorsRef.current,
        [tabId]: { line, column },
      }
    },
    [],
  )

  return {
    sessionReady: sessionReadyRef.current,
    tabCursors: tabCursorsRef.current,
    updateCursor,
  }
}
