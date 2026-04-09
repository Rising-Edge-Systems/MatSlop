import { useState, useCallback } from 'react'
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
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
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

  const handleTabClose = useCallback(
    (tabId: string) => {
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
    [activeTabId]
  )

  const handleContentChange = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, content } : t))
    )
  }, [])

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
