import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Note: StrictMode intentionally disabled — this is an Electron app (no SSR/hydration)
// and StrictMode's double-invocation causes spurious side effects with IPC handlers
// that create real resources (Octave processes, welcome tabs, etc.)
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
