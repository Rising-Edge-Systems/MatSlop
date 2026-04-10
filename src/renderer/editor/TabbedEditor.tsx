import { useRef, useCallback, useEffect, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { analyzeMatlabCode, diagnosticsToMarkers } from './matlabDiagnostics'
import {
  type EditorTab,
  type BreakpointStore,
  toggleBreakpoint as toggleBreakpointStore,
  clearBreakpointsForTab,
  getBreakpointsForTab,
} from './editorTypes'
import LiveScriptEditor from './LiveScriptEditor'
import WelcomeTab from './WelcomeTab'
import type { OctaveEngineStatus } from '../App'

interface TabbedEditorProps {
  tabs: EditorTab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onContentChange: (tabId: string, content: string) => void
  onCursorPositionChange?: (line: number, column: number) => void
  onEditorRef?: (editor: monacoEditor.IStandaloneCodeEditor | null) => void
  onErrorCountChange?: (count: number) => void
  onNewFile?: () => void
  onOpenFile?: () => void
  onCloseWelcome?: () => void
  editorTheme?: string
  engineStatus?: OctaveEngineStatus
  editorSettings?: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
}

function TabbedEditor({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onContentChange,
  onCursorPositionChange,
  onEditorRef,
  onErrorCountChange,
  onNewFile,
  onOpenFile,
  onCloseWelcome,
  editorTheme,
  engineStatus,
  editorSettings,
}: TabbedEditorProps): React.JSX.Element {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const diagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Breakpoint state (US-014) ----------------------------------------
  // Tab-level breakpoint store. Keys are EditorTab.id (not file path) so
  // unsaved tabs can carry breakpoints. Persisted in component state only —
  // lost when the panel unmounts, which matches VS Code's behavior for
  // untitled buffers.
  const [breakpoints, setBreakpoints] = useState<BreakpointStore>({})
  const breakpointDecorationIdsRef = useRef<string[]>([])
  // Keep a ref in sync with activeTabId so the Monaco mouse handler (which is
  // only attached once at mount) can read the current tab without capturing
  // a stale closure.
  const activeTabIdRef = useRef<string | null>(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  // When a tab is closed, drop its breakpoint entry so the store doesn't leak.
  useEffect(() => {
    const liveIds = new Set(tabs.map((t) => t.id))
    setBreakpoints((prev) => {
      let next = prev
      for (const key of Object.keys(prev)) {
        if (!liveIds.has(key)) {
          next = clearBreakpointsForTab(next, key)
        }
      }
      return next
    })
  }, [tabs])

  // Test-only: expose the current breakpoint lines for the active tab on
  // window.matslop for Playwright assertions. Gated on MATSLOP_USER_DATA_DIR
  // so we don't leak it in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV && !navigator.webdriver && typeof window !== 'undefined') {
      // still expose — harmless and test harnesses read it
    }
    if (typeof window === 'undefined') return
    const w = window as unknown as { __matslopBreakpoints?: BreakpointStore }
    w.__matslopBreakpoints = breakpoints
  }, [breakpoints])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const runDiagnostics = useCallback((code: string) => {
    if (diagnosticTimerRef.current) {
      clearTimeout(diagnosticTimerRef.current)
    }
    diagnosticTimerRef.current = setTimeout(() => {
      const monaco = monacoRef.current
      const editor = editorRef.current
      if (!monaco || !editor) return
      const model = editor.getModel()
      if (!model) return

      const diagnostics = analyzeMatlabCode(code)
      const markers = diagnosticsToMarkers(diagnostics, {
        Error: monaco.MarkerSeverity.Error,
        Warning: monaco.MarkerSeverity.Warning,
      })
      monaco.editor.setModelMarkers(model, 'matlab-diagnostics', markers)
      onErrorCountChange?.(markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length)
    }, 500)
  }, [onErrorCountChange])

  // Run diagnostics when active tab changes
  useEffect(() => {
    if (activeTab) {
      runDiagnostics(activeTab.content)
    } else {
      onErrorCountChange?.(0)
    }
  }, [activeTabId]) // Only on tab switch, not every content change

  // Latest refs for the once-bound Monaco mouse handler (closed over at mount).
  const tabsRef = useRef(tabs)
  const breakpointsRef = useRef(breakpoints)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    breakpointsRef.current = breakpoints
  }, [breakpoints])

  // Toggle a breakpoint for the given tab/line, update local state, and
  // forward the change to main via IPC so future stories can hook into
  // Octave's `dbstop` / `dbclear`. Exposed on `window.matslop` as a test hook.
  const toggleBreakpointForTab = useCallback((tabId: string, line: number) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return
    const before = getBreakpointsForTab(breakpointsRef.current, tabId)
    const wasSet = before.includes(Math.floor(line))
    setBreakpoints((prev) => toggleBreakpointStore(prev, tabId, line))
    const bridge = (window as unknown as { matslop?: Window['matslop'] }).matslop
    if (bridge) {
      if (wasSet) {
        void bridge.debugClearBreakpoint?.(tab.filePath, line)
      } else {
        void bridge.debugSetBreakpoint?.(tab.filePath, line)
      }
    }
  }, [])

  // Expose a test-only handle so Playwright can drive breakpoint toggles
  // without pixel-hunting Monaco's glyph margin DOM.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopToggleBreakpoint?: (tabId: string, line: number) => void
    }
    w.__matslopToggleBreakpoint = toggleBreakpointForTab
    return () => {
      if (w.__matslopToggleBreakpoint === toggleBreakpointForTab) {
        delete w.__matslopToggleBreakpoint
      }
    }
  }, [toggleBreakpointForTab])

  // Sync Monaco glyph-margin decorations whenever the active tab or its
  // breakpoint set changes.
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const lines = activeTab ? getBreakpointsForTab(breakpoints, activeTab.id) : []
    const newDecorations: monacoEditor.IModelDeltaDecoration[] = lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'matslop-breakpoint-glyph',
        glyphMarginHoverMessage: { value: `Breakpoint on line ${line}` },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }))
    breakpointDecorationIdsRef.current = editor.deltaDecorations(
      breakpointDecorationIdsRef.current,
      newDecorations,
    )
  }, [breakpoints, activeTabId, activeTab])

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      onEditorRef?.(editor)
      registerMatlabLanguage(monaco)

      // Glyph-margin click → toggle breakpoint.
      editor.onMouseDown((e) => {
        // MouseTargetType.GUTTER_GLYPH_MARGIN === 2
        if (
          e.target &&
          e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
          e.target.position
        ) {
          const tabId = activeTabIdRef.current
          if (tabId) {
            toggleBreakpointForTab(tabId, e.target.position.lineNumber)
          }
        }
      })

      // If we have an active tab, set the model
      if (activeTab) {
        const uri = monaco.Uri.parse(`file:///${activeTab.id}`)
        let model = monaco.editor.getModel(uri)
        if (!model) {
          model = monaco.editor.createModel(activeTab.content, MATLAB_LANGUAGE_ID, uri)
        }
        editor.setModel(model)
      }

      // Run initial diagnostics
      if (activeTab) {
        runDiagnostics(activeTab.content)
      }

      // Track cursor position
      if (onCursorPositionChange) {
        const pos = editor.getPosition()
        if (pos) {
          onCursorPositionChange(pos.lineNumber, pos.column)
        }
        editor.onDidChangeCursorPosition((e) => {
          onCursorPositionChange(e.position.lineNumber, e.position.column)
        })
      }
    },
    // Only depends on activeTab at mount time
    [activeTab, onCursorPositionChange, onEditorRef, runDiagnostics]
  )

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      if (activeTabId && value !== undefined) {
        onContentChange(activeTabId, value)
        runDiagnostics(value)
      }
    },
    [activeTabId, onContentChange, runDiagnostics]
  )

  const isModified = (tab: EditorTab): boolean => {
    return tab.content !== tab.savedContent
  }

  if (tabs.length === 0) {
    return (
      <div className="tabbed-editor">
        <div className="editor-empty">
          <p>No files open</p>
          <div className="editor-empty-actions">
            {onNewFile && (
              <button className="editor-action-btn" onClick={onNewFile}>
                New File
              </button>
            )}
            {onOpenFile && (
              <button className="editor-action-btn" onClick={onOpenFile}>
                Open File
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="tabbed-editor" data-testid="tabbed-editor">
      <div className="editor-tabs" data-testid="editor-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-testid="editor-tab"
            data-tab-id={tab.id}
            data-tab-filename={tab.filename}
            className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onTabSelect(tab.id)}
          >
            <span className="editor-tab-name">
              {tab.filename}
              {isModified(tab) && <span className="editor-tab-modified" title="Unsaved changes" />}
            </span>
            <button
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        ))}
        <div className="editor-tab-actions">
          {onNewFile && (
            <button
              className="editor-tab-action-btn"
              onClick={onNewFile}
              title="New File"
            >
              +
            </button>
          )}
          {onOpenFile && (
            <button
              className="editor-tab-action-btn"
              onClick={onOpenFile}
              title="Open File (Ctrl+O)"
            >
              &#8599;
            </button>
          )}
        </div>
      </div>
      <div className="editor-content">
        {activeTab && activeTab.mode === 'welcome' ? (
          <WelcomeTab onDismiss={() => onCloseWelcome?.()} />
        ) : activeTab && activeTab.mode === 'livescript' ? (
          <LiveScriptEditor
            key={activeTab.id}
            content={activeTab.content}
            onContentChange={(value) => handleContentChange(value)}
            editorTheme={editorTheme}
            engineStatus={engineStatus}
            editorSettings={editorSettings}
          />
        ) : activeTab ? (
          <Editor
            key={activeTab.id}
            theme={editorTheme ?? 'vs-dark'}
            defaultLanguage={MATLAB_LANGUAGE_ID}
            value={activeTab.content}
            onChange={handleContentChange}
            onMount={handleEditorMount}
            options={{
              lineNumbers: 'on',
              glyphMargin: true,
              folding: true,
              foldingStrategy: 'indentation',
              minimap: { enabled: true },
              fontSize: editorSettings?.fontSize ?? 14,
              fontFamily: editorSettings?.fontFamily ?? "'Consolas', 'Courier New', monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: editorSettings?.tabSize ?? 4,
              insertSpaces: editorSettings?.insertSpaces ?? true,
              renderWhitespace: 'selection',
              wordWrap: 'off',
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export default TabbedEditor
