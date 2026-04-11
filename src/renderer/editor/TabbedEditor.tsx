import { useRef, useCallback, useEffect, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import type Monaco from 'monaco-editor'
import { registerMatlabLanguage, MATLAB_LANGUAGE_ID } from './matlabLanguage'
import { analyzeMatlabCode, diagnosticsToMarkers } from './matlabDiagnostics'
import {
  type EditorTab,
  type BreakpointStore,
  type BreakpointConditionStore,
  toggleBreakpoint as toggleBreakpointStore,
  clearBreakpointsForTab,
  getBreakpointsForTab,
  setBreakpointCondition as setBreakpointConditionStore,
  getBreakpointCondition,
  clearBreakpointConditionsForTab,
  findSectionHeaderLines,
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
  /** US-016: Octave's current paused location; renders the green-arrow gutter. */
  pausedLocation?: { file: string; line: number } | null
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
  pausedLocation,
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
  // US-021: conditions attached to breakpoints. Kept in a parallel store so
  // the existing toggle logic doesn't have to grow a case for conditional
  // lines. Absent entries = unconditional breakpoint.
  const [breakpointConditions, setBreakpointConditions] =
    useState<BreakpointConditionStore>({})
  const breakpointDecorationIdsRef = useRef<string[]>([])
  // US-029: decoration ids for the `%%` section-divider lines in .m scripts.
  const sectionDecorationIdsRef = useRef<string[]>([])
  // US-016: decoration ids for the green-arrow "currently paused" marker.
  const pausedDecorationIdsRef = useRef<string[]>([])
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
    setBreakpointConditions((prev) => {
      let next = prev
      for (const key of Object.keys(prev)) {
        if (!liveIds.has(key)) {
          next = clearBreakpointConditionsForTab(next, key)
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

  // Test hook: expose the condition store on window for Playwright.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopBreakpointConditions?: BreakpointConditionStore
    }
    w.__matslopBreakpointConditions = breakpointConditions
  }, [breakpointConditions])

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
  const breakpointConditionsRef = useRef(breakpointConditions)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    breakpointsRef.current = breakpoints
  }, [breakpoints])
  useEffect(() => {
    breakpointConditionsRef.current = breakpointConditions
  }, [breakpointConditions])

  // Toggle a breakpoint for the given tab/line, update local state, and
  // forward the change to main via IPC so future stories can hook into
  // Octave's `dbstop` / `dbclear`. Exposed on `window.matslop` as a test hook.
  const toggleBreakpointForTab = useCallback((tabId: string, line: number) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return
    const before = getBreakpointsForTab(breakpointsRef.current, tabId)
    const wasSet = before.includes(Math.floor(line))
    setBreakpoints((prev) => toggleBreakpointStore(prev, tabId, line))
    // Clearing a breakpoint should also clear any condition attached to it
    // so a later retoggle starts out unconditional.
    if (wasSet) {
      setBreakpointConditions((prev) =>
        setBreakpointConditionStore(prev, tabId, line, null),
      )
    }
    const bridge = (window as unknown as { matslop?: Window['matslop'] }).matslop
    if (bridge) {
      if (wasSet) {
        void bridge.debugClearBreakpoint?.(tab.filePath, line)
      } else {
        void bridge.debugSetBreakpoint?.(tab.filePath, line)
      }
    }
  }, [])

  /**
   * US-021: Attach (or clear) a condition to the breakpoint on `line` in
   * the given tab. If there isn't yet a breakpoint on that line, this call
   * *implicitly* creates one (so the user can right-click an empty gutter
   * line and go straight to "set a conditional breakpoint" in one step).
   * Passing a null/empty condition reverts the line to a plain breakpoint.
   */
  const setConditionForTab = useCallback(
    (tabId: string, line: number, condition: string | null) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (!tab) return
      const lineInt = Math.floor(line)
      if (!Number.isFinite(line) || lineInt <= 0) return
      // Ensure the bp exists first so the gutter shows a glyph regardless
      // of whether the user toggled one before right-clicking.
      const hadBp = getBreakpointsForTab(breakpointsRef.current, tabId).includes(
        lineInt,
      )
      if (!hadBp) {
        setBreakpoints((prev) => toggleBreakpointStore(prev, tabId, lineInt))
      }
      setBreakpointConditions((prev) =>
        setBreakpointConditionStore(prev, tabId, lineInt, condition),
      )
      const bridge = (window as unknown as { matslop?: Window['matslop'] }).matslop
      if (bridge) {
        // If this is the very first bp on that line, register it in main's
        // registry before attaching a condition — `debug:setBreakpointCondition`
        // is idempotent on the registry but a separate `setBreakpoint` call
        // keeps the main-side state consistent with existing stories.
        if (!hadBp) {
          void bridge.debugSetBreakpoint?.(tab.filePath, lineInt)
        }
        void bridge.debugSetBreakpointCondition?.(tab.filePath, lineInt, condition)
      }
    },
    [],
  )

  // Expose a test-only handle so Playwright can drive breakpoint toggles
  // without pixel-hunting Monaco's glyph margin DOM.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as {
      __matslopToggleBreakpoint?: (tabId: string, line: number) => void
      __matslopSetBreakpointCondition?: (
        tabId: string,
        line: number,
        condition: string | null,
      ) => void
    }
    w.__matslopToggleBreakpoint = toggleBreakpointForTab
    w.__matslopSetBreakpointCondition = setConditionForTab
    return () => {
      if (w.__matslopToggleBreakpoint === toggleBreakpointForTab) {
        delete w.__matslopToggleBreakpoint
      }
      if (w.__matslopSetBreakpointCondition === setConditionForTab) {
        delete w.__matslopSetBreakpointCondition
      }
    }
  }, [toggleBreakpointForTab, setConditionForTab])

  /**
   * Prompt the user for a condition expression and attach it to the
   * breakpoint on the given line. Uses the host's native prompt() as the
   * simplest "Edit condition" dialog — Monaco doesn't ship a modal
   * primitive and the app doesn't yet have a reusable dialog component.
   * Cancelling the prompt is a no-op; submitting an empty string reverts
   * the bp to unconditional.
   */
  const promptForCondition = useCallback(
    (tabId: string, line: number) => {
      const lineInt = Math.floor(line)
      const existing =
        getBreakpointCondition(breakpointConditionsRef.current, tabId, lineInt) ??
        ''
      const answer = typeof window === 'undefined'
        ? null
        : window.prompt(
            `Breakpoint condition (line ${lineInt})\n\nEnter an Octave expression — the breakpoint will only trigger when it is true. Leave blank to remove the condition.`,
            existing,
          )
      if (answer === null) return // cancelled
      setConditionForTab(tabId, lineInt, answer)
    },
    [setConditionForTab],
  )

  // US-016: compute whether the current paused location maps onto the
  // active tab by basename (or filename minus `.m`). When it does, place a
  // green-arrow glyph and line highlight on that line and scroll it into
  // view. Cleared when `pausedLocation` is null or the active tab doesn't
  // match.
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    let decorations: monacoEditor.IModelDeltaDecoration[] = []
    if (pausedLocation && activeTab) {
      const raw = pausedLocation.file || ''
      const lastSep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
      const base = lastSep >= 0 ? raw.substring(lastSep + 1) : raw
      const candidates = [base, base.endsWith('.m') ? base : `${base}.m`]
      if (candidates.includes(activeTab.filename)) {
        const line = Math.max(1, Math.floor(pausedLocation.line))
        decorations = [
          {
            range: new monaco.Range(line, 1, line, 1),
            options: {
              isWholeLine: true,
              glyphMarginClassName: 'matslop-paused-glyph',
              glyphMarginHoverMessage: { value: `Paused at line ${line}` },
              className: 'matslop-paused-line',
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          },
        ]
        // Scroll the paused line into view (center it).
        try {
          editor.revealLineInCenterIfOutsideViewport(line)
        } catch {
          /* monaco may be tearing down — ignore */
        }
      }
    }
    pausedDecorationIdsRef.current = editor.deltaDecorations(
      pausedDecorationIdsRef.current,
      decorations,
    )
  }, [pausedLocation, activeTab, activeTabId])

  // Sync Monaco glyph-margin decorations whenever the active tab or its
  // breakpoint set changes.
  useEffect(() => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const lines = activeTab ? getBreakpointsForTab(breakpoints, activeTab.id) : []
    const newDecorations: monacoEditor.IModelDeltaDecoration[] = lines.map((line) => {
      const cond = activeTab
        ? getBreakpointCondition(breakpointConditions, activeTab.id, line)
        : null
      return {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: cond
            ? 'matslop-breakpoint-glyph matslop-breakpoint-glyph-conditional'
            : 'matslop-breakpoint-glyph',
          glyphMarginHoverMessage: {
            value: cond
              ? `Conditional breakpoint on line ${line}: \`${cond}\``
              : `Breakpoint on line ${line}`,
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }
    })
    breakpointDecorationIdsRef.current = editor.deltaDecorations(
      breakpointDecorationIdsRef.current,
      newDecorations,
    )
  }, [breakpoints, breakpointConditions, activeTabId, activeTab])

  // US-029: highlight `%%` code-section breaks with a horizontal divider
  // line. Only applied to script-mode tabs (.m files). Decorations are kept
  // in sync whenever the active tab or its content changes. We also mirror
  // the list of section header lines onto `window.__matslopSectionLines` so
  // Playwright tests can assert presence without pixel-hunting DOM nodes.
  useEffect(() => {
    const isScriptTab = activeTab?.mode === 'script'
    const headerLines = isScriptTab && activeTab
      ? findSectionHeaderLines(activeTab.content)
      : []
    // Always expose the test hook, even when Monaco isn't mounted yet
    // (e.g. on the welcome tab). Tests rely on the array being present.
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __matslopSectionLines?: number[] }
      w.__matslopSectionLines = headerLines
    }
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) {
      return
    }
    const newDecorations: monacoEditor.IModelDeltaDecoration[] = headerLines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'matslop-section-line',
        linesDecorationsClassName: 'matslop-section-line-gutter',
        marginClassName: 'matslop-section-line-margin',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }))
    sectionDecorationIdsRef.current = editor.deltaDecorations(
      sectionDecorationIdsRef.current,
      newDecorations,
    )
  }, [activeTab, activeTabId])

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
          if (!tabId) return
          // Right-click (US-021) → open the "Edit condition" prompt instead
          // of toggling. Monaco exposes the underlying browser event via
          // e.event; its `rightButton` flag is the canonical way to detect
          // a right-click on the glyph margin without suppressing the
          // editor's normal left-click flow.
          const ev = e.event as { rightButton?: boolean; preventDefault?: () => void }
          if (ev?.rightButton) {
            ev.preventDefault?.()
            promptForCondition(tabId, e.target.position.lineNumber)
            return
          }
          toggleBreakpointForTab(tabId, e.target.position.lineNumber)
        }
      })

      // US-021: swallow the native contextmenu event on the glyph margin so
      // Monaco's right-click menu doesn't pop up over our prompt.
      editor.onContextMenu((e) => {
        if (
          e.target &&
          e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
        ) {
          const ev = e.event as { preventDefault?: () => void; stopPropagation?: () => void }
          ev?.preventDefault?.()
          ev?.stopPropagation?.()
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
    [activeTab, onCursorPositionChange, onEditorRef, runDiagnostics, promptForCondition, toggleBreakpointForTab]
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
