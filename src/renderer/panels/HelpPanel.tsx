import { useMemo } from 'react'
import { splitHelpBody, type HelpSegment } from '../editor/helpDoc'
import { useAppContext } from '../AppContext'

/**
 * US-031: Help browser panel. Shows the output of `help <name>` with
 * clickable cross-references for the "See also:" section. All navigation
 * logic lives in App.tsx; this component is a dumb renderer over the
 * help-state reducer in `src/renderer/editor/helpDoc.ts`.
 *
 * US-L02: Reads help state from AppContext instead of props so that
 * rc-dock's cached element stays up-to-date without a layout rebuild.
 * Props are accepted as optional overrides for testing without a provider.
 */
export interface HelpPanelProps {
  topic?: string | null
  content?: string | null
  error?: string | null
  loading?: boolean
  canGoBack?: boolean
  onNavigate?: (topic: string) => void
  onBack?: () => void
  onClose?: () => void
}

function HelpPanel(props: HelpPanelProps): React.JSX.Element {
  const ctx = useAppContext()

  const topic = props.topic !== undefined ? props.topic : ctx.helpTopic
  const content = props.content !== undefined ? props.content : ctx.helpContent
  const error = props.error !== undefined ? props.error : ctx.helpError
  const loading = props.loading !== undefined ? props.loading : ctx.helpLoading
  const canGoBack = props.canGoBack !== undefined ? props.canGoBack : ctx.helpCanGoBack
  const onNavigate = props.onNavigate ?? ctx.onHelpNavigate
  const onBack = props.onBack ?? ctx.onHelpBack

  const segments: HelpSegment[] = useMemo(() => {
    if (!content) return []
    return splitHelpBody(content)
  }, [content])

  return (
    <div className="help-panel" data-testid="help-panel">
      <div className="help-toolbar" data-testid="help-toolbar">
        <button
          type="button"
          className="help-back-btn"
          onClick={onBack}
          disabled={!canGoBack}
          data-testid="help-back-btn"
          title="Back"
        >
          ← Back
        </button>
        <span className="help-topic" data-testid="help-topic">
          {topic ?? ''}
        </span>
      </div>
      <div className="help-body" data-testid="help-body">
        {topic == null ? (
          <div className="help-empty" data-testid="help-empty">
            Type <code>doc &lt;name&gt;</code> in the Command Window to look up
            documentation for a function.
          </div>
        ) : loading ? (
          <div className="help-loading" data-testid="help-loading">
            Loading help for <strong>{topic}</strong>…
          </div>
        ) : error ? (
          <div className="help-error" data-testid="help-error">
            <strong>Error:</strong> {error}
          </div>
        ) : (
          <pre className="help-content" data-testid="help-content">
            {segments.map((seg, i) =>
              seg.kind === 'link' ? (
                <button
                  key={i}
                  type="button"
                  className="help-xref"
                  data-testid="help-xref"
                  data-xref-target={seg.target}
                  onClick={() => onNavigate(seg.target)}
                >
                  {seg.target}
                </button>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </pre>
        )}
      </div>
    </div>
  )
}

export default HelpPanel
