import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PanelHeader from './PanelHeader'
import type { GitStatusEntry, ParsedDiff } from '../git/gitCore'

/**
 * US-037: Source Control panel.
 *
 * Lists staged / unstaged / untracked files, shows a diff viewer for the
 * selected file, and exposes a commit-message form plus a Commit button.
 * The panel is dumb — all git shelling lives in the main-process
 * `gitBridge.ts` module and is driven through the `window.matslop.git*`
 * IPC bridge.
 */

export interface SourceControlPanelProps {
  /** Current working directory — root of the git query. */
  cwd: string
  /** Optional close callback for the panel header. */
  onClose?: () => void
  /** Optional: observed status-result for controlled-mode tests. */
  initialStatus?: GitStatusResult | null
}

export interface GitStatusResult {
  isRepo: boolean
  repoRoot: string | null
  branch: string | null
  entries: GitStatusEntry[]
  error?: string
}

interface DiffViewState {
  path: string | null
  staged: boolean
  untracked: boolean
  diff: ParsedDiff | null
  loading: boolean
  error: string | null
}

const EMPTY_DIFF: DiffViewState = {
  path: null,
  staged: false,
  untracked: false,
  diff: null,
  loading: false,
  error: null,
}

function SourceControlPanel(props: SourceControlPanelProps): React.JSX.Element {
  const { cwd, onClose, initialStatus = null } = props
  const [status, setStatus] = useState<GitStatusResult | null>(initialStatus)
  const [loading, setLoading] = useState(false)
  const [selectedDiff, setSelectedDiff] = useState<DiffViewState>(EMPTY_DIFF)
  const [commitMessage, setCommitMessage] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [commitInFlight, setCommitInFlight] = useState(false)
  const [lastCommit, setLastCommit] = useState<string | null>(null)
  const abortedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!cwd) {
      setStatus({
        isRepo: false,
        repoRoot: null,
        branch: null,
        entries: [],
        error: 'No working directory',
      })
      return
    }
    setLoading(true)
    try {
      const result = (await window.matslop.gitStatus(cwd)) as GitStatusResult
      if (!abortedRef.current) setStatus(result)
    } catch (err) {
      if (!abortedRef.current) {
        setStatus({
          isRepo: false,
          repoRoot: null,
          branch: null,
          entries: [],
          error: String(err),
        })
      }
    } finally {
      if (!abortedRef.current) setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    abortedRef.current = false
    void refresh()
    return () => {
      abortedRef.current = true
    }
  }, [refresh])

  // Expose a test hook so Playwright can force a refresh without racing
  // the filesystem watcher.
  useEffect(() => {
    const w = window as unknown as {
      __matslopGitRefresh?: () => Promise<void>
    }
    w.__matslopGitRefresh = async () => {
      await refresh()
    }
    return () => {
      delete (window as unknown as { __matslopGitRefresh?: () => Promise<void> }).__matslopGitRefresh
    }
  }, [refresh])

  const openDiff = useCallback(
    async (entry: GitStatusEntry, staged: boolean) => {
      setSelectedDiff({
        path: entry.path,
        staged,
        untracked: entry.untracked,
        diff: null,
        loading: true,
        error: null,
      })
      try {
        const result = (await window.matslop.gitDiff(
          cwd,
          entry.path,
          staged,
          entry.untracked,
        )) as { isRepo: boolean; diff: ParsedDiff | null; error?: string }
        setSelectedDiff({
          path: entry.path,
          staged,
          untracked: entry.untracked,
          diff: result.diff,
          loading: false,
          error: result.error ?? null,
        })
      } catch (err) {
        setSelectedDiff({
          path: entry.path,
          staged,
          untracked: entry.untracked,
          diff: null,
          loading: false,
          error: String(err),
        })
      }
    },
    [cwd],
  )

  const handleStage = useCallback(
    async (entry: GitStatusEntry, stage: boolean) => {
      try {
        await window.matslop.gitStageFile(cwd, entry.path, stage)
      } catch (err) {
        // Surface as a commit error row so the user sees SOMETHING.
        setCommitError(String(err))
      }
      await refresh()
      if (selectedDiff.path === entry.path) {
        // Re-fetch the diff on the new side.
        await openDiff(entry, stage)
      }
    },
    [cwd, refresh, selectedDiff.path, openDiff],
  )

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) {
      setCommitError('Commit message is required')
      return
    }
    setCommitInFlight(true)
    setCommitError(null)
    try {
      const result = (await window.matslop.gitCommit(cwd, commitMessage)) as {
        success: boolean
        commit?: string
        error?: string
      }
      if (result.success) {
        setCommitMessage('')
        setLastCommit(result.commit ?? 'committed')
        await refresh()
      } else {
        setCommitError(result.error ?? 'commit failed')
      }
    } catch (err) {
      setCommitError(String(err))
    } finally {
      setCommitInFlight(false)
    }
  }, [cwd, commitMessage, refresh])

  const { stagedEntries, unstagedEntries, untrackedEntries } = useMemo(() => {
    const stagedEntries: GitStatusEntry[] = []
    const unstagedEntries: GitStatusEntry[] = []
    const untrackedEntries: GitStatusEntry[] = []
    if (status?.entries) {
      for (const e of status.entries) {
        if (e.untracked) {
          untrackedEntries.push(e)
          continue
        }
        if (e.staged) stagedEntries.push(e)
        if (e.unstaged) unstagedEntries.push(e)
      }
    }
    return { stagedEntries, unstagedEntries, untrackedEntries }
  }, [status])

  const stageableCount = unstagedEntries.length + untrackedEntries.length

  const renderEntry = (
    entry: GitStatusEntry,
    section: 'staged' | 'unstaged' | 'untracked',
  ): React.JSX.Element => {
    const shortName = status?.repoRoot && entry.path.startsWith(status.repoRoot)
      ? entry.path.substring(status.repoRoot.length).replace(/^[\\/]+/, '')
      : entry.path
    const isSelected = selectedDiff.path === entry.path && selectedDiff.staged === (section === 'staged')
    return (
      <li
        key={`${section}:${entry.path}`}
        className={`sc-entry${isSelected ? ' sc-entry-selected' : ''}`}
        data-testid="sc-entry"
        data-section={section}
        data-badge={entry.badge}
        data-file-path={entry.path}
      >
        <button
          type="button"
          className="sc-entry-name"
          data-testid="sc-entry-name"
          onClick={() => void openDiff(entry, section === 'staged')}
          title={entry.path}
        >
          <span className="sc-badge" data-testid="sc-badge">
            {entry.badge}
          </span>
          <span className="sc-path">{shortName}</span>
        </button>
        <button
          type="button"
          className="sc-stage-btn"
          data-testid={section === 'staged' ? 'sc-unstage-btn' : 'sc-stage-btn'}
          title={section === 'staged' ? 'Unstage' : 'Stage'}
          onClick={() => void handleStage(entry, section !== 'staged')}
        >
          {section === 'staged' ? '−' : '+'}
        </button>
      </li>
    )
  }

  return (
    <div className="source-control-panel" data-testid="source-control-panel">
      <PanelHeader title="Source Control" onCollapse={onClose} />
      <div className="sc-header" data-testid="sc-header">
        {status?.isRepo ? (
          <>
            <span className="sc-branch" data-testid="sc-branch">
              ⎇ {status.branch ?? '(detached)'}
            </span>
            <button
              type="button"
              className="sc-refresh-btn"
              data-testid="sc-refresh-btn"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh"
            >
              ↻
            </button>
          </>
        ) : (
          <span className="sc-not-repo" data-testid="sc-not-repo">
            {status?.error ?? 'Not a git repository'}
          </span>
        )}
      </div>
      {status?.isRepo && (
        <>
          <div className="sc-commit-form" data-testid="sc-commit-form">
            <textarea
              className="sc-commit-message"
              data-testid="sc-commit-message"
              placeholder="Commit message…"
              value={commitMessage}
              onChange={(e) => {
                setCommitMessage(e.target.value)
                if (commitError) setCommitError(null)
              }}
              rows={2}
              aria-label="Commit message"
            />
            <button
              type="button"
              className="sc-commit-btn"
              data-testid="sc-commit-btn"
              onClick={() => void handleCommit()}
              disabled={commitInFlight || stagedEntries.length === 0 || !commitMessage.trim()}
              title={
                stagedEntries.length === 0
                  ? 'Stage at least one file before committing'
                  : !commitMessage.trim()
                    ? 'Enter a commit message'
                    : 'Commit staged changes'
              }
            >
              {commitInFlight ? 'Committing…' : 'Commit'}
            </button>
          </div>
          {commitError && (
            <div className="sc-commit-error" data-testid="sc-commit-error">
              {commitError}
            </div>
          )}
          {lastCommit && !commitError && (
            <div className="sc-commit-success" data-testid="sc-commit-success">
              Committed: {lastCommit}
            </div>
          )}
          <div className="sc-lists" data-testid="sc-lists">
            <section className="sc-section" data-testid="sc-section-staged">
              <div className="sc-section-header">
                Staged Changes ({stagedEntries.length})
              </div>
              <ul>{stagedEntries.map((e) => renderEntry(e, 'staged'))}</ul>
            </section>
            <section className="sc-section" data-testid="sc-section-unstaged">
              <div className="sc-section-header">
                Changes ({unstagedEntries.length})
              </div>
              <ul>{unstagedEntries.map((e) => renderEntry(e, 'unstaged'))}</ul>
            </section>
            {untrackedEntries.length > 0 && (
              <section className="sc-section" data-testid="sc-section-untracked">
                <div className="sc-section-header">
                  Untracked ({untrackedEntries.length})
                </div>
                <ul>{untrackedEntries.map((e) => renderEntry(e, 'untracked'))}</ul>
              </section>
            )}
            {stageableCount === 0 && stagedEntries.length === 0 && (
              <div className="sc-clean" data-testid="sc-clean">
                Working tree clean.
              </div>
            )}
          </div>
        </>
      )}
      {selectedDiff.path && (
        <div className="sc-diff" data-testid="sc-diff">
          <div className="sc-diff-header">
            <span className="sc-diff-path" data-testid="sc-diff-path">
              {selectedDiff.path}
            </span>
            <button
              type="button"
              className="sc-diff-close"
              data-testid="sc-diff-close"
              onClick={() => setSelectedDiff(EMPTY_DIFF)}
              aria-label="Close diff"
            >
              ×
            </button>
          </div>
          {selectedDiff.loading && (
            <div className="sc-diff-loading" data-testid="sc-diff-loading">
              Loading diff…
            </div>
          )}
          {selectedDiff.error && (
            <div className="sc-diff-error" data-testid="sc-diff-error">
              {selectedDiff.error}
            </div>
          )}
          {selectedDiff.diff && selectedDiff.diff.empty && (
            <div className="sc-diff-empty" data-testid="sc-diff-empty">
              No textual diff (binary or mode-only change).
            </div>
          )}
          {selectedDiff.diff && !selectedDiff.diff.empty && (
            <div className="sc-diff-body" data-testid="sc-diff-body">
              {selectedDiff.diff.hunks.map((hunk, idx) => (
                <div key={idx} className="sc-hunk" data-testid="sc-hunk">
                  <div className="sc-hunk-header">{hunk.header}</div>
                  <pre className="sc-hunk-lines">
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        className={`sc-diff-line sc-diff-${line.kind}`}
                        data-testid={`sc-diff-line-${line.kind}`}
                      >
                        <span className="sc-diff-marker">
                          {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                        </span>
                        <span className="sc-diff-text">{line.text}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SourceControlPanel
