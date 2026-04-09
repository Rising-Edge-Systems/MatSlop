import { useRef, useCallback, useEffect } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { analyzeMatlabCode, diagnosticsToMarkers } from './matlabDiagnostics'
import type { EditorTab } from './editorTypes'
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

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      onEditorRef?.(editor)
      registerMatlabLanguage(monaco)

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
    <div className="tabbed-editor">
      <div className="editor-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
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
