import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import MatslopDockLayout, {
  type DockVisibility,
  sanitizeSavedDockLayout,
} from './panels/MatslopDockLayout'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow, { type PendingCommand } from './panels/CommandWindow'
import CommandHistoryPanel from './panels/CommandHistoryPanel'
import FigurePanel, { type FigureData } from './panels/FigurePanel'
import StatusBar from './panels/StatusBar'
import { octaveBusyTracker, type OctaveBusyState } from './octaveBusyTracker'
import UpdateBanner from './panels/UpdateBanner'
import type { CursorPosition } from './panels/StatusBar'
import DebugToolbar from './editor/DebugToolbar'
import CallStackPanel, { type CallStackFrame } from './panels/CallStackPanel'
import WatchesPanel from './panels/WatchesPanel'
import HelpPanel from './panels/HelpPanel'
import FindInFilesPanel from './panels/FindInFilesPanel'
import ProfilerPanel from './panels/ProfilerPanel'
import SourceControlPanel from './panels/SourceControlPanel'
import { OctaveContext } from './OctaveContext'
import { AppContext, type AppContextValue } from './AppContext'
import {
  buildProfileStartCommand,
  buildProfileStopCommand,
  buildProfileReportCommand,
  buildProfileClearCommand,
  parseProfileReport,
  buildWhichCommand,
  parseWhichOutput,
  type ProfilerEntry,
  type ProfilerMode,
} from './editor/profilerStore'
import {
  EMPTY_HELP_STATE,
  beginHelpNavigation,
  completeHelpNavigation,
  failHelpNavigation,
  popHelpHistory,
  closeHelp as closeHelpState,
  buildHelpFetchCommand,
  extractHelpBody,
  type HelpState,
} from './editor/helpDoc'
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
import VariableInspectorDialog, { type InspectedVariable } from './dialogs/VariableInspectorDialog'
import PreferencesDialog, { type EditorPreferences } from './dialogs/PreferencesDialog'
import SavePresetDialog from './dialogs/SavePresetDialog'
import {
  captureLayoutPreset,
  getBuiltinPreset,
  parseLayoutPresetAction,
  type BuiltinPresetId,
  type LayoutPreset,
} from './editor/layoutPresets'
import { updateWorkspaceVariables, updateMFileNames } from './editor/matlabCompletionProvider'
import { buildRunScriptCommand } from './editor/functionFileDetection'

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
  // US-026: persisted rc-dock layout tree. Loaded from the existing
  // layout IPC on mount and saved on every interactive rc-dock change
  // (drag between docks, tab close, ...).
  const [savedDockLayout, setSavedDockLayout] = useState<unknown>(null)
  const savedDockLayoutRef = useRef<unknown>(null)
  // US-027: set of tab ids currently hosted in detached OS windows. While
  // a tab id is in this set, `MatslopDockLayout` omits it from the dock
  // layout tree. When the detached window closes, main sends a
  // `panel:redocked` event and the id is removed, restoring the dock tab.
  const [detachedPanels, setDetachedPanels] = useState<Set<string>>(() => new Set())
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null)
  // US-032: Find in Files. `findInFilesOpen` drives the dock-visibility
  // flag; when toggled on, the panel mounts into the center-bottom dock
  // and MatslopDockLayout auto-activates its tab. A pending reveal line
  // is routed through EditorPanel so a clicked result jumps to the
  // matched line in Monaco.
  const [findInFilesOpen, setFindInFilesOpen] = useState(false)
  // US-037: Source Control panel visibility.
  const [sourceControlOpen, setSourceControlOpen] = useState(false)
  // US-037: absolute-path → single-letter badge for File Browser overlay.
  const [gitBadges, setGitBadges] = useState<Map<string, string>>(() => new Map())
  // US-033: Profiler panel state. `profilerOpen` gates dock visibility;
  // `profilerMode` tracks whether `profile on` has been sent so the Start
  // button can disable itself; `profilerEntries` holds the last parsed
  // report. All Octave interaction lives in handlers below.
  const [profilerOpen, setProfilerOpen] = useState(false)
  const [profilerMode, setProfilerMode] = useState<ProfilerMode>('idle')
  const [profilerEntries, setProfilerEntries] = useState<ProfilerEntry[]>([])
  const [profilerError, setProfilerError] = useState<string | null>(null)
  const [profilerLoading, setProfilerLoading] = useState(false)
  const [pendingOpenLine, setPendingOpenLine] = useState<number | null>(null)
  const [octaveStatus, setOctaveStatus] = useState<OctaveStatus>({ path: null, version: null, configured: false, engineStatus: 'disconnected' })
  // US-S02: "Running…" indicator driven by a ref-counted in-flight tracker
  // wrapped around every `octaveExecute` IPC. Starts as 'idle'; flips to
  // 'running' only after 250ms of sustained activity so sub-threshold
  // commands don't flicker the status bar.
  const [octaveBusyState, setOctaveBusyState] = useState<OctaveBusyState>(() => octaveBusyTracker.getState())
  useEffect(() => {
    return octaveBusyTracker.subscribe(setOctaveBusyState)
  }, [])
  // US-P04: Replaced the blocking OctaveSetupDialog modal with a dismissible
  // banner above the status bar. The full UI mounts on launch even when
  // Octave isn't configured yet; the user can browse for octave-cli or
  // dismiss and configure later from Preferences > Octave path.
  const [octaveBannerVisible, setOctaveBannerVisible] = useState(false)
  const [octaveBannerError, setOctaveBannerError] = useState<string | null>(null)
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
  // US-Q01: Seed initial theme to 'dark' (matching the main-process default
  // in DEFAULT_THEME) so the very first paint never lands on light even if
  // configGetTheme() resolves a beat later. Stored preferences (including
  // a user-chosen 'system' or 'light') still override via the load effect
  // below.
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark')
  const [errorCount, setErrorCount] = useState(0)
  const [showPreferences, setShowPreferences] = useState(false)
  // US-028: Layout presets. Names list is refreshed every time the main
  // process tells us the list has changed (save/delete) so the "Save as
  // Preset" dialog's overwrite warning and tests can see the live set.
  const [showSavePresetDialog, setShowSavePresetDialog] = useState(false)
  const [customPresetNames, setCustomPresetNames] = useState<string[]>([])
  // US-016: when Octave hits a breakpoint we track the paused location so the
  // editor can highlight the line and the status bar can flip into debug mode.
  const [pausedLocation, setPausedLocation] = useState<{ file: string; line: number } | null>(null)
  const pausedLocationRef = useRef(pausedLocation)
  pausedLocationRef.current = pausedLocation
  // Track the last file/dir run via F5 so Pause can re-run with a breakpoint
  const lastRunRef = useRef<{ filePath: string; dirPath: string } | null>(null)
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
  // US-031: Help browser state. `doc <name>` in the Command Window (or
  // the test-only `__matslopOpenHelp` hook) drives this; the Help panel
  // auto-shows when `topic !== null`.
  const [helpState, setHelpState] = useState<HelpState>(EMPTY_HELP_STATE)
  const helpStateRef = useRef(helpState)
  helpStateRef.current = helpState
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
    // Sync current status once on mount — after a renderer reload the main
    // process may already have a running Octave but will not re-emit the
    // status unless it actually changes, so the onOctaveStatusChanged
    // listener alone would leave React stuck at 'disconnected'.
    window.matslop.octaveGetStatus?.().then?.((status) => {
      if (status) {
        setOctaveStatus((prev) => ({ ...prev, engineStatus: status }))
      }
    }).catch(() => {})
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
    // NOTE: intentionally only [pausedKey]; refreshAllWatches is stable.
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
      // US-P04: Not configured and auto-detect failed — show a dismissible
      // banner above the status bar instead of a modal blocking the UI.
      setOctaveBannerVisible(true)
    })
  }, [startOctaveProcess])

  const handleOctaveConfigured = useCallback((path: string, version: string) => {
    setOctaveStatus({ path, version, configured: true, engineStatus: 'disconnected' })
    setOctaveBannerVisible(false)
    setOctaveBannerError(null)
    startOctaveProcess(path)
  }, [startOctaveProcess])

  // US-P04: Browse for octave-cli from the not-found banner. Validates the
  // selected binary and, on success, starts the Octave process and hides the
  // banner. On failure, shows an inline error inside the banner.
  const handleOctaveBannerBrowse = useCallback(async () => {
    const selected = await window.matslop.octaveBrowse()
    if (!selected) return
    const result = await window.matslop.octaveValidate(selected)
    if (result.valid) {
      await window.matslop.octaveSetPath(selected)
      handleOctaveConfigured(selected, result.version ?? 'unknown')
    } else {
      setOctaveBannerError(result.error ?? 'Not a valid Octave binary')
    }
  }, [handleOctaveConfigured])

  const handleOctaveBannerDismiss = useCallback(() => {
    setOctaveBannerVisible(false)
  }, [])

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
      const rawSaved = (layout as { dockLayout?: unknown }).dockLayout ?? null
      // US-Q02: migrate stale persisted layouts on load. If the saved
      // tree contains a tab id whose visibility flag is currently false
      // (e.g. a leftover `matslop-command-history` after the user hid
      // History), strip it via the sanitizer and write the cleaned layout
      // back to disk so the ghost cannot resurrect on the next launch.
      let saved: unknown = rawSaved
      if (rawSaved && typeof rawSaved === 'object') {
        try {
          // Mirror the same DockVisibility shape MatslopDockLayout will
          // see at first paint. We only know the persistable subset here
          // (callStack/watches/figure are derived from runtime state and
          // start out false on a fresh launch), which is exactly the
          // shape that mattered when the layout was saved.
          const visForSanitize: DockVisibility = {
            fileBrowser: layout.panelVisibility.fileBrowser,
            commandWindow: layout.panelVisibility.commandWindow,
            commandHistory: layout.panelVisibility.commandHistory,
            workspace: layout.panelVisibility.workspace,
            callStack: false,
            watches: false,
            figure: false,
            helpBrowser: false,
            findInFiles: false,
            profiler: false,
            sourceControl: false,
          }
          const cleaned = sanitizeSavedDockLayout(
            rawSaved as never,
            visForSanitize,
          )
          if (cleaned) {
            const before = JSON.stringify(rawSaved)
            const after = JSON.stringify(cleaned)
            if (before !== after) {
              saved = cleaned
              // Persist the migration so future launches start clean.
              window.matslop.layoutSet({
                panelVisibility: layout.panelVisibility,
                panelSizes: layout.panelSizes,
                dockLayout: cleaned,
              })
            }
          } else {
            // Sanitization wiped everything → drop the saved layout so
            // we fall back to the visibility-derived default tree.
            saved = null
            window.matslop.layoutSet({
              panelVisibility: layout.panelVisibility,
              panelSizes: layout.panelSizes,
              dockLayout: undefined,
            })
          }
        } catch {
          // On any sanitizer error, keep the raw layout — better a
          // possibly-stale tab than a wiped layout.
        }
      }
      setSavedDockLayout(saved)
      savedDockLayoutRef.current = saved
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
    window.matslop.layoutSet({
      panelVisibility: vis,
      panelSizes: sizes,
      dockLayout: savedDockLayoutRef.current ?? undefined,
    })
  }, [])

  // Mirror visibility/panelSizes into refs so callbacks can snapshot the
  // current values without enlarging their dep arrays (used by US-026's
  // handleDockLayoutChange, and US-028's handleSaveLayoutPreset).
  const visibilityRef = useRef(visibility)
  visibilityRef.current = visibility
  const panelSizesRef = useRef(panelSizes)
  panelSizesRef.current = panelSizes

  // US-028: Apply a layout preset (built-in or custom). Resets detached
  // panels, applies visibility + sizes, and optionally rehydrates a stored
  // rc-dock layout tree (custom presets may have one; built-ins never do).
  const applyLayoutPreset = useCallback(
    (preset: LayoutPreset) => {
      setDetachedPanels(new Set())
      const dock = preset.dockLayout ?? null
      savedDockLayoutRef.current = dock
      setSavedDockLayout(dock)
      setVisibility(preset.visibility)
      setPanelSizes(preset.sizes)
      window.matslop.layoutSet({
        panelVisibility: preset.visibility,
        panelSizes: preset.sizes,
        dockLayout: dock ?? undefined,
      })
    },
    [],
  )

  // US-028: Refresh the custom preset name list from main. Called on
  // mount + after save/delete so menu and dialog state stay in sync.
  const refreshCustomPresetNames = useCallback(async () => {
    const map = await window.matslop.layoutPresetsList()
    setCustomPresetNames(Object.keys(map))
  }, [])
  useEffect(() => {
    void refreshCustomPresetNames()
  }, [refreshCustomPresetNames])

  const handleSaveLayoutPreset = useCallback(
    async (name: string) => {
      const preset = captureLayoutPreset(
        name,
        visibilityRef.current,
        panelSizesRef.current,
        savedDockLayoutRef.current ?? null,
      )
      await window.matslop.layoutPresetsSave(name, preset)
      setShowSavePresetDialog(false)
      await refreshCustomPresetNames()
    },
    [refreshCustomPresetNames],
  )

  const applyCustomPreset = useCallback(
    async (name: string) => {
      const stored = await window.matslop.layoutPresetsGet(name)
      if (!stored) return
      applyLayoutPreset({
        label: stored.label,
        visibility: stored.visibility,
        sizes: stored.sizes,
        dockLayout: stored.dockLayout,
      })
    },
    [applyLayoutPreset],
  )

  const deleteCustomPreset = useCallback(
    async (name: string) => {
      await window.matslop.layoutPresetsDelete(name)
      await refreshCustomPresetNames()
    },
    [refreshCustomPresetNames],
  )

  const applyBuiltinPreset = useCallback(
    (id: BuiltinPresetId) => {
      applyLayoutPreset(getBuiltinPreset(id))
    },
    [applyLayoutPreset],
  )

  // US-026: persist rc-dock layout on drag between docks. Callback reads
  // the latest visibility+sizes via the refs declared above.
  const handleDockLayoutChange = useCallback((layout: unknown) => {
    savedDockLayoutRef.current = layout
    window.matslop.layoutSet({
      panelVisibility: visibilityRef.current,
      panelSizes: panelSizesRef.current,
      dockLayout: layout,
    })
  }, [])

  // US-027: detach a dock tab into its own OS window. Marks the tab as
  // detached (so MatslopDockLayout omits it from the layout tree) and
  // asks main to open a new BrowserWindow via IPC. Dropping the saved
  // dock layout mirrors the togglePanel() flow so re-docking can land in
  // the default slot for the panel.
  const handleDetachTab = useCallback((tabId: string) => {
    savedDockLayoutRef.current = null
    setSavedDockLayout(null)
    setDetachedPanels((prev) => {
      if (prev.has(tabId)) return prev
      const next = new Set(prev)
      next.add(tabId)
      return next
    })
    // Fire-and-forget; failures are logged but don't block the UI update.
    void window.matslop.panelOpenDetached(tabId).then((res) => {
      if (!res?.success) {
        // Roll back the detached state if main refused to open.
        setDetachedPanels((prev) => {
          if (!prev.has(tabId)) return prev
          const next = new Set(prev)
          next.delete(tabId)
          return next
        })
      }
    })
  }, [])

  // US-027: subscribe to `panel:redocked` events from main. Fires when
  // the user closes a detached panel window — we remove the tab id from
  // our detached set so MatslopDockLayout re-includes it in the layout.
  useEffect(() => {
    const off = window.matslop.onPanelRedocked((tabId: string) => {
      savedDockLayoutRef.current = null
      setSavedDockLayout(null)
      setDetachedPanels((prev) => {
        if (!prev.has(tabId)) return prev
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
    })
    return () => {
      off()
    }
  }, [])

  // US-027: e2e test hook that mirrors the current detached set onto a
  // window-level global so Playwright can read it without waiting on
  // IPC roundtrips. Co-located with the state it observes.
  useEffect(() => {
    const w = window as unknown as {
      __matslopDetachedPanels?: string[]
    }
    w.__matslopDetachedPanels = Array.from(detachedPanels).sort()
  }, [detachedPanels])

  const togglePanel = useCallback((panel: keyof PanelVisibility) => {
    // Any visibility change rebuilds the dock tree from scratch inside
    // MatslopDockLayout, so we must drop the persisted dock layout here
    // to avoid re-applying a stale arrangement on next load.
    savedDockLayoutRef.current = null
    setSavedDockLayout(null)
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
    setPendingOpenLine(null)
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

  // US-L04: Shared capture-then-refresh helper.  The capture script
  // (pwd + figure detection) MUST complete before WorkspacePanel's `whos`
  // is triggered.  Without this ordering the two commands race for the
  // single Octave command slot and `whos` can return empty on slower
  // systems.  Every handler that finishes an Octave command should call
  // this instead of incrementing refreshTrigger directly.
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const runCaptureAndRefresh = useCallback(async () => {
    if (octaveStatus.engineStatus === 'disconnected') {
      setWorkspaceRefreshTrigger((prev) => prev + 1)
      return
    }

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
        if (octaveCwd && octaveCwd !== cwdRef.current) {
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
      // ignore capture errors — still refresh workspace below
    }

    // Only NOW — after the capture script has fully completed (or failed) —
    // do we trigger the workspace refresh.  WorkspacePanel's `whos` call
    // will not compete with the capture script for the Octave command slot.
    setWorkspaceRefreshTrigger((prev) => prev + 1)
  }, [octaveStatus.engineStatus])

  // US-S05: Run (F5) sources the saved .m file via `source('<abs path>')`
  // so the Command Window surfaces any output the script prints. We cd into
  // the script's directory first so relative paths inside the script still
  // resolve (matching the prior `run(...)` behavior). The Command-Window
  // "display" echoes the human-friendly `source('file.m')` form, not the
  // full absolute path, to keep the history readable.
  // Execute a script or section directly via IPC and push the result into
  // the command window's output via a shared ref. This bypasses the
  // pendingCommand → CommandWindow prop pipeline which is broken by
  // rc-dock's stale-content caching (the dock only re-renders tab content
  // on layout changes, so prop updates to components inside dock panes
  // are silently dropped).
  const handleRunScript = useCallback(async (filePath: string, dirPath: string) => {
    lastRunRef.current = { filePath, dirPath }
    const { command, display } = buildRunScriptCommand(filePath, dirPath)
    try {
      const result = await window.matslop.octaveExecute(command)
      // Push to command window output via a shared event
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display, output: result.output, error: result.error },
      }))
    } catch (err) {
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display, output: '', error: String(err) },
      }))
    }
    // US-L04: Run capture script (pwd + figures) then refresh workspace —
    // serialized, not concurrent.
    await runCaptureAndRefresh()
  }, [runCaptureAndRefresh])

  const handleRunSection = useCallback(async (code: string) => {
    const display = code.length > 80 ? code.substring(0, 77) + '...' : code
    try {
      const result = await window.matslop.octaveExecute(code)
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display, output: result.output, error: result.error },
      }))
    } catch (err) {
      window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
        detail: { display, output: '', error: String(err) },
      }))
    }
    // US-L04: Run capture script (pwd + figures) then refresh workspace —
    // serialized, not concurrent.
    await runCaptureAndRefresh()
  }, [runCaptureAndRefresh])

  const handleStop = useCallback(() => {
    window.matslop.octaveInterrupt()
    // If we're in debug mode, also exit it and clear breakpoints
    if (pausedLocationRef.current) {
      try {
        void window.matslop.octaveExecute('dbquit').catch(() => {})
        void window.matslop.octaveExecute('dbclear all').catch(() => {})
      } catch { /* ignore */ }
    }
    setPausedLocation(null)
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
  const handlePauseForDebug = useCallback(async () => {
    if (typeof window !== 'undefined') {
      const w = window as unknown as {
        __matslopLastPauseForDebug?: { at: number }
      }
      w.__matslopLastPauseForDebug = { at: Date.now() }
    }
    // Octave's debug_on_interrupt doesn't work with pipe-based stdin.
    // Instead: interrupt current execution, set a breakpoint at line 1
    // of the last-run script, and re-run it so the user can step through.
    const last = lastRunRef.current
    if (!last) return
    try {
      await window.matslop.octaveInterrupt()
    } catch { /* ignore */ }
    // Wait for the interrupt to settle
    await new Promise<void>((r) => setTimeout(r, 500))
    try {
      const basename = last.filePath.replace(/.*[\\/]/, '').replace(/\.m$/, '')
      const escapedDir = last.dirPath.replace(/'/g, "''")
      await window.matslop.octaveExecute(`addpath('${escapedDir}'); dbstop in ${basename} at 1`)
      // Re-run — this will hit the breakpoint at line 1
      const { command } = buildRunScriptCommand(last.filePath, last.dirPath)
      void window.matslop.octaveExecute(command).then((result) => {
        if (result.output || result.error) {
          window.dispatchEvent(new CustomEvent('matslop:commandOutput', {
            detail: { display: '', output: result.output, error: result.error },
          }))
        }
      })
    } catch {
      /* ignore — best effort */
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
      // On stop, also clear all breakpoints so the Pause-inserted dbstop
      // doesn't fire again on the next Run.
      if (action === 'stop') {
        void window.matslop.octaveExecute('dbclear all').catch(() => {})
      }
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
          // Drop any persisted rc-dock rearrangement so reset actually
          // restores the default tree (see US-026). "Reset Layout" is an
          // alias for applying the Default built-in preset (US-028).
          applyBuiltinPreset('default')
          break
        case 'saveLayoutPreset':
          setShowSavePresetDialog(true)
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
        case 'findInFiles':
          // US-032: toggle the Find-in-Files panel (Ctrl+Shift+F menu item).
          setFindInFilesOpen((prev) => !prev)
          break
        case 'toggleProfiler':
          // US-033: toggle the Profiler panel.
          setProfilerOpen((prev) => !prev)
          break
        case 'toggleSourceControl':
          // US-037: toggle the Source Control panel.
          setSourceControlOpen((prev) => !prev)
          break
        default: {
          // Handle recent file open actions
          if (action.startsWith('recentFile:')) {
            const filePath = action.substring('recentFile:'.length)
            setPendingOpenPath(filePath)
            break
          }
          // US-028: Layout preset menu actions (builtin/custom/delete).
          const parsed = parseLayoutPresetAction(action)
          if (parsed) {
            if (parsed.kind === 'builtin') {
              applyBuiltinPreset(parsed.id)
            } else if (parsed.kind === 'custom') {
              void applyCustomPreset(parsed.name)
            } else {
              void deleteCustomPreset(parsed.name)
            }
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
  }, [
    handleStop,
    handleSetTheme,
    togglePanel,
    saveLayout,
    applyBuiltinPreset,
    applyCustomPreset,
    deleteCustomPreset,
  ])

  const handleMenuActionConsumed = useCallback(() => {
    setMenuAction(null)
  }, [])

  const handleCommandExecuted = useCallback(async () => {
    await runCaptureAndRefresh()
  }, [runCaptureAndRefresh])

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

  // US-031: Fetch help for `topic` from Octave, parse out the body from
  // the delimited command output, and hand it to the reducer. Swallows
  // IPC failures (shown as an inline error in the panel). Test-only hook
  // `__matslopOpenHelp` bypasses this function entirely by populating the
  // state directly with a canned body.
  const fetchAndShowHelp = useCallback(async (topic: string) => {
    setHelpState((prev) => beginHelpNavigation(prev, topic))
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) {
        setHelpState((prev) =>
          failHelpNavigation(prev, topic, 'Octave bridge unavailable'),
        )
        return
      }
      const { output, error } = await bridge.octaveExecute(buildHelpFetchCommand(topic))
      const body = extractHelpBody(output || '') ?? (error || output || '').trim()
      if (!body) {
        setHelpState((prev) => failHelpNavigation(prev, topic, 'No help found.'))
        return
      }
      setHelpState((prev) => completeHelpNavigation(prev, topic, body))
    } catch (err) {
      setHelpState((prev) =>
        failHelpNavigation(prev, topic, err instanceof Error ? err.message : String(err)),
      )
    }
  }, [])

  const handleHelpNavigate = useCallback(
    (topic: string) => {
      void fetchAndShowHelp(topic)
    },
    [fetchAndShowHelp],
  )

  const handleHelpBack = useCallback(() => {
    const { state: popped, previous } = popHelpHistory(helpStateRef.current)
    setHelpState(popped)
    if (previous) {
      // Re-fetch the previous topic (its content isn't cached; popping
      // the stack just restores the topic id). Fire-and-forget.
      void fetchAndShowHelp(previous)
    }
  }, [fetchAndShowHelp])

  const handleHelpClose = useCallback(() => {
    setHelpState((prev) => closeHelpState(prev))
  }, [])

  // US-033: Profiler handlers. Each handler dispatches an Octave command
  // via the preload bridge and updates the profiler panel state. Commands
  // are fire-and-forget — if Octave is disconnected we surface a friendly
  // error in the panel rather than silently no-op.
  const handleProfilerStart = useCallback(async () => {
    setProfilerError(null)
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) {
        setProfilerError('Octave is not running.')
        return
      }
      // Clear first so the next Report reflects only this run's data.
      await bridge.octaveExecute(buildProfileClearCommand()).catch(() => {})
      await bridge.octaveExecute(buildProfileStartCommand())
      setProfilerMode('running')
    } catch (err) {
      setProfilerError(String(err))
    }
  }, [])

  const handleProfilerStop = useCallback(async () => {
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) {
        setProfilerError('Octave is not running.')
        return
      }
      await bridge.octaveExecute(buildProfileStopCommand())
      setProfilerMode('stopped')
    } catch (err) {
      setProfilerError(String(err))
    }
  }, [])

  const handleProfilerReport = useCallback(async () => {
    setProfilerLoading(true)
    setProfilerError(null)
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) {
        setProfilerError('Octave is not running.')
        setProfilerEntries([])
        return
      }
      const result = await bridge.octaveExecute(buildProfileReportCommand())
      const parsed = parseProfileReport(result.output || '')
      if (parsed.ok) {
        setProfilerEntries(parsed.entries)
      } else {
        setProfilerError(parsed.error)
        setProfilerEntries([])
      }
    } catch (err) {
      setProfilerError(String(err))
      setProfilerEntries([])
    } finally {
      setProfilerLoading(false)
    }
  }, [])

  // US-033: Navigate to a function's source. Runs `which <name>` via the
  // Octave bridge and, if a path comes back, opens that file in the
  // editor. Silently no-ops for built-ins (which returns empty).
  const handleProfilerNavigate = useCallback(async (functionName: string) => {
    try {
      const bridge = window.matslop as typeof window.matslop | undefined
      if (!bridge?.octaveExecute) return
      const result = await bridge.octaveExecute(buildWhichCommand(functionName))
      const filePath = parseWhichOutput(result.output || '')
      if (filePath) {
        setPendingOpenPath(filePath)
      }
    } catch {
      // ignore
    }
  }, [])

  // US-033: test-only hooks so Playwright can drive the profiler panel
  // without a real Octave process behind the IPC. Mirrors the watches /
  // help-browser test hooks.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopOpenProfiler?: () => void
      __matslopCloseProfiler?: () => void
      __matslopSimulateProfilerEntries?: (entries: ProfilerEntry[]) => void
      __matslopSimulateProfilerError?: (error: string) => void
      __matslopSimulateProfilerMode?: (mode: ProfilerMode) => void
      __matslopProfilerState?: {
        mode: ProfilerMode
        entries: ProfilerEntry[]
        error: string | null
        open: boolean
      }
    }
    w.__matslopOpenProfiler = () => setProfilerOpen(true)
    w.__matslopCloseProfiler = () => setProfilerOpen(false)
    w.__matslopSimulateProfilerEntries = (entries) => {
      setProfilerEntries(entries)
      setProfilerError(null)
    }
    w.__matslopSimulateProfilerError = (error) => {
      setProfilerError(error)
      setProfilerEntries([])
    }
    w.__matslopSimulateProfilerMode = (mode) => setProfilerMode(mode)
    w.__matslopProfilerState = {
      mode: profilerMode,
      entries: profilerEntries,
      error: profilerError,
      open: profilerOpen,
    }
    return () => {
      const ww = w as unknown as { __matslopProfilerState?: unknown }
      ww.__matslopProfilerState = null
    }
  }, [profilerMode, profilerEntries, profilerError, profilerOpen])

  // US-031: command-window hook — CommandWindow forwards intercepted
  // `doc <name>` / `help <name>` inputs here so App owns the help flow.
  const handleDocCommand = useCallback(
    (topic: string) => {
      void fetchAndShowHelp(topic)
    },
    [fetchAndShowHelp],
  )

  // US-031: test-only hooks mirroring the call-stack / watches patterns.
  // `__matslopOpenHelp(topic, rawBody?)` lets Playwright populate the
  // panel without needing a real Octave process; pass only `topic` to
  // exercise the loading branch. `__matslopHelpState` mirrors the
  // current state so tests can inspect history-stack transitions.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopOpenHelp?: (topic: string, body?: string) => void
      __matslopSimulateHelpContent?: (topic: string, body: string) => void
      __matslopSimulateHelpError?: (topic: string, error: string) => void
      __matslopCloseHelp?: () => void
      __matslopHelpState?: HelpState
    }
    w.__matslopOpenHelp = (topic: string, body?: string) => {
      setHelpState((prev) => {
        const next = beginHelpNavigation(prev, topic)
        if (body != null) {
          return completeHelpNavigation(next, topic, body)
        }
        return next
      })
    }
    w.__matslopSimulateHelpContent = (topic: string, body: string) => {
      setHelpState((prev) => completeHelpNavigation(prev, topic, body))
    }
    w.__matslopSimulateHelpError = (topic: string, error: string) => {
      setHelpState((prev) => failHelpNavigation(prev, topic, error))
    }
    w.__matslopCloseHelp = () => {
      setHelpState(() => EMPTY_HELP_STATE)
    }
    w.__matslopHelpState = helpState
    return () => {
      const ww = window as unknown as { __matslopHelpState?: unknown }
      ww.__matslopHelpState = null
    }
  }, [helpState])

  // US-032: Global Ctrl+Shift+F shortcut toggles the Find-in-Files
  // panel. Registered in capture phase so it wins over Monaco's built-in
  // shortcuts (Monaco binds Ctrl+Shift+F to "format document" by default).
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        e.stopPropagation()
        setFindInFilesOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // US-032: test hooks for Find in Files. Mirrors the help-panel pattern
  // so Playwright can open the panel, inspect its mounted state, and
  // drive the "click a result" path without synthesizing keyboard events
  // (which don't always propagate through Monaco's shadow DOM in tests).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopOpenFindInFiles?: () => void
      __matslopCloseFindInFiles?: () => void
      __matslopFindInFilesOpen?: boolean
    }
    w.__matslopOpenFindInFiles = () => setFindInFilesOpen(true)
    w.__matslopCloseFindInFiles = () => setFindInFilesOpen(false)
    w.__matslopFindInFilesOpen = findInFilesOpen
    return () => {
      const ww = window as unknown as { __matslopFindInFilesOpen?: boolean }
      ww.__matslopFindInFilesOpen = undefined
    }
  }, [findInFilesOpen])

  // US-037: refresh git status badges whenever cwd changes or the
  // source-control panel commits/stages. Writes absolute-path → badge
  // into `gitBadges` which FileBrowser consumes for overlay paint.
  const refreshGitBadges = useCallback(async () => {
    if (!cwd) {
      setGitBadges(new Map())
      return
    }
    try {
      const result = await window.matslop.gitStatus(cwd)
      if (!result.isRepo) {
        setGitBadges(new Map())
        return
      }
      const map = new Map<string, string>()
      for (const entry of result.entries) {
        if (entry.badge) map.set(entry.path, entry.badge)
      }
      setGitBadges(map)
    } catch {
      setGitBadges(new Map())
    }
  }, [cwd])

  useEffect(() => {
    void refreshGitBadges()
  }, [refreshGitBadges])

  useEffect(() => {
    const w = window as unknown as { __matslopRefreshGitBadges?: () => Promise<void> }
    w.__matslopRefreshGitBadges = async () => {
      await refreshGitBadges()
    }
    return () => {
      delete (window as unknown as { __matslopRefreshGitBadges?: unknown }).__matslopRefreshGitBadges
    }
  }, [refreshGitBadges])

  // US-037: test hooks for Source Control panel.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopOpenSourceControl?: () => void
      __matslopCloseSourceControl?: () => void
      __matslopSourceControlOpen?: boolean
    }
    w.__matslopOpenSourceControl = () => setSourceControlOpen(true)
    w.__matslopCloseSourceControl = () => setSourceControlOpen(false)
    w.__matslopSourceControlOpen = sourceControlOpen
    return () => {
      const ww = window as unknown as { __matslopSourceControlOpen?: boolean }
      ww.__matslopSourceControlOpen = undefined
    }
  }, [sourceControlOpen])

  // US-025: derive dock visibility from app state. Optional panels
  // (Call Stack, Watches, Figure) are auto-shown based on state
  // transitions — they match the conditional-mount rules that the old
  // Allotment layout enforced via `visible={...}`.
  const octaveCtx = useMemo(
    () => ({ engineStatus: octaveStatus.engineStatus }),
    [octaveStatus.engineStatus],
  )

  // US-L02: AppContext carries all dynamic state that panels previously
  // received as frozen props through rc-dock's loadTab cache. Panels now
  // read from this context instead, so data updates bypass rc-dock's
  // PureComponent optimisation without forcing a full layout rebuild.
  const appCtx: AppContextValue = useMemo(
    () => ({
      helpTopic: helpState.topic,
      helpContent: helpState.content,
      helpError: helpState.error,
      helpLoading: helpState.loading,
      helpCanGoBack: helpState.history.length > 0,
      onHelpNavigate: handleHelpNavigate,
      onHelpBack: handleHelpBack,
      onHelpClose: handleHelpClose,

      profilerMode,
      profilerEntries,
      profilerError,
      profilerLoading,
      onProfilerStart: handleProfilerStart,
      onProfilerStop: handleProfilerStop,
      onProfilerReport: handleProfilerReport,
      onProfilerNavigate: handleProfilerNavigate,
      onProfilerClose: () => setProfilerOpen(false),

      cwd,

      pendingOpenPath,
      pendingOpenLine,
      onFileOpened: handleFileOpened,
    }),
    [
      helpState.topic,
      helpState.content,
      helpState.error,
      helpState.loading,
      helpState.history.length,
      handleHelpNavigate,
      handleHelpBack,
      handleHelpClose,
      profilerMode,
      profilerEntries,
      profilerError,
      profilerLoading,
      handleProfilerStart,
      handleProfilerStop,
      handleProfilerReport,
      handleProfilerNavigate,
      cwd,
      pendingOpenPath,
      pendingOpenLine,
      handleFileOpened,
    ],
  )

  const dockVisibility: DockVisibility = useMemo(
    () => ({
      fileBrowser: visibility.fileBrowser,
      commandWindow: visibility.commandWindow,
      commandHistory: visibility.commandHistory,
      workspace: visibility.workspace,
      callStack: pausedLocation !== null,
      watches: watches.length > 0 || pausedLocation !== null,
      figure: figures.length > 0,
      helpBrowser: helpState.topic !== null,
      findInFiles: findInFilesOpen,
      profiler: profilerOpen,
      sourceControl: sourceControlOpen,
    }),
    [
      visibility.fileBrowser,
      visibility.commandWindow,
      visibility.commandHistory,
      visibility.workspace,
      pausedLocation,
      watches.length,
      figures.length,
      helpState.topic,
      findInFilesOpen,
      profilerOpen,
      sourceControlOpen,
    ],
  )

  return (
    <div className="app">
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
      {showSavePresetDialog && (
        <SavePresetDialog
          existingNames={customPresetNames}
          onCancel={() => setShowSavePresetDialog(false)}
          onSave={(name) => {
            void handleSaveLayoutPreset(name)
          }}
        />
      )}
      {inspectedVariable && (
        <VariableInspectorDialog
          variable={inspectedVariable}
          onClose={() => setInspectedVariable(null)}
        />
      )}
      {/* US-041: Auto-update notification banner. Renders null when idle,
          so it consumes no layout space until an update is available. */}
      <UpdateBanner />
      <OctaveContext.Provider value={octaveCtx}>
      <AppContext.Provider value={appCtx}>
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
          savedDockLayout={savedDockLayout as never}
          onDockLayoutChange={handleDockLayoutChange}
          detachedPanels={detachedPanels}
          onDetachTab={handleDetachTab}
          fileBrowser={
            dockVisibility.fileBrowser ? (
              <FileBrowser
                onCollapse={() => togglePanel('fileBrowser')}
                onOpenFile={handleFileBrowserOpen}
                onCwdChange={handleCwdChange}
                externalCwd={cwd}
                gitBadges={gitBadges}
              />
            ) : null
          }
          editor={
            <EditorPanel
              panelVisibility={visibility}
              onTogglePanel={togglePanel}
              openFilePath={pendingOpenPath}
              openFileLine={pendingOpenLine}
              onFileOpened={handleFileOpened}
              onCursorPositionChange={handleCursorPositionChange}
              onErrorCountChange={handleErrorCountChange}
              engineStatus={octaveStatus.engineStatus}
              onRun={handleRunScript}
              onStop={handleStop}
              onPauseForDebug={handlePauseForDebug}
              onRunSection={handleRunSection}
              onDebugAction={handleDebugAction}
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
                onDocCommand={handleDocCommand}
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
          profiler={
            dockVisibility.profiler ? (
              /* US-L02: ProfilerPanel reads all dynamic state from AppContext. */
              <ProfilerPanel />
            ) : null
          }
          sourceControl={
            dockVisibility.sourceControl ? (
              /* US-L02: SourceControlPanel reads cwd from AppContext. */
              <SourceControlPanel
                onClose={() => setSourceControlOpen(false)}
              />
            ) : null
          }
          findInFiles={
            dockVisibility.findInFiles ? (
              /* US-L02: FindInFilesPanel reads cwd from AppContext. */
              <FindInFilesPanel
                onOpenMatch={(filePath, line) => {
                  setPendingOpenLine(line)
                  setPendingOpenPath(filePath)
                }}
                onClose={() => setFindInFilesOpen(false)}
              />
            ) : null
          }
          helpBrowser={
            dockVisibility.helpBrowser ? (
              /* US-L02: HelpPanel reads all dynamic state from AppContext.
                 No data props needed — rc-dock's cached element stays
                 up-to-date via context propagation. */
              <HelpPanel />
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
      {/* US-P04: dismissible "GNU Octave Not Found" banner. Mounted above
          the status bar so the dock layout remains fully usable on first
          launch even when Octave is not configured yet. */}
      {octaveBannerVisible && (
        <div
          className="octave-not-found-banner"
          data-testid="octave-not-found-banner"
          role="status"
          aria-live="polite"
        >
          <span className="octave-not-found-banner-icon" aria-hidden="true">⚠</span>
          <span className="octave-not-found-banner-text">
            <strong>GNU Octave was not detected.</strong>{' '}
            MatSlop needs the <code>octave-cli</code> binary to run code.
            {octaveBannerError && (
              <span
                className="octave-not-found-banner-error"
                data-testid="octave-not-found-banner-error"
              >
                {' '}— {octaveBannerError}
              </span>
            )}
          </span>
          <button
            type="button"
            className="octave-not-found-banner-btn octave-not-found-banner-btn-primary"
            data-testid="octave-not-found-banner-browse"
            onClick={() => { void handleOctaveBannerBrowse() }}
          >
            Browse for octave-cli...
          </button>
          <button
            type="button"
            className="octave-not-found-banner-btn"
            data-testid="octave-not-found-banner-dismiss"
            onClick={handleOctaveBannerDismiss}
          >
            Dismiss
          </button>
        </div>
      )}
      <StatusBar
        cwd={cwd}
        engineStatus={octaveStatus.engineStatus}
        cursorPosition={cursorPosition}
        errorCount={errorCount}
        debugPaused={pausedLocation !== null}
        running={octaveBusyState === 'running'}
      />
      </AppContext.Provider>
      </OctaveContext.Provider>
    </div>
  )
}

export default App
