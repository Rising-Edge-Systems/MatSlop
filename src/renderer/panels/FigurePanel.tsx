import { useState, useCallback } from 'react'
import { Download } from 'lucide-react'
import PanelHeader from './PanelHeader'

export interface FigureData {
  handle: number
  imageDataUrl: string
  tempPath: string
}

interface FigurePanelProps {
  figures: FigureData[]
  onCollapse?: () => void
  onSaveFigure?: (figure: FigureData) => void
}

function FigurePanel({ figures, onCollapse, onSaveFigure }: FigurePanelProps): React.JSX.Element {
  const [activeHandle, setActiveHandle] = useState<number | null>(null)

  const activeFigure = figures.find((f) => f.handle === activeHandle) ?? figures[0] ?? null

  const handleSave = useCallback(() => {
    if (activeFigure) {
      onSaveFigure?.(activeFigure)
    }
  }, [activeFigure, onSaveFigure])

  return (
    <div className="panel figure-panel">
      <PanelHeader title="Figures" onCollapse={onCollapse} />
      {figures.length === 0 ? (
        <div className="panel-content figure-empty">
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
            {activeFigure && (
              <img
                src={activeFigure.imageDataUrl}
                alt={`Figure ${activeFigure.handle}`}
                className="figure-image"
                draggable={false}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default FigurePanel
