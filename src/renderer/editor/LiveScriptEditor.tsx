import { useState, useCallback, useRef, useEffect } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import Markdown from 'react-markdown'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { Plus, Trash2, Code, FileText, GripVertical, Play, PlayCircle, Loader, Download, ExternalLink } from 'lucide-react'
import {
  parseLiveScript,
  serializeLiveScript,
  type LiveScriptCell,
  type LiveScriptCellFigure,
  type LiveScriptDocument,
} from './editorTypes'
import type { OctaveEngineStatus } from '../App'

interface LiveScriptEditorProps {
  content: string
  onContentChange: (content: string) => void
  editorTheme?: string
  engineStatus?: OctaveEngineStatus
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
  _isError?: boolean
  _figures?: LiveScriptCellFigure[]
}

function addIds(cells: LiveScriptCell[]): CellWithId[] {
  return cells.map((c) => ({ ...c, _id: nextCellId(), _figures: c.figures }))
}

function stripIds(cells: CellWithId[]): LiveScriptCell[] {
  return cells.map(({ _id, _isError, _figures, ...rest }) => ({
    ...rest,
    figures: _figures && _figures.length > 0 ? _figures : rest.figures,
  }))
}

function LiveScriptEditor({
  content,
  onContentChange,
  editorTheme,
  engineStatus,
  editorSettings,
}: LiveScriptEditorProps): React.JSX.Element {
  const [cells, setCells] = useState<CellWithId[]>(() => {
    const doc = parseLiveScript(content)
    return addIds(doc.cells)
  })
  const [focusedCellId, setFocusedCellId] = useState<string | null>(null)
  const [addMenuIndex, setAddMenuIndex] = useState<number | null>(null)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
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

  // Capture any open figures from Octave as inline images
  const captureFigures = useCallback(async (): Promise<LiveScriptCellFigure[]> => {
    const captureScript = [
      "__mslp_fh__=get(0,'children');",
      "for __mslp_k__=1:length(__mslp_fh__);",
      "__mslp_fp__=[tempdir() 'matslop_ls_fig_' num2str(__mslp_fh__(__mslp_k__)) '.png'];",
      "try;print(__mslp_fh__(__mslp_k__),__mslp_fp__,'-dpng','-r150');",
      "disp(['__MATSLOP_LS_FIG__:' num2str(__mslp_fh__(__mslp_k__)) ':' __mslp_fp__]);",
      "catch;end;end;",
      "clear __mslp_fh__ __mslp_k__ __mslp_fp__;"
    ].join('')

    try {
      const result = await window.matslop.octaveExecute(captureScript)
      const output = result.output || ''
      const figMatches = [...output.matchAll(/__MATSLOP_LS_FIG__:(\d+):(.+)/g)]
      if (figMatches.length === 0) return []

      const figures: LiveScriptCellFigure[] = []
      for (const m of figMatches) {
        const tempPath = m[2].trim()
        const base64 = await window.matslop.figuresReadImage(tempPath)
        if (base64) {
          figures.push({
            imageDataUrl: `data:image/png;base64,${base64}`,
            tempPath,
          })
        }
      }
      return figures
    } catch {
      return []
    }
  }, [])

  // Close all open figures so the next cell starts clean
  const closeAllFigures = useCallback(async (): Promise<void> => {
    try {
      await window.matslop.octaveExecute('close all;')
    } catch {
      // ignore
    }
  }, [])

  const handleRunCell = useCallback(async (cellId: string) => {
    const cell = cells.find((c) => c._id === cellId)
    if (!cell || cell.type !== 'code' || !cell.content.trim()) return
    if (engineStatus !== 'ready') return

    // Close any existing figures before running cell
    await closeAllFigures()

    setRunningCellId(cellId)
    try {
      const result = await window.matslop.octaveExecute(cell.content)
      const output = result.error ? result.error : result.output
      const isError = !!result.error

      // Capture any figures produced by this cell
      const cellFigures = isError ? [] : await captureFigures()

      setCells((prev) =>
        prev.map((c) =>
          c._id === cellId
            ? { ...c, output: output || '', _isError: isError, _figures: cellFigures }
            : c
        )
      )
    } catch (err) {
      setCells((prev) =>
        prev.map((c) =>
          c._id === cellId
            ? { ...c, output: String(err), _isError: true, _figures: [] }
            : c
        )
      )
    } finally {
      setRunningCellId(null)
    }
  }, [cells, engineStatus, captureFigures, closeAllFigures])

  const handleRunAll = useCallback(async () => {
    if (engineStatus !== 'ready') return
    setRunningAll(true)
    const codeCells = cells.filter((c) => c.type === 'code')
    for (const cell of codeCells) {
      if (!cell.content.trim()) continue

      // Close figures before each cell so captures are cell-specific
      await closeAllFigures()

      setRunningCellId(cell._id)
      try {
        const result = await window.matslop.octaveExecute(cell.content)
        const output = result.error ? result.error : result.output
        const isError = !!result.error

        const cellFigures = isError ? [] : await captureFigures()

        setCells((prev) =>
          prev.map((c) =>
            c._id === cell._id
              ? { ...c, output: output || '', _isError: isError, _figures: cellFigures }
              : c
          )
        )
        // Stop running all if there was an error
        if (isError) break
      } catch (err) {
        setCells((prev) =>
          prev.map((c) =>
            c._id === cell._id
              ? { ...c, output: String(err), _isError: true, _figures: [] }
              : c
          )
        )
        break
      } finally {
        setRunningCellId(null)
      }
    }
    setRunningAll(false)
  }, [cells, engineStatus, captureFigures, closeAllFigures])

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

  const canRun = engineStatus === 'ready' && !runningAll

  return (
    <div className="ls-editor" onClick={() => setFocusedCellId(null)}>
      <div className="ls-toolbar">
        <button
          className="ls-run-all-btn"
          onClick={(e) => {
            e.stopPropagation()
            handleRunAll()
          }}
          disabled={!canRun}
          title="Run All Cells"
        >
          <PlayCircle size={16} />
          Run All
        </button>
      </div>
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
                {cell.type === 'code' ? (
                  runningCellId === cell._id ? (
                    <Loader size={14} className="ls-cell-running-icon" />
                  ) : (
                    <button
                      className="ls-cell-run-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRunCell(cell._id)
                      }}
                      disabled={!canRun}
                      title="Run Cell"
                    >
                      <Play size={14} />
                    </button>
                  )
                ) : (
                  <span className="ls-cell-type-badge">
                    <FileText size={12} />
                  </span>
                )}
              </div>
              <div className="ls-cell-content">
                {cell.type === 'code' ? (
                  <>
                    <CodeCell
                      cell={cell}
                      onChange={handleCellContentChange}
                      onMount={handleEditorMount}
                      editorTheme={editorTheme}
                      editorSettings={editorSettings}
                    />
                    {cell.output && (
                      <div className={`ls-cell-output ${cell._isError ? 'ls-cell-output-error' : ''}`}>
                        <pre>{cell.output}</pre>
                      </div>
                    )}
                    {(cell._figures ?? cell.figures ?? []).length > 0 && (
                      <InlinePlots figures={cell._figures ?? cell.figures ?? []} />
                    )}
                  </>
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

// Inline plot display with context menu
interface InlinePlotsProps {
  figures: LiveScriptCellFigure[]
}

function InlinePlots({ figures }: InlinePlotsProps): React.JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; figure: LiveScriptCellFigure } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, figure: LiveScriptCellFigure) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, figure })
  }, [])

  const handleSaveAs = useCallback(async () => {
    if (!contextMenu) return
    const result = await window.matslop.figuresSaveDialog('figure.png')
    if (result) {
      await window.matslop.figuresCopyFile(contextMenu.figure.tempPath, result.filePath)
    }
    setContextMenu(null)
  }, [contextMenu])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  return (
    <div className="ls-inline-plots">
      {figures.map((fig, i) => (
        <img
          key={i}
          src={fig.imageDataUrl}
          alt={`Plot ${i + 1}`}
          className="ls-inline-plot-image"
          draggable={false}
          onContextMenu={(e) => handleContextMenu(e, fig)}
        />
      ))}
      {contextMenu && (
        <div
          className="ls-plot-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={handleSaveAs}>
            <Download size={14} /> Save As Image
          </button>
          <button onClick={() => {
            // Open in the figure panel by opening a new window with the image
            const w = window.open('', '_blank', 'width=800,height=600')
            if (w) {
              w.document.write(`<html><head><title>Figure</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#1e1e1e;"><img src="${contextMenu.figure.imageDataUrl}" style="max-width:100%;max-height:100vh;"/></body></html>`)
            }
            setContextMenu(null)
          }}>
            <ExternalLink size={14} /> Open in Figure Window
          </button>
        </div>
      )}
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
