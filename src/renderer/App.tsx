import { useState, useCallback, useEffect, useRef } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow, { type PendingCommand } from './panels/CommandWindow'
import StatusBar from './panels/StatusBar'
import type { CursorPosition } from './panels/StatusBar'
import OctaveSetupDialog from './dialogs/OctaveSetupDialog'

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
}

function App(): React.JSX.Element {
  const [visibility, setVisibility] = useState<PanelVisibility>({
    fileBrowser: true,
    workspace: true,
    commandWindow: true,
  })
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null)
  const [octaveStatus, setOctaveStatus] = useState<OctaveStatus>({ path: null, version: null, configured: false, engineStatus: 'disconnected' })
  const [showOctaveSetup, setShowOctaveSetup] = useState(false)
  const [cwd, setCwd] = useState('')
  const [cursorPosition, setCursorPosition] = useState<CursorPosition | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const pendingCommandIdRef = useRef(0)

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

  useEffect(() => {
    // Check if Octave is already configured on startup
    window.matslop.octaveGetPath().then(async (storedPath) => {
      if (storedPath) {
        const result = await window.matslop.octaveValidate(storedPath)
        if (result.valid) {
          setOctaveStatus({ path: storedPath, version: result.version ?? 'unknown', configured: true, engineStatus: 'disconnected' })
          // Auto-start the Octave process
          startOctaveProcess(storedPath)
          return
        }
      }
      // Not configured or invalid — show setup dialog
      setShowOctaveSetup(true)
    })
  }, [startOctaveProcess])

  const handleOctaveConfigured = useCallback((path: string, version: string) => {
    setOctaveStatus({ path, version, configured: true, engineStatus: 'disconnected' })
    setShowOctaveSetup(false)
    startOctaveProcess(path)
  }, [startOctaveProcess])

  const togglePanel = (panel: keyof PanelVisibility) => {
    setVisibility((prev) => ({ ...prev, [panel]: !prev[panel] }))
  }

  const handleFileBrowserOpen = useCallback((filePath: string) => {
    setPendingOpenPath(filePath)
  }, [])

  const handleFileOpened = useCallback(() => {
    setPendingOpenPath(null)
  }, [])

  const handleCwdChange = useCallback((newCwd: string) => {
    setCwd(newCwd)
    // Sync Octave's working directory when FileBrowser changes
    if (octaveStatus.engineStatus === 'ready') {
      const escapedDir = newCwd.replace(/'/g, "''")
      window.matslop.octaveExecute(`cd('${escapedDir}')`).catch(() => {
        // ignore cd errors
      })
    }
  }, [octaveStatus.engineStatus])

  const handleCursorPositionChange = useCallback((line: number, column: number) => {
    setCursorPosition({ line, column })
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

  const handleCommandExecuted = useCallback(async () => {
    // After each command, check if Octave's cwd changed and sync UI
    if (octaveStatus.engineStatus === 'disconnected') return
    try {
      const result = await window.matslop.octaveExecute('pwd')
      if (result.output) {
        // pwd output is like "ans = /some/path" or just "/some/path"
        const match = result.output.match(/ans = (.+)/) ?? result.output.match(/^\s*(.+)\s*$/m)
        if (match) {
          const octaveCwd = match[1].trim()
          if (octaveCwd && octaveCwd !== cwd) {
            setCwd(octaveCwd)
          }
        }
      }
    } catch {
      // ignore pwd query errors
    }
  }, [octaveStatus.engineStatus, cwd])

  return (
    <div className="app">
      {showOctaveSetup && <OctaveSetupDialog onConfigured={handleOctaveConfigured} />}
      <div className="app-main">
      {/* Outer horizontal split: File Browser | Main Area */}
      <Allotment>
        <Allotment.Pane
          minSize={150}
          preferredSize={220}
          snap
          visible={visibility.fileBrowser}
        >
          <FileBrowser onCollapse={() => togglePanel('fileBrowser')} onOpenFile={handleFileBrowserOpen} onCwdChange={handleCwdChange} externalCwd={cwd} />
        </Allotment.Pane>

        {/* Main area: vertical split of top and bottom */}
        <Allotment.Pane minSize={200}>
          <Allotment vertical>
            {/* Top area: horizontal split of Editor | Workspace */}
            <Allotment.Pane minSize={200}>
              <Allotment>
                <Allotment.Pane minSize={300}>
                  <EditorPanel
                    panelVisibility={visibility}
                    onTogglePanel={togglePanel}
                    openFilePath={pendingOpenPath}
                    onFileOpened={handleFileOpened}
                    onCursorPositionChange={handleCursorPositionChange}
                    engineStatus={octaveStatus.engineStatus}
                    onRun={handleRunScript}
                    onStop={handleStop}
                    onRunSection={handleRunSection}
                  />
                </Allotment.Pane>
                <Allotment.Pane
                  minSize={150}
                  preferredSize={280}
                  snap
                  visible={visibility.workspace}
                >
                  <WorkspacePanel onCollapse={() => togglePanel('workspace')} />
                </Allotment.Pane>
              </Allotment>
            </Allotment.Pane>

            {/* Bottom: Command Window */}
            <Allotment.Pane
              minSize={100}
              preferredSize={200}
              snap
              visible={visibility.commandWindow}
            >
              <CommandWindow
                onCollapse={() => togglePanel('commandWindow')}
                engineStatus={octaveStatus.engineStatus}
                pendingCommand={pendingCommand}
                onCommandExecuted={handleCommandExecuted}
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
      </div>
      <StatusBar
        cwd={cwd}
        engineStatus={octaveStatus.engineStatus}
        cursorPosition={cursorPosition}
      />
    </div>
  )
}

export default App
