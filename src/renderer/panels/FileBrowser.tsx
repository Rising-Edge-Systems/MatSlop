import PanelHeader from './PanelHeader'

interface FileBrowserProps {
  onCollapse: () => void
}

function FileBrowser({ onCollapse }: FileBrowserProps): React.JSX.Element {
  return (
    <div className="panel file-browser">
      <PanelHeader title="File Browser" onCollapse={onCollapse} />
      <div className="panel-content">
        <p className="placeholder-text">Files will appear here</p>
      </div>
    </div>
  )
}

export default FileBrowser
