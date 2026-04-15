import { useCallback, useEffect, useRef } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import TabbedEditor from '../editor/TabbedEditor'
import EditorToolbar from '../editor/EditorToolbar'
import { useAppContext } from '../AppContext'
import type { DebugAction } from '../editor/debugCommands'
import { createEmptyLiveScript, type EditorTab } from '../editor/editorTypes'
import type { OctaveEngineStatus } from '../App'
import { useTabReducer } from '../editor/useTabReducer'
import { useSessionPersistence, type RestoredSession } from '../editor/useSessionPersistence'
import { useFileOperations } from '../editor/useFileOperations'
import { useScriptExecution } from '../editor/useScriptExecution'
import { useEditorShortcuts } from '../editor/useEditorShortcuts'
import { useDragDrop } from '../editor/useDragDrop'
import { useMenuActions } from '../editor/useMenuActions'
import { useDebugIntegration } from '../editor/useDebugIntegration'

interface PanelVisibility { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }

interface EditorPanelProps {
  panelVisibility: PanelVisibility
  onTogglePanel: (panel: keyof PanelVisibility) => void
  openFilePath?: string | null
  openFileLine?: number | null
  onFileOpened?: () => void
  onCursorPositionChange?: (line: number, column: number) => void
  onErrorCountChange?: (count: number) => void
  engineStatus: OctaveEngineStatus
  onRun?: (filePath: string, dirPath: string) => void
  onStop?: () => void
  onPauseForDebug?: () => void
  onRunSection?: (code: string) => void
  menuAction?: { action: string; id: number } | null
  onMenuActionConsumed?: () => void
  editorTheme?: string
  editorSettings?: { fontFamily: string; fontSize: number; tabSize: number; insertSpaces: boolean }
  pausedLocation?: { file: string; line: number } | null
  onFileSavedWhilePaused?: (filePath: string | null) => void
  onDebugAction?: (action: DebugAction) => void
}

function EditorPanel(props: EditorPanelProps): React.JSX.Element {
  // AppContext prop resolution
  const appCtx = useAppContext()
  const openFilePath = appCtx.pendingOpenPath ?? props.openFilePath
  const openFileLine = appCtx.pendingOpenLine ?? props.openFileLine
  const onFileOpened = appCtx.pendingOpenPath !== null ? appCtx.onFileOpened : props.onFileOpened
  const pausedLocation = appCtx.pausedLocation ?? props.pausedLocation
  const editorTheme = appCtx.editorTheme ?? props.editorTheme
  const editorSettings = appCtx.editorSettings ?? props.editorSettings
  const menuAction = appCtx.menuAction ?? props.menuAction
  const onMenuActionConsumed = appCtx._provided ? appCtx.onMenuActionConsumed : props.onMenuActionConsumed
  const onRunSection = appCtx._provided ? appCtx.onRunSection : props.onRunSection

  // Editor instance
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const handleEditorRef = useCallback((ed: monacoEditor.IStandaloneCodeEditor | null) => { editorRef.current = ed }, [])
  const getEditor = useCallback(() => editorRef.current, [])

  // Tab state
  const [{ tabs, activeTabId }, dispatch] = useTabReducer()
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const activeIdRef = useRef(activeTabId); activeIdRef.current = activeTabId
  const getTabs = useCallback(() => tabsRef.current, [])
  const getActiveTab = useCallback((): EditorTab | null => tabsRef.current.find((t) => t.id === activeIdRef.current) ?? null, [])

  // Session persistence
  const handleRestore = useCallback((session: RestoredSession | null) => {
    if (!session) return
    dispatch({ type: 'RESTORE_SESSION', payload: { tabs: session.tabs, activeTabId: session.activeTabId } })
    const tryRestore = (n: number): void => {
      const ed = editorRef.current
      const pos = session.activeTabId ? session.cursors[session.activeTabId] : null
      if (ed && pos) { try { ed.setPosition({ lineNumber: pos.line, column: pos.column }); ed.revealLineInCenter(pos.line) } catch { /* */ } return }
      if (n < 10) setTimeout(() => tryRestore(n + 1), 50)
    }
    setTimeout(() => tryRestore(0), 50)
  }, [dispatch])
  const { updateCursor } = useSessionPersistence({ tabs, activeTabId, onRestore: handleRestore })

  // File operations
  const { openFile, saveFile, saveFileAs, publishHtml } = useFileOperations({ dispatch, getTabs })

  // Script execution
  const { run: runScript, stop: handleStop, runSection: handleRunSection, runAndAdvance: handleRunAndAdvance, runWarning, clearRunWarning } = useScriptExecution({
    getActiveTab, saveFile, dispatch, engineStatus: props.engineStatus, onRun: appCtx._provided ? appCtx.onRunScript : props.onRun,
    onStop: props.onStop, onRunSection, getEditorInstance: getEditor, isPaused: pausedLocation !== null,
  })
  // For live scripts, F5 should trigger "Run All Cells" inside LiveScriptEditor
  const handleRun = useCallback(() => {
    const tab = getActiveTab()
    if (tab?.mode === 'livescript') {
      window.dispatchEvent(new CustomEvent('matslop:runAllCells'))
    } else {
      runScript()
    }
  }, [getActiveTab, runScript])

  // Debug integration
  const { isPaused, notifyFileSaved } = useDebugIntegration({
    pausedLocation: pausedLocation ?? null, tabs, activeTabId, dispatch, getEditorInstance: getEditor, onFileSavedWhilePaused: props.onFileSavedWhilePaused,
  })

  // Simple action dispatchers
  const handleNewFile = useCallback(() => dispatch({ type: 'CREATE_TAB', payload: { filename: 'untitled.m', content: '', filePath: null, mode: 'script' } }), [dispatch])
  const handleNewLiveScript = useCallback(() => dispatch({ type: 'CREATE_TAB', payload: { filename: 'untitled.mls', content: createEmptyLiveScript(), filePath: null, mode: 'livescript' } }), [dispatch])
  const handleTabSelect = useCallback((tabId: string) => dispatch({ type: 'SELECT_TAB', payload: { tabId } }), [dispatch])
  const handleContentChange = useCallback((tabId: string, content: string) => { dispatch({ type: 'UPDATE_CONTENT', payload: { tabId, content } }); clearRunWarning() }, [dispatch, clearRunWarning])
  const handleSave = useCallback(async () => { const t = getActiveTab(); if (!t) return; await saveFile(t); if (isPaused && t.filePath?.endsWith('.m')) notifyFileSaved(t.filePath) }, [getActiveTab, saveFile, isPaused, notifyFileSaved])
  const handleSaveAs = useCallback(async () => { const t = getActiveTab(); if (t) await saveFileAs(t) }, [getActiveTab, saveFileAs])
  const handlePublishHtml = useCallback(async () => { const t = getActiveTab(); if (t) await publishHtml(t) }, [getActiveTab, publishHtml])

  const handleTabClose = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.content !== tab.savedContent) {
      const response = await window.matslop.confirmClose(tab.filename)
      if (response === 2) return
      if (response === 0) {
        if (tab.filePath) { const r = await window.matslop.saveFile(tab.filePath, tab.content); if (!r.success) return }
        else { const r = await window.matslop.saveFileAs(tab.content, tab.filename); if (!r) return }
      }
    }
    dispatch({ type: 'CLOSE_TAB', payload: { tabId } })
  }, [dispatch])

  // Editor actions shared between shortcuts and menus
  const editorAction = useCallback((id: string) => () => editorRef.current?.getAction(id)?.run(), [])
  const closeActiveTab = useCallback(() => { if (activeIdRef.current) handleTabClose(activeIdRef.current) }, [handleTabClose])

  // Keyboard shortcuts
  useEditorShortcuts({
    run: handleRun, runSection: handleRunSection, runAndAdvance: handleRunAndAdvance,
    save: handleSave, saveAs: handleSaveAs, newFile: handleNewFile, openFile, closeTab: closeActiveTab, stop: handleStop,
    find: editorAction('actions.find'), findReplace: editorAction('editor.action.startFindReplaceAction'),
    goToLine: editorAction('editor.action.gotoLine'), toggleComment: editorAction('editor.action.commentLine'),
  })

  // Menu actions
  useMenuActions({ menuAction, onMenuActionConsumed, actions: {
    newFile: handleNewFile, newLiveScript: handleNewLiveScript, openFile, save: handleSave, saveAs: handleSaveAs,
    publishHtml: handlePublishHtml, closeTab: closeActiveTab, runScript: handleRun, runSection: handleRunSection,
    runAndAdvance: handleRunAndAdvance, find: editorAction('actions.find'),
    findReplace: editorAction('editor.action.startFindReplaceAction'),
    goToLine: editorAction('editor.action.gotoLine'), toggleComment: editorAction('editor.action.commentLine'),
  } })

  // Drag-and-drop
  const handleFilesDropped = useCallback((files: { path: string; name: string }[]) => {
    for (const file of files) {
      const existing = tabsRef.current.find((t) => t.filePath === file.path)
      if (existing) { dispatch({ type: 'SELECT_TAB', payload: { tabId: existing.id } }); continue }
      window.matslop.readFile(file.path).then((r) => {
        if (!r) return
        const mode = r.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
        dispatch({ type: 'CREATE_TAB', payload: { filename: r.filename, content: r.content, filePath: r.filePath, mode } })
        window.matslop.recentFilesAdd(r.filePath)
      })
    }
  }, [dispatch])
  const { isDragOver, dragHandlers } = useDragDrop({ onFilesDropped: handleFilesDropped })

  // Open file from File Browser / external request
  useEffect(() => {
    if (!openFilePath) return
    const existing = tabs.find((t) => t.filePath === openFilePath)
    if (existing) { dispatch({ type: 'SELECT_TAB', payload: { tabId: existing.id } }); onFileOpened?.(); return }
    window.matslop.readFile(openFilePath).then((r) => {
      if (r) {
        const mode = r.filename.endsWith('.mls') ? 'livescript' as const : 'script' as const
        dispatch({ type: 'CREATE_TAB', payload: { filename: r.filename, content: r.content, filePath: r.filePath, mode } })
        window.matslop.recentFilesAdd(r.filePath)
      }
      onFileOpened?.()
    })
  }, [openFilePath, onFileOpened, tabs, dispatch])

  // Find-in-Files line reveal
  useEffect(() => {
    if (openFileLine == null) return
    const id = window.setTimeout(() => {
      const ed = editorRef.current; if (!ed) return
      try { ed.revealLineInCenterIfOutsideViewport(openFileLine); ed.setPosition({ lineNumber: openFileLine, column: 1 }); ed.focus() } catch { /* */ }
    }, 150)
    return () => window.clearTimeout(id)
  }, [openFileLine, activeTabId])

  // Global Run event listener (rc-dock stale-closure workaround)
  useEffect(() => {
    const h = (): void => { handleRun() }
    window.addEventListener('matslop:runActiveScript', h)
    return () => window.removeEventListener('matslop:runActiveScript', h)
  }, [handleRun])

  // Expose active tab for App.tsx global Run handler
  useEffect(() => {
    type W = { __matslopGetActiveTabForRun?: () => { content: string; filePath: string | null; id: string } | null }
    ;(window as unknown as W).__matslopGetActiveTabForRun = () => { const t = getActiveTab(); return t ? { content: t.content, filePath: t.filePath, id: t.id } : null }
    return () => { (window as unknown as W).__matslopGetActiveTabForRun = undefined }
  }, [getActiveTab])

  const allPanels: { key: keyof PanelVisibility; label: string }[] = [
    { key: 'fileBrowser', label: 'File Browser' }, { key: 'workspace', label: 'Workspace' },
    { key: 'commandWindow', label: 'Command Window' }, { key: 'commandHistory', label: 'Command History' },
  ]
  const hiddenPanels = allPanels.filter((p) => !props.panelVisibility[p.key])

  return (
    <div className="panel editor-panel" data-testid="editor-panel" {...dragHandlers}>
      <EditorToolbar
        hasActiveFile={activeTabId !== null} isLiveScript={getActiveTab()?.mode === 'livescript'}
        onNewFile={handleNewFile} onNewLiveScript={handleNewLiveScript} onOpenFile={openFile}
        onSave={handleSave} onRun={handleRun} onStop={handleStop} onPauseForDebug={props.onPauseForDebug}
        onRunSection={handleRunSection} onRunAndAdvance={handleRunAndAdvance}
        debugPaused={pausedLocation !== null} onDebugAction={props.onDebugAction}
      />
      <div className="panel-content editor-panel-content">
        {runWarning !== null && (
          <div className="editor-run-warning" role="status" data-testid="editor-run-warning">
            <span>{runWarning}</span>
            <button type="button" className="editor-run-warning-dismiss" onClick={clearRunWarning} aria-label="Dismiss warning">×</button>
          </div>
        )}
        {isDragOver && <div className="drop-overlay"><div className="drop-overlay-content">Drop .m or .mls files to open</div></div>}
        <TabbedEditor
          tabs={tabs} activeTabId={activeTabId} onTabSelect={handleTabSelect} onTabClose={handleTabClose}
          onContentChange={handleContentChange}
          onCursorPositionChange={(line, column) => { if (activeTabId) updateCursor(activeTabId, line, column); props.onCursorPositionChange?.(line, column) }}
          onEditorRef={handleEditorRef} onErrorCountChange={props.onErrorCountChange}
          onNewFile={handleNewFile} onOpenFile={openFile}
          editorTheme={editorTheme} engineStatus={props.engineStatus} editorSettings={editorSettings}
          pausedLocation={pausedLocation ?? null}
        />
      </div>
      {hiddenPanels.length > 0 && (
        <div className="collapsed-panels-bar">
          {hiddenPanels.map((p) => (
            <button key={p.key} className="restore-panel-btn" onClick={() => props.onTogglePanel(p.key)} title={`Show ${p.label}`}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default EditorPanel
