import PanelHeader from './PanelHeader'

interface WorkspacePanelProps {
  onCollapse: () => void
}

function WorkspacePanel({ onCollapse }: WorkspacePanelProps): React.JSX.Element {
  return (
    <div className="panel workspace-panel">
      <PanelHeader title="Workspace" onCollapse={onCollapse} />
      <div className="panel-content">
        <p className="placeholder-text">Variables will appear here</p>
      </div>
    </div>
  )
}

export default WorkspacePanel
