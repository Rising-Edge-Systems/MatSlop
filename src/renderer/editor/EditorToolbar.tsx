import {
  FilePlus,
  FolderOpen,
  Save,
  Play,
  Pause,
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
  /** US-020: Pause a running script and drop into the debugger. */
  onPauseForDebug?: () => void
  /** US-020: True while the debugger is already paused — hides the Pause button. */
  debugPaused?: boolean
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
  onPauseForDebug,
  debugPaused = false,
}: EditorToolbarProps): React.JSX.Element {
  const isBusy = engineStatus === 'busy'
  const runDisabled = !hasActiveFile || isBusy || engineStatus === 'disconnected'
  const stopDisabled = !isBusy
  // US-020: Pause button is only meaningful while a script is actively
  // running and we're not ALREADY in the debugger.
  const pauseDisabled = !isBusy || debugPaused

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
        className="toolbar-btn toolbar-btn-pause"
        onClick={onPauseForDebug}
        title="Pause (drop into debugger)"
        data-testid="toolbar-pause"
        disabled={pauseDisabled}
      >
        <Pause size={16} />
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
