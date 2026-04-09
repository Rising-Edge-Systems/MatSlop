import PanelHeader from './PanelHeader'

interface PanelVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
}

interface EditorPanelProps {
  panelVisibility: PanelVisibility
  onTogglePanel: (panel: keyof PanelVisibility) => void
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
}: EditorPanelProps): React.JSX.Element {
  const allPanels: { key: keyof PanelVisibility; label: string }[] = [
    { key: 'fileBrowser', label: 'File Browser' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'commandWindow', label: 'Command Window' },
  ]
  const hiddenPanels = allPanels.filter((p) => !panelVisibility[p.key])

  return (
    <div className="panel editor-panel">
      <PanelHeader title="Editor" />
      <div className="panel-content">
        <p className="placeholder-text">Editor will go here</p>
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
