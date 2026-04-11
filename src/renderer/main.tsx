import ReactDOM from 'react-dom/client'
import App from './App'
import DetachedPlot from './DetachedPlot'
import DetachedPanel from './DetachedPanel'
import './styles.css'

// US-S02 note: the busy-indicator ref-counted tracker used to be installed
// here by monkey-patching `window.matslop.octaveExecute`. Electron's
// contextBridge freezes that property, which turned the original patch
// into either a no-op or (worse) an infinite recursion through the Proxy
// after HMR reloads. The tracker itself still exists in octaveBusyTracker.ts
// as a module-level singleton — callers that want to drive it can import
// `octaveBusyTracker.begin/end` directly, without trying to rewrite the
// contextBridge object.

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
