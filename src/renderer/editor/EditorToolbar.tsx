import {
  FilePlus,
  FolderOpen,
  Save,
  Play,
  Pause,
  Square,
  LayoutList,
  FastForward,
  Redo2,
  ArrowDownToLine,
  SkipForward,
} from 'lucide-react'
import { useOctaveStatus } from '../OctaveContext'
import type { DebugAction } from './debugCommands'

interface EditorToolbarProps {
  hasActiveFile: boolean
  /** True when the active file is a live script (.mls) — enables section-run buttons. */
  isLiveScript?: boolean
  onNewFile: () => void
  onOpenFile: () => void
  onSave: () => void
  onRun: () => void
  onStop: () => void
  onRunSection: () => void
  /** US-029: Run the section at the cursor then advance to the next section. */
  onRunAndAdvance?: () => void
  /** US-020: Pause a running script and drop into the debugger. */
  onPauseForDebug?: () => void
  /** US-020: True while the debugger is already paused — hides the Pause button. */
  debugPaused?: boolean
  /** Debug action callback (Step, Step In, Step Out, Continue). */
  onDebugAction?: (action: DebugAction) => void
}

function EditorToolbar({
  hasActiveFile,
  isLiveScript = false,
  onNewFile,
  onOpenFile,
  onSave,
  onRun,
  onStop,
  onRunSection,
  onRunAndAdvance,
  onPauseForDebug,
  debugPaused = false,
  onDebugAction,
}: EditorToolbarProps): React.JSX.Element {
  const engineStatus = useOctaveStatus()
  const isBusy = engineStatus === 'busy'
  const runDisabled = !hasActiveFile || isBusy || engineStatus === 'disconnected'
  const stopDisabled = !isBusy && !debugPaused
  const pauseDisabled = !isBusy || debugPaused
  const stepDisabled = !debugPaused
  const sectionDisabled = runDisabled || !isLiveScript

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
        onClick={debugPaused ? () => onDebugAction?.('continue') : onRun}
        title={debugPaused ? "Continue (F5)" : "Run (F5)"}
        disabled={debugPaused ? false : runDisabled}
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
      <div className="toolbar-separator" />
      <button
        className="toolbar-btn"
        onClick={() => onDebugAction?.('stepOver')}
        title="Step Over (F10)"
        data-testid="toolbar-step-over"
        disabled={stepDisabled}
      >
        <Redo2 size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={() => onDebugAction?.('stepIn')}
        title="Step Into (F11)"
        data-testid="toolbar-step-in"
        disabled={stepDisabled}
      >
        <ArrowDownToLine size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={() => onDebugAction?.('stepOut')}
        title="Step Out (Shift+F11)"
        data-testid="toolbar-step-out"
        disabled={stepDisabled}
      >
        <SkipForward size={16} />
      </button>
      <div className="toolbar-separator" />
      <button
        className="toolbar-btn"
        onClick={onRunSection}
        title="Run Section (Ctrl+Enter)"
        data-testid="toolbar-run-section"
        disabled={sectionDisabled}
      >
        <LayoutList size={16} />
      </button>
      <button
        className="toolbar-btn"
        onClick={onRunAndAdvance}
        title="Run Section and Advance (Ctrl+Shift+Enter)"
        data-testid="toolbar-run-and-advance"
        disabled={sectionDisabled || !onRunAndAdvance}
      >
        <FastForward size={16} />
      </button>
    </div>
  )
}

export default EditorToolbar
