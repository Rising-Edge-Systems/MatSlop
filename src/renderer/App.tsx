import { useState, useCallback, useEffect } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow from './panels/CommandWindow'
import OctaveSetupDialog from './dialogs/OctaveSetupDialog'

export interface OctaveStatus {
  path: string | null
  version: string | null
  configured: boolean
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
  const [octaveStatus, setOctaveStatus] = useState<OctaveStatus>({ path: null, version: null, configured: false })
  const [showOctaveSetup, setShowOctaveSetup] = useState(false)

  useEffect(() => {
    // Check if Octave is already configured on startup
    window.matslop.octaveGetPath().then(async (storedPath) => {
      if (storedPath) {
        const result = await window.matslop.octaveValidate(storedPath)
        if (result.valid) {
          setOctaveStatus({ path: storedPath, version: result.version ?? 'unknown', configured: true })
          return
        }
      }
      // Not configured or invalid — show setup dialog
      setShowOctaveSetup(true)
    })
  }, [])

  const handleOctaveConfigured = useCallback((path: string, version: string) => {
    setOctaveStatus({ path, version, configured: true })
    setShowOctaveSetup(false)
  }, [])

  const togglePanel = (panel: keyof PanelVisibility) => {
    setVisibility((prev) => ({ ...prev, [panel]: !prev[panel] }))
  }

  const handleFileBrowserOpen = useCallback((filePath: string) => {
    setPendingOpenPath(filePath)
  }, [])

  const handleFileOpened = useCallback(() => {
    setPendingOpenPath(null)
  }, [])

  return (
    <div className="app">
      {showOctaveSetup && <OctaveSetupDialog onConfigured={handleOctaveConfigured} />}
      {/* Outer horizontal split: File Browser | Main Area */}
      <Allotment>
        <Allotment.Pane
          minSize={150}
          preferredSize={220}
          snap
          visible={visibility.fileBrowser}
        >
          <FileBrowser onCollapse={() => togglePanel('fileBrowser')} onOpenFile={handleFileBrowserOpen} />
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
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  )
}

export default App
