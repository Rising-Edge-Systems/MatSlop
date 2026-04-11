interface PanelHeaderProps {
  title: string
  onCollapse?: () => void
  /**
   * Optional extra controls rendered between the title and the collapse
   * button (e.g. a refresh button on the Watches panel).
   */
  actions?: React.ReactNode
}

function PanelHeader({ title, onCollapse, actions }: PanelHeaderProps): React.JSX.Element {
  return (
    <div className="panel-header">
      <span className="panel-title">{title}</span>
      {actions}
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
