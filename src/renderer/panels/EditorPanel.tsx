import { useState, useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import PanelHeader from './PanelHeader'
import TabbedEditor from '../editor/TabbedEditor'
import EditorToolbar from '../editor/EditorToolbar'
import {
  createTab,
  createEmptyLiveScript,
  findSectionRange,
  findNextSectionAdvanceLine,
  type EditorTab,
} from '../editor/editorTypes'
import { publishHtml } from '../editor/publishHtml'
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
  /** US-032: when opening via Find-in-Files, reveal/position at this line. */
  openFileLine?: number | null
  onFileOpened?: () => void
  onCursorPositionChange?: (line: number, column: number) => void
  onErrorCountChange?: (count: number) => void
  engineStatus: OctaveEngineStatus
  onRun?: (filePath: string, dirPath: string) => void
  onStop?: () => void
  onPauseForDebug?: () => void
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
  /** US-016: location Octave is currently paused at, null when not debugging. */
  pausedLocation?: { file: string; line: number } | null
  /**
   * US-023 (edit-and-continue, best effort): fired whenever a file is saved
   * while the debugger is paused so the parent can trigger breakpoint
   * re-application and surface a warning banner. Receives the saved file's
   * absolute path (or null if the save was to an unsaved/untitled tab).
   */
  onFileSavedWhilePaused?: (filePath: string | null) => void
}

function EditorPanel({
  panelVisibility,
  onTogglePanel,
  openFilePath,
  openFileLine,
  onFileOpened,
  onCursorPositionChange,
  onErrorCountChange,
  engineStatus,
  onRun,
  onStop,
  onPauseForDebug,
  onRunSection,
  menuAction,
  onMenuActionConsumed,
  editorTheme,
  editorSettings,
  pausedLocation,
  onFileSavedWhilePaused,
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

  // US-023: keep the latest paused-location / callback in refs so the
  // handleSave closure doesn't need to be re-created whenever debugger
  // state changes (which would invalidate menu/shortcut bindings below).
  const pausedLocationRef = useRef<{ file: string; line: number } | null>(null)
  const onFileSavedWhilePausedRef = useRef<
    ((filePath: string | null) => void) | undefined
  >(undefined)
  useEffect(() => {
    pausedLocationRef.current = pausedLocation ?? null
  }, [pausedLocation])
  useEffect(() => {
    onFileSavedWhilePausedRef.current = onFileSavedWhilePaused
  }, [onFileSavedWhilePaused])

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
        // US-023 (edit-and-continue, best effort): if Octave is currently
        // paused when the user saves, notify the parent so it can re-apply
        // breakpoints and show the "changes will take effect on re-entry"
        // banner. Only .m files are meaningful here — .mls live scripts are
        // not function bodies Octave can re-enter mid-pause.
        if (pausedLocationRef.current && tab.filePath.endsWith('.m')) {
          onFileSavedWhilePausedRef.current?.(tab.filePath)
        }
      }
    } else {
      // Untitled file — use Save As
      await handleSaveAs()
    }
  }, [getActiveTab])

  /**
   * US-030: Publish the active tab as a self-contained HTML document.
   * Live scripts preserve cell layout + outputs + embedded figures; .m
   * scripts emit a highlighted code listing. Delegates document assembly
   * to the pure `publishHtml()` helper so all the string work is
   * unit-testable.
   */
  const handlePublishHtml = useCallback(async () => {
    const tab = getActiveTab()
    if (!tab || tab.mode === 'welcome') return
    const html = publishHtml({
      filename: tab.filename,
      mode: tab.mode === 'livescript' ? 'livescript' : 'script',
      content: tab.content,
      timestamp: new Date().toISOString(),
    })
    const defaultName = tab.filename.replace(/\.(m|mls)$/i, '') + '.html'
    const result = await window.matslop.publishSaveDialog(defaultName)
    if (!result) return
    await window.matslop.publishWriteFile(result.filePath, html)
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

  /**
   * Get the section around the current cursor as a pure computation over
   * the tab content. Returns null when there is no active tab / editor /
   * cursor position, or when the section body is empty.
   */
  const getSectionAtCursor = useCallback((): {
    tab: EditorTab
    cursorLine: number
    code: string
  } | null => {
    const tab = getActiveTab()
    if (!tab) return null
    const editor = editorInstanceRef.current
    if (!editor) return null
    const pos = editor.getPosition()
    if (!pos) return null
    const range = findSectionRange(tab.content, pos.lineNumber)
    if (!range.code.trim()) return null
    return { tab, cursorLine: pos.lineNumber, code: range.code }
  }, [getActiveTab])

  const handleRunSection = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSection?.(section.code)
  }, [getSectionAtCursor, onRunSection])

  /**
   * US-029: Run the section at the cursor and advance the cursor to the
   * first content line of the next section (if there is one). Reuses the
   * same command-execution path as handleRunSection.
   */
  const handleRunAndAdvance = useCallback(() => {
    const section = getSectionAtCursor()
    if (!section) return
    onRunSection?.(section.code)
    const editor = editorInstanceRef.current
    if (!editor) return
    const advanceLine = findNextSectionAdvanceLine(section.tab.content, section.cursorLine)
    if (advanceLine != null) {
      editor.setPosition({ lineNumber: advanceLine, column: 1 })
      try {
        editor.revealLineInCenterIfOutsideViewport(advanceLine)
      } catch {
        /* monaco tearing down — ignore */
      }
      editor.focus()
    }
  }, [getSectionAtCursor, onRunSection])

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
      case 'runAndAdvance':
        handleRunAndAdvance()
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
  }, [handleRun, handleRunSection, handleRunAndAdvance, handleSave, handleSaveAs, handleNewFile, handleOpenFile, activeTabId, handleTabClose, handleStop])

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
      case 'publishHtml':
        handlePublishHtml().then(() => onMenuActionConsumed?.())
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
      case 'runAndAdvance':
        handleRunAndAdvance()
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
  }, [menuAction, activeTabId, handleNewFile, handleNewLiveScript, handleOpenFile, handleSave, handleSaveAs, handlePublishHtml, handleTabClose, handleRun, handleRunSection, handleRunAndAdvance, onMenuActionConsumed])

  // US-032: Reveal/position at a target line when navigating in from a
  // Find-in-Files result. Runs after the open-file effect below has
  // mounted the editor for the target tab. A small timeout gives Monaco
  // a chance to finish initial layout/measure before we call revealLine.
  useEffect(() => {
    if (openFileLine == null) return
    const id = window.setTimeout(() => {
      const editor = editorInstanceRef.current
      if (!editor) return
      try {
        editor.revealLineInCenterIfOutsideViewport(openFileLine)
        editor.setPosition({ lineNumber: openFileLine, column: 1 })
        editor.focus()
      } catch {
        /* editor tearing down — ignore */
      }
    }, 150)
    return () => window.clearTimeout(id)
  }, [openFileLine, activeTabId])

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

  // US-016: when Octave reports a paused location, activate a tab whose
  // filename matches the paused file (by basename). If no tab matches, we
  // leave the active tab alone — the status bar still surfaces debug state.
  useEffect(() => {
    if (!pausedLocation) return
    const rawFile = pausedLocation.file
    if (!rawFile) return
    // Extract the basename portably from either a posix or windows path.
    const lastSep = Math.max(rawFile.lastIndexOf('/'), rawFile.lastIndexOf('\\'))
    const rawBase = lastSep >= 0 ? rawFile.substring(lastSep + 1) : rawFile
    // Octave may report "funcname" without a .m extension. Match permissively:
    // prefer exact filename match, then filename-minus-extension match.
    const candidates = [rawBase, rawBase.endsWith('.m') ? rawBase : `${rawBase}.m`]
    const match = tabs.find((t) => candidates.includes(t.filename))
    if (match && match.id !== activeTabId) {
      setActiveTabId(match.id)
    }
  }, [pausedLocation, tabs, activeTabId])

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
      data-testid="editor-panel"
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
        onPauseForDebug={onPauseForDebug}
        onRunSection={handleRunSection}
        onRunAndAdvance={handleRunAndAdvance}
        debugPaused={pausedLocation !== null}
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
          pausedLocation={pausedLocation ?? null}
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
