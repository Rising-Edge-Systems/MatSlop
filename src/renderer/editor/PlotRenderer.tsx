import { useEffect, useRef } from 'react'
import type { PlotFigure } from '../../main/plotSchema'
import { figureToPlotly, formatCursorLabel } from './plotlyAdapter'

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
 * Data-cursor behaviour (US-010):
 * - `layout.hovermode` is `'closest'` so Plotly's default hover tooltips
 *   already show (x, y) / (x, y, z) while the mouse is over a point.
 * - `plotly_click` handler pins the tooltip as an annotation that survives
 *   mouseout. 2D clicks append to `layout.annotations`, 3D clicks append to
 *   `layout.scene.annotations` (Plotly's per-scene annotation bucket).
 * - `plotly_clickannotation` removes a pinned annotation when it's clicked.
 * - `plotly_doubleclick` clears all pinned annotations.
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
        const el = divRef.current as HTMLDivElement & {
          on?: (event: string, handler: (ev: unknown) => void) => void
          layout?: { annotations?: unknown[]; scene?: { annotations?: unknown[] } }
        }
        void Plotly.react(el, data, layout, config).then(() => {
          if (cancelled) return
          // Wire US-010 click-to-pin handlers. Plotly extends the div with
          // an `on()` jquery-like method after the first newPlot/react call.
          if (typeof el.on !== 'function') return

          el.on('plotly_click', (ev: unknown) => {
            const evt = ev as {
              points?: Array<{
                x?: number
                y?: number
                z?: number
                data?: { type?: string; scene?: string }
                xaxis?: { _name?: string }
                yaxis?: { _name?: string }
              }>
            }
            const pt = evt.points?.[0]
            if (!pt) return
            const text = formatCursorLabel({ x: pt.x, y: pt.y, z: pt.z })
            const traceType = pt.data?.type ?? ''
            const is3D =
              traceType === 'scatter3d' ||
              traceType === 'surface' ||
              traceType === 'mesh3d' ||
              traceType === 'cone'

            if (is3D) {
              const sceneKey = (pt.data?.scene as string | undefined) ?? 'scene'
              const current = (el.layout as { [k: string]: { annotations?: unknown[] } } | undefined)?.[
                sceneKey
              ]?.annotations
              const next = [
                ...((current as unknown[]) ?? []),
                {
                  x: pt.x,
                  y: pt.y,
                  z: pt.z,
                  text,
                  showarrow: true,
                  arrowhead: 2,
                  ax: 20,
                  ay: -30,
                  bgcolor: 'rgba(255,255,255,0.95)',
                  bordercolor: '#333',
                  borderwidth: 1,
                  font: { size: 11, color: '#111' },
                  captureevents: true,
                },
              ]
              void Plotly.relayout(el, { [`${sceneKey}.annotations`]: next })
            } else {
              const current = (el.layout?.annotations as unknown[] | undefined) ?? []
              const next = [
                ...current,
                {
                  x: pt.x,
                  y: pt.y,
                  xref: pt.xaxis?._name ?? 'x',
                  yref: pt.yaxis?._name ?? 'y',
                  text,
                  showarrow: true,
                  arrowhead: 2,
                  ax: 20,
                  ay: -30,
                  bgcolor: 'rgba(255,255,255,0.95)',
                  bordercolor: '#333',
                  borderwidth: 1,
                  font: { size: 11, color: '#111' },
                  captureevents: true,
                },
              ]
              void Plotly.relayout(el, { annotations: next })
            }
          })

          el.on('plotly_clickannotation', (ev: unknown) => {
            const evt = ev as { index?: number; annotation?: { text?: string } }
            if (typeof evt.index !== 'number') return
            const current = (el.layout?.annotations as unknown[] | undefined) ?? []
            const next = current.filter((_, i) => i !== evt.index)
            void Plotly.relayout(el, { annotations: next })
          })

          el.on('plotly_doubleclick', () => {
            const relayoutUpdate: Record<string, unknown> = { annotations: [] }
            // Clear per-scene annotations for any 3D scenes present.
            const layoutAny = el.layout as Record<string, unknown> | undefined
            if (layoutAny) {
              for (const key of Object.keys(layoutAny)) {
                if (key === 'scene' || /^scene\d+$/.test(key)) {
                  relayoutUpdate[`${key}.annotations`] = []
                }
              }
            }
            void Plotly.relayout(el, relayoutUpdate)
          })
        })
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
