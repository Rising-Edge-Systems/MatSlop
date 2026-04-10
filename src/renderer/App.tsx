import { useState, useCallback, useEffect, useRef } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow, { type PendingCommand } from './panels/CommandWindow'
import CommandHistoryPanel from './panels/CommandHistoryPanel'
import FigurePanel, { type FigureData } from './panels/FigurePanel'
import StatusBar from './panels/StatusBar'
import type { CursorPosition } from './panels/StatusBar'
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
    })

    return () => {
      unsubStatus()
      unsubCrash()
    }
  }, [])

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

  // Allotment size change handlers
  const handleOuterHorizontalChange = useCallback((sizes: number[]) => {
    if (sizes.length >= 2 && sizes[0] > 0) {
      setPanelSizes((prev) => {
        const next = { ...prev, fileBrowserWidth: Math.round(sizes[0]) }
        setVisibility((vis) => { saveLayout(vis, next); return vis })
        return next
      })
    }
  }, [saveLayout])

  const handleTopHorizontalChange = useCallback((sizes: number[]) => {
    if (sizes.length >= 2 && sizes[sizes.length - 1] > 0) {
      setPanelSizes((prev) => {
        const next = { ...prev, workspaceWidth: Math.round(sizes[sizes.length - 1]) }
        setVisibility((vis) => { saveLayout(vis, next); return vis })
        return next
      })
    }
  }, [saveLayout])

  const handleVerticalChange = useCallback((sizes: number[]) => {
    if (sizes.length >= 2 && sizes[1] > 0) {
      setPanelSizes((prev) => {
        const next = { ...prev, bottomHeight: Math.round(sizes[1]) }
        setVisibility((vis) => { saveLayout(vis, next); return vis })
        return next
      })
    }
  }, [saveLayout])

  const handleBottomHorizontalChange = useCallback((sizes: number[]) => {
    if (sizes.length >= 2 && sizes[sizes.length - 1] > 0) {
      setPanelSizes((prev) => {
        const next = { ...prev, commandHistoryWidth: Math.round(sizes[sizes.length - 1]) }
        setVisibility((vis) => { saveLayout(vis, next); return vis })
        return next
      })
    }
  }, [saveLayout])

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
      {/* Outer horizontal split: File Browser | Main Area */}
      {layoutLoaded && <Allotment onChange={handleOuterHorizontalChange}>
        <Allotment.Pane
          minSize={150}
          preferredSize={panelSizes.fileBrowserWidth}
          snap
          visible={visibility.fileBrowser}
        >
          <FileBrowser onCollapse={() => togglePanel('fileBrowser')} onOpenFile={handleFileBrowserOpen} onCwdChange={handleCwdChange} externalCwd={cwd} />
        </Allotment.Pane>

        {/* Main area: vertical split of top and bottom */}
        <Allotment.Pane minSize={200}>
          <Allotment vertical onChange={handleVerticalChange}>
            {/* Top area: horizontal split of Editor | Workspace */}
            <Allotment.Pane minSize={200}>
              <Allotment onChange={handleTopHorizontalChange}>
                <Allotment.Pane minSize={300}>
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
                    onRunSection={handleRunSection}
                    menuAction={menuAction}
                    onMenuActionConsumed={handleMenuActionConsumed}
                    editorTheme={resolvedTheme === 'light' ? 'vs-light' : 'vs-dark'}
                    editorSettings={editorSettings}
                  />
                </Allotment.Pane>
                <Allotment.Pane
                  minSize={150}
                  preferredSize={panelSizes.workspaceWidth}
                  snap
                  visible={visibility.workspace || figures.length > 0}
                >
                  <Allotment vertical>
                    <Allotment.Pane minSize={100} visible={visibility.workspace}>
                      <WorkspacePanel onCollapse={() => togglePanel('workspace')} engineStatus={octaveStatus.engineStatus} refreshTrigger={workspaceRefreshTrigger} onInspectVariable={handleInspectVariable} onVariablesChanged={handleVariablesChanged} />
                    </Allotment.Pane>
                    <Allotment.Pane minSize={100} visible={figures.length > 0}>
                      <FigurePanel figures={figures} onSaveFigure={handleSaveFigure} />
                    </Allotment.Pane>
                  </Allotment>
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>

            {/* Bottom: Command Window + Command History */}
            <Allotment.Pane
              minSize={100}
              preferredSize={panelSizes.bottomHeight}
              snap
              visible={visibility.commandWindow || visibility.commandHistory}
            >
              <Allotment onChange={handleBottomHorizontalChange}>
                <Allotment.Pane minSize={200} visible={visibility.commandWindow}>
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
                </Allotment.Pane>
                <Allotment.Pane minSize={150} preferredSize={panelSizes.commandHistoryWidth} snap visible={visibility.commandHistory}>
                  <CommandHistoryPanel
                    onCollapse={() => togglePanel('commandHistory')}
                    onExecuteCommand={handleHistoryExecute}
                    historyVersion={historyVersion}
                  />
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>}
      </div>
      <StatusBar
        cwd={cwd}
        engineStatus={octaveStatus.engineStatus}
        cursorPosition={cursorPosition}
        errorCount={errorCount}
      />
    </div>
  )
}

export default App
