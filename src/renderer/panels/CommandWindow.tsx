import PanelHeader from './PanelHeader'

interface CommandWindowProps {
  onCollapse: () => void
}

function CommandWindow({ onCollapse }: CommandWindowProps): React.JSX.Element {
  return (
    <div className="panel command-window">
      <PanelHeader title="Command Window" onCollapse={onCollapse} />
      <div className="panel-content">
        <p className="placeholder-text">&gt;&gt; </p>
      </div>
    </div>
  )
}

export default CommandWindow
