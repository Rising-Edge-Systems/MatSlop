/**
 * US-017: Debug toolbar.
 *
 * A small row of buttons (Continue / Step / Step In / Step Out / Stop) that
 * only renders when Octave is paused at a breakpoint. Each button calls
 * `onAction(action)` — App.tsx owns the actual command dispatch so it can
 * also clear the paused-location state and track commands for tests.
 */

import type { DebugAction } from './debugCommands'

interface DebugToolbarProps {
  onAction: (action: DebugAction) => void
  /** Optional label shown next to the buttons, e.g. "hello.m:4". */
  pausedLabel?: string
}

interface ButtonSpec {
  action: DebugAction
  label: string
  shortcut: string
  testid: string
  icon: string
}

const BUTTONS: ButtonSpec[] = [
  { action: 'continue', label: 'Continue', shortcut: 'F5', testid: 'debug-continue', icon: '▶' },
  { action: 'stepOver', label: 'Step', shortcut: 'F10', testid: 'debug-step-over', icon: '⤼' },
  { action: 'stepIn', label: 'Step In', shortcut: 'F11', testid: 'debug-step-in', icon: '↳' },
  { action: 'stepOut', label: 'Step Out', shortcut: 'Shift+F11', testid: 'debug-step-out', icon: '↱' },
  { action: 'stop', label: 'Stop', shortcut: 'Shift+F5', testid: 'debug-stop', icon: '■' },
]

function DebugToolbar({ onAction, pausedLabel }: DebugToolbarProps): React.JSX.Element {
  return (
    <div className="debug-toolbar" data-testid="debug-toolbar" role="toolbar" aria-label="Debugger">
      <span className="debug-toolbar-label">
        <span className="status-dot" style={{ backgroundColor: '#4caf50' }} />
        Debug{pausedLabel ? `: ${pausedLabel}` : ''}
      </span>
      {BUTTONS.map((b) => (
        <button
          key={b.action}
          type="button"
          className="debug-toolbar-btn"
          data-testid={b.testid}
          title={`${b.label} (${b.shortcut})`}
          onClick={() => onAction(b.action)}
        >
          <span className="debug-toolbar-icon" aria-hidden="true">
            {b.icon}
          </span>
          <span className="debug-toolbar-text">{b.label}</span>
        </button>
      ))}
    </div>
  )
}

export default DebugToolbar
