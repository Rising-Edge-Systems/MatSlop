interface PanelHeaderProps {
  title: string
  onCollapse?: () => void
}

function PanelHeader({ title, onCollapse }: PanelHeaderProps): React.JSX.Element {
  return (
    <div className="panel-header">
      <span className="panel-title">{title}</span>
      {onCollapse && (
        <button
          className="panel-collapse-btn"
          onClick={onCollapse}
          title={`Collapse ${title}`}
          aria-label={`Collapse ${title}`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default PanelHeader
