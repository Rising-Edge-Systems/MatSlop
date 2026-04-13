import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import TabbedEditor from '../editor/TabbedEditor'
import EditorToolbar from '../editor/EditorToolbar'
import { useAppContext } from '../AppContext'
import type { DebugAction } from '../editor/debugCommands'
import {
  createTab,
  createEmptyLiveScript,
  findSectionRange,
  findNextSectionAdvanceLine,
  type EditorTab,
} from '../editor/editorTypes'
import { isFunctionOnlyFile, buildRunScriptCommand } from '../editor/functionFileDetection'
import { publishHtml } from '../editor/publishHtml'
import {
  tabsToSession,
  sessionToTabs,
  type CursorSnapshot,
} from '../editor/sessionState'
import type { OctaveEngineStatus } from '../App'
import { shortcutManager, SHORTCUT_DEFINITIONS, type ShortcutAction } from '../shortcuts/shortcutManager'
import { applyShortcutOverrides, parseStoredOverrides } from '../shortcuts/customShortcuts'

interface PanelVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
  commandHistory: boolean
}

interface MenuAction {
  action: string
  id: number
}

interface EditorPanelProps {
  panelVisibility: PanelVisibility
  onTogglePanel: (panel: keyof PanelVisibility) => void
  openFilePath?: string | null
  /** US-032: when opening via Find-in-Files, reveal/position at this line. */
  openFileLine?: number | null
  onFileOpened?: () => void
  onCursorPositionChange?: (line: number, column: number) => void
  onErrorCountChange?: (count: number) => void
  engineStatus: OctaveEngineStatus
  onRun?: (filePath: string, dirPath: string) => void
  onStop?: () => void
  onPauseForDebug?: () => void
  onRunSection?: (code: string) => void
  menuAction?: MenuAction | null
  onMenuActionConsumed?: () => void
  editorTheme?: string
  editorSettings?: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
  /** US-016: location Octave is currently paused at, null when not debugging. */
  pausedLocation?: { file: string; line: number } | null
  /**
   * US-023 (edit-and-continue, best effort): fired whenever a file is saved
   * while the debugger is paused so the parent can trigger breakpoint
   * re-application and surface a warning banner. Receives the saved file's
   * absolute path (or null if the save was to an unsaved/untitled tab).
   */
  onFileSavedWhilePaused?: (filePath: string | null) => void
  onDebugAction?: (action: DebugAction) => void
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
  openFilePath: openFilePathProp,
  openFileLine: openFileLineProp,
  onFileOpened: onFileOpenedProp,
  onCursorPositionChange,
  onErrorCountChange,
  engineStatus,
  onRun: onRunProp,
  onStop,
  onPauseForDebug,
  onRunSection: onRunSectionProp,
  menuAction: menuActionProp,
  onMenuActionConsumed: onMenuActionConsumedProp,
  editorTheme: editorThemeProp,
  editorSettings: editorSettingsProp,
  pausedLocation: pausedLocationProp,
  onFileSavedWhilePaused,
  onDebugAction,
}: EditorPanelProps): React.JSX.Element {
  // US-L02: Read file-open requests from AppContext to bypass rc-dock stale props
  const appCtx = useAppContext()
  const openFilePath = appCtx.pendingOpenPath ?? openFilePathProp
  const openFileLine = appCtx.pendingOpenLine ?? openFileLineProp
  const onFileOpened = appCtx.pendingOpenPath !== null ? appCtx.onFileOpened : onFileOpenedProp
  // US-SC04: Read additional dynamic state from AppContext
  const pausedLocation = appCtx.pausedLocation ?? pausedLocationProp
  const editorTheme = appCtx.editorTheme ?? editorThemeProp
  const editorSettings = appCtx.editorSettings ?? editorSettingsProp
  const menuAction = appCtx.menuAction ?? menuActionProp
  const onMenuActionConsumed = appCtx._provided ? appCtx.onMenuActionConsumed : onMenuActionConsumedProp
  const onRun = appCtx._provided ? appCtx.onRunScript : onRunProp
  const onRunSection = appCtx._provided ? appCtx.onRunSection : onRunSectionProp
  // Refs for callbacks used inside stable useCallback closures
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  // DEV: expose for debugging
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__matslopOnRunInfo = {
      provided: appCtx._provided,
      onRunIsNoop: onRun === undefined || onRun === null,
      onRunType: typeof onRun,
      onRunRefType: typeof onRunRef.current,
    }
  }
  const onRunSectionRef = useRef(onRunSection)
  onRunSectionRef.current = onRunSection
  // Start with an empty tab list. The session-restore / welcome-tab
  // useEffect below populates it after mount. Creating an untitled.m
  // dummy here caused the Run button to operate on the wrong tab when
  // the Welcome tab was also present (the Welcome tab became active but
  // the dummy tab lingered behind it with stale content).
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [welcomeTabId, setWelcomeTabId] = useState<string | null>(null)
  const welcomeTabIdRef = useRef<string | null>(null)
  const welcomeInitRef = useRef(false)
  // US-S05: banner text shown above the editor when a Run action is
  // blocked because the active buffer only defines function(s) and has
  // no top-level code to execute. Cleared automatically the next time
  // the user types in the editor, switches tabs, or clicks Run again.
  const [runWarning, setRunWarning] = useState<string | null>(null)
  // Stable refs for tabs/activeTabId so flush-on-unmount closures see the
  // latest values without re-binding listeners on every edit.
  const tabsRef = useRef<EditorTab[]>(tabs)
  const activeTabIdRef = useRef<string | null>(activeTabId)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])
  useEffect(() => {
    welcomeTabIdRef.current = welcomeTabId
  }, [welcomeTabId])
  // US-034: per-tab cursor snapshots (line/column), mirrored into session.json
  const tabCursorsRef = useRef<Record<string, CursorSnapshot>>({})
  // Guard so session persistence effect doesn't fire with uninitialized state
  // during the initial welcome/session restore.
  const sessionReadyRef = useRef(false)
  // Snapshot of whether session restore preference is on — checked once at
  // mount. Falsy means we skip restore on this launch but still save state so
  // toggling the pref on later recovers the subsequent session.
  const sessionRestoreEnabledRef = useRef(true)

  // US-034: On first mount, try to restore the last session. Falls back to
  // showing the welcome tab (legacy behavior) when there's no saved session
  // or the restore pref is disabled.
  useEffect(() => {
    if (welcomeInitRef.current) return
    welcomeInitRef.current = true
    ;(async () => {
      let restored = false
      try {
        const enabled = await window.matslop.sessionGetRestoreEnabled()
        sessionRestoreEnabledRef.current = enabled
        if (enabled) {
          const session = await window.matslop.sessionGet()
          const loaded = sessionToTabs(session)
          if (loaded) {
            setTabs(loaded.tabs)
            setActiveTabId(loaded.activeTabId)
            tabCursorsRef.current = { ...loaded.cursors }
            restored = true
          }
        }
      } catch {
        // ignore — fall through to welcome path
      }
      if (restored) {
        // After React commits the restored tabs, move the Monaco cursor
        // to the saved line/col of the active tab (if any). Schedule a
        // couple of retries because TabbedEditor mounts lazily.
        const tryRestoreCursor = (attempt: number): void => {
          const ed = editorInstanceRef.current
          const activeId = activeTabIdRef.current
          const pos = activeId ? tabCursorsRef.current[activeId] : null
          if (ed && pos) {
            try {
              ed.setPosition({ lineNumber: pos.line, column: pos.column })
              ed.revealLineInCenter(pos.line)
            } catch {
              // ignore
            }
            return
          }
          if (attempt < 10) setTimeout(() => tryRestoreCursor(attempt + 1), 50)
        }
        setTimeout(() => tryRestoreCursor(0), 50)
      }
      if (!restored) {
        // Create a runnable demo script so the Run button works on first
        // launch. Also show the Welcome tab if configured.
        const demoTab = createTab(
          'untitled.m',
          '% Welcome to MatSlop\n% Start writing MATLAB/Octave code here\n\nx = 1:10;\ny = x .^ 2;\ndisp("Hello from MatSlop!");\nfprintf("Sum of first 10 squares: %d\\n", sum(y));\n'
        )
        const show = await window.matslop.configGetShowWelcome()
        if (show) {
          const welcomeTab = createTab('Welcome', '', null, 'welcome')
          setTabs([welcomeTab, demoTab])
          setActiveTabId(demoTab.id)
          setWelcomeTabId(welcomeTab.id)
        } else {
          setTabs([demoTab])
          setActiveTabId(demoTab.id)
        }
      }
      sessionReadyRef.current = true
    })()
  }, [])

  // US-034: Persist the session (tabs + active tab + cursor) on every change
  // to any of those. Debounced via a simple setTimeout + ref so rapid typing
  // doesn't hammer the IPC channel.
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  // US-034: Also flush session immediately on unmount (covers reload /
  // close-without-typing-again cases).
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
    // NOTE: mount-only effect; flush reads latest refs so no deps needed.
  }, [])

  // Test hook so e2e specs can flush the in-memory session snapshot to
  // disk without needing to navigate/quit the window.
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
  const editorInstanceRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleEditorRef = useCallback((editor: monacoEditor.IStandaloneCodeEditor | null) => {
    editorInstanceRef.current = editor
  }, [])

  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const getActiveTab = useCallback((): EditorTab | null => {
    return tabsRef.current.find((t) => t.id === activeTabIdRef.current) ?? null
  }, [])

  const handleCloseWelcome = useCallback(() => {
    const wId = welcomeTabIdRef.current
    if (!wId) return
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== wId)
      if (wId === activeTabIdRef.current && next.length > 0) {
        setActiveTabId(next[0].id)
      } else if (next.length === 0) {
        setActiveTabId(null)
      }
      return next
    })
    setWelcomeTabId(null)
  }, [])

  const handleNewFile = useCallback(() => {
    const tab = createTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleNewLiveScript = useCallback(() => {
    const content = createEmptyLiveScript()
    const tab = createTab('untitled.mls', content, null, 'livescript')
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleOpenFile = useCallback(async () => {
    const result = await window.matslop.openFile()
    if (!result) return
    // Check if the file is already open
    const existing = tabsRef.current.find((t) => t.filePath === result.filePath)
    if (existing) {
      setActiveTabId(existing.id)
      window.matslop.recentFilesAdd(result.filePath)
      return
    }
    const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
    const tab = createTab(result.filename, result.content, result.filePath, mode)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    window.matslop.recentFilesAdd(result.filePath)
  }, [])

  // US-023: keep the latest paused-location / callback in refs so the
  // handleSave closure doesn't need to be re-created whenever debugger
  // state changes (which would invalidate menu/shortcut bindings below).
  const pausedLocationRef = useRef<{ file: string; line: number } | null>(null)
  const onFileSavedWhilePausedRef = useRef<
    ((filePath: string | null) => void) | undefined
  >(undefined)
  useEffect(() => {
    pausedLocationRef.current = pausedLocation ?? null
  }, [pausedLocation])
  useEffect(() => {
    onFileSavedWhilePausedRef.current = onFileSavedWhilePaused
  }, [onFileSavedWhilePaused])

  const handleSave = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab) return
    if (tab.filePath) {
      const result = await window.matslop.saveFile(tab.filePath, tab.content)
      if (result.success) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, savedContent: t.content } : t
          )
        )
        // US-023 (edit-and-continue, best effort): if Octave is currently
        // paused when the user saves, notify the parent so it can re-apply
        // breakpoints and show the "changes will take effect on re-entry"
        // banner. Only .m files are meaningful here — .mls live scripts are
        // not function bodies Octave can re-enter mid-pause.
        if (pausedLocationRef.current && tab.filePath.endsWith('.m')) {
          onFileSavedWhilePausedRef.current?.(tab.filePath)
        }
      }
    } else {
      // Untitled file — use Save As
      await handleSaveAs()
    }
  }, [getActiveTab])

  /**
   * US-030: Publish the active tab as a self-contained HTML document.
   * Live scripts preserve cell layout + outputs + embedded figures; .m
   * scripts emit a highlighted code listing. Delegates document assembly
   * to the pure `publishHtml()` helper so all the string work is
   * unit-testable.
   */
  const handlePublishHtml = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab || tab.mode === 'welcome') return

    // US-T04: For saved .m scripts, capture disp/fprintf output by sourcing
    // the file inside `evalc(...)` so the published HTML carries real
    // runtime output, not just a code listing. Live scripts already embed
    // per-cell output in their JSON so no capture is needed.
    let scriptOutput: string | undefined
    if (tab.mode !== 'livescript' && tab.filePath) {
      try {
        const escapedPath = tab.filePath.replace(/'/g, "''")
        const res = await window.matslop.octaveExecute(
          `disp(evalc("source('${escapedPath}')"))`,
        )
        const combined = (res?.output ?? '') + (res?.error ?? '')
        if (combined.trim().length > 0) scriptOutput = combined.replace(/\n+$/, '')
      } catch {
        /* swallow — publish without output */
      }
    }

    const html = publishHtml({
      filename: tab.filename,
      mode: tab.mode === 'livescript' ? 'livescript' : 'script',
      content: tab.content,
      scriptOutput,
      timestamp: new Date().toISOString(),
    })
    const defaultName = tab.filename.replace(/\.(m|mls)$/i, '') + '.html'
    const result = await window.matslop.publishSaveDialog(defaultName)
    if (!result) return
    await window.matslop.publishWriteFile(result.filePath, html)
  }, [getActiveTab])

  const handleSaveAs = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab) return
    const result = await window.matslop.saveFileAs(tab.content, tab.filename)
    if (result) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                filePath: result.filePath,
                filename: result.filename,
                savedContent: t.content,
              }
            : t
        )
      )
    }
  }, [getActiveTab])

  // Ref for pausedLocation — used by handleRun to check debug state at call time.
  // The actual useRef is declared later (line ~372) for the breakpoint decoration
  // effect, but we need it earlier. So we create a dedicated one here.
  const isPausedRef = useRef(false)
  isPausedRef.current = pausedLocation !== null

  const handleRun = useCallback(async () => {
    // If paused at a breakpoint, continue instead of re-running.
    // Uses sendRaw which bypasses the command queue and writes directly
    // to Octave's stdin.
    if (isPausedRef.current) {
      window.dispatchEvent(new CustomEvent('matslop:debugContinued'))
      // sendRaw returns the output produced after dbcont (e.g. disp() output)
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

    // US-S05: A file whose first top-level statement is `function` is a
    // function file — sourcing it executes no top-level code, so the
    // user would see no output and think Run was broken. Short-circuit
    // with a visible banner instead. Detect against the *current* buffer
    // content (not the saved-on-disk version), so editing in an unsaved
    // tab is reflected immediately. Clear any stale banner as soon as a
    // fresh Run attempt begins.
    setRunWarning(null)
    if (isFunctionOnlyFile(tab.content)) {
      setRunWarning('This file only defines function(s); nothing to run.')
      return
    }

    // Auto-save first
    if (tab.filePath) {
      const result = await window.matslop.saveFile(tab.filePath, tab.content)
      if (result.success) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, savedContent: t.content } : t
          )
        )
      }
      // Re-apply breakpoints after save — Octave drops them when the file
      // timestamp changes (it re-caches the source on next source() call).
      try {
        await window.matslop.debugReapplyBreakpointsForFile(tab.filePath)
      } catch { /* ignore — breakpoints are best-effort */ }
    } else {
      // Untitled buffer — write to a temp file and run from there.
      // Previously prompted Save As which blocked the UI; now the user
      // can iterate quickly without saving first.
      try {
        const home = await window.matslop.getHomeDir()
        const tmpName = `matslop_run_${tab.id.replace(/[^a-zA-Z0-9]/g, '_')}.m`
        const tmpPath = `${home}/${tmpName}`
        const saveResult = await window.matslop.saveFile(tmpPath, tab.content)
        if (!saveResult.success) return
        const { command: tmpCmd } = buildRunScriptCommand(tmpPath, home)
        window.matslop.octaveExecute(tmpCmd).then((r) => {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: `source('${tmpName}')`, output: r.output, error: r.error },
          }))
          window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
        }).catch(() => {})
      } catch {
        // Fall back to Save As
        const result = await window.matslop.saveFileAs(tab.content, tab.filename)
        if (!result) return
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? { ...t, filePath: result.filePath, filename: result.filename, savedContent: t.content }
              : t
          )
        )
        const lastSep2 = Math.max(result.filePath.lastIndexOf('/'), result.filePath.lastIndexOf('\\'))
        const dirPath2 = result.filePath.substring(0, lastSep2)
        const { command: saCmd } = buildRunScriptCommand(result.filePath, dirPath2)
        window.matslop.octaveExecute(saCmd).then((r) => {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: `source('${result.filename}')`, output: r.output, error: r.error },
          }))
          window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
        }).catch(() => {})
      }
      return
    }

    const lastSep = Math.max(tab.filePath.lastIndexOf('/'), tab.filePath.lastIndexOf('\\'))
    const dirPath = tab.filePath.substring(0, lastSep)
    // Run directly via IPC — bypasses the onRun callback chain which
    // suffers from rc-dock stale closure issues with the AppContext.
    const { command } = buildRunScriptCommand(tab.filePath, dirPath)
    window.matslop.octaveExecute(command).then((result) => {
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display: `source('${tab.filename}')`, output: result.output, error: result.error },
      }))
      window.dispatchEvent(new CustomEvent('matslop:commandExecuted'))
    }).catch(() => {})
  }, [getActiveTab]) // reads onRunRef.current at call time

  /**
   * Get the section around the current cursor as a pure computation over
   * the tab content. Returns null when there is no active tab / editor /
   * cursor position, or when the section body is empty.
   */
  const getSectionAtCursor = useCallback((): {
    tab: EditorTab
    cursorLine: number
    code: string
  } | null => {
    const tab = getActiveTab()
    if (!tab) return null
    const editor = editorInstanceRef.current
    if (!editor) return null
    const pos = editor.getPosition()
    if (!pos) return null
    const range = findSectionRange(tab.content, pos.lineNumber)
    if (!range.code.trim()) return null
    return { tab, cursorLine: pos.lineNumber, code: range.code }
  }, [getActiveTab])

  const handleRunSection = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSection?.(section.code)
  }, [getSectionAtCursor, onRunSection])

  /**
   * US-029: Run the section at the cursor and advance the cursor to the
   * first content line of the next section (if there is one). Reuses the
   * same command-execution path as handleRunSection.
   */
  const handleRunAndAdvance = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSection?.(section.code)
    const editor = editorInstanceRef.current
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
  }, [getSectionAtCursor, onRunSection])

  const handleStop = useCallback(() => {
    onStop?.()
  }, [onStop])

  const handleTabClose = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (!tab) return

      // Check for unsaved changes
      if (tab.content !== tab.savedContent) {
        const response = await window.matslop.confirmClose(tab.filename)
        if (response === 2) return // Cancel
        if (response === 0) {
          // Save
          if (tab.filePath) {
            const saveResult = await window.matslop.saveFile(
              tab.filePath,
              tab.content
            )
            if (!saveResult.success) return
          } else {
            const saveResult = await window.matslop.saveFileAs(
              tab.content,
              tab.filename
            )
            if (!saveResult) return // User cancelled save dialog
          }
        }
        // response === 1 means Discard — fall through to close
      }

      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        const next = prev.filter((t) => t.id !== tabId)
        const currentActive = activeTabIdRef.current
        if (tabId === currentActive && next.length > 0) {
          const newIdx = Math.min(idx, next.length - 1)
          setActiveTabId(next[newIdx].id)
        } else if (next.length === 0) {
          setActiveTabId(null)
        }
        return next
      })
    },
    [] // stable — uses refs for tabs and activeTabId
  )

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, content } : t))
    )
  }, [])

  // Centralized keyboard shortcut handler
  const handleShortcut = useCallback((action: ShortcutAction) => {
    switch (action) {
      case 'run':
        handleRun()
        break
      case 'runSection':
        handleRunSection()
        break
      case 'runAndAdvance':
        handleRunAndAdvance()
        break
      case 'save':
        handleSave()
        break
      case 'saveAs':
        handleSaveAs()
        break
      case 'newFile':
        handleNewFile()
        break
      case 'openFile':
        handleOpenFile()
        break
      case 'closeTab':
        if (activeTabIdRef.current) handleTabClose(activeTabIdRef.current)
        break
      case 'stop':
        handleStop()
        break
      case 'find': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('actions.find')?.run()
        }
        break
      }
      case 'findReplace': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.startFindReplaceAction')?.run()
        }
        break
      }
      case 'goToLine': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.gotoLine')?.run()
        }
        break
      }
      case 'toggleComment': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.commentLine')?.run()
        }
        break
      }
    }
  }, [handleRun, handleRunSection, handleRunAndAdvance, handleSave, handleSaveAs, handleNewFile, handleOpenFile, handleTabClose, handleStop])

  useEffect(() => {
    shortcutManager.start(handleShortcut)
    return () => shortcutManager.stop()
  }, [handleShortcut])

  // US-035: load persisted shortcut overrides and push the merged list
  // into shortcutManager on startup.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = await window.matslop.configGetShortcuts()
        if (cancelled) return
        const overrides = parseStoredOverrides(raw)
        shortcutManager.setActiveDefinitions(
          applyShortcutOverrides(SHORTCUT_DEFINITIONS, overrides),
        )
      } catch {
        // Fall back to defaults
        shortcutManager.setActiveDefinitions([...SHORTCUT_DEFINITIONS])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Handle menu actions from main process
  const lastMenuActionIdRef = useRef(0)
  useEffect(() => {
    if (!menuAction || menuAction.id <= lastMenuActionIdRef.current) return
    lastMenuActionIdRef.current = menuAction.id

    switch (menuAction.action) {
      case 'newFile':
        handleNewFile()
        onMenuActionConsumed?.()
        break
      case 'newLiveScript':
        handleNewLiveScript()
        onMenuActionConsumed?.()
        break
      case 'openFile':
        handleOpenFile().then(() => onMenuActionConsumed?.())
        break
      case 'save':
        handleSave().then(() => onMenuActionConsumed?.())
        break
      case 'saveAs':
        handleSaveAs().then(() => onMenuActionConsumed?.())
        break
      case 'publishHtml':
        handlePublishHtml().then(() => onMenuActionConsumed?.())
        break
      case 'closeTab':
        if (activeTabId) {
          handleTabClose(activeTabId).then(() => onMenuActionConsumed?.())
        } else {
          onMenuActionConsumed?.()
        }
        break
      case 'runScript':
        handleRun().then(() => onMenuActionConsumed?.())
        break
      case 'runSection':
        handleRunSection()
        onMenuActionConsumed?.()
        break
      case 'runAndAdvance':
        handleRunAndAdvance()
        onMenuActionConsumed?.()
        break
      case 'find': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('actions.find')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'findReplace': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.startFindReplaceAction')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'goToLine': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.gotoLine')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'toggleComment': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.commentLine')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      default:
        // Not handled by EditorPanel — leave for other consumers
        break
    }
  }, [menuAction, activeTabId, handleNewFile, handleNewLiveScript, handleOpenFile, handleSave, handleSaveAs, handlePublishHtml, handleTabClose, handleRun, handleRunSection, handleRunAndAdvance, onMenuActionConsumed])

  // US-032: Reveal/position at a target line when navigating in from a
  // Find-in-Files result. Runs after the open-file effect below has
  // mounted the editor for the target tab. A small timeout gives Monaco
  // a chance to finish initial layout/measure before we call revealLine.
  useEffect(() => {
    if (openFileLine == null) return
    const id = window.setTimeout(() => {
      const editor = editorInstanceRef.current
      if (!editor) return
      try {
        editor.revealLineInCenterIfOutsideViewport(openFileLine)
        editor.setPosition({ lineNumber: openFileLine, column: 1 })
        editor.focus()
      } catch {
        /* editor tearing down — ignore */
      }
    }, 150)
    return () => window.clearTimeout(id)
  }, [openFileLine, activeTabId])

  // Open file from File Browser
  useEffect(() => {
    if (!openFilePath) return
    // Check if already open
    const existing = tabs.find((t) => t.filePath === openFilePath)
    if (existing) {
      setActiveTabId(existing.id)
      onFileOpened?.()
      return
    }
    window.matslop.readFile(openFilePath).then((result) => {
      if (result) {
        const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
        const tab = createTab(result.filename, result.content, result.filePath, mode)
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
        window.matslop.recentFilesAdd(result.filePath)
      }
      onFileOpened?.()
    })
  }, [openFilePath, onFileOpened, tabs])

  // US-016: when Octave reports a paused location, activate a tab whose
  // filename matches the paused file (by basename). If no tab matches, we
  // leave the active tab alone — the status bar still surfaces debug state.
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
    if (match && match.id !== activeTabId) {
      setActiveTabId(match.id)
    }
  }, [pausedLocation, tabs, activeTabId])

  // Drag-and-drop file opening
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0

    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      const filePath = (file as File & { path: string }).path
      if (!filePath) continue
      if (!filePath.endsWith('.m') && !filePath.endsWith('.mls')) continue

      // Check if already open
      const existing = tabs.find((t) => t.filePath === filePath)
      if (existing) {
        setActiveTabId(existing.id)
        continue
      }

      window.matslop.readFile(filePath).then((result) => {
        if (result) {
          const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
          const tab = createTab(result.filename, result.content, result.filePath, mode)
          setTabs((prev) => [...prev, tab])
          setActiveTabId(tab.id)
          window.matslop.recentFilesAdd(result.filePath)
        }
      })
    }
  }, [tabs])

  // Expose the active tab content so App.tsx's global Run handler can
  // access it from outside rc-dock's stale-closure boundary.
  useEffect(() => {
    const w = window as unknown as {
      __matslopGetActiveTabForRun?: () => { content: string; filePath: string | null; id: string } | null
    }
    w.__matslopGetActiveTabForRun = () => {
      const tab = getActiveTab()
      return tab ? { content: tab.content, filePath: tab.filePath, id: tab.id } : null
    }
    return () => {
      (window as unknown as { __matslopGetActiveTabForRun?: unknown }).__matslopGetActiveTabForRun = undefined
    }
  }, [getActiveTab])

  // Listen for the global Run event dispatched by EditorToolbar's Run button.
  // This is a workaround for rc-dock's stale-closure issue: the toolbar's
  // onClick prop may reference a stale handleRun, but this listener always
  // has the latest state because useEffect deps include handleRun.
  useEffect(() => {
    const handler = (): void => { handleRun() }
    window.addEventListener('matslop:runActiveScript', handler)
    return () => window.removeEventListener('matslop:runActiveScript', handler)
  }, [handleRun])

  const allPanels: { key: keyof PanelVisibility; label: string }[] = [
    { key: 'fileBrowser', label: 'File Browser' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'commandWindow', label: 'Command Window' },
    { key: 'commandHistory', label: 'Command History' },
  ]
  const hiddenPanels = allPanels.filter((p) => !panelVisibility[p.key])

  return (
    <div
      className="panel editor-panel"
      data-testid="editor-panel"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <EditorToolbar
        hasActiveFile={activeTabId !== null}
        isLiveScript={getActiveTab()?.mode === 'livescript'}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onSave={handleSave}
        onRun={handleRun}
        onStop={handleStop}
        onPauseForDebug={onPauseForDebug}
        onRunSection={handleRunSection}
        onRunAndAdvance={handleRunAndAdvance}
        debugPaused={pausedLocation !== null}
        onDebugAction={onDebugAction}
      />
      <div className="panel-content editor-panel-content">
        {runWarning !== null && (
          <div
            className="editor-run-warning"
            role="status"
            data-testid="editor-run-warning"
          >
            <span>{runWarning}</span>
            <button
              type="button"
              className="editor-run-warning-dismiss"
              onClick={() => setRunWarning(null)}
              aria-label="Dismiss warning"
            >
              ×
            </button>
          </div>
        )}
        {isDragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay-content">
              Drop .m or .mls files to open
            </div>
          </div>
        )}
        <TabbedEditor
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          onCursorPositionChange={(line, column) => {
            // Mirror cursor into per-tab snapshot for US-034 session save.
            const activeId = activeTabIdRef.current
            if (activeId) {
              tabCursorsRef.current = {
                ...tabCursorsRef.current,
                [activeId]: { line, column },
              }
            }
            onCursorPositionChange?.(line, column)
          }}
          onEditorRef={handleEditorRef}
          onErrorCountChange={onErrorCountChange}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onCloseWelcome={handleCloseWelcome}
          editorTheme={editorTheme}
          engineStatus={engineStatus}
          editorSettings={editorSettings}
          pausedLocation={pausedLocation ?? null}
        />
      </div>
      {hiddenPanels.length > 0 && (
        <div className="collapsed-panels-bar">
          {hiddenPanels.map((p) => (
            <button
              key={p.key}
              className="restore-panel-btn"
              onClick={() => onTogglePanel(p.key)}
              title={`Show ${p.label}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default EditorPanel
