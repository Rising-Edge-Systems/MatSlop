import type { OctaveEngineStatus } from '../App'

export interface CursorPosition {
  line: number
  column: number
}

interface StatusBarProps {
  cwd: string
  engineStatus: OctaveEngineStatus
  cursorPosition: CursorPosition | null
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

function StatusBar({ cwd, engineStatus, cursorPosition }: StatusBarProps): React.JSX.Element {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-item status-bar-cwd" title={cwd}>
          {cwd}
        </span>
      </div>
      <div className="status-bar-right">
        <span className="status-bar-item">
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
