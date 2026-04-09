import { useState } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import FileBrowser from './panels/FileBrowser'
import EditorPanel from './panels/EditorPanel'
import WorkspacePanel from './panels/WorkspacePanel'
import CommandWindow from './panels/CommandWindow'

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

  const togglePanel = (panel: keyof PanelVisibility) => {
    setVisibility((prev) => ({ ...prev, [panel]: !prev[panel] }))
  }

  return (
    <div className="app">
      {/* Outer horizontal split: File Browser | Main Area */}
      <Allotment>
        <Allotment.Pane
          minSize={150}
          preferredSize={220}
          snap
          visible={visibility.fileBrowser}
        >
          <FileBrowser onCollapse={() => togglePanel('fileBrowser')} />
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
