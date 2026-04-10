import { useState, useCallback, useRef, MouseEvent, WheelEvent } from 'react'
import { Home, ZoomIn, ZoomOut, Maximize2, Download } from 'lucide-react'

interface InteractivePlotProps {
  src: string
  alt?: string
  onSaveAs?: () => void
  onOpenInWindow?: () => void
}

interface Transform {
  scale: number
  x: number
  y: number
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 }
const MIN_SCALE = 0.2
const MAX_SCALE = 10

/**
 * InteractivePlot renders a PNG plot image with pan/zoom controls.
 * - Scroll wheel zooms centered on the cursor
 * - Click+drag pans
 * - Double-click resets view
 * - Toolbar buttons: home (reset), zoom in/out, fit, save
 *
 * Note: this is not true interactive graphics like MATLAB's figure window
 * (which supports 3D rotation, data tips, etc.) — it's a lightweight
 * image viewer that covers zoom/pan. True rotation would require either
 * re-rendering via Octave or a full JS plotting library.
 */
function InteractivePlot({ src, alt, onSaveAs }: InteractivePlotProps): React.JSX.Element {
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    // Position within the container
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2

    setTransform((t) => {
      const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * zoomFactor))
      const actualFactor = newScale / t.scale
      // Keep the point under the cursor stationary
      const newX = cx - (cx - t.x) * actualFactor
      const newY = cy - (cy - t.y) * actualFactor
      return { scale: newScale, x: newX, y: newY }
    })
  }, [])

  const handleMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: transform.x,
      startY: transform.y,
    }
  }, [transform.x, transform.y])

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    setTransform((t) => ({
      ...t,
      x: dragStartRef.current!.startX + dx,
      y: dragStartRef.current!.startY + dy,
    }))
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    dragStartRef.current = null
  }, [])

  const handleDoubleClick = useCallback(() => {
    setTransform(IDENTITY)
  }, [])

  const zoomIn = useCallback(() => {
    setTransform((t) => ({ ...t, scale: Math.min(MAX_SCALE, t.scale * 1.3) }))
  }, [])

  const zoomOut = useCallback(() => {
    setTransform((t) => ({ ...t, scale: Math.max(MIN_SCALE, t.scale / 1.3) }))
  }, [])

  const reset = useCallback(() => {
    setTransform(IDENTITY)
  }, [])

  return (
    <div className="ls-interactive-plot">
      <div className="ls-plot-toolbar">
        <button onClick={reset} title="Reset view (or double-click)" className="ls-plot-tool-btn">
          <Home size={14} />
        </button>
        <button onClick={zoomIn} title="Zoom in" className="ls-plot-tool-btn">
          <ZoomIn size={14} />
        </button>
        <button onClick={zoomOut} title="Zoom out" className="ls-plot-tool-btn">
          <ZoomOut size={14} />
        </button>
        <button onClick={reset} title="Fit" className="ls-plot-tool-btn">
          <Maximize2 size={14} />
        </button>
        {onSaveAs && (
          <button onClick={onSaveAs} title="Save As" className="ls-plot-tool-btn">
            <Download size={14} />
          </button>
        )}
        <span className="ls-plot-zoom-indicator">{Math.round(transform.scale * 100)}%</span>
      </div>
      <div
        ref={containerRef}
        className={`ls-plot-viewport ${isDragging ? 'ls-plot-viewport-dragging' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src}
          alt={alt ?? 'Plot'}
          className="ls-interactive-plot-image"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

export default InteractivePlot
