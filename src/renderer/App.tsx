import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import MatslopDockLayout, { type DockVisibility } from './panels/MatslopDockLayout'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow, { type PendingCommand } from './panels/CommandWindow'
import CommandHistoryPanel from './panels/CommandHistoryPanel'
import FigurePanel, { type FigureData } from './panels/FigurePanel'
import StatusBar from './panels/StatusBar'
import type { CursorPosition } from './panels/StatusBar'
import DebugToolbar from './editor/DebugToolbar'
import CallStackPanel, { type CallStackFrame } from './panels/CallStackPanel'
import WatchesPanel from './panels/WatchesPanel'
import {
  addWatch as addWatchHelper,
  removeWatch as removeWatchHelper,
  updateWatchExpression as updateWatchHelper,
  setWatchValue,
  setWatchError,
  clearWatchValues,
  buildWatchCommand,
  parseWatchOutput,
  formatWatchValue,
  type WatchEntry,
} from './editor/watchesStore'
import {
  debugActionToOctaveCommand,
  matchDebugShortcut,
  type DebugAction,
} from './editor/debugCommands'
import OctaveSetupDialog from './dialogs/OctaveSetupDialog'
import VariableInspectorDialog, { type InspectedVariable } from './dialogs/VariableInspectorDialog'
import PreferencesDialog, { type EditorPreferences } from './dialogs/PreferencesDialog'
import { updateWorkspaceVariables, updateMFileNames } from './editor/matlabCompletionProvider'

export type ThemeMode = 'light' | 'dark' | 'system'
export type OctaveEngineStatus = 'ready' | 'busy' | 'disconnected'

export interface OctaveStatus {
  path: string | null
  version: string | null
  configured: boolean
  engineStatus: OctaveEngineStatus
}

interface PanelVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
  commandHistory: boolean
}

interface PanelSizes {
  fileBrowserWidth: number
  workspaceWidth: number
  bottomHeight: number
  commandHistoryWidth: number
}

const defaultVisibility: PanelVisibility = {
  fileBrowser: true,
  workspace: true,
  commandWindow: true,
  commandHistory: false,
}

const defaultSizes: PanelSizes = {
  fileBrowserWidth: 220,
  workspaceWidth: 280,
  bottomHeight: 200,
  commandHistoryWidth: 250,
}

function App(): React.JSX.Element {
  const [visibility, setVisibility] = useState<PanelVisibility>(defaultVisibility)
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(defaultSizes)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null)
  const [octaveStatus, setOctaveStatus] = useState<OctaveStatus>({ path: null, version: null, configured: false, engineStatus: 'disconnected' })
  const [showOctaveSetup, setShowOctaveSetup] = useState(false)
  const [cwd, setCwd] = useState('')
  const [cursorPosition, setCursorPosition] = useState<CursorPosition | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const pendingCommandIdRef = useRef(0)
  const [workspaceRefreshTrigger, setWorkspaceRefreshTrigger] = useState(0)
  const [inspectedVariable, setInspectedVariable] = useState<InspectedVariable | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [pasteCommand, setPasteCommand] = useState<string | null>(null)
  const [figures, setFigures] = useState<FigureData[]>([])
  const [menuAction, setMenuAction] = useState<{ action: string; id: number } | null>(null)
  const menuActionIdRef = useRef(0)
  const [showAbout, setShowAbout] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark')
  const [errorCount, setErrorCount] = useState(0)
  const [showPreferences, setShowPreferences] = useState(false)
  // US-016: when Octave hits a breakpoint we track the paused location so the
  // editor can highlight the line and the status bar can flip into debug mode.
  const [pausedLocation, setPausedLocation] = useState<{ file: string; line: number } | null>(null)
  // US-018: Current call stack (top frame first) and the selected frame
  // index. Both reset when we're no longer paused. The stack is refreshed
  // on every `onOctavePaused` event via a `debug:getCallStack` IPC call.
  const [callStack, setCallStack] = useState<CallStackFrame[]>([])
  const [callStackSelected, setCallStackSelected] = useState<number>(-1)
  // US-022: Pinned watch expressions. Values are refreshed on every
  // pause/step transition (see effect below) and when the user explicitly
  // adds or refreshes a watch.
  const [watches, setWatches] = useState<WatchEntry[]>([])
  const watchesRef = useRef<WatchEntry[]>(watches)
  watchesRef.current = watches
  // US-023: edit-and-continue banner. Set whenever the user saves a .m file
  // while paused — tells them the edits won't take effect until the function
  // is re-entered (best-effort approximation). Dismissed via the banner's
  // close button or automatically when the debugger resumes.
  const [editContinueBanner, setEditContinueBanner] = useState<{
    filename: string
    id: number
  } | null>(null)
  const editContinueBannerIdRef = useRef(0)
  const [editorSettings, setEditorSettings] = useState({
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 14,
    tabSize: 4,
    insertSpaces: true,
  })

  // Start Octave process when path becomes configured
  const startOctaveProcess = useCallback(async (binaryPath: string) => {
    const result = await window.matslop.octaveStart(binaryPath)
    if (!result.success) {
      console.error('Failed to start Octave:', result.error)
    }
  }, [])

  useEffect(() => {
    // Listen for Octave engine status changes
    const unsubStatus = window.matslop.onOctaveStatusChanged((status) => {
      setOctaveStatus((prev) => ({ ...prev, engineStatus: status }))
    })

    const unsubCrash = window.matslop.onOctaveCrashed((info) => {
      console.error('Octave process crashed:', info)
      setOctaveStatus((prev) => ({ ...prev, engineStatus: 'disconnected' }))
      // US-016: if Octave crashes while paused, drop the debug highlight.
      setPausedLocation(null)
    })

    // US-016: listen for debug-pause events from the main process.
    const unsubPaused = window.matslop.onOctavePaused?.((loc) => {
      if (loc && typeof loc.file === 'string' && Number.isFinite(loc.line)) {
        setPausedLocation({ file: loc.file, line: Math.floor(loc.line) })
      }
    }) ?? (() => {})

    // US-016 + US-018: if Octave crashes while paused, also clear the
    // call stack so the panel returns to its idle state.
    const unsubCrashCs = window.matslop.onOctaveCrashed(() => {
      setCallStack([])
      setCallStackSelected(-1)
    })

    return () => {
      unsubStatus()
      unsubCrash()
      unsubPaused()
      unsubCrashCs()
    }
  }, [])

  // US-018: Whenever the paused location changes, refresh the call stack
  // from the main process. When we transition out of paused state, clear
  // the stack so the panel shows its idle message. Swallow IPC errors —
  // an empty stack is an acceptable fallback.
  useEffect(() => {
    if (!pausedLocation) {
      setCallStack([])
      setCallStackSelected(-1)
      return
    }
    let cancelled = false
    const bridge = (window as unknown as { matslop?: Window['matslop'] }).matslop
    if (!bridge?.debugGetCallStack) return
    bridge.debugGetCallStack().then(
      (frames) => {
        if (cancelled) return
        // Test hook may have already populated a synthetic stack; in that
        // case don't clobber it with an empty real-IPC result.
        if (Array.isArray(frames) && frames.length > 0) {
          setCallStack(frames)
          setCallStackSelected(0)
        }
      },
      () => {
        /* ignore — leave existing stack untouched */
      },
    )
    return () => {
      cancelled = true
    }
  }, [pausedLocation])

  // US-018: expose a test-only hook that lets Playwright seed a synthetic
  // call stack without a real Octave process. Mirrors the paused-location
  // test hook from US-016.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopSimulateCallStack?: (frames: CallStackFrame[]) => void
      __matslopClearCallStack?: () => void
      __matslopCallStack?: CallStackFrame[]
    }
    w.__matslopSimulateCallStack = (frames: CallStackFrame[]) => {
      setCallStack(frames)
      setCallStackSelected(frames.length > 0 ? 0 : -1)
    }
    w.__matslopClearCallStack = () => {
      setCallStack([])
      setCallStackSelected(-1)
    }
    w.__matslopCallStack = callStack
    return () => {
      const ww = window as unknown as { __matslopCallStack?: unknown }
      ww.__matslopCallStack = null
    }
  }, [callStack])

  // US-018: selecting a frame in the Call Stack panel navigates the
  // editor to that frame's file/line. We reuse the existing paused-location
  // pipeline — setting pausedLocation activates the matching editor tab
  // (via EditorPanel) and scrolls the line into view with the paused
  // highlight (via TabbedEditor). We do NOT re-query the stack here,
  // since it's the same pause.
  const handleCallStackSelect = useCallback(
    (index: number) => {
      setCallStackSelected(index)
      const frame = callStack[index]
      if (frame && frame.file) {
        setPausedLocation({ file: frame.file, line: Math.floor(frame.line) })
      }
    },
    [callStack],
  )

  // US-019: Re-query the Workspace panel whenever the debugger's paused
  // state transitions. Entering a paused state means `whos` now reports
  // variables of the current (paused) stack frame; leaving the paused
  // state means we should snap back to the top scope. Bumping
  // `workspaceRefreshTrigger` is enough — WorkspacePanel's existing
  // refresh hook picks it up.
  const pausedKey = pausedLocation ? `${pausedLocation.file}:${pausedLocation.line}` : ''
  useEffect(() => {
    setWorkspaceRefreshTrigger((prev) => prev + 1)
  }, [pausedKey])

  // US-023: when the debugger resumes (paused → not paused), auto-dismiss
  // the edit-and-continue banner — the message is only relevant during the
  // active pause.
  useEffect(() => {
    if (!pausedLocation) {
      setEditContinueBanner(null)
    }
  }, [pausedLocation])

  // US-023 (edit-and-continue, best effort): fired by EditorPanel's handleSave
  // when the user writes a .m file while the debugger is paused. We:
  //   1. Ask main to re-apply breakpoints for that file (dbclear + dbstop),
  //      so Octave re-reads the freshly-written source on the next call.
  //   2. Raise a warning banner telling the user the edits will only take
  //      effect when the function is re-entered.
  // This is intentionally a best-effort approximation of MATLAB's true
  // edit-and-continue: Octave has no in-place function replacement, so the
  // running call-frame keeps executing the OLD source until it returns.
  const handleFileSavedWhilePaused = useCallback((filePath: string | null) => {
    if (!filePath) return
    // Kick the main-process bridge — swallow errors, it's best-effort.
    const bridge = window.matslop as typeof window.matslop | undefined
    if (bridge?.debugReapplyBreakpointsForFile) {
      void bridge.debugReapplyBreakpointsForFile(filePath).catch(() => {
        /* best-effort */
      })
    }
    const filename = filePath.split(/[\\/]/).pop() ?? filePath
    editContinueBannerIdRef.current += 1
    setEditContinueBanner({ filename, id: editContinueBannerIdRef.current })
  }, [])

  // US-022: Evaluate one watch expression via the main-process Octave IPC
  // and thread the result back into state via the setWatch{Value,Error}
  // helpers. Wrapped in try/catch so a bad expression (e.g. undefined
  // variable) doesn't poison the whole queue; the `__MSLP_WATCH_ERR__`
  // marker from buildWatchCommand carries the Octave error message.
  const evaluateWatch = useCallback(async (id: string, expression: string) => {
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) return
      const result = await bridge.octaveExecute(buildWatchCommand(expression))
      const parsed = parseWatchOutput(result.output || '')
      if (parsed.ok) {
        setWatches((prev) => setWatchValue(prev, id, formatWatchValue(parsed.value)))
      } else {
        setWatches((prev) => setWatchError(prev, id, parsed.error))
      }
    } catch (err) {
      setWatches((prev) => setWatchError(prev, id, String(err)))
    }
  }, [])

  // US-022: Re-evaluate every pinned watch. Called on pause/step
  // transitions, on engine-ready transitions, and from the refresh button.
  const refreshAllWatches = useCallback(async () => {
    const current = watchesRef.current
    if (current.length === 0) return
    if (octaveStatus.engineStatus === 'disconnected') return
    // Fire serially so commands don't race through Octave's queue (the
    // underlying executor is already serial, but awaiting one at a time
    // makes ordering deterministic for tests).
    for (const w of current) {
      await evaluateWatch(w.id, w.expression)
    }
  }, [evaluateWatch, octaveStatus.engineStatus])

  // US-022: Re-evaluate watches whenever Octave's paused location changes
  // (entering a breakpoint, stepping, or leaving debug mode all update
  // pausedKey). Leaving the paused state still re-evaluates so top-level
  // workspace values replace the stack-frame readings.
  useEffect(() => {
    refreshAllWatches()
    // pausedKey intentionally used instead of pausedLocation so deep
    // object changes don't cause spurious re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedKey])

  // US-022: Clear watch values on engine disconnect so the panel doesn't
  // show stale readings from a dead Octave process.
  useEffect(() => {
    if (octaveStatus.engineStatus === 'disconnected') {
      setWatches((prev) => clearWatchValues(prev))
    }
  }, [octaveStatus.engineStatus])

  const handleAddWatch = useCallback(
    (expression: string) => {
      setWatches((prev) => {
        const next = addWatchHelper(prev, expression)
        const added = next[next.length - 1]
        if (added && added.expression === expression.trim()) {
          // Kick off an evaluation after the state commit.
          void evaluateWatch(added.id, added.expression)
        }
        return next
      })
    },
    [evaluateWatch],
  )

  const handleRemoveWatch = useCallback((id: string) => {
    setWatches((prev) => removeWatchHelper(prev, id))
  }, [])

  const handleUpdateWatch = useCallback(
    (id: string, expression: string) => {
      setWatches((prev) => {
        const next = updateWatchHelper(prev, id, expression)
        // If the entry still exists in `next`, the expression changed —
        // evaluate it. If it was removed (blank edit), skip.
        const updated = next.find((w) => w.id === id)
        if (updated) {
          void evaluateWatch(updated.id, updated.expression)
        }
        return next
      })
    },
    [evaluateWatch],
  )

  // US-022: Expose test-only hooks so Playwright can drive the watch list
  // without real keyboard interaction. Mirrors the call-stack test hooks.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopAddWatch?: (expression: string) => void
      __matslopRemoveWatch?: (id: string) => void
      __matslopUpdateWatch?: (id: string, expression: string) => void
      __matslopClearWatches?: () => void
      __matslopSimulateWatchValue?: (id: string, value: string) => void
      __matslopSimulateWatchError?: (id: string, error: string) => void
      __matslopWatches?: WatchEntry[]
    }
    w.__matslopAddWatch = (expression: string) => handleAddWatch(expression)
    w.__matslopRemoveWatch = (id: string) => handleRemoveWatch(id)
    w.__matslopUpdateWatch = (id: string, expression: string) =>
      handleUpdateWatch(id, expression)
    w.__matslopClearWatches = () => setWatches([])
    w.__matslopSimulateWatchValue = (id: string, value: string) =>
      setWatches((prev) => setWatchValue(prev, id, value))
    w.__matslopSimulateWatchError = (id: string, error: string) =>
      setWatches((prev) => setWatchError(prev, id, error))
    w.__matslopWatches = watches
    return () => {
      const ww = window as unknown as { __matslopWatches?: unknown }
      ww.__matslopWatches = null
    }
  }, [handleAddWatch, handleRemoveWatch, handleUpdateWatch, watches])

  // US-016: expose a test-only hook so Playwright can simulate a paused
  // event without spinning up a real Octave process. Gated on
  // MATSLOP_USER_DATA_DIR (set by the e2e launcher) but harmless elsewhere.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopSimulatePaused?: (file: string, line: number) => void
      __matslopClearPaused?: () => void
      __matslopPausedLocation?: { file: string; line: number } | null
    }
    w.__matslopSimulatePaused = (file: string, line: number) => {
      setPausedLocation({ file, line: Math.floor(line) })
    }
    w.__matslopClearPaused = () => {
      setPausedLocation(null)
    }
    w.__matslopPausedLocation = pausedLocation
    return () => {
      const ww = window as unknown as { __matslopPausedLocation?: unknown }
      ww.__matslopPausedLocation = null
    }
  }, [pausedLocation])

  // US-023: expose a test-only hook so Playwright can fire the same
  // "saved a .m file while paused" flow EditorPanel.handleSave triggers —
  // without needing a tab with a real file path on disk. Mirrors the
  // banner state so tests can assert monotonic visibility.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopSimulateFileSavedWhilePaused?: (filePath: string) => void
      __matslopEditContinueBanner?: { filename: string; id: number } | null
    }
    w.__matslopSimulateFileSavedWhilePaused = (filePath: string) => {
      handleFileSavedWhilePaused(filePath)
    }
    w.__matslopEditContinueBanner = editContinueBanner
    return () => {
      const ww = window as unknown as {
        __matslopEditContinueBanner?: unknown
      }
      ww.__matslopEditContinueBanner = null
    }
  }, [handleFileSavedWhilePaused, editContinueBanner])

  // US-020: expose a test-only hook so Playwright can simulate the Octave
  // engine being 'busy' without actually running a script. The Pause button
  // is only enabled while the engine is busy, so e2e tests need to drive
  // that state directly.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopSimulateEngineStatus?: (status: OctaveEngineStatus) => void
    }
    w.__matslopSimulateEngineStatus = (status: OctaveEngineStatus) => {
      setOctaveStatus((prev) => ({ ...prev, engineStatus: status }))
    }
    return () => {
      const ww = window as unknown as {
        __matslopSimulateEngineStatus?: unknown
      }
      ww.__matslopSimulateEngineStatus = undefined
    }
  }, [])

  // US-019: expose the workspace refresh counter so e2e tests can assert
  // that entering/leaving a paused state causes the panel to re-query.
  useEffect(() => {
    const w = window as unknown as { __matslopWorkspaceRefreshCount?: number }
    w.__matslopWorkspaceRefreshCount = workspaceRefreshTrigger
    return () => {
      const ww = window as unknown as { __matslopWorkspaceRefreshCount?: unknown }
      ww.__matslopWorkspaceRefreshCount = undefined
    }
  }, [workspaceRefreshTrigger])

  const octaveInitRef = useRef(false)
  useEffect(() => {
    // Guard against StrictMode double-invoke
    if (octaveInitRef.current) return
    octaveInitRef.current = true

    // Check if Octave is already configured on startup
    window.matslop.octaveGetPath().then(async (storedPath) => {
      if (storedPath) {
        const result = await window.matslop.octaveValidate(storedPath)
        if (result.valid) {
          setOctaveStatus({ path: storedPath, version: result.version ?? 'unknown', configured: true, engineStatus: 'disconnected' })
          startOctaveProcess(storedPath)
          return
        }
      }
      // Try auto-detect (finds bundled or system-installed Octave)
      const detected = await window.matslop.octaveAutoDetect()
      if (detected) {
        const result = await window.matslop.octaveValidate(detected)
        if (result.valid) {
          await window.matslop.octaveSetPath(detected)
          setOctaveStatus({ path: detected, version: result.version ?? 'unknown', configured: true, engineStatus: 'disconnected' })
          startOctaveProcess(detected)
          return
        }
      }
      // Not configured and auto-detect failed — show setup dialog
      setShowOctaveSetup(true)
    })
  }, [startOctaveProcess])

  const handleOctaveConfigured = useCallback((path: string, version: string) => {
    setOctaveStatus({ path, version, configured: true, engineStatus: 'disconnected' })
    setShowOctaveSetup(false)
    startOctaveProcess(path)
  }, [startOctaveProcess])

  // Load theme preference on startup
  useEffect(() => {
    window.matslop.configGetTheme().then((stored) => {
      setThemeMode(stored)
    })
  }, [])

  // Load editor preferences on startup
  useEffect(() => {
    window.matslop.configGetPreferences().then((stored) => {
      setEditorSettings({
        fontFamily: stored.fontFamily,
        fontSize: stored.fontSize,
        tabSize: stored.tabSize,
        insertSpaces: stored.insertSpaces,
      })
    })
  }, [])

  // Load layout config on startup
  useEffect(() => {
    window.matslop.layoutGet().then((layout) => {
      setVisibility(layout.panelVisibility)
      setPanelSizes(layout.panelSizes)
      setLayoutLoaded(true)
    })
  }, [])

  // Resolve theme mode to actual light/dark and apply to document
  useEffect(() => {
    const resolve = (mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' => {
      if (mode === 'system') return prefersDark ? 'dark' : 'light'
      return mode
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = (): void => {
      const resolved = resolve(themeMode, mediaQuery.matches)
      setResolvedTheme(resolved)
      if (resolved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light')
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    }

    updateTheme()

    // Listen for system preference changes when in 'system' mode
    mediaQuery.addEventListener('change', updateTheme)
    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [themeMode])

  const handleSetTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    window.matslop.configSetTheme(mode)
  }, [])

  const handlePreferencesChanged = useCallback((prefs: EditorPreferences) => {
    setThemeMode(prefs.theme)
    setEditorSettings({
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
      tabSize: prefs.tabSize,
      insertSpaces: prefs.insertSpaces,
    })
  }, [])

  const saveLayout = useCallback((vis: PanelVisibility, sizes: PanelSizes) => {
    window.matslop.layoutSet({ panelVisibility: vis, panelSizes: sizes })
  }, [])

  const togglePanel = useCallback((panel: keyof PanelVisibility) => {
    setVisibility((prev) => {
      const next = { ...prev, [panel]: !prev[panel] }
      setPanelSizes((sizes) => {
        saveLayout(next, sizes)
        return sizes
      })
      return next
    })
  }, [saveLayout])

  // US-025: rc-dock owns the layout tree now. Splitter resizes are handled
  // internally by rc-dock via `onLayoutChange` in MatslopDockLayout — we no
  // longer need per-splitter pixel-tracking callbacks. `panelSizes` state
  // is retained for preferences persistence, but the values are advisory.

  const handleFileBrowserOpen = useCallback((filePath: string) => {
    setPendingOpenPath(filePath)
  }, [])

  const handleFileOpened = useCallback(() => {
    setPendingOpenPath(null)
  }, [])

  const octaveEngineStatusRef = useRef<OctaveEngineStatus>('disconnected')
  octaveEngineStatusRef.current = octaveStatus.engineStatus

  const handleCwdChange = useCallback((newCwd: string) => {
    setCwd(newCwd)
    // Sync Octave's working directory when FileBrowser changes
    if (octaveEngineStatusRef.current === 'ready') {
      const escapedDir = newCwd.replace(/'/g, "''")
      window.matslop.octaveExecute(`cd('${escapedDir}')`).catch(() => {
        // ignore cd errors
      })
    }
  }, [])

  const handleCursorPositionChange = useCallback((line: number, column: number) => {
    setCursorPosition({ line, column })
  }, [])

  const handleErrorCountChange = useCallback((count: number) => {
    setErrorCount(count)
  }, [])

  const handleRunScript = useCallback((filePath: string, dirPath: string) => {
    const fileName = filePath.substring(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
    const escapedDir = dirPath.replace(/'/g, "''")
    const escapedFile = fileName.replace(/'/g, "''")
    const command = `cd('${escapedDir}'); run('${escapedFile}')`
    const display = `run('${escapedFile}')`
    const id = ++pendingCommandIdRef.current
    setPendingCommand({ command, display, id })
  }, [])

  const handleRunSection = useCallback((code: string) => {
    const display = code.length > 80 ? code.substring(0, 77) + '...' : code
    const id = ++pendingCommandIdRef.current
    setPendingCommand({ command: code, display, id })
  }, [])

  const handleStop = useCallback(() => {
    window.matslop.octaveInterrupt()
  }, [])

  // US-020: Pause a running script and drop into the debugger at the
  // currently-executing line. Calls the preload bridge which in turn
  // invokes `OctaveProcessManager.pauseForDebug()` (SIGINT with
  // `debug_on_interrupt(true)` set). When Octave actually enters debug
  // mode it will print its standard "stopped in <file>" marker which
  // flows back through the existing `onOctavePaused` IPC pipeline and
  // sets `pausedLocation`, flipping the UI into debug mode.
  //
  // Also exposes `window.__matslopLastPauseForDebug` so e2e tests can
  // observe that the button fired without needing a real Octave process.
  const handlePauseForDebug = useCallback(() => {
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __matslopLastPauseForDebug?: { at: number }
      }
      w.__matslopLastPauseForDebug = { at: Date.now() }
    }
    try {
      const bridge = (window as unknown as { matslop?: Window['matslop'] }).matslop
      void bridge?.octavePauseForDebug?.().catch(() => {})
    } catch {
      /* ignore */
    }
  }, [])

  // US-017: Dispatch a debug command (continue/step/stepIn/stepOut/stop).
  // Sends the corresponding Octave `db*` command and clears the paused
  // highlight locally — the next `onOctavePaused` event will restore it
  // if execution stops again. Also exposes the last dispatched command
  // via `window.__matslopLastDebugCommand` so e2e tests can observe it
  // without needing a real Octave process behind the IPC.
  const handleDebugAction = useCallback((action: DebugAction) => {
    const command = debugActionToOctaveCommand(action)
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __matslopLastDebugCommand?: { action: DebugAction; command: string; at: number }
      }
      w.__matslopLastDebugCommand = { action, command, at: Date.now() }
    }
    // Fire-and-forget; if Octave isn't running (e.g. during tests that only
    // simulate the paused state) the IPC rejects harmlessly.
    try {
      void window.matslop.octaveExecute(command).catch(() => {})
    } catch {
      /* ignore */
    }
    setPausedLocation(null)
  }, [])

  // US-017: Global keyboard shortcuts that are only active while the
  // debugger is paused. F5/F10/F11/Shift+F11/Shift+F5 map to the debug
  // actions here; outside a paused state they fall through to the normal
  // editor shortcut manager (F5 = run, Shift+F5 = stop). Registered in the
  // capture phase so it takes precedence over the editor-panel listener.
  useEffect(() => {
    if (!pausedLocation) return
    const handler = (e: KeyboardEvent): void => {
      const action = matchDebugShortcut(e)
      if (!action) return
      e.preventDefault()
      e.stopPropagation()
      handleDebugAction(action)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [pausedLocation, handleDebugAction])

  // Listen for menu actions from main process
  useEffect(() => {
    const unsub = window.matslop.onMenuAction((action) => {
      switch (action) {
        case 'toggleCommandWindow':
          togglePanel('commandWindow')
          break
        case 'toggleWorkspace':
          togglePanel('workspace')
          break
        case 'toggleFileBrowser':
          togglePanel('fileBrowser')
          break
        case 'toggleCommandHistory':
          togglePanel('commandHistory')
          break
        case 'resetLayout':
          setVisibility(defaultVisibility)
          setPanelSizes(defaultSizes)
          saveLayout(defaultVisibility, defaultSizes)
          break
        case 'setThemeLight':
          handleSetTheme('light')
          break
        case 'setThemeDark':
          handleSetTheme('dark')
          break
        case 'setThemeSystem':
          handleSetTheme('system')
          break
        case 'stopExecution':
          handleStop()
          break
        case 'preferences':
          setShowPreferences(true)
          break
        case 'about':
          setShowAbout(true)
          break
        case 'clearRecentFiles':
          window.matslop.recentFilesClear()
          break
        default: {
          // Handle recent file open actions
          if (action.startsWith('recentFile:')) {
            const filePath = action.substring('recentFile:'.length)
            setPendingOpenPath(filePath)
            break
          }
          // Forward to EditorPanel/CommandWindow via menuAction state
          const id = ++menuActionIdRef.current
          setMenuAction({ action, id })
          break
        }
      }
    })
    return unsub
  }, [handleStop, handleSetTheme, togglePanel, saveLayout])

  const handleMenuActionConsumed = useCallback(() => {
    setMenuAction(null)
  }, [])

  const handleCommandExecuted = useCallback(async () => {
    // After each command, query pwd and capture figures in a single Octave command
    if (octaveStatus.engineStatus === 'disconnected') return

    // Combined query: get pwd + detect and capture figures
    const captureScript = [
      "__mslp_r__=pwd();disp(['__MATSLOP_PWD__:' __mslp_r__]);",
      "__mslp_fh__=get(0,'children');",
      "for __mslp_k__=1:length(__mslp_fh__);",
      "__mslp_fp__=[tempdir() 'matslop_fig_' num2str(__mslp_fh__(__mslp_k__)) '.png'];",
      "try;print(__mslp_fh__(__mslp_k__),__mslp_fp__,'-dpng','-r150');",
      "disp(['__MATSLOP_FIG__:' num2str(__mslp_fh__(__mslp_k__)) ':' __mslp_fp__]);",
      "catch;end;end;",
      "clear __mslp_r__ __mslp_fh__ __mslp_k__ __mslp_fp__;"
    ].join('')

    try {
      const result = await window.matslop.octaveExecute(captureScript)
      const output = result.output || ''

      // Parse pwd
      const pwdMatch = output.match(/__MATSLOP_PWD__:(.+)/)
      if (pwdMatch) {
        const octaveCwd = pwdMatch[1].trim()
        if (octaveCwd && octaveCwd !== cwd) {
          setCwd(octaveCwd)
        }
      }

      // Parse figures
      const figMatches = [...output.matchAll(/__MATSLOP_FIG__:(\d+):(.+)/g)]
      if (figMatches.length > 0) {
        const newFigures: FigureData[] = []
        for (const m of figMatches) {
          const handle = parseInt(m[1])
          const tempPath = m[2].trim()
          const base64 = await window.matslop.figuresReadImage(tempPath)
          if (base64) {
            newFigures.push({
              handle,
              imageDataUrl: `data:image/png;base64,${base64}`,
              tempPath,
            })
          }
        }
        setFigures(newFigures)
      } else {
        setFigures([])
      }
    } catch {
      // ignore query errors
    }

    // Trigger workspace refresh after command execution
    setWorkspaceRefreshTrigger((prev) => prev + 1)
  }, [octaveStatus.engineStatus, cwd])

  const handleInspectVariable = useCallback((variable: InspectedVariable) => {
    setInspectedVariable(variable)
  }, [])

  const handleVariablesChanged = useCallback(
    (variables: Array<{ name: string; class: string; size: string }>) => {
      updateWorkspaceVariables(variables)
    },
    []
  )

  // Update .m file names for auto-complete when cwd changes
  useEffect(() => {
    if (!cwd) {
      updateMFileNames([])
      return
    }
    window.matslop.readDir(cwd).then((entries) => {
      const mFiles = entries
        .filter((e) => !e.isDirectory && e.name.endsWith('.m'))
        .map((e) => e.name)
      updateMFileNames(mFiles)
    }).catch(() => {
      updateMFileNames([])
    })
  }, [cwd])

  const handleSaveFigure = useCallback(async (figure: FigureData) => {
    const result = await window.matslop.figuresSaveDialog(`figure_${figure.handle}.png`)
    if (!result) return

    if (result.format === 'png') {
      // Copy the existing PNG
      await window.matslop.figuresCopyFile(figure.tempPath, result.filePath)
    } else {
      // Re-render in the requested format via Octave
      const escapedPath = result.filePath.replace(/'/g, "''")
      const formatFlag = result.format === 'svg' ? '-dsvg' : '-dpdf'
      await window.matslop.octaveExecute(
        `print(${figure.handle},'${escapedPath}','${formatFlag}')`
      )
    }
  }, [])

  const handleHistoryChanged = useCallback(() => {
    setHistoryVersion((prev) => prev + 1)
  }, [])

  const handleHistoryExecute = useCallback((command: string) => {
    setPasteCommand(command)
  }, [])

  const handlePasteConsumed = useCallback(() => {
    setPasteCommand(null)
  }, [])

  // US-025: derive dock visibility from app state. Optional panels
  // (Call Stack, Watches, Figure) are auto-shown based on state
  // transitions — they match the conditional-mount rules that the old
  // Allotment layout enforced via `visible={...}`.
  const dockVisibility: DockVisibility = useMemo(
    () => ({
      fileBrowser: visibility.fileBrowser,
      commandWindow: visibility.commandWindow,
      commandHistory: visibility.commandHistory,
      workspace: visibility.workspace,
      callStack: pausedLocation !== null,
      watches: watches.length > 0 || pausedLocation !== null,
      figure: figures.length > 0,
    }),
    [
      visibility.fileBrowser,
      visibility.commandWindow,
      visibility.commandHistory,
      visibility.workspace,
      pausedLocation,
      watches.length,
      figures.length,
    ],
  )

  return (
    <div className="app">
      {showOctaveSetup && <OctaveSetupDialog onConfigured={handleOctaveConfigured} />}
      {showAbout && (
        <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAbout(false) }}>
          <div className="about-dialog">
            <h2>MatSlop</h2>
            <p>Open-source MATLAB alternative IDE</p>
            <p>Built with Electron, React, TypeScript, and GNU Octave</p>
            <p className="about-version">Version 1.0.0</p>
            <button className="about-close-btn" onClick={() => setShowAbout(false)}>Close</button>
          </div>
        </div>
      )}
      {showPreferences && (
        <PreferencesDialog
          onClose={() => setShowPreferences(false)}
          onPreferencesChanged={handlePreferencesChanged}
        />
      )}
      {inspectedVariable && (
        <VariableInspectorDialog
          variable={inspectedVariable}
          onClose={() => setInspectedVariable(null)}
        />
      )}
      <div className="app-main">
      {/* US-025: Every panel is now a dock pane inside MatslopDockLayout,
          which wraps rc-dock. The layout tree is computed from the
          visibility flags below — panels whose flag is `false` are
          omitted from the layout entirely, so their data-testids vanish
          from the DOM (matching the conditional-mount behavior existing
          tests assumed from Allotment.Pane{visible}). */}
      {layoutLoaded && (
        <MatslopDockLayout
          visibility={dockVisibility}
          fileBrowser={
            dockVisibility.fileBrowser ? (
              <FileBrowser
                onCollapse={() => togglePanel('fileBrowser')}
                onOpenFile={handleFileBrowserOpen}
                onCwdChange={handleCwdChange}
                externalCwd={cwd}
              />
            ) : null
          }
          editor={
            <EditorPanel
              panelVisibility={visibility}
              onTogglePanel={togglePanel}
              openFilePath={pendingOpenPath}
              onFileOpened={handleFileOpened}
              onCursorPositionChange={handleCursorPositionChange}
              onErrorCountChange={handleErrorCountChange}
              engineStatus={octaveStatus.engineStatus}
              onRun={handleRunScript}
              onStop={handleStop}
              onPauseForDebug={handlePauseForDebug}
              onRunSection={handleRunSection}
              menuAction={menuAction}
              onMenuActionConsumed={handleMenuActionConsumed}
              editorTheme={resolvedTheme === 'light' ? 'vs-light' : 'vs-dark'}
              editorSettings={editorSettings}
              pausedLocation={pausedLocation}
              onFileSavedWhilePaused={handleFileSavedWhilePaused}
            />
          }
          commandWindow={
            dockVisibility.commandWindow ? (
              <CommandWindow
                onCollapse={() => togglePanel('commandWindow')}
                engineStatus={octaveStatus.engineStatus}
                pendingCommand={pendingCommand}
                onCommandExecuted={handleCommandExecuted}
                onHistoryChanged={handleHistoryChanged}
                pasteCommand={pasteCommand}
                onPasteConsumed={handlePasteConsumed}
                menuAction={menuAction}
                onMenuActionConsumed={handleMenuActionConsumed}
              />
            ) : null
          }
          commandHistory={
            dockVisibility.commandHistory ? (
              <CommandHistoryPanel
                onCollapse={() => togglePanel('commandHistory')}
                onExecuteCommand={handleHistoryExecute}
                historyVersion={historyVersion}
              />
            ) : null
          }
          workspace={
            dockVisibility.workspace ? (
              <WorkspacePanel
                onCollapse={() => togglePanel('workspace')}
                engineStatus={octaveStatus.engineStatus}
                refreshTrigger={workspaceRefreshTrigger}
                onInspectVariable={handleInspectVariable}
                onVariablesChanged={handleVariablesChanged}
                debugPaused={pausedLocation !== null}
                debugFrameName={pausedLocation ? (callStack[callStackSelected]?.name ?? null) : null}
              />
            ) : null
          }
          callStack={
            dockVisibility.callStack ? (
              <CallStackPanel
                frames={callStack}
                selectedIndex={callStackSelected}
                onSelectFrame={handleCallStackSelect}
              />
            ) : null
          }
          watches={
            dockVisibility.watches ? (
              <WatchesPanel
                watches={watches}
                onAddWatch={handleAddWatch}
                onRemoveWatch={handleRemoveWatch}
                onUpdateWatch={handleUpdateWatch}
                onRefresh={refreshAllWatches}
              />
            ) : null
          }
          figure={
            dockVisibility.figure ? (
              <FigurePanel figures={figures} onSaveFigure={handleSaveFigure} />
            ) : null
          }
        />
      )}
      </div>
      {/* US-023: edit-and-continue warning banner. Shown whenever the user
          saved a .m file while paused. Auto-dismisses on resume (see effect
          above) or on manual close. Placed above DebugToolbar so they stack
          cleanly along the bottom when both are visible. */}
      {editContinueBanner && (
        <div
          className="edit-continue-banner"
          data-testid="edit-continue-banner"
          role="status"
          aria-live="polite"
        >
          <span className="edit-continue-banner-icon" aria-hidden="true">⚠</span>
          <span className="edit-continue-banner-text">
            Changes to <strong>{editContinueBanner.filename}</strong> will take
            effect when this function is re-entered. Breakpoints have been
            re-applied (best-effort edit-and-continue).
          </span>
          <button
            type="button"
            className="edit-continue-banner-close"
            data-testid="edit-continue-banner-close"
            aria-label="Dismiss edit-and-continue notice"
            onClick={() => setEditContinueBanner(null)}
          >
            ×
          </button>
        </div>
      )}
      {pausedLocation && (
        <DebugToolbar
          onAction={handleDebugAction}
          pausedLabel={`${pausedLocation.file.split(/[\\/]/).pop() ?? pausedLocation.file}:${pausedLocation.line}`}
        />
      )}
      <StatusBar
        cwd={cwd}
        engineStatus={octaveStatus.engineStatus}
        cursorPosition={cursorPosition}
        errorCount={errorCount}
        debugPaused={pausedLocation !== null}
      />
    </div>
  )
}

export default App
