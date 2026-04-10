import { useEffect, useState } from 'react'
import PlotRenderer from './editor/PlotRenderer'
import { parsePlotFigure, type PlotFigure } from '../main/plotSchema'

/**
 * US-012: Standalone renderer mounted in a detached BrowserWindow. Reads
 * the figure id from `window.location.search`, fetches the figure payload
 * from the main process via `window.matslop.plotGetDetachedFigure`, and
 * mounts a full-viewport `PlotRenderer`. The plot is fully interactive
 * (zoom, rotate, data-cursor, export) because it reuses the same
 * `PlotRenderer` component as the main-window inline plots.
 */
export interface DetachedPlotProps {
  figureId: string
}

export default function DetachedPlot({ figureId }: DetachedPlotProps): React.JSX.Element {
  const [figure, setFigure] = useState<PlotFigure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: window.innerWidth,
    h: window.innerHeight,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const payload = await window.matslop.plotGetDetachedFigure(figureId)
        if (cancelled) return
        if (payload == null) {
          setError('Figure not found (it may have been closed already)')
          return
        }
        try {
          const parsed = parsePlotFigure(payload)
          setFigure(parsed)
        } catch (err) {
          setError(
            `Invalid figure payload: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [figureId])

  useEffect(() => {
    const onResize = (): void => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (error) {
    return (
      <div
        data-testid="detached-plot-error"
        style={{
          padding: 20,
          font: '13px/1.5 system-ui, sans-serif',
          color: '#a00',
        }}
      >
        Error loading plot: {error}
      </div>
    )
  }

  if (!figure) {
    return (
      <div
        data-testid="detached-plot-loading"
        style={{
          padding: 20,
          font: '13px/1.5 system-ui, sans-serif',
          color: '#555',
        }}
      >
        Loading plot…
      </div>
    )
  }

  return (
    <div
      data-testid="detached-plot"
      style={{
        width: '100vw',
        height: '100vh',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <PlotRenderer figure={figure} height={size.h} canDetach={false} />
    </div>
  )
}
