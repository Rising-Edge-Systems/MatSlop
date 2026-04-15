import { useState, useRef, useEffect } from 'react'
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
  ChevronDown,
} from 'lucide-react'
import { useOctaveStatus } from '../OctaveContext'
import type { DebugAction } from './debugCommands'

interface EditorToolbarProps {
  hasActiveFile: boolean
  /** True when the active file is a live script (.mls) — enables section-run buttons. */
  isLiveScript?: boolean
  onNewFile: () => void
  onNewLiveScript: () => void
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
  onNewLiveScript,
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

  const [newFileOpen, setNewFileOpen] = useState(false)
  const newFileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!newFileOpen) return
    const handleClick = (e: MouseEvent) => {
      if (newFileRef.current && !newFileRef.current.contains(e.target as Node)) {
        setNewFileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [newFileOpen])

  return (
    <div className="editor-toolbar">
      <div className="toolbar-split-btn" ref={newFileRef}>
        <button
          className="toolbar-btn"
          onClick={onNewFile}
          title="New Script (Ctrl+N)"
        >
          <FilePlus size={16} />
        </button>
        <button
          className="toolbar-btn toolbar-split-chevron"
          onClick={() => setNewFileOpen((v) => !v)}
          title="New file options"
        >
          <ChevronDown size={10} />
        </button>
        {newFileOpen && (
          <div className="toolbar-dropdown">
            <button
              className="toolbar-dropdown-item"
              onClick={() => { onNewFile(); setNewFileOpen(false) }}
            >
              Script (.m)
            </button>
            <button
              className="toolbar-dropdown-item"
              onClick={() => { onNewLiveScript(); setNewFileOpen(false) }}
            >
              Live Script (.mls)
            </button>
          </div>
        )}
      </div>
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
