import { useRef, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import type { EditorTab } from './editorTypes'

interface TabbedEditorProps {
  tabs: EditorTab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onContentChange: (tabId: string, content: string) => void
  onCursorPositionChange?: (line: number, column: number) => void
  onEditorRef?: (editor: monacoEditor.IStandaloneCodeEditor | null) => void
  onNewFile?: () => void
  onOpenFile?: () => void
}

function TabbedEditor({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onContentChange,
  onCursorPositionChange,
  onEditorRef,
  onNewFile,
  onOpenFile,
}: TabbedEditorProps): React.JSX.Element {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
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
    [activeTab, onCursorPositionChange, onEditorRef]
  )

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      if (activeTabId && value !== undefined) {
        onContentChange(activeTabId, value)
      }
    },
    [activeTabId, onContentChange]
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
        {activeTab && (
          <Editor
            key={activeTab.id}
            theme="vs-dark"
            defaultLanguage={MATLAB_LANGUAGE_ID}
            value={activeTab.content}
            onChange={handleContentChange}
            onMount={handleEditorMount}
            options={{
              lineNumbers: 'on',
              folding: true,
              foldingStrategy: 'indentation',
              minimap: { enabled: true },
              fontSize: 14,
              fontFamily: "'Consolas', 'Courier New', monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              renderWhitespace: 'selection',
              wordWrap: 'off',
            }}
          />
        )}
      </div>
    </div>
  )
}

export default TabbedEditor
