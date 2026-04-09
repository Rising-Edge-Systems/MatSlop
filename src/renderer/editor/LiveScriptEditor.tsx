import { useState, useCallback, useRef, useEffect } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import Markdown from 'react-markdown'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { Plus, Trash2, Code, FileText, GripVertical } from 'lucide-react'
import {
  parseLiveScript,
  serializeLiveScript,
  type LiveScriptCell,
  type LiveScriptDocument,
} from './editorTypes'

interface LiveScriptEditorProps {
  content: string
  onContentChange: (content: string) => void
  editorTheme?: string
  editorSettings?: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
}

let cellIdCounter = 0
function nextCellId(): string {
  return `cell-${++cellIdCounter}`
}

interface CellWithId extends LiveScriptCell {
  _id: string
}

function addIds(cells: LiveScriptCell[]): CellWithId[] {
  return cells.map((c) => ({ ...c, _id: nextCellId() }))
}

function stripIds(cells: CellWithId[]): LiveScriptCell[] {
  return cells.map(({ _id, ...rest }) => rest)
}

function LiveScriptEditor({
  content,
  onContentChange,
  editorTheme,
  editorSettings,
}: LiveScriptEditorProps): React.JSX.Element {
  const [cells, setCells] = useState<CellWithId[]>(() => {
    const doc = parseLiveScript(content)
    return addIds(doc.cells)
  })
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null)
  const [addMenuIndex, setAddMenuIndex] = useState<number | null>(null)
  const contentRef = useRef(content)
  const monacoRefLocal = useRef<typeof Monaco | null>(null)

  // Sync cells back to content string when cells change
  useEffect(() => {
    const doc: LiveScriptDocument = { cells: stripIds(cells) }
    const serialized = serializeLiveScript(doc)
    if (serialized !== contentRef.current) {
      contentRef.current = serialized
      onContentChange(serialized)
    }
  }, [cells, onContentChange])

  // Update cells if content changes externally (e.g., file reload)
  useEffect(() => {
    if (content !== contentRef.current) {
      contentRef.current = content
      const doc = parseLiveScript(content)
      setCells(addIds(doc.cells))
    }
  }, [content])

  const handleCellContentChange = useCallback((cellId: string, newContent: string) => {
    setCells((prev) =>
      prev.map((c) => (c._id === cellId ? { ...c, content: newContent } : c))
    )
  }, [])

  const handleDeleteCell = useCallback((cellId: string) => {
    setCells((prev) => {
      if (prev.length <= 1) return prev // Keep at least one cell
      return prev.filter((c) => c._id !== cellId)
    })
  }, [])

  const handleAddCell = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellWithId = {
      _id: nextCellId(),
      type,
      content: type === 'code' ? '' : '',
      output: '',
    }
    setCells((prev) => {
      const next = [...prev]
      next.splice(index, 0, newCell)
      return next
    })
    setFocusedCellId(newCell._id)
    setAddMenuIndex(null)
  }, [])

  const handleAddMenuToggle = useCallback((index: number) => {
    setAddMenuIndex((prev) => (prev === index ? null : index))
  }, [])

  const handleEditorMount: OnMount = useCallback((_editor, monaco) => {
    if (!monacoRefLocal.current) {
      monacoRefLocal.current = monaco
      registerMatlabLanguage(monaco)
    }
  }, [])

  // Close add menu when clicking outside
  useEffect(() => {
    if (addMenuIndex === null) return
    const handleClick = (): void => setAddMenuIndex(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [addMenuIndex])

  const renderAddCellButton = (index: number): React.JSX.Element => (
    <div className="ls-add-cell-row" key={`add-${index}`}>
      <button
        className="ls-add-cell-btn"
        onClick={(e) => {
          e.stopPropagation()
          handleAddMenuToggle(index)
        }}
        title="Add cell"
      >
        <Plus size={14} />
      </button>
      {addMenuIndex === index && (
        <div className="ls-add-cell-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => handleAddCell(index, 'code')}>
            <Code size={14} /> Code
          </button>
          <button onClick={() => handleAddCell(index, 'markdown')}>
            <FileText size={14} /> Markdown
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="ls-editor" onClick={() => setFocusedCellId(null)}>
      <div className="ls-cells">
        {renderAddCellButton(0)}
        {cells.map((cell, idx) => (
          <div key={cell._id}>
            <div
              className={`ls-cell ${cell.type === 'code' ? 'ls-cell-code' : 'ls-cell-markdown'} ${focusedCellId === cell._id ? 'ls-cell-focused' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setFocusedCellId(cell._id)
              }}
            >
              <div className="ls-cell-gutter">
                <GripVertical size={14} className="ls-cell-drag-handle" />
                <span className="ls-cell-type-badge">
                  {cell.type === 'code' ? <Code size={12} /> : <FileText size={12} />}
                </span>
              </div>
              <div className="ls-cell-content">
                {cell.type === 'code' ? (
                  <CodeCell
                    cell={cell}
                    onChange={handleCellContentChange}
                    onMount={handleEditorMount}
                    editorTheme={editorTheme}
                    editorSettings={editorSettings}
                  />
                ) : (
                  <MarkdownCell
                    cell={cell}
                    isFocused={focusedCellId === cell._id}
                    onChange={handleCellContentChange}
                  />
                )}
              </div>
              <div className="ls-cell-actions">
                <button
                  className="ls-cell-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteCell(cell._id)
                  }}
                  title="Delete cell"
                  disabled={cells.length <= 1}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {renderAddCellButton(idx + 1)}
          </div>
        ))}
      </div>
    </div>
  )
}

interface CodeCellProps {
  cell: CellWithId
  onChange: (cellId: string, content: string) => void
  onMount: OnMount
  editorTheme?: string
  editorSettings?: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
}

function CodeCell({ cell, onChange, onMount, editorTheme, editorSettings }: CodeCellProps): React.JSX.Element {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null)

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    onMount(editor, monaco)

    // Auto-resize editor to fit content
    const updateHeight = (): void => {
      const model = editor.getModel()
      if (!model) return
      const lineCount = Math.max(model.getLineCount(), 3)
      const lineHeight = editor.getOption(editor.getOption(67) /* lineHeight */ ? 67 : 66)
      const newHeight = lineCount * (typeof lineHeight === 'number' ? lineHeight : 19) + 10
      const container = editor.getDomNode()
      if (container) {
        container.style.height = `${newHeight}px`
      }
      editor.layout()
    }

    editor.onDidChangeModelContent(updateHeight)
    // Initial layout
    setTimeout(updateHeight, 50)
  }, [onMount])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        onChange(cell._id, value)
      }
    },
    [cell._id, onChange]
  )

  return (
    <div className="ls-code-cell-editor">
      <Editor
        theme={editorTheme ?? 'vs-dark'}
        defaultLanguage={MATLAB_LANGUAGE_ID}
        value={cell.content}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          lineNumbers: 'on',
          folding: false,
          minimap: { enabled: false },
          fontSize: editorSettings?.fontSize ?? 14,
          fontFamily: editorSettings?.fontFamily ?? "'Consolas', 'Courier New', monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: editorSettings?.tabSize ?? 4,
          insertSpaces: editorSettings?.insertSpaces ?? true,
          renderWhitespace: 'selection',
          wordWrap: 'off',
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'auto',
            alwaysConsumeMouseWheel: false,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          glyphMargin: false,
        }}
      />
    </div>
  )
}

interface MarkdownCellProps {
  cell: CellWithId
  isFocused: boolean
  onChange: (cellId: string, content: string) => void
}

function MarkdownCell({ cell, isFocused, onChange }: MarkdownCellProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isFocused && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isFocused])

  // Auto-resize textarea
  useEffect(() => {
    if (isFocused && textareaRef.current) {
      const ta = textareaRef.current
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    }
  }, [isFocused, cell.content])

  if (isFocused) {
    return (
      <textarea
        ref={textareaRef}
        className="ls-markdown-editor"
        value={cell.content}
        onChange={(e) => {
          onChange(cell._id, e.target.value)
        }}
        placeholder="Write markdown here..."
      />
    )
  }

  if (!cell.content.trim()) {
    return (
      <div className="ls-markdown-preview ls-markdown-empty">
        Click to edit markdown...
      </div>
    )
  }

  return (
    <div className="ls-markdown-preview">
      <Markdown>{cell.content}</Markdown>
    </div>
  )
}

export default LiveScriptEditor
