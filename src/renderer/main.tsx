import ReactDOM from 'react-dom/client'
import App from './App'
import DetachedPlot from './DetachedPlot'
import './styles.css'

// Note: StrictMode intentionally disabled — this is an Electron app (no SSR/hydration)
// and StrictMode's double-invocation causes spurious side effects with IPC handlers
// that create real resources (Octave processes, welcome tabs, etc.)

// US-012: Detached plot windows reuse this same bundle but mount the
// lightweight `DetachedPlot` component instead of the full `App` when a
// `detachedFigureId` is present in the URL query string.
const params = new URLSearchParams(window.location.search)
const detachedFigureId = params.get('detachedFigureId')

ReactDOM.createRoot(document.getElementById('root')!).render(
  detachedFigureId ? <DetachedPlot figureId={detachedFigureId} /> : <App />,
)
