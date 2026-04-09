import { useState, useCallback, useEffect } from 'react'
import PanelHeader from './PanelHeader'
import TabbedEditor from '../editor/TabbedEditor'
import { createTab, type EditorTab } from '../editor/editorTypes'

interface PanelVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
}

interface EditorPanelProps {
  panelVisibility: PanelVisibility
  onTogglePanel: (panel: keyof PanelVisibility) => void
  openFilePath?: string | null
  onFileOpened?: () => void
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
  openFilePath,
  onFileOpened,
}: EditorPanelProps): React.JSX.Element {
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    const initial = createTab(
      'untitled.m',
      '% Welcome to MatSlop\n% Start writing MATLAB/Octave code here\n\nfunction result = hello()\n    disp("Hello from MatSlop!");\n    result = 42;\nend\n'
    )
    return [initial]
  })
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => tabs[0]?.id ?? null
  )

  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const getActiveTab = useCallback((): EditorTab | null => {
    return tabs.find((t) => t.id === activeTabId) ?? null
  }, [tabs, activeTabId])

  const handleNewFile = useCallback(() => {
    const tab = createTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleOpenFile = useCallback(async () => {
    const result = await window.matslop.openFile()
    if (!result) return
    // Check if the file is already open
    const existing = tabs.find((t) => t.filePath === result.filePath)
    if (existing) {
      setActiveTabId(existing.id)
      return
    }
    const tab = createTab(result.filename, result.content, result.filePath)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [tabs])

  const handleSave = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab) return
    if (tab.filePath) {
      const result = await window.matslop.saveFile(tab.filePath, tab.content)
      if (result.success) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, savedContent: t.content } : t
          )
        )
      }
    } else {
      // Untitled file — use Save As
      await handleSaveAs()
    }
  }, [getActiveTab])

  const handleSaveAs = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab) return
    const result = await window.matslop.saveFileAs(tab.content, tab.filename)
    if (result) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                filePath: result.filePath,
                filename: result.filename,
                savedContent: t.content,
              }
            : t
        )
      )
    }
  }, [getActiveTab])

  const handleTabClose = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      // Check for unsaved changes
      if (tab.content !== tab.savedContent) {
        const response = await window.matslop.confirmClose(tab.filename)
        if (response === 2) return // Cancel
        if (response === 0) {
          // Save
          if (tab.filePath) {
            const saveResult = await window.matslop.saveFile(
              tab.filePath,
              tab.content
            )
            if (!saveResult.success) return
          } else {
            const saveResult = await window.matslop.saveFileAs(
              tab.content,
              tab.filename
            )
            if (!saveResult) return // User cancelled save dialog
          }
        }
        // response === 1 means Discard — fall through to close
      }

      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        const next = prev.filter((t) => t.id !== tabId)
        if (tabId === activeTabId && next.length > 0) {
          const newIdx = Math.min(idx, next.length - 1)
          setActiveTabId(next[newIdx].id)
        } else if (next.length === 0) {
          setActiveTabId(null)
        }
        return next
      })
    },
    [tabs, activeTabId]
  )

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, content } : t))
    )
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        handleSaveAs()
      } else if (ctrl && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, handleSaveAs])

  // Open file from File Browser
  useEffect(() => {
    if (!openFilePath) return
    // Check if already open
    const existing = tabs.find((t) => t.filePath === openFilePath)
    if (existing) {
      setActiveTabId(existing.id)
      onFileOpened?.()
      return
    }
    window.matslop.readFile(openFilePath).then((result) => {
      if (result) {
        const tab = createTab(result.filename, result.content, result.filePath)
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
      }
      onFileOpened?.()
    })
  }, [openFilePath, onFileOpened, tabs])

  const allPanels: { key: keyof PanelVisibility; label: string }[] = [
    { key: 'fileBrowser', label: 'File Browser' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'commandWindow', label: 'Command Window' },
  ]
  const hiddenPanels = allPanels.filter((p) => !panelVisibility[p.key])

  return (
    <div className="panel editor-panel">
      <PanelHeader title="Editor" />
      <div className="panel-content editor-panel-content">
        <TabbedEditor
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
        />
      </div>
      {hiddenPanels.length > 0 && (
        <div className="collapsed-panels-bar">
          {hiddenPanels.map((p) => (
            <button
              key={p.key}
              className="restore-panel-btn"
              onClick={() => onTogglePanel(p.key)}
              title={`Show ${p.label}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default EditorPanel
