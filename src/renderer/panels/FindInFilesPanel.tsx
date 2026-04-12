import { useCallback, useEffect, useRef, useState } from 'react'
import { truncateContext } from '../editor/findInFiles'
import { useAppContext } from '../AppContext'

/**
 * US-032: Find in Files panel.
 *
 * A small search UI that lives as a dock tab. The user types a query
 * and (optionally) a glob pattern, hits Enter or clicks Search, and the
 * panel calls `window.matslop.findInFiles(cwd, query, options)` to walk
 * the current working directory in the main process. Results are shown
 * grouped by file; clicking a result calls the provided `onOpenMatch`
 * callback to navigate to the file at the matched line.
 *
 * The panel owns its own input / result state so that navigating away
 * (e.g. closing the panel) and reopening returns to the same results.
 */
export interface FindInFilesMatch {
  file: string
  line: number
  column: number
  text: string
}

/**
 * US-L02: cwd is now read from AppContext so rc-dock's cached element
 * stays up-to-date without a layout rebuild. The prop is still accepted
 * as an optional override for testing.
 */
export interface FindInFilesPanelProps {
  /** Current working directory — the root of the search. Read from AppContext if omitted. */
  cwd?: string
  /** Called with (filePath, line) when a result is clicked. */
  onOpenMatch: (filePath: string, line: number) => void
  /** Optional: called when the user hits the panel close button. */
  onClose?: () => void
  /** Test-only: pre-populate the query field. */
  initialQuery?: string
  initialGlob?: string
}

interface SearchState {
  loading: boolean
  matches: FindInFilesMatch[]
  filesScanned: number
  truncated: boolean
  error: string | null
  ranQuery: string
}

const EMPTY_STATE: SearchState = {
  loading: false,
  matches: [],
  filesScanned: 0,
  truncated: false,
  error: null,
  ranQuery: '',
}

function shortenPath(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd)) {
    const rel = filePath.substring(cwd.length)
    return rel.replace(/^[\\/]+/, '') || filePath
  }
  return filePath
}

function FindInFilesPanel(props: FindInFilesPanelProps): React.JSX.Element {
  const ctx = useAppContext()
  const cwd = props.cwd !== undefined ? props.cwd : ctx.cwd
  const { onOpenMatch, onClose, initialQuery = '', initialGlob = '' } = props
  const [query, setQuery] = useState(initialQuery)
  const [glob, setGlob] = useState(initialGlob)
  const [caseInsensitive, setCaseInsensitive] = useState(true)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [state, setState] = useState<SearchState>(EMPTY_STATE)
  const queryInputRef = useRef<HTMLInputElement>(null)

  const runSearch = useCallback(async () => {
    const q = query
    if (!q) {
      setState({ ...EMPTY_STATE, ranQuery: '' })
      return
    }
    if (!cwd) {
      setState({
        ...EMPTY_STATE,
        error: 'No working directory set.',
        ranQuery: q,
      })
      return
    }
    setState((prev) => ({ ...prev, loading: true, error: null, ranQuery: q }))
    try {
      const result = await window.matslop.findInFiles(cwd, q, {
        glob,
        caseInsensitive,
        wholeWord,
        regex,
      })
      setState({
        loading: false,
        matches: result.matches,
        filesScanned: result.filesScanned,
        truncated: result.truncated,
        error: result.error ?? null,
        ranQuery: q,
      })
    } catch (err) {
      setState({
        loading: false,
        matches: [],
        filesScanned: 0,
        truncated: false,
        error: String(err),
        ranQuery: q,
      })
    }
  }, [query, glob, caseInsensitive, wholeWord, regex, cwd])

  // Focus the query input whenever this panel is (re)mounted. Since the
  // dock rebuilds the panel when the Find-in-Files tab is toggled via
  // Ctrl+Shift+F, this gives the shortcut immediate type-to-search
  // behavior without having to click the field first.
  useEffect(() => {
    queryInputRef.current?.focus()
    queryInputRef.current?.select()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void runSearch()
    }
  }

  // Group matches by file for the results list.
  const groups: Array<{ file: string; matches: FindInFilesMatch[] }> = []
  const groupIndex = new Map<string, number>()
  for (const m of state.matches) {
    const idx = groupIndex.get(m.file)
    if (idx === undefined) {
      groupIndex.set(m.file, groups.length)
      groups.push({ file: m.file, matches: [m] })
    } else {
      groups[idx].matches.push(m)
    }
  }

  return (
    <div className="find-in-files-panel" data-testid="find-in-files-panel">
      <div className="find-in-files-controls" data-testid="find-in-files-controls">
        <input
          ref={queryInputRef}
          type="text"
          className="find-in-files-query"
          data-testid="find-in-files-query"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search query"
        />
        <input
          type="text"
          className="find-in-files-glob"
          data-testid="find-in-files-glob"
          placeholder="files to include (e.g. *.m,*.mls)"
          value={glob}
          onChange={(e) => setGlob(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="File glob filter"
        />
        <div className="find-in-files-options">
          <label>
            <input
              type="checkbox"
              checked={caseInsensitive}
              onChange={(e) => setCaseInsensitive(e.target.checked)}
              data-testid="find-in-files-case-insensitive"
            />
            Ignore case
          </label>
          <label>
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
              data-testid="find-in-files-whole-word"
            />
            Whole word
          </label>
          <label>
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => setRegex(e.target.checked)}
              data-testid="find-in-files-regex"
            />
            Regex
          </label>
          <button
            type="button"
            className="find-in-files-search-btn"
            data-testid="find-in-files-search"
            onClick={() => {
              void runSearch()
            }}
            disabled={state.loading || !query}
          >
            {state.loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
      <div className="find-in-files-status" data-testid="find-in-files-status">
        {state.error ? (
          <span className="find-in-files-error" data-testid="find-in-files-error">
            Error: {state.error}
          </span>
        ) : state.ranQuery === '' ? (
          <span>Type a query and press Enter to search {cwd || '…'}</span>
        ) : state.loading ? (
          <span>Searching {cwd}…</span>
        ) : (
          <span>
            {state.matches.length} match{state.matches.length === 1 ? '' : 'es'}{' '}
            in {groups.length} file{groups.length === 1 ? '' : 's'}
            {' '}
            ({state.filesScanned} scanned{state.truncated ? ', truncated' : ''})
          </span>
        )}
      </div>
      <div className="find-in-files-results" data-testid="find-in-files-results">
        {groups.length === 0 && !state.loading && state.ranQuery !== '' && !state.error && (
          <div className="find-in-files-empty" data-testid="find-in-files-empty">
            No matches for <strong>{state.ranQuery}</strong>.
          </div>
        )}
        {groups.map((group) => (
          <div
            key={group.file}
            className="find-in-files-group"
            data-testid="find-in-files-group"
            data-file-path={group.file}
          >
            <div className="find-in-files-group-header" title={group.file}>
              {shortenPath(group.file, cwd)}{' '}
              <span className="find-in-files-group-count">
                ({group.matches.length})
              </span>
            </div>
            <ul>
              {group.matches.map((m, idx) => (
                <li key={`${m.file}:${m.line}:${idx}`}>
                  <button
                    type="button"
                    className="find-in-files-result"
                    data-testid="find-in-files-result"
                    data-file-path={m.file}
                    data-line={m.line}
                    onClick={() => onOpenMatch(m.file, m.line)}
                    title={`${group.file}:${m.line}`}
                  >
                    <span className="find-in-files-line">{m.line}</span>
                    <span className="find-in-files-context">
                      {truncateContext(m.text)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export default FindInFilesPanel
