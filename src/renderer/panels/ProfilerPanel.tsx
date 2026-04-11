import { useState, useMemo, useCallback } from 'react'
import {
  formatProfileTime,
  sortProfileEntries,
  type ProfilerEntry,
  type ProfilerMode,
} from '../editor/profilerStore'

/**
 * US-033: Profiler panel. Shows Start/Stop/Report controls and a sortable
 * function × time table from `profile('info')`.
 *
 * All Octave interaction is owned by App.tsx — this component is a dumb
 * renderer over the state reducers in profilerStore.ts. Clicking a row's
 * function name asks the host to `which` the symbol and open the
 * resulting path in the editor.
 */
export interface ProfilerPanelProps {
  mode: ProfilerMode
  entries: ProfilerEntry[]
  error: string | null
  loading: boolean
  onStart: () => void
  onStop: () => void
  onReport: () => void
  onNavigate: (functionName: string) => void
  onClose?: () => void
}

type SortKey = 'totalTime' | 'numCalls' | 'functionName'

function ProfilerPanel({
  mode,
  entries,
  error,
  loading,
  onStart,
  onStop,
  onReport,
  onNavigate,
  onClose,
}: ProfilerPanelProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('totalTime')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(
    () => sortProfileEntries(entries, sortKey, sortDir),
    [entries, sortKey, sortDir],
  )

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir(key === 'functionName' ? 'asc' : 'desc')
      }
    },
    [sortKey],
  )

  const sortIndicator = (key: SortKey): string =>
    key === sortKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div className="profiler-panel" data-testid="profiler-panel">
      <div className="profiler-toolbar" data-testid="profiler-toolbar">
        <button
          type="button"
          className="profiler-start-btn"
          data-testid="profiler-start"
          data-mode={mode}
          onClick={onStart}
          disabled={mode === 'running'}
          title="profile on"
        >
          ▶ Start
        </button>
        <button
          type="button"
          className="profiler-stop-btn"
          data-testid="profiler-stop"
          onClick={onStop}
          disabled={mode !== 'running'}
          title="profile off"
        >
          ■ Stop
        </button>
        <button
          type="button"
          className="profiler-report-btn"
          data-testid="profiler-report"
          onClick={onReport}
          disabled={loading}
          title="profile('info')"
        >
          ⟳ Report
        </button>
        <span
          className="profiler-mode"
          data-testid="profiler-mode"
          data-mode={mode}
        >
          {mode === 'running' ? 'Recording…' : mode === 'stopped' ? 'Stopped' : 'Idle'}
        </span>
      </div>
      <div className="profiler-body" data-testid="profiler-body">
        {error ? (
          <div className="profiler-error" data-testid="profiler-error">
            <strong>Error:</strong> {error}
          </div>
        ) : loading ? (
          <div className="profiler-loading" data-testid="profiler-loading">
            Loading report…
          </div>
        ) : sorted.length === 0 ? (
          <div className="profiler-empty" data-testid="profiler-empty">
            No profiler data yet. Click <strong>Start</strong>, run a script,
            then click <strong>Report</strong>.
          </div>
        ) : (
          <table className="profiler-table" data-testid="profiler-table">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="profiler-col-function"
                  onClick={() => toggleSort('functionName')}
                  data-testid="profiler-col-function"
                >
                  Function{sortIndicator('functionName')}
                </th>
                <th
                  scope="col"
                  className="profiler-col-time"
                  onClick={() => toggleSort('totalTime')}
                  data-testid="profiler-col-time"
                >
                  Total Time{sortIndicator('totalTime')}
                </th>
                <th
                  scope="col"
                  className="profiler-col-calls"
                  onClick={() => toggleSort('numCalls')}
                  data-testid="profiler-col-calls"
                >
                  Calls{sortIndicator('numCalls')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr
                  key={entry.functionName}
                  className="profiler-row"
                  data-testid="profiler-row"
                  data-function-name={entry.functionName}
                >
                  <td className="profiler-cell-function">
                    <button
                      type="button"
                      className="profiler-function-link"
                      data-testid="profiler-function-link"
                      onClick={() => onNavigate(entry.functionName)}
                      title={`Open definition of ${entry.functionName}`}
                    >
                      {entry.functionName}
                    </button>
                  </td>
                  <td
                    className="profiler-cell-time"
                    data-testid="profiler-cell-time"
                    data-total-time={String(entry.totalTime)}
                  >
                    {formatProfileTime(entry.totalTime)}
                  </td>
                  <td
                    className="profiler-cell-calls"
                    data-testid="profiler-cell-calls"
                    data-num-calls={String(entry.numCalls)}
                  >
                    {entry.numCalls}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default ProfilerPanel
