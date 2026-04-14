import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlotFigure } from '../../main/plotSchema'
import { defaultExportFilename, figureToPlotly, formatCursorLabel } from './plotlyAdapter'

// Plotly is loaded dynamically to avoid blocking initial render.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Plotly: any = null
const getPlotly = async () => {
  if (!_Plotly) {
    const mod = await import('plotly.js-dist-min')
    _Plotly = mod.default
  }
  return _Plotly
}

export interface PlotRendererProps {
  figure: PlotFigure
  /** Explicit pixel height. Defaults to 320 for live-script inline plots. */
  height?: number
  className?: string
  /**
   * Whether to show the "Detach" button (US-012). Set to false when this
   * renderer is already mounted inside a detached plot window — otherwise
   * users could open a detached-of-a-detached window.
   */
  canDetach?: boolean
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
function PlotRenderer({
  figure,
  height = 320,
  className,
  canDetach = true,
}: PlotRendererProps): React.JSX.Element {
  const divRef = useRef<HTMLDivElement | null>(null)
  const [exportStatus, setExportStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)
  const [detachStatus, setDetachStatus] = useState<'idle' | 'opening' | 'error'>('idle')

  /**
   * US-012: Open this figure in its own OS window. Serializes the current
   * `PlotFigure` via IPC, which the main process registers under a fresh id
   * and uses as the payload for a new BrowserWindow.
   */
  const handleDetach = useCallback(async (): Promise<void> => {
    try {
      setDetachStatus('opening')
      const result = await window.matslop.plotOpenDetached(figure)
      if (!result?.success) {
        setDetachStatus('error')
        return
      }
      setDetachStatus('idle')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PlotRenderer] detach failed', err)
      setDetachStatus('error')
    }
  }, [figure])

  /**
   * Export the current Plotly canvas (including the user's current rotation,
   * zoom and pinned annotations) as an image. Shows a native save dialog so
   * the user can pick PNG or SVG, then writes the file via IPC.
   */
  const handleExport = useCallback(async (): Promise<void> => {
    const el = divRef.current
    if (!el) return
    try {
      setExportStatus('saving')
      setExportError(null)
      const defaultName = defaultExportFilename(figure)
      // Show the native save dialog first so we know the target format
      // before asking Plotly to rasterize (no wasted work on cancel).
      const dialogResult = await window.matslop.figuresSaveDialog(`${defaultName}.png`)
      if (!dialogResult) {
        setExportStatus('idle')
        return
      }
      const rawFormat = (dialogResult.format || 'png').toLowerCase()
      const format: 'png' | 'svg' = rawFormat === 'svg' ? 'svg' : 'png'
      const Plotly = await getPlotly()
      const bounds = el.getBoundingClientRect()
      const width = Math.max(400, Math.round(bounds.width))
      const imgHeight = Math.max(300, Math.round(bounds.height))
      const imgData = await Plotly.toImage(el, { format, width, height: imgHeight })
      // Plotly.toImage returns a data URL for raster formats (data:image/png;base64,...)
      // and either a data URL or raw SVG string for 'svg'. Normalize.
      let payload = imgData
      let encoding: 'base64' | 'utf8' = 'base64'
      if (format === 'svg') {
        encoding = 'utf8'
        if (imgData.startsWith('data:')) {
          const comma = imgData.indexOf(',')
          payload = decodeURIComponent(imgData.slice(comma + 1))
        }
      }
      const result = await window.matslop.figuresExportPlot(
        dialogResult.filePath,
        payload,
        encoding,
      )
      if (!result.success) {
        setExportStatus('error')
        setExportError(result.error ?? 'failed to save file')
        return
      }
      setExportStatus('idle')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[PlotRenderer] export failed', err)
      setExportStatus('error')
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [figure])

  useEffect(() => {
    let cancelled = false
    const root = divRef.current
    if (!root) return

    const { data, layout, config } = figureToPlotly(figure)

    getPlotly().then((Plotly) => {
        if (cancelled || !divRef.current) { return }
        const el = divRef.current as HTMLDivElement & {
          on?: (event: string, handler: (ev: unknown) => void) => void
          layout?: { annotations?: unknown[]; scene?: { annotations?: unknown[] } }
        }
        void Plotly.react(el, data, layout, config).then(() => {
          if (cancelled) return
          // Wire click-to-pin handlers for 2D plots only.
          // 3D (WebGL) plots freeze when relayout is called with annotations.
          if (typeof el.on !== 'function') return
          const has3D = data.some((t: Record<string, unknown>) =>
            t.type === 'surface' || t.type === 'scatter3d' || t.type === 'mesh3d')
          if (has3D) return

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
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[PlotRenderer] Plotly render failed', err)
      })

    return () => {
      cancelled = true
      if (root && _Plotly) {
        try { _Plotly.purge(root) } catch { /* ignore */ }
      }
    }
  }, [figure])

  return (
    <div
      className={`matslop-plot-renderer-wrap ${className ?? ''}`.trim()}
      data-testid="plot-renderer-wrap"
      style={{ position: 'relative', width: '100%', height }}
    >
      <div
        ref={divRef}
        className="matslop-plot-renderer"
        data-testid="plot-renderer"
        style={{ width: '100%', height: '100%' }}
      />
      {canDetach ? (
        <button
          type="button"
          className="matslop-plot-detach-btn"
          data-testid="plot-detach-btn"
          onClick={() => {
            void handleDetach()
          }}
          disabled={detachStatus === 'opening'}
          title="Open plot in a new window"
          aria-label="Detach plot to new window"
          style={{
            position: 'absolute',
            top: 6,
            right: 74,
            zIndex: 10,
            padding: '2px 8px',
            font: '11px/1.4 system-ui, sans-serif',
            background: 'rgba(255,255,255,0.92)',
            color: '#222',
            border: '1px solid #888',
            borderRadius: 3,
            cursor: detachStatus === 'opening' ? 'wait' : 'pointer',
          }}
        >
          {detachStatus === 'opening' ? 'Opening…' : 'Detach'}
        </button>
      ) : null}
      {canDetach ? <button
        type="button"
        className="matslop-plot-export-btn"
        data-testid="plot-export-btn"
        onClick={() => {
          void handleExport()
        }}
        disabled={exportStatus === 'saving'}
        title="Export plot as PNG or SVG"
        aria-label="Export plot"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 10,
          padding: '2px 8px',
          font: '11px/1.4 system-ui, sans-serif',
          background: 'rgba(255,255,255,0.92)',
          color: '#222',
          border: '1px solid #888',
          borderRadius: 3,
          cursor: exportStatus === 'saving' ? 'wait' : 'pointer',
        }}
      >
        {exportStatus === 'saving' ? 'Saving…' : 'Export'}
      </button> : null}
      {canDetach && exportStatus === 'error' && exportError ? (
        <div
          role="alert"
          data-testid="plot-export-error"
          style={{
            position: 'absolute',
            top: 34,
            right: 6,
            zIndex: 10,
            maxWidth: 240,
            padding: '4px 8px',
            font: '11px/1.4 system-ui, sans-serif',
            background: 'rgba(255, 235, 235, 0.95)',
            color: '#811',
            border: '1px solid #c66',
            borderRadius: 3,
          }}
        >
          Export failed: {exportError}
        </div>
      ) : null}
    </div>
  )
}

export default PlotRenderer
