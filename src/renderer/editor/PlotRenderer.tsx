import { useEffect, useRef } from 'react'
import type { PlotFigure } from '../../main/plotSchema'
import { figureToPlotly } from './plotlyAdapter'

// `plotly.js-dist-min` has no .d.ts of its own. A minimal module
// declaration lives in `src/renderer/env.d.ts` so the import below type-
// checks without pulling in @types/plotly.js (which is sized for the
// full bundle and doesn't target the -dist-min entrypoint).

export interface PlotRendererProps {
  figure: PlotFigure
  /** Explicit pixel height. Defaults to 320 for live-script inline plots. */
  height?: number
  className?: string
}

/**
 * React wrapper around the `plotly.js-dist-min` bundle. Mounts a `<div>`,
 * converts the `PlotFigure` to Plotly data/layout via the pure
 * `figureToPlotly` adapter, and calls `Plotly.react` for updates.
 *
 * The component lazily imports `plotly.js-dist-min` so tests that render
 * sibling components don't pay the 4.7 MB bundle cost unless they
 * actually mount a <PlotRenderer/>.
 */
function PlotRenderer({ figure, height = 320, className }: PlotRendererProps): React.JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const root = divRef.current
    if (!root) return

    const { data, layout, config } = figureToPlotly(figure)

    // Lazy import so tests (and the initial app bundle before the first
    // plot renders) don't pay the Plotly bundle cost up front.
    import('plotly.js-dist-min')
      .then((mod) => {
        if (cancelled || !divRef.current) return
        const Plotly = mod.default
        void Plotly.react(divRef.current, data, layout, config)
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[PlotRenderer] failed to load plotly.js-dist-min', err)
      })

    return () => {
      cancelled = true
      if (root) {
        import('plotly.js-dist-min')
          .then((mod) => {
            try {
              mod.default.purge(root)
            } catch {
              /* ignore */
            }
          })
          .catch(() => {
            /* ignore */
          })
      }
    }
  }, [figure])

  return (
    <div
      ref={divRef}
      className={`matslop-plot-renderer ${className ?? ''}`.trim()}
      data-testid="plot-renderer"
      style={{ width: '100%', height }}
    />
  )
}

export default PlotRenderer
