import { useMemo } from 'react'
import { useAppContext } from '../AppContext'

/**
 * US-018: A single frame reported by Octave's `dbstack()` and surfaced via
 * the main-process `debug:getCallStack` IPC. Field semantics match
 * `src/main/callStack.ts`.
 */
export interface CallStackFrame {
  name: string
  file: string
  line: number
}

interface CallStackPanelProps {
  /** Top-to-bottom list of frames. Empty = show the idle "not paused" state. */
  frames?: CallStackFrame[]
  /** Index of the currently-selected frame (highlighted); -1 when none. */
  selectedIndex?: number
  /** Called with a frame index when the user clicks a row. */
  onSelectFrame?: (index: number) => void
  /** Called when the ✕ button is clicked (collapse this panel). */
  onCollapse?: () => void
}

function basename(filePath: string): string {
  if (!filePath) return ''
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep >= 0 ? filePath.substring(lastSep + 1) : filePath
}

/**
 * US-018: Call-stack sidebar panel. Renders one row per dbstack frame
 * with the function name, file basename and line. Rows are clickable and
 * announce themselves as buttons so keyboard users can navigate.
 */
function CallStackPanel({
  frames: framesProp,
  selectedIndex: selectedIndexProp,
  onSelectFrame: onSelectFrameProp,
  onCollapse,
}: CallStackPanelProps): React.JSX.Element {
  // US-SC04: Read dynamic state from AppContext (bypasses rc-dock caching)
  const ctx = useAppContext()
  const frames = (ctx.callStack as CallStackFrame[]) ?? framesProp ?? []
  const selectedIndex = ctx.callStackSelected ?? selectedIndexProp ?? -1
  const onSelectFrame = ctx.onCallStackSelect ?? onSelectFrameProp ?? (() => {})
  const rows = useMemo(() => {
    return frames.map((f, i) => {
      const short = basename(f.file) || '<anonymous>'
      return {
        key: `${i}:${f.name}:${f.line}:${f.file}`,
        index: i,
        name: f.name || '<anonymous>',
        fileBase: short,
        fileFull: f.file,
        line: f.line,
      }
    })
  }, [frames])

  return (
    <div className="call-stack-panel" data-testid="call-stack-panel">
      <div className="call-stack-body" data-testid="call-stack-body">
        {rows.length === 0 ? (
          <div className="call-stack-empty" data-testid="call-stack-empty">
            Not paused. Frames appear here when execution stops at a breakpoint.
          </div>
        ) : (
          <ul className="call-stack-list" role="list">
            {rows.map((row) => {
              const active = row.index === selectedIndex
              return (
                <li
                  key={row.key}
                  className={active ? 'call-stack-row active' : 'call-stack-row'}
                  data-testid="call-stack-row"
                  data-frame-index={row.index}
                  data-frame-name={row.name}
                  data-frame-file={row.fileFull}
                  data-frame-line={row.line}
                >
                  <button
                    type="button"
                    className="call-stack-row-btn"
                    onClick={() => onSelectFrame(row.index)}
                    title={`${row.name}  (${row.fileFull || 'no file'}:${row.line})`}
                  >
                    <span className="call-stack-name">{row.name}</span>
                    <span className="call-stack-location">
                      {row.fileBase}:{row.line}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export default CallStackPanel
