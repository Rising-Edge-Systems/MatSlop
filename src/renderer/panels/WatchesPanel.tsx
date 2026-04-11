import { useState, useCallback, useRef, useEffect } from 'react'
import type { WatchEntry } from '../editor/watchesStore'

/**
 * US-022: Watch expressions panel. Shows one row per pinned expression
 * (e.g. `x`, `length(data)`, `foo.bar(1)`) with its most recent evaluated
 * value. Rows can be edited in place (click the expression), removed via
 * the ✕ button, and new rows added via the input field at the bottom.
 *
 * All state mutations are delegated to pure helpers in watchesStore.ts so
 * the panel itself only owns the ephemeral "is this row currently being
 * edited" state. Value re-evaluation on pause/step is driven by App.tsx.
 */
export interface WatchesPanelProps {
  watches: WatchEntry[]
  onAddWatch: (expression: string) => void
  onRemoveWatch: (id: string) => void
  onUpdateWatch: (id: string, expression: string) => void
  onRefresh?: () => void
  onCollapse?: () => void
}

function WatchesPanel({
  watches,
  onAddWatch,
  onRemoveWatch,
  onUpdateWatch,
  onRefresh,
  onCollapse,
}: WatchesPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const commitNew = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    onAddWatch(trimmed)
    setDraft('')
  }, [draft, onAddWatch])

  const startEdit = useCallback((w: WatchEntry) => {
    setEditingId(w.id)
    setEditDraft(w.expression)
  }, [])

  const commitEdit = useCallback(() => {
    if (editingId == null) return
    onUpdateWatch(editingId, editDraft)
    setEditingId(null)
    setEditDraft('')
  }, [editingId, editDraft, onUpdateWatch])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  return (
    <div className="watches-panel" data-testid="watches-panel">
      {onRefresh && (
        <div className="watches-toolbar">
          <button
            type="button"
            className="watches-refresh-btn"
            onClick={onRefresh}
            title="Refresh values"
            data-testid="watches-refresh"
          >
            ⟳
          </button>
        </div>
      )}
      <div className="watches-body" data-testid="watches-body">
        {watches.length === 0 ? (
          <div className="watches-empty" data-testid="watches-empty">
            No watches. Add an expression below to pin it here.
          </div>
        ) : (
          <ul className="watches-list" role="list">
            {watches.map((w) => {
              const isEditing = editingId === w.id
              return (
                <li
                  key={w.id}
                  className={w.error ? 'watches-row watches-row-error' : 'watches-row'}
                  data-testid="watches-row"
                  data-watch-id={w.id}
                  data-watch-expression={w.expression}
                >
                  <div className="watches-row-main">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        className="watches-edit-input"
                        data-testid="watches-edit-input"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitEdit()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEdit()
                          }
                        }}
                        onBlur={commitEdit}
                      />
                    ) : (
                      <button
                        type="button"
                        className="watches-expression"
                        onClick={() => startEdit(w)}
                        title="Click to edit"
                      >
                        {w.expression}
                      </button>
                    )}
                    <button
                      type="button"
                      className="watches-remove-btn"
                      onClick={() => onRemoveWatch(w.id)}
                      title="Remove"
                      data-testid="watches-remove"
                    >
                      ✕
                    </button>
                  </div>
                  <div
                    className="watches-value"
                    data-testid="watches-value"
                    title={w.error ?? w.value ?? ''}
                  >
                    {w.error != null ? (
                      <span className="watches-error">{w.error}</span>
                    ) : w.value == null ? (
                      <span className="watches-pending">—</span>
                    ) : w.value === '' ? (
                      <span className="watches-empty-value">(empty)</span>
                    ) : (
                      <span className="watches-value-text">{w.value}</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="watches-add-row">
        <input
          type="text"
          className="watches-add-input"
          data-testid="watches-add-input"
          placeholder="Add expression…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitNew()
            }
          }}
        />
        <button
          type="button"
          className="watches-add-btn"
          onClick={commitNew}
          disabled={draft.trim() === ''}
          data-testid="watches-add-btn"
        >
          +
        </button>
      </div>
    </div>
  )
}

export default WatchesPanel
