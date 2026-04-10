import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import PanelHeader from './PanelHeader'
import TabbedEditor from '../editor/TabbedEditor'
import EditorToolbar from '../editor/EditorToolbar'
import { createTab, createEmptyLiveScript, type EditorTab } from '../editor/editorTypes'
import type { OctaveEngineStatus } from '../App'
import { shortcutManager, type ShortcutAction } from '../shortcuts/shortcutManager'

interface PanelVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
  commandHistory: boolean
}

interface MenuAction {
  action: string
  id: number
}

interface EditorPanelProps {
  panelVisibility: PanelVisibility
  onTogglePanel: (panel: keyof PanelVisibility) => void
  openFilePath?: string | null
  onFileOpened?: () => void
  onCursorPositionChange?: (line: number, column: number) => void
  onErrorCountChange?: (count: number) => void
  engineStatus: OctaveEngineStatus
  onRun?: (filePath: string, dirPath: string) => void
  onStop?: () => void
  onRunSection?: (code: string) => void
  menuAction?: MenuAction | null
  onMenuActionConsumed?: () => void
  editorTheme?: string
  editorSettings?: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
  openFilePath,
  onFileOpened,
  onCursorPositionChange,
  onErrorCountChange,
  engineStatus,
  onRun,
  onStop,
  onRunSection,
  menuAction,
  onMenuActionConsumed,
  editorTheme,
  editorSettings,
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
  const [welcomeTabId, setWelcomeTabId] = useState<string | null>(null)
  const welcomeInitRef = useRef(false)

  // Show welcome tab on first launch
  useEffect(() => {
    if (welcomeInitRef.current) return
    welcomeInitRef.current = true
    window.matslop.configGetShowWelcome().then((show) => {
      if (show) {
        const welcomeTab = createTab('Welcome', '', null, 'welcome')
        setTabs((prev) => [welcomeTab, ...prev])
        setActiveTabId(welcomeTab.id)
        setWelcomeTabId(welcomeTab.id)
      }
    })
  }, [])
  const editorInstanceRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const handleEditorRef = useCallback((editor: monacoEditor.IStandaloneCodeEditor | null) => {
    editorInstanceRef.current = editor
  }, [])

  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const getActiveTab = useCallback((): EditorTab | null => {
    return tabs.find((t) => t.id === activeTabId) ?? null
  }, [tabs, activeTabId])

  const handleCloseWelcome = useCallback(() => {
    if (!welcomeTabId) return
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== welcomeTabId)
      if (welcomeTabId === activeTabId && next.length > 0) {
        setActiveTabId(next[0].id)
      } else if (next.length === 0) {
        setActiveTabId(null)
      }
      return next
    })
    setWelcomeTabId(null)
  }, [welcomeTabId, activeTabId])

  const handleNewFile = useCallback(() => {
    const tab = createTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const handleNewLiveScript = useCallback(() => {
    const content = createEmptyLiveScript()
    const tab = createTab('untitled.mls', content, null, 'livescript')
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
      window.matslop.recentFilesAdd(result.filePath)
      return
    }
    const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
    const tab = createTab(result.filename, result.content, result.filePath, mode)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    window.matslop.recentFilesAdd(result.filePath)
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

  const handleRun = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab) return

    // Auto-save first
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
      // Untitled — need Save As first
      const result = await window.matslop.saveFileAs(tab.content, tab.filename)
      if (!result) return // User cancelled
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? { ...t, filePath: result.filePath, filename: result.filename, savedContent: t.content }
            : t
        )
      )
      // Use the newly saved path
      const lastSep = Math.max(result.filePath.lastIndexOf('/'), result.filePath.lastIndexOf('\\'))
      const dirPath = result.filePath.substring(0, lastSep)
      onRun?.(result.filePath, dirPath)
      return
    }

    const lastSep = Math.max(tab.filePath.lastIndexOf('/'), tab.filePath.lastIndexOf('\\'))
    const dirPath = tab.filePath.substring(0, lastSep)
    onRun?.(tab.filePath, dirPath)
  }, [getActiveTab, onRun])

  const handleRunSection = useCallback(() => {
    const tab = getActiveTab()
    if (!tab) return
    const editor = editorInstanceRef.current
    if (!editor) return

    const model = editor.getModel()
    if (!model) return
    const pos = editor.getPosition()
    if (!pos) return

    const lineCount = model.getLineCount()
    let startLine = 1
    let endLine = lineCount

    // Find cell boundaries: lines starting with %%
    for (let i = pos.lineNumber; i >= 1; i--) {
      const lineContent = model.getLineContent(i)
      if (lineContent.trimStart().startsWith('%%')) {
        startLine = i
        break
      }
    }
    for (let i = pos.lineNumber + 1; i <= lineCount; i++) {
      const lineContent = model.getLineContent(i)
      if (lineContent.trimStart().startsWith('%%')) {
        endLine = i - 1
        break
      }
    }

    // Extract the cell content (skip the %% header line itself)
    const cellStartLine = model.getLineContent(startLine).trimStart().startsWith('%%') ? startLine + 1 : startLine
    const lines: string[] = []
    for (let i = cellStartLine; i <= endLine; i++) {
      lines.push(model.getLineContent(i))
    }
    const code = lines.join('\n').trim()
    if (code) {
      onRunSection?.(code)
    }
  }, [getActiveTab, onRunSection])

  const handleStop = useCallback(() => {
    onStop?.()
  }, [onStop])

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

  // Centralized keyboard shortcut handler
  const handleShortcut = useCallback((action: ShortcutAction) => {
    switch (action) {
      case 'run':
        handleRun()
        break
      case 'runSection':
        handleRunSection()
        break
      case 'save':
        handleSave()
        break
      case 'saveAs':
        handleSaveAs()
        break
      case 'newFile':
        handleNewFile()
        break
      case 'openFile':
        handleOpenFile()
        break
      case 'closeTab':
        if (activeTabId) handleTabClose(activeTabId)
        break
      case 'stop':
        handleStop()
        break
      case 'find': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('actions.find')?.run()
        }
        break
      }
      case 'findReplace': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.startFindReplaceAction')?.run()
        }
        break
      }
      case 'goToLine': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.gotoLine')?.run()
        }
        break
      }
      case 'toggleComment': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.commentLine')?.run()
        }
        break
      }
    }
  }, [handleRun, handleRunSection, handleSave, handleSaveAs, handleNewFile, handleOpenFile, activeTabId, handleTabClose, handleStop])

  useEffect(() => {
    shortcutManager.start(handleShortcut)
    return () => shortcutManager.stop()
  }, [handleShortcut])

  // Handle menu actions from main process
  const lastMenuActionIdRef = useRef(0)
  useEffect(() => {
    if (!menuAction || menuAction.id <= lastMenuActionIdRef.current) return
    lastMenuActionIdRef.current = menuAction.id

    switch (menuAction.action) {
      case 'newFile':
        handleNewFile()
        onMenuActionConsumed?.()
        break
      case 'newLiveScript':
        handleNewLiveScript()
        onMenuActionConsumed?.()
        break
      case 'openFile':
        handleOpenFile().then(() => onMenuActionConsumed?.())
        break
      case 'save':
        handleSave().then(() => onMenuActionConsumed?.())
        break
      case 'saveAs':
        handleSaveAs().then(() => onMenuActionConsumed?.())
        break
      case 'closeTab':
        if (activeTabId) {
          handleTabClose(activeTabId).then(() => onMenuActionConsumed?.())
        } else {
          onMenuActionConsumed?.()
        }
        break
      case 'runScript':
        handleRun().then(() => onMenuActionConsumed?.())
        break
      case 'runSection':
        handleRunSection()
        onMenuActionConsumed?.()
        break
      case 'find': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('actions.find')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'findReplace': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.startFindReplaceAction')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'goToLine': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.gotoLine')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      case 'toggleComment': {
        const editor = editorInstanceRef.current
        if (editor) {
          editor.getAction('editor.action.commentLine')?.run()
        }
        onMenuActionConsumed?.()
        break
      }
      default:
        // Not handled by EditorPanel — leave for other consumers
        break
    }
  }, [menuAction, activeTabId, handleNewFile, handleNewLiveScript, handleOpenFile, handleSave, handleSaveAs, handleTabClose, handleRun, handleRunSection, onMenuActionConsumed])

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
        const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
        const tab = createTab(result.filename, result.content, result.filePath, mode)
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
        window.matslop.recentFilesAdd(result.filePath)
      }
      onFileOpened?.()
    })
  }, [openFilePath, onFileOpened, tabs])

  // Drag-and-drop file opening
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0

    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      const filePath = (file as File & { path: string }).path
      if (!filePath) continue
      if (!filePath.endsWith('.m') && !filePath.endsWith('.mls')) continue

      // Check if already open
      const existing = tabs.find((t) => t.filePath === filePath)
      if (existing) {
        setActiveTabId(existing.id)
        continue
      }

      window.matslop.readFile(filePath).then((result) => {
        if (result) {
          const mode = result.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
          const tab = createTab(result.filename, result.content, result.filePath, mode)
          setTabs((prev) => [...prev, tab])
          setActiveTabId(tab.id)
          window.matslop.recentFilesAdd(result.filePath)
        }
      })
    }
  }, [tabs])

  const allPanels: { key: keyof PanelVisibility; label: string }[] = [
    { key: 'fileBrowser', label: 'File Browser' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'commandWindow', label: 'Command Window' },
    { key: 'commandHistory', label: 'Command History' },
  ]
  const hiddenPanels = allPanels.filter((p) => !panelVisibility[p.key])

  return (
    <div
      className="panel editor-panel"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <PanelHeader title="Editor" />
      <EditorToolbar
        hasActiveFile={activeTabId !== null}
        engineStatus={engineStatus}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onSave={handleSave}
        onRun={handleRun}
        onStop={handleStop}
        onRunSection={handleRunSection}
      />
      <div className="panel-content editor-panel-content">
        {isDragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay-content">
              Drop .m or .mls files to open
            </div>
          </div>
        )}
        <TabbedEditor
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          onCursorPositionChange={onCursorPositionChange}
          onEditorRef={handleEditorRef}
          onErrorCountChange={onErrorCountChange}
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onCloseWelcome={handleCloseWelcome}
          editorTheme={editorTheme}
          engineStatus={engineStatus}
          editorSettings={editorSettings}
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
