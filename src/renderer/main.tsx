import ReactDOM from 'react-dom/client'
import App from './App'
import DetachedPlot from './DetachedPlot'
import DetachedPanel from './DetachedPanel'
import { wrapOctaveExecute } from './octaveBusyTracker'
import './styles.css'

// US-S02 / US-L01: Install the ref-counted busy tracker by wrapping the
// contextBridge object in a Proxy that intercepts `octaveExecute` calls.
// `window.matslop` itself (a regular property of `window`) IS writable —
// only the properties OF the bridge object are frozen by contextBridge.
// The Proxy intercepts property access without mutating the frozen object.
// The idempotency guard (__matslopBusyTrackerWrapped) prevents double-
// wrapping on HMR reloads.
;(window as any).matslop = wrapOctaveExecute((window as any).matslop)

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
