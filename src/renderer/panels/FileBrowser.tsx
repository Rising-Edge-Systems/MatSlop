import { useState, useEffect, useCallback, useRef } from 'react'

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface TreeNodeState {
  expanded: boolean
  children: DirEntry[] | null
}

interface ContextMenuState {
  x: number
  y: number
  entry: DirEntry | null
  // null entry means context menu on the root directory background
}

interface FileBrowserProps {
  onCollapse: () => void
  onOpenFile: (filePath: string) => void
  onCwdChange?: (cwd: string) => void
  externalCwd?: string
  /** US-037: absolute-path → single-letter git status badge. */
  gitBadges?: ReadonlyMap<string, string>
}

function FileBrowser({ onCollapse, onOpenFile, onCwdChange, externalCwd, gitBadges }: FileBrowserProps): React.JSX.Element {
  const [cwd, setCwd] = useState<string>('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [treeState, setTreeState] = useState<Record<string, TreeNodeState>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null) // path being renamed
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreating] = useState<{ dir: string; type: 'file' | 'folder' } | null>(null)
  const [createValue, setCreateValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const loadDir = useCallback(async (dirPath: string) => {
    const results = await window.matslop.readDir(dirPath)
    return results
  }, [])

  const onCwdChangeRef = useRef(onCwdChange)
  onCwdChangeRef.current = onCwdChange

  const loadRoot = useCallback(async (dirPath: string) => {
    const results = await loadDir(dirPath)
    setEntries(results)
    setCwd(dirPath)
    onCwdChangeRef.current?.(dirPath)
  }, [loadDir])

  // Initialize with home directory
  useEffect(() => {
    window.matslop.getHomeDir().then(loadRoot)
  }, [loadRoot])

  // Respond to external cwd changes (e.g., cd command in Command Window)
  useEffect(() => {
    if (externalCwd && externalCwd !== cwd) {
      setTreeState({})
      loadRoot(externalCwd)
    }
  }, [externalCwd]) // intentionally only react to externalCwd changes

  const handleChangeDir = useCallback(async () => {
    const dir = await window.matslop.selectDirectory()
    if (dir) {
      setTreeState({})
      loadRoot(dir)
    }
  }, [loadRoot])

  const toggleDir = useCallback(async (entry: DirEntry) => {
    setTreeState((prev) => {
      const existing = prev[entry.path]
      if (existing?.expanded) {
        return { ...prev, [entry.path]: { ...existing, expanded: false } }
      }
      return prev
    })

    const existing = treeState[entry.path]
    if (existing?.expanded) return // collapsing handled above

    // Expand: load children if not loaded
    if (!existing?.children) {
      const children = await loadDir(entry.path)
      setTreeState((prev) => ({
        ...prev,
        [entry.path]: { expanded: true, children }
      }))
    } else {
      setTreeState((prev) => ({
        ...prev,
        [entry.path]: { ...existing, expanded: true }
      }))
    }
  }, [treeState, loadDir])

  const handleDoubleClick = useCallback((entry: DirEntry) => {
    if (!entry.isDirectory) {
      onOpenFile(entry.path)
    }
  }, [onOpenFile])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  // Focus rename/create inputs when they appear
  useEffect(() => {
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renaming])

  useEffect(() => {
    createInputRef.current?.focus()
  }, [creating])

  const refreshDir = useCallback(async (dirPath: string) => {
    const results = await loadDir(dirPath)
    if (dirPath === cwd) {
      setEntries(results)
    } else {
      setTreeState((prev) => ({
        ...prev,
        [dirPath]: { expanded: true, children: results }
      }))
    }
  }, [cwd, loadDir])

  const handleContextAction = useCallback(async (action: string) => {
    const entry = contextMenu?.entry
    setContextMenu(null)

    if (action === 'open' && entry && !entry.isDirectory) {
      onOpenFile(entry.path)
      return
    }

    if (action === 'rename' && entry) {
      setRenaming(entry.path)
      setRenameValue(entry.name)
      return
    }

    if (action === 'delete' && entry) {
      const confirmed = await window.matslop.confirmDelete(entry.name, entry.isDirectory)
      if (confirmed) {
        await window.matslop.fsDelete(entry.path)
        // Determine parent directory path
        const parentDir = entry.path.substring(0, entry.path.lastIndexOf('/')) || entry.path.substring(0, entry.path.lastIndexOf('\\'))
        refreshDir(parentDir || cwd)
      }
      return
    }

    if (action === 'newFile' || action === 'newFolder') {
      const targetDir = entry?.isDirectory ? entry.path : cwd
      setCreating({ dir: targetDir, type: action === 'newFile' ? 'file' : 'folder' })
      setCreateValue('')
      // If target is a collapsed directory, expand it
      if (entry?.isDirectory && !treeState[entry.path]?.expanded) {
        toggleDir(entry)
      }
      return
    }
  }, [contextMenu, onOpenFile, cwd, refreshDir, treeState, toggleDir])

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null)
      return
    }
    const result = await window.matslop.fsRename(renaming, renameValue.trim())
    if (result.success) {
      const parentDir = renaming.substring(0, renaming.lastIndexOf('/')) || renaming.substring(0, renaming.lastIndexOf('\\'))
      refreshDir(parentDir || cwd)
    }
    setRenaming(null)
  }, [renaming, renameValue, cwd, refreshDir])

  const handleCreateSubmit = useCallback(async () => {
    if (!creating || !createValue.trim()) {
      setCreating(null)
      return
    }
    if (creating.type === 'file') {
      await window.matslop.fsCreateFile(creating.dir, createValue.trim())
    } else {
      await window.matslop.fsCreateFolder(creating.dir, createValue.trim())
    }
    refreshDir(creating.dir)
    setCreating(null)
  }, [creating, createValue, refreshDir])

  const getFileIcon = (entry: DirEntry): string => {
    if (entry.isDirectory) return '📁'
    if (entry.name.endsWith('.m')) return '📐'
    if (entry.name.endsWith('.mls')) return '📓'
    return '📄'
  }

  const renderEntry = (entry: DirEntry, depth: number): React.JSX.Element => {
    const nodeState = treeState[entry.path]
    const isExpanded = nodeState?.expanded ?? false
    const isRenaming = renaming === entry.path
    const badge = gitBadges?.get(entry.path) ?? ''

    return (
      <div key={entry.path}>
        <div
          className="fb-entry"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          data-git-badge={badge || undefined}
          data-file-path={entry.path}
          onDoubleClick={() => handleDoubleClick(entry)}
          onClick={() => {
            if (entry.isDirectory) {
              toggleDir(entry)
            } else if (entry.name.endsWith('.m') || entry.name.endsWith('.mls')) {
              onOpenFile(entry.path)
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, entry)}
        >
          {entry.isDirectory && (
            <span className="fb-arrow">{isExpanded ? '▾' : '▸'}</span>
          )}
          {!entry.isDirectory && <span className="fb-arrow-placeholder" />}
          <span className="fb-icon">{getFileIcon(entry)}</span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              className="fb-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="fb-name">{entry.name}</span>
          )}
          {badge && (
            <span
              className={`fb-git-badge fb-git-badge-${badge}`}
              data-testid="fb-git-badge"
              title={`git: ${badge}`}
            >
              {badge}
            </span>
          )}
        </div>
        {entry.isDirectory && isExpanded && nodeState?.children && (
          <div>
            {nodeState.children.map((child) => renderEntry(child, depth + 1))}
            {creating && creating.dir === entry.path && renderCreateInput(depth + 1)}
          </div>
        )}
      </div>
    )
  }

  const renderCreateInput = (depth: number): React.JSX.Element => (
    <div className="fb-entry" style={{ paddingLeft: `${depth * 16 + 4}px` }} key="__creating__">
      <span className="fb-arrow-placeholder" />
      <span className="fb-icon">{creating?.type === 'folder' ? '📁' : '📄'}</span>
      <input
        ref={createInputRef}
        className="fb-rename-input"
        value={createValue}
        placeholder={creating?.type === 'folder' ? 'New folder...' : 'New file...'}
        onChange={(e) => setCreateValue(e.target.value)}
        onBlur={handleCreateSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleCreateSubmit()
          if (e.key === 'Escape') setCreating(null)
        }}
      />
    </div>
  )

  return (
    <div className="panel file-browser" data-testid="file-browser" onContextMenu={(e) => handleContextMenu(e, null)}>
      <div className="fb-path-bar">
        <span className="fb-path" title={cwd}>{cwd}</span>
        <button className="fb-change-dir-btn" onClick={handleChangeDir} title="Change Directory">
          ...
        </button>
      </div>
      <div className="panel-content fb-content">
        {entries.map((entry) => renderEntry(entry, 0))}
        {creating && creating.dir === cwd && renderCreateInput(0)}
      </div>

      {contextMenu && (
        <div
          className="fb-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry && !contextMenu.entry.isDirectory && (
            <div className="fb-ctx-item" onClick={() => handleContextAction('open')}>Open</div>
          )}
          {contextMenu.entry && (
            <>
              <div className="fb-ctx-item" onClick={() => handleContextAction('rename')}>Rename</div>
              <div className="fb-ctx-item fb-ctx-danger" onClick={() => handleContextAction('delete')}>Delete</div>
              <div className="fb-ctx-separator" />
            </>
          )}
          <div className="fb-ctx-item" onClick={() => handleContextAction('newFile')}>New File</div>
          <div className="fb-ctx-item" onClick={() => handleContextAction('newFolder')}>New Folder</div>
        </div>
      )}
    </div>
  )
}

export default FileBrowser
