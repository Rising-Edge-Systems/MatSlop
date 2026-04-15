import { useState, useCallback, useRef } from 'react'
import type { EditorTab } from './editorTypes'
import { findSectionRange, findNextSectionAdvanceLine } from './editorTypes'
import { isFunctionOnlyFile, buildRunScriptCommand } from './functionFileDetection'
import type { TabAction } from './useTabReducer'
import type { editor as monacoEditor } from 'monaco-editor'

/**
 * Options accepted by the useScriptExecution hook.
 */
interface UseScriptExecutionOptions {
  /** Returns the currently active tab, or null. */
  getActiveTab: () => EditorTab | null
  /** Save the given tab (auto-save before run). Returns true on success. */
  saveFile: (tab: EditorTab) => Promise<boolean>
  /** Dispatch function from useTabReducer — used for UPDATE_SAVED_CONTENT on auto-save. */
  dispatch: React.Dispatch<TabAction>
  /** Current engine status — not used directly but kept for future gating. */
  engineStatus?: string
  /** Callback fired after building a run command for a saved file. */
  onRun?: (filePath: string, dirPath: string) => void
  /** Callback to stop execution. */
  onStop?: () => void
  /** Callback fired with section code to run a section. */
  onRunSection?: (code: string) => void
  /** Returns the current Monaco editor instance, or null. */
  getEditorInstance: () => monacoEditor.IStandaloneCodeEditor | null
  /** Whether the debugger is currently paused (for dbcont behavior). */
  isPaused?: boolean
}

/**
 * Hook that encapsulates script run / stop / run-section / run-and-advance logic.
 *
 * All execution commands are built via pure helpers (buildRunScriptCommand,
 * findSectionRange, etc.) and dispatched through IPC or callbacks. The hook
 * manages the runWarning state internally.
 */
export function useScriptExecution({
  getActiveTab,
  saveFile,
  dispatch,
  onRun,
  onStop,
  onRunSection,
  getEditorInstance,
  isPaused,
}: UseScriptExecutionOptions) {
  const [runWarning, setRunWarning] = useState<string | null>(null)

  // Keep callbacks in refs so the stable run/stop closures always see latest
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onRunSectionRef = useRef(onRunSection)
  onRunSectionRef.current = onRunSection
  const onStopRef = useRef(onStop)
  onStopRef.current = onStop
  const isPausedRef = useRef(isPaused ?? false)
  isPausedRef.current = isPaused ?? false

  const clearRunWarning = useCallback(() => {
    setRunWarning(null)
  }, [])

  /**
   * Run the active tab's script. Auto-saves first.
   * - If paused at a breakpoint, sends dbcont instead of re-running.
   * - If the file is function-only, sets runWarning and returns.
   * - If the file is untitled, writes to a temp file and runs from there.
   */
  const run = useCallback(async () => {
    // If paused at a breakpoint, continue instead of re-running.
    if (isPausedRef.current) {
      window.dispatchEvent(new CustomEvent('matslop:debugContinued'))
      window.matslop.octaveSendRaw('dbcont').then((result) => {
        if (result.output?.trim()) {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: '', output: result.output, error: result.error },
          }))
        }
      }).catch(() => {})
      return
    }

    const tab = getActiveTab()
    if (!tab) return

    // Clear stale warning
    setRunWarning(null)

    // US-S05: function-only file detection
    if (isFunctionOnlyFile(tab.content)) {
      setRunWarning('This file only defines function(s); nothing to run.')
      return
    }

    // Auto-save first
    if (tab.filePath) {
      const result = await window.matslop.saveFile(tab.filePath, tab.content)
      if (result.success) {
        dispatch({ type: 'UPDATE_SAVED_CONTENT', payload: { tabId: tab.id, savedContent: tab.content } })
      }
      // Re-apply breakpoints after save
      try {
        await window.matslop.debugReapplyBreakpointsForFile(tab.filePath)
      } catch { /* ignore — breakpoints are best-effort */ }
    } else {
      // Untitled buffer — write to a temp file and run from there.
      try {
        const home = await window.matslop.getHomeDir()
        const tmpName = `matslop_run_${tab.id.replace(/[^a-zA-Z0-9]/g, '_')}.m`
        const tmpPath = `${home}/${tmpName}`
        const saveResult = await window.matslop.saveFile(tmpPath, tab.content)
        if (!saveResult.success) return
        const { command: tmpCmd } = buildRunScriptCommand(tmpPath, home)
        window.matslop.octaveExecute(tmpCmd).then((r) => {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: tab.filename, output: r.output, error: r.error },
          }))
          window.dispatchEvent(new CustomEvent('matslop:runCapture'))
          // Clean up temp file after execution
          window.matslop.fsDelete(tmpPath).catch(() => {})
        }).catch(() => {})
      } catch {
        // Fall back to Save As
        const result = await window.matslop.saveFileAs(tab.content, tab.filename)
        if (!result) return
        dispatch({ type: 'RENAME_TAB', payload: { tabId: tab.id, filename: result.filename, filePath: result.filePath } })
        dispatch({ type: 'UPDATE_SAVED_CONTENT', payload: { tabId: tab.id, savedContent: tab.content } })
        const lastSep2 = Math.max(result.filePath.lastIndexOf('/'), result.filePath.lastIndexOf('\\'))
        const dirPath2 = result.filePath.substring(0, lastSep2)
        const { command: saCmd } = buildRunScriptCommand(result.filePath, dirPath2)
        window.matslop.octaveExecute(saCmd).then((r) => {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: result.filename, output: r.output, error: r.error },
          }))
          window.dispatchEvent(new CustomEvent('matslop:runCapture'))
        }).catch(() => {})
      }
      return
    }

    const lastSep = Math.max(tab.filePath.lastIndexOf('/'), tab.filePath.lastIndexOf('\\'))
    const dirPath = tab.filePath.substring(0, lastSep)
    const { command } = buildRunScriptCommand(tab.filePath, dirPath)
    window.matslop.octaveExecute(command).then((result) => {
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display: tab.filename, output: result.output, error: result.error },
      }))
      window.dispatchEvent(new CustomEvent('matslop:runCapture'))
    }).catch(() => {})
  }, [getActiveTab, saveFile, dispatch])

  /**
   * Get the section around the current cursor. Returns null when there is
   * no active tab / editor / cursor position, or when the section body is empty.
   */
  const getSectionAtCursor = useCallback((): {
    tab: EditorTab
    cursorLine: number
    code: string
  } | null => {
    const tab = getActiveTab()
    if (!tab) return null
    const editor = getEditorInstance()
    if (!editor) return null
    const pos = editor.getPosition()
    if (!pos) return null
    const range = findSectionRange(tab.content, pos.lineNumber)
    if (!range.code.trim()) return null
    return { tab, cursorLine: pos.lineNumber, code: range.code }
  }, [getActiveTab, getEditorInstance])

  /**
   * Run the code section at the cursor position.
   */
  const runSection = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSectionRef.current?.(section.code)
  }, [getSectionAtCursor])

  /**
   * Run the section at the cursor and advance the cursor to the next section.
   */
  const runAndAdvance = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSectionRef.current?.(section.code)
    const editor = getEditorInstance()
    if (!editor) return
    const advanceLine = findNextSectionAdvanceLine(section.tab.content, section.cursorLine)
    if (advanceLine != null) {
      editor.setPosition({ lineNumber: advanceLine, column: 1 })
      try {
        editor.revealLineInCenterIfOutsideViewport(advanceLine)
      } catch {
        /* monaco tearing down — ignore */
      }
      editor.focus()
    }
  }, [getSectionAtCursor, getEditorInstance])

  /**
   * Stop execution.
   */
  const stop = useCallback(() => {
    onStopRef.current?.()
  }, [])

  return {
    run,
    stop,
    runSection,
    runAndAdvance,
    runWarning,
    clearRunWarning,
  }
}
