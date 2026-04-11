import { useState, useEffect, useCallback, useRef } from 'react'

interface CommandHistoryPanelProps {
  onCollapse: () => void
  onExecuteCommand?: (command: string) => void
  historyVersion: number
}

function CommandHistoryPanel({ onCollapse, onExecuteCommand, historyVersion }: CommandHistoryPanelProps): React.JSX.Element {
  const [history, setHistory] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load history from disk on mount and when historyVersion changes
  useEffect(() => {
    window.matslop.historyLoad().then((loaded) => {
      setHistory(loaded)
    })
  }, [historyVersion])

  // Auto-scroll to bottom when history updates
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [history])

  // Click outside to close context menu
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const filteredHistory = filter
    ? history
        .map((cmd, i) => ({ cmd, originalIndex: i }))
        .filter(({ cmd }) => cmd.toLowerCase().includes(filter.toLowerCase()))
    : history.map((cmd, i) => ({ cmd, originalIndex: i }))

  const handleDoubleClick = useCallback((command: string) => {
    onExecuteCommand?.(command)
  }, [onExecuteCommand])

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, index })
  }, [])

  const handleCopy = useCallback(() => {
    if (contextMenu === null) return
    const cmd = history[contextMenu.index]
    if (cmd) {
      navigator.clipboard.writeText(cmd)
    }
    setContextMenu(null)
  }, [contextMenu, history])

  const handleExecute = useCallback(() => {
    if (contextMenu === null) return
    const cmd = history[contextMenu.index]
    if (cmd) {
      onExecuteCommand?.(cmd)
    }
    setContextMenu(null)
  }, [contextMenu, history, onExecuteCommand])

  const handleDelete = useCallback(() => {
    if (contextMenu === null) return
    window.matslop.historyDeleteEntry(contextMenu.index).then((updated) => {
      setHistory(updated)
    })
    setContextMenu(null)
  }, [contextMenu])

  return (
    <div className="panel ch-panel">
      <div className="ch-filter-bar">
        <input
          type="text"
          className="ch-filter-input"
          placeholder="Filter history..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="ch-list" ref={listRef}>
        {filteredHistory.length === 0 ? (
          <div className="ch-empty">
            {filter ? 'No matching commands' : 'No command history'}
          </div>
        ) : (
          filteredHistory.map(({ cmd, originalIndex }) => (
            <div
              key={originalIndex}
              className="ch-entry"
              onDoubleClick={() => handleDoubleClick(cmd)}
              onContextMenu={(e) => handleContextMenu(e, originalIndex)}
              title="Double-click to execute"
            >
              {cmd}
            </div>
          ))
        )}
      </div>
      {contextMenu && (
        <div
          className="fb-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="fb-ctx-item" onClick={handleCopy}>Copy</div>
          <div className="fb-ctx-item" onClick={handleExecute}>Execute</div>
          <div className="fb-ctx-separator" />
          <div className="fb-ctx-item fb-ctx-danger" onClick={handleDelete}>Delete from History</div>
        </div>
      )}
    </div>
  )
}

export default CommandHistoryPanel
