import type { OctaveEngineStatus } from '../App'

export interface CursorPosition {
  line: number
  column: number
}

interface StatusBarProps {
  cwd: string
  engineStatus: OctaveEngineStatus
  cursorPosition: CursorPosition | null
  errorCount?: number
  /** US-016: surface "Debug: paused" when Octave is stopped at a breakpoint. */
  debugPaused?: boolean
}

const statusLabels: Record<OctaveEngineStatus, string> = {
  ready: 'Ready',
  busy: 'Busy',
  disconnected: 'Disconnected',
}

const statusColors: Record<OctaveEngineStatus, string> = {
  ready: '#4ec9b0',
  busy: '#dcdcaa',
  disconnected: '#f48771',
}

function StatusBar({ cwd, engineStatus, cursorPosition, errorCount = 0, debugPaused = false }: StatusBarProps): React.JSX.Element {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-item status-bar-cwd" title={cwd}>
          {cwd}
        </span>
        {debugPaused && (
          <span
            className="status-bar-item status-bar-debug-paused"
            data-testid="status-debug-paused"
          >
            <span className="status-dot" style={{ backgroundColor: '#4caf50' }} />
            Debug: paused
          </span>
        )}
      </div>
      <div className="status-bar-right">
        {errorCount > 0 && (
          <span className="status-bar-item status-bar-errors">
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
        <span className="status-bar-item" data-testid="engine-status">
          <span
            className="status-dot"
            style={{ backgroundColor: statusColors[engineStatus] }}
          />
          {statusLabels[engineStatus]}
        </span>
        {cursorPosition && (
          <span className="status-bar-item">
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        )}
        <span className="status-bar-item">UTF-8</span>
      </div>
    </div>
  )
}

export default StatusBar
