import {
  FilePlus,
  FolderOpen,
  Save,
  Play,
  Square,
  LayoutList,
} from 'lucide-react'
import type { OctaveEngineStatus } from '../App'

interface EditorToolbarProps {
  hasActiveFile: boolean
  engineStatus: OctaveEngineStatus
  onNewFile: () => void
  onOpenFile: () => void
  onSave: () => void
  onRun: () => void
  onStop: () => void
  onRunSection: () => void
}

function EditorToolbar({
  hasActiveFile,
  engineStatus,
  onNewFile,
  onOpenFile,
  onSave,
  onRun,
  onStop,
  onRunSection,
}: EditorToolbarProps): React.JSX.Element {
  const isBusy = engineStatus === 'busy'
  const runDisabled = !hasActiveFile || isBusy || engineStatus === 'disconnected'
  const stopDisabled = !isBusy

  return (
    <div className="editor-toolbar">
      <button
        className="toolbar-btn"
        onClick={onNewFile}
        title="New File (Ctrl+N)"
      >
        <FilePlus size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={onOpenFile}
        title="Open File (Ctrl+O)"
      >
        <FolderOpen size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={onSave}
        title="Save (Ctrl+S)"
        disabled={!hasActiveFile}
      >
        <Save size={16} />
      </button>
      <div className="toolbar-separator" />
      <button
        className="toolbar-btn toolbar-btn-run"
        onClick={onRun}
        title="Run (F5)"
        disabled={runDisabled}
      >
        <Play size={16} />
      </button>
      <button
        className="toolbar-btn toolbar-btn-stop"
        onClick={onStop}
        title="Stop Execution"
        disabled={stopDisabled}
      >
        <Square size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={onRunSection}
        title="Run Section (Ctrl+Enter)"
        disabled={runDisabled}
      >
        <LayoutList size={16} />
      </button>
    </div>
  )
}

export default EditorToolbar
