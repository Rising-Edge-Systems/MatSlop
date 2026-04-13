import { useState, useCallback } from 'react'
import { Download } from 'lucide-react'
import { useAppContext } from '../AppContext'
import PlotRenderer from '../editor/PlotRenderer'
import { parsePlotFigure } from '../../main/plotSchema'

export interface FigureData {
  handle: number
  imageDataUrl: string
  tempPath: string
  /** Interactive plot data from matslop_export_fig (Plotly JSON). */
  plotJson?: unknown
}

interface FigurePanelProps {
  figures?: FigureData[]
  onCollapse?: () => void
  onSaveFigure?: (figure: FigureData) => void
}

function FigurePanel({ figures: figuresProp, onCollapse, onSaveFigure }: FigurePanelProps): React.JSX.Element {
  // US-SC04: Read dynamic state from AppContext (bypasses rc-dock caching)
  const ctx = useAppContext()
  const figures = (ctx.figures as FigureData[]) ?? figuresProp ?? []
  const [activeHandle, setActiveHandle] = useState<number | null>(null)

  const activeFigure = figures.find((f) => f.handle === activeHandle) ?? figures[0] ?? null

  const handleSave = useCallback(() => {
    if (activeFigure) {
      onSaveFigure?.(activeFigure)
    }
  }, [activeFigure, onSaveFigure])

  return (
    <div className="panel figure-panel" data-testid="figure-panel">
      {figures.length === 0 ? (
        <div className="panel-content figure-empty" data-testid="figure-empty">
          <span className="empty-text">No figures</span>
        </div>
      ) : (
        <>
          <div className="figure-toolbar">
            <div className="figure-tabs">
              {figures.map((fig) => (
                <button
                  key={fig.handle}
                  className={`figure-tab ${fig.handle === (activeFigure?.handle) ? 'active' : ''}`}
                  onClick={() => setActiveHandle(fig.handle)}
                >
                  Figure {fig.handle}
                </button>
              ))}
            </div>
            <div className="figure-actions">
              <button
                className="figure-save-btn"
                onClick={handleSave}
                title="Save as Image (PNG/SVG/PDF)"
              >
                <Download size={14} />
                <span>Save</span>
              </button>
            </div>
          </div>
          <div className="panel-content figure-content">
            {activeFigure && activeFigure.plotJson ? (
              (() => {
                try {
                  const plotFig = parsePlotFigure(activeFigure.plotJson)
                  return (
                    <PlotRenderer
                      figure={plotFig}
                      height={400}
                      canDetach={true}
                    />
                  )
                } catch {
                  // JSON parse failed — fall back to static image
                  return activeFigure.imageDataUrl ? (
                    <img src={activeFigure.imageDataUrl} alt={`Figure ${activeFigure.handle}`} className="figure-image" data-testid="figure-image" draggable={false} />
                  ) : null
                }
              })()
            ) : activeFigure ? (
              <img
                src={activeFigure.imageDataUrl}
                alt={`Figure ${activeFigure.handle}`}
                className="figure-image"
                data-testid="figure-image"
                draggable={false}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export default FigurePanel
