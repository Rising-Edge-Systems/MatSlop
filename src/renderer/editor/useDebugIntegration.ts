import { useEffect, useRef, useCallback, useMemo } from 'react'
import type { EditorTab } from './editorTypes'
import type { TabAction } from './useTabReducer'
import type { editor as monacoEditor } from 'monaco-editor'

/**
 * Paused-location descriptor from the debugger. Null when not debugging.
 */
export interface PausedLocation {
  file: string
  line: number
}

/**
 * Options accepted by the useDebugIntegration hook.
 */
interface UseDebugIntegrationOptions {
  /** Current paused location from the debugger, null when not debugging. */
  pausedLocation: PausedLocation | null
  /** Current list of open tabs. */
  tabs: EditorTab[]
  /** Currently active tab ID. */
  activeTabId: string | null
  /** Dispatch function from useTabReducer. */
  dispatch: React.Dispatch<TabAction>
  /** Returns the current Monaco editor instance, or null. */
  getEditorInstance: () => monacoEditor.IStandaloneCodeEditor | null
  /**
   * US-023 (edit-and-continue, best effort): fired whenever a file is saved
   * while the debugger is paused so the parent can trigger breakpoint
   * re-application and surface a warning banner.
   */
  onFileSavedWhilePaused?: (filePath: string | null) => void
}

/**
 * Return value of the useDebugIntegration hook.
 */
interface UseDebugIntegrationReturn {
  /** Whether the debugger is currently paused at a location. */
  isPaused: boolean
  /**
   * Notify the hook that a file was saved. If the debugger is currently
   * paused and the file is a .m script, calls onFileSavedWhilePaused and
   * re-applies breakpoints for the file.
   */
  notifyFileSaved: (filePath: string | null) => void
}

/**
 * Hook that encapsulates debugger integration for the editor panel:
 *
 * - When pausedLocation changes to a file already open, dispatches SELECT_TAB.
 * - When pausedLocation changes to a file NOT currently open, reads it via
 *   window.matslop.readFile() and dispatches CREATE_TAB + SELECT_TAB.
 * - After activating the paused tab, moves the cursor to the paused line.
 * - Exposes isPaused and notifyFileSaved for save-while-debugging support.
 */
export function useDebugIntegration({
  pausedLocation,
  tabs,
  activeTabId,
  dispatch,
  getEditorInstance,
  onFileSavedWhilePaused,
}: UseDebugIntegrationOptions): UseDebugIntegrationReturn {
  const isPaused = pausedLocation !== null

  // Keep callbacks in refs to avoid re-triggering effects.
  const onFileSavedWhilePausedRef = useRef(onFileSavedWhilePaused)
  useEffect(() => {
    onFileSavedWhilePausedRef.current = onFileSavedWhilePaused
  }, [onFileSavedWhilePaused])

  const getEditorInstanceRef = useRef(getEditorInstance)
  useEffect(() => {
    getEditorInstanceRef.current = getEditorInstance
  }, [getEditorInstance])

  // Keep isPaused in a ref so notifyFileSaved closure is stable.
  const isPausedRef = useRef(isPaused)
  isPausedRef.current = isPaused

  // US-016: when Octave reports a paused location, activate a tab whose
  // filename matches the paused file (by basename). If no tab matches, we
  // read the file and open it in a new tab.
  useEffect(() => {
    if (!pausedLocation) return
    const rawFile = pausedLocation.file
    if (!rawFile) return

    // Extract the basename portably from either a posix or windows path.
    const lastSep = Math.max(rawFile.lastIndexOf('/'), rawFile.lastIndexOf('\\'))
    const rawBase = lastSep >= 0 ? rawFile.substring(lastSep + 1) : rawFile
    // Octave may report "funcname" without a .m extension. Match permissively:
    // prefer exact filename match, then filename-minus-extension match.
    const candidates = [rawBase, rawBase.endsWith('.m') ? rawBase : `${rawBase}.m`]
    const match = tabs.find((t) => candidates.includes(t.filename))

    if (match) {
      if (match.id !== activeTabId) {
        dispatch({ type: 'SELECT_TAB', payload: { tabId: match.id } })
      }
      // Move the cursor to the paused line after a short delay to allow
      // React to re-render and the editor to update.
      setTimeout(() => {
        const editor = getEditorInstanceRef.current()
        if (editor) {
          editor.setPosition({ lineNumber: pausedLocation.line, column: 1 })
          editor.revealLineInCenter(pausedLocation.line)
        }
      }, 50)
    } else {
      // File not open — read it and create a new tab.
      window.matslop.readFile(rawFile).then((result) => {
        if (result) {
          const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
          dispatch({
            type: 'CREATE_TAB',
            payload: {
              filename: result.filename,
              content: result.content,
              filePath: result.filePath,
              mode,
            },
          })
          // The CREATE_TAB action auto-selects the new tab.
          // Move cursor to paused line after the tab is created.
          setTimeout(() => {
            const editor = getEditorInstanceRef.current()
            if (editor) {
              editor.setPosition({ lineNumber: pausedLocation.line, column: 1 })
              editor.revealLineInCenter(pausedLocation.line)
            }
          }, 100)
        }
      })
    }
  }, [pausedLocation, tabs, activeTabId, dispatch])

  // US-023: Notify the parent when a file is saved while paused.
  const notifyFileSaved = useCallback((filePath: string | null) => {
    if (!isPausedRef.current) return
    if (!filePath || !filePath.endsWith('.m')) return
    onFileSavedWhilePausedRef.current?.(filePath)
    // Re-apply breakpoints — Octave drops them when the file timestamp changes.
    window.matslop.debugReapplyBreakpointsForFile(filePath).catch(() => {
      /* ignore — breakpoints are best-effort */
    })
  }, [])

  return useMemo(() => ({
    isPaused,
    notifyFileSaved,
  }), [isPaused, notifyFileSaved])
}
