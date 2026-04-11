import ReactDOM from 'react-dom/client'
import App from './App'
import DetachedPlot from './DetachedPlot'
import DetachedPanel from './DetachedPanel'
import { wrapOctaveExecute } from './octaveBusyTracker'
import './styles.css'

// US-S02: install the ref-counted in-flight tracker around
// `window.matslop.octaveExecute` before any component has a chance to call
// it. Idempotent — safe during HMR.
wrapOctaveExecute((window as unknown as { matslop?: Parameters<typeof wrapOctaveExecute>[0] }).matslop ?? null)

// Note: StrictMode intentionally disabled — this is an Electron app (no SSR/hydration)
// and StrictMode's double-invocation causes spurious side effects with IPC handlers
// that create real resources (Octave processes, welcome tabs, etc.)

// Detached auxiliary windows reuse this same renderer bundle but mount a
// lightweight component instead of the full `App` when an identifying
// query param is present:
//   - US-012 `?detachedFigureId=...`  → <DetachedPlot>
//   - US-027 `?detachedPanelId=...`   → <DetachedPanel>
const params = new URLSearchParams(window.location.search)
const detachedFigureId = params.get('detachedFigureId')
const detachedPanelId = params.get('detachedPanelId')

let root: React.ReactNode
if (detachedFigureId) {
  root = <DetachedPlot figureId={detachedFigureId} />
} else if (detachedPanelId) {
  root = <DetachedPanel panelId={detachedPanelId} />
} else {
  root = <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(root)
