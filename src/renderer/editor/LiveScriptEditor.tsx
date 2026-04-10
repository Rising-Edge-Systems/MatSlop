import { Fragment, useState, useCallback, useRef, useEffect } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import Markdown from 'react-markdown'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { Plus, Trash2, Code, FileText, GripVertical, Play, PlayCircle, Loader } from 'lucide-react'
import InteractivePlot from './InteractivePlot'
import {
  parseLiveScript,
  serializeLiveScript,
  splitStatements,
  reorderCells,
  type LiveScriptCell,
  type LiveScriptCellFigure,
  type LiveScriptStatementResult,
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
  _statementResults?: LiveScriptStatementResult[]
}

function addIds(cells: LiveScriptCell[]): CellWithId[] {
  return cells.map((c) => ({
    ...c,
    _id: nextCellId(),
    _figures: c.figures,
    _statementResults: c.statementResults,
  }))
}

function stripIds(cells: CellWithId[]): LiveScriptCell[] {
  return cells.map(({ _id, _isError, _figures, _statementResults, ...rest }) => ({
    ...rest,
    figures: _figures && _figures.length > 0 ? _figures : rest.figures,
    statementResults: _statementResults,
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
  const [draggedCellId, setDraggedCellId] = useState<string | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null)
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

  // Drag and drop handlers for cell reordering
  const handleDragStart = useCallback((e: React.DragEvent, cellId: string) => {
    setDraggedCellId(cellId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', cellId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedCellId(null)
    setDropTargetIndex(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetIndex(index)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (draggedCellId === null) return

    setCells((prev) => {
      const sourceIndex = prev.findIndex((c) => c._id === draggedCellId)
      if (sourceIndex === -1) return prev
      return reorderCells(prev, sourceIndex, targetIndex)
    })
    setDraggedCellId(null)
    setDropTargetIndex(null)
  }, [draggedCellId])

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

  /**
   * Execute a cell as a single compound Octave script, capturing figure
   * snapshots between plot groups. A "plot group" is the sequence starting
   * at a plot-creating call (plot/surf/bar/...) and ending just before the
   * next plot-creating call or end of cell. The snapshot is taken at the
   * END of each group so modifier commands (xlabel, title, etc.) are
   * included in the captured image.
   *
   * Design goals:
   *   - Single octaveExecute call → no flickering
   *   - Figures anchored to the plot statement that started their group
   *   - Label/title modifiers reflected in the captured snapshot
   */
  const runCellStatements = useCallback(async (cellContent: string): Promise<{
    aggregateOutput: string
    aggregateFigures: LiveScriptCellFigure[]
    statementResults: LiveScriptStatementResult[]
    isError: boolean
  }> => {
    const plotCreator = /\b(figure|plot|plot3|surf|surfc|surfl|mesh|meshc|bar|bar3|barh|hist|histogram|scatter|scatter3|contour|contourf|contour3|imshow|imagesc|image|pcolor|stem|stem3|stairs|area|fill|fill3|pie|pie3|polar|polarplot|semilogx|semilogy|loglog|quiver|quiver3|streamline|ezplot|ezplot3|ezsurf|ezmesh|ezcontour|fplot|fplot3|fsurf|fcontour|subplot|compass|feather|rose|errorbar|boxplot|heatmap|waterfall|ribbon|trisurf|trimesh|triplot)\s*\(/

    const statements = splitStatements(cellContent)
    if (statements.length === 0) {
      return { aggregateOutput: '', aggregateFigures: [], statementResults: [], isError: false }
    }

    // Unique run ID so consecutive runs don't collide on tempfile paths
    const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Walk statements and produce the compound script.
    // `pendingLine` is the anchor line for the currently-building plot group.
    const scriptParts: string[] = []
    const anchorLines: number[] = [] // parallel list of lines that each snapshot N anchors to
    let pendingLine = 0
    let snapCount = 0

    const emitSnapshot = (lineToAnchor: number): void => {
      snapCount++
      const snapId = snapCount
      anchorLines.push(lineToAnchor)
      // Build the capture script. Use tempdir() and an absolute, safe path.
      // Use str2double/sprintf via direct string building.
      scriptParts.push(
        `__mslp_snap_path__ = [tempdir() '__mslp_${runId}_snap_${snapId}.png'];`
      )
      scriptParts.push(
        `try; if ~isempty(get(0,'children')); print(gcf, __mslp_snap_path__, '-dpng', '-r100'); disp(['__MSLP_FIG__:${lineToAnchor}:' __mslp_snap_path__]); close(gcf); end; catch; end;`
      )
    }

    for (const stmt of statements) {
      const isPlot = plotCreator.test(stmt.code)

      // Before starting a new plot group, snapshot the previous one
      if (isPlot && pendingLine > 0) {
        emitSnapshot(pendingLine)
        pendingLine = 0
      }

      // Insert the user's statement
      scriptParts.push(stmt.code)

      if (isPlot) {
        // The anchor line for this group = the line of the plot creator
        pendingLine = stmt.startLine + stmt.lineCount - 1
      }
    }

    // End of cell: finalize any pending plot group
    if (pendingLine > 0) {
      emitSnapshot(pendingLine)
    }

    // Clean up temporaries at the end
    scriptParts.push(`clear __mslp_snap_path__;`)

    const compoundScript = scriptParts.join('\n')

    // Execute as one command
    await closeAllFigures()
    const result = await window.matslop.octaveExecute(compoundScript)
    const isError = !!result.error
    const stdoutText = result.output || ''
    const stderrText = result.error || ''

    // Parse snapshot markers from stdout (markers are printed via disp())
    const figMatches = [...stdoutText.matchAll(/__MSLP_FIG__:(\d+):(.+)/g)]
    // Clean the user-visible output: strip markers from stdout, combine with stderr
    const cleanedStdout = stdoutText.replace(/__MSLP_FIG__:\d+:.+\n?/g, '').trim()
    const aggregateOutput = isError
      ? [cleanedStdout, stderrText].filter(Boolean).join('\n').trim()
      : cleanedStdout

    // Load each snapshot PNG as base64 and build per-line figure lists
    const figuresByLine: Map<number, LiveScriptCellFigure[]> = new Map()
    const aggregateFigures: LiveScriptCellFigure[] = []
    for (const m of figMatches) {
      const line = parseInt(m[1], 10)
      const tempPath = m[2].trim()
      const base64 = await window.matslop.figuresReadImage(tempPath)
      if (base64) {
        const fig: LiveScriptCellFigure = {
          imageDataUrl: `data:image/png;base64,${base64}`,
          tempPath,
        }
        const list = figuresByLine.get(line) ?? []
        list.push(fig)
        figuresByLine.set(line, list)
        aggregateFigures.push(fig)
      }
    }

    // Build statement results: one entry per unique anchor line (for figures),
    // plus one entry at line 1 for any remaining text output.
    const statementResults: LiveScriptStatementResult[] = []
    const sortedLines = [...figuresByLine.keys()].sort((a, b) => a - b)
    for (const line of sortedLines) {
      statementResults.push({
        startLine: line,
        lineCount: 1,
        figures: figuresByLine.get(line),
      })
    }
    if (aggregateOutput) {
      statementResults.push({
        startLine: 1,
        lineCount: 1,
        output: aggregateOutput,
        isError: isError || undefined,
      })
    }

    return { aggregateOutput, aggregateFigures, statementResults, isError }
  }, [closeAllFigures])

  const handleRunCell = useCallback(async (cellId: string) => {
    const cell = cells.find((c) => c._id === cellId)
    if (!cell || cell.type !== 'code' || !cell.content.trim()) return
    if (engineStatus !== 'ready') return

    setRunningCellId(cellId)
    try {
      const { aggregateOutput, aggregateFigures, statementResults, isError } =
        await runCellStatements(cell.content)

      setCells((prev) =>
        prev.map((c) =>
          c._id === cellId
            ? {
                ...c,
                output: aggregateOutput,
                _isError: isError,
                _figures: aggregateFigures,
                _statementResults: statementResults,
              }
            : c
        )
      )
    } catch (err) {
      setCells((prev) =>
        prev.map((c) =>
          c._id === cellId
            ? { ...c, output: String(err), _isError: true, _figures: [], _statementResults: [] }
            : c
        )
      )
    } finally {
      setRunningCellId(null)
    }
  }, [cells, engineStatus, runCellStatements])

  const handleRunAll = useCallback(async () => {
    if (engineStatus !== 'ready') return
    setRunningAll(true)
    const codeCells = cells.filter((c) => c.type === 'code')
    for (const cell of codeCells) {
      if (!cell.content.trim()) continue

      setRunningCellId(cell._id)
      try {
        const { aggregateOutput, aggregateFigures, statementResults, isError } =
          await runCellStatements(cell.content)

        setCells((prev) =>
          prev.map((c) =>
            c._id === cell._id
              ? {
                  ...c,
                  output: aggregateOutput,
                  _isError: isError,
                  _figures: aggregateFigures,
                  _statementResults: statementResults,
                }
              : c
          )
        )
        if (isError) break
      } catch (err) {
        setCells((prev) =>
          prev.map((c) =>
            c._id === cell._id
              ? { ...c, output: String(err), _isError: true, _figures: [], _statementResults: [] }
              : c
          )
        )
        break
      } finally {
        setRunningCellId(null)
      }
    }
    setRunningAll(false)
  }, [cells, engineStatus, runCellStatements])

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
      <div
        className={`ls-cells ls-cells-grid ${draggedCellId !== null ? 'ls-cells-dragging' : ''}`}
        data-testid="ls-cells"
      >
        {renderAddCellButton(0)}
        {cells.map((cell, idx) => {
          const isHovered = hoveredCellId === cell._id
          const isFocused = focusedCellId === cell._id
          const isDragging = draggedCellId === cell._id
          const commonCellClasses = [
            'ls-cell',
            cell.type === 'code' ? 'ls-cell-code' : 'ls-cell-markdown',
            isFocused ? 'ls-cell-focused' : '',
            isDragging ? 'ls-cell-dragging' : '',
            isHovered ? 'ls-cell-hover' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const gutter = (
            <div className="ls-cell-gutter">
              <div
                className="ls-cell-drag-handle"
                data-testid="ls-cell-drag-handle"
                draggable
                onDragStart={(e) => handleDragStart(e, cell._id)}
                onDragEnd={handleDragEnd}
              >
                <GripVertical size={14} />
              </div>
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
          )
          const actions = (
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
          )
          return (
            <Fragment key={cell._id}>
              <div
                className={`ls-drop-zone ${dropTargetIndex === idx && draggedCellId !== null ? 'ls-drop-zone-active' : ''}`}
                data-testid="ls-drop-zone"
                data-drop-index={idx}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
              />
              {cell.type === 'code' ? (
                <>
                  <div
                    className={`${commonCellClasses} ls-cell-code-side`}
                    data-testid="ls-cell"
                    data-cell-index={idx}
                    data-cell-type="code"
                    data-cell-id={cell._id}
                    onMouseEnter={() => setHoveredCellId(cell._id)}
                    onMouseLeave={() => setHoveredCellId(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFocusedCellId(cell._id)
                    }}
                  >
                    {gutter}
                    <div className="ls-cell-code-col">
                      <CodeCell
                        cell={cell}
                        onChange={handleCellContentChange}
                        onMount={handleEditorMount}
                        editorTheme={editorTheme}
                        editorSettings={editorSettings}
                      />
                    </div>
                    {actions}
                  </div>
                  <div
                    className={`ls-cell-output-col ls-cell-output-side ${isHovered ? 'ls-cell-hover' : ''} ${isFocused ? 'ls-cell-focused' : ''}`}
                    data-testid="ls-cell-output"
                    data-cell-id={cell._id}
                    data-cell-index={idx}
                    onMouseEnter={() => setHoveredCellId(cell._id)}
                    onMouseLeave={() => setHoveredCellId(null)}
                  >
                    <StatementResultsColumn cell={cell} />
                  </div>
                </>
              ) : (
                <div
                  className={`${commonCellClasses} ls-cell-md-full`}
                  data-testid="ls-cell"
                  data-cell-index={idx}
                  data-cell-type="markdown"
                  data-cell-id={cell._id}
                  onMouseEnter={() => setHoveredCellId(cell._id)}
                  onMouseLeave={() => setHoveredCellId(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setFocusedCellId(cell._id)
                  }}
                >
                  {gutter}
                  <div className="ls-cell-content">
                    <MarkdownCell
                      cell={cell}
                      isFocused={focusedCellId === cell._id}
                      onChange={handleCellContentChange}
                    />
                  </div>
                  {actions}
                </div>
              )}
              {renderAddCellButton(idx + 1)}
            </Fragment>
          )
        })}
        {draggedCellId !== null && (
          <div
            className={`ls-drop-zone ls-drop-zone-last ${dropTargetIndex === cells.length ? 'ls-drop-zone-active' : ''}`}
            data-testid="ls-drop-zone"
            data-drop-index={cells.length}
            onDragOver={(e) => handleDragOver(e, cells.length)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, cells.length)}
          />
        )}
      </div>
    </div>
  )
}

// Inline plot display with context menu
interface InlinePlotsProps {
  figures: LiveScriptCellFigure[]
}

function InlinePlots({ figures }: InlinePlotsProps): React.JSX.Element {
  const handleSaveAs = useCallback(async (figure: LiveScriptCellFigure) => {
    const result = await window.matslop.figuresSaveDialog('figure.png')
    if (result) {
      await window.matslop.figuresCopyFile(figure.tempPath, result.filePath)
    }
  }, [])

  return (
    <div className="ls-inline-plots">
      {figures.map((fig, i) => (
        <InteractivePlot
          key={i}
          src={fig.imageDataUrl}
          alt={`Plot ${i + 1}`}
          onSaveAs={() => handleSaveAs(fig)}
        />
      ))}
    </div>
  )
}

interface StatementResultsColumnProps {
  cell: CellWithId
}

/**
 * Renders per-statement results in the right column. Results stack
 * compactly in the source-line order they were produced, without artificial
 * line-based gaps. The container grows with its content so the cell height
 * accommodates all outputs.
 */
function StatementResultsColumn({ cell }: StatementResultsColumnProps): React.JSX.Element {
  const results = cell._statementResults ?? cell.statementResults
  const hasStatementResults = results && results.length > 0

  if (!hasStatementResults) {
    return (
      <>
        {cell.output && (
          <div className={`ls-cell-output ${cell._isError ? 'ls-cell-output-error' : ''}`}>
            <pre>{cell.output}</pre>
          </div>
        )}
        {(cell._figures ?? cell.figures ?? []).length > 0 && (
          <InlinePlots figures={cell._figures ?? cell.figures ?? []} />
        )}
      </>
    )
  }

  // Sort by source line so outputs appear in execution order
  const sorted = [...results].sort((a, b) => a.startLine - b.startLine)
  return (
    <div className="ls-statement-results">
      {sorted.map((r, i) => (
        <div key={i} className="ls-statement-result">
          {r.output && (
            <div className={`ls-cell-output ${r.isError ? 'ls-cell-output-error' : ''}`}>
              <pre>{r.output}</pre>
            </div>
          )}
          {r.figures && r.figures.length > 0 && (
            <InlinePlots figures={r.figures} />
          )}
        </div>
      ))}
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
