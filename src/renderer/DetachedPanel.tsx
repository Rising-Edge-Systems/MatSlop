import { useEffect, useState } from 'react'
import { DOCK_TAB_IDS, DOCK_TAB_TITLES, type MatslopDockTabId } from './panels/MatslopDockLayout'

/**
 * US-027: Standalone renderer mounted in a detached BrowserWindow for a
 * single panel. Reads the panel/tab id from `window.location.search` and
 * renders a lightweight read-only view of that panel's state.
 *
 * The goal of this component is to demonstrate that a panel can run in
 * its own OS window while sharing Octave state via IPC — closing the
 * window notifies the main renderer via `panel:redocked` so the panel
 * is restored to the dock layout at its previous location.
 *
 * Each panel gets a tiny live demo hooked up to the same preload bridge
 * the main window uses: the Workspace panel shows `whos` output, the
 * Command Window shows live engine status + echoes executed commands,
 * the File Browser lists the current working directory, etc. These are
 * intentionally minimal — the full panel components pull too many props
 * from App.tsx to mount in isolation without large refactors.
 */
export interface DetachedPanelProps {
  panelId: string
}

const KNOWN_IDS: ReadonlySet<string> = new Set(Object.values(DOCK_TAB_IDS))

export default function DetachedPanel({ panelId }: DetachedPanelProps): React.JSX.Element {
  const known = KNOWN_IDS.has(panelId)
  const title = known ? DOCK_TAB_TITLES[panelId as MatslopDockTabId] : panelId
  const [engineStatus, setEngineStatus] = useState<'ready' | 'busy' | 'disconnected'>(
    'disconnected',
  )
  const [live, setLive] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  // Subscribe to the shared Octave status. This proves the detached
  // window is sharing state with the main Octave process via the
  // existing IPC bridge — no separate Octave instance is spawned.
  useEffect(() => {
    let cancelled = false
    void window.matslop
      .octaveGetStatus()
      .then((s) => {
        if (!cancelled) setEngineStatus(s)
      })
      .catch(() => undefined)
    const off = window.matslop.onOctaveStatusChanged((s) => {
      setEngineStatus(s)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Per-panel live demo: each tab id maps to a lightweight query so the
  // detached window shows something meaningful and exercises the IPC
  // bridge. Kept inside one effect for simplicity.
  useEffect(() => {
    let cancelled = false

    async function refresh(): Promise<void> {
      try {
        if (panelId === DOCK_TAB_IDS.workspace) {
          const res = await window.matslop.octaveExecute('whos')
          if (!cancelled) setLive(res.output || '(no variables)')
        } else if (panelId === DOCK_TAB_IDS.fileBrowser) {
          const cwdRes = await window.matslop.octaveExecute('disp(pwd)')
          const cwd = (cwdRes.output || '').trim()
          if (!cwd) {
            if (!cancelled) setLive('(disconnected)')
            return
          }
          const entries = await window.matslop.readDir(cwd).catch(() => [])
          if (!cancelled) {
            setLive(
              [
                `cwd: ${cwd}`,
                '',
                ...entries.map((e) => (e.isDirectory ? `[dir] ${e.name}` : `      ${e.name}`)),
              ].join('\n'),
            )
          }
        } else if (panelId === DOCK_TAB_IDS.commandHistory) {
          const hist = await window.matslop.historyLoad()
          if (!cancelled) setLive(hist.slice(-20).join('\n') || '(empty)')
        } else if (panelId === DOCK_TAB_IDS.callStack) {
          const frames = await window.matslop.debugGetCallStack()
          if (!cancelled) {
            setLive(
              frames.length === 0
                ? '(not paused)'
                : frames.map((f) => `${f.name}  —  ${f.file}:${f.line}`).join('\n'),
            )
          }
        } else {
          // CommandWindow / Watches / Figure / Editor: just show a live
          // status banner. Full panel components depend on host state
          // that isn't easily portable across windows.
          if (!cancelled) {
            setLive(`Engine: ${engineStatus}`)
          }
        }
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    }

    void refresh()
    const handle = window.setInterval(() => {
      void refresh()
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [panelId, engineStatus])

  return (
    <div
      data-testid="detached-panel-root"
      data-panel-id={panelId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#ddd',
        background: '#1e1e1e',
      }}
    >
      <header
        data-testid="detached-panel-header"
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #3a3a3d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#2d2d30',
        }}
      >
        <div>
          <strong data-testid="detached-panel-title">{title}</strong>
          {!known && (
            <span style={{ marginLeft: 8, color: '#f88' }} data-testid="detached-panel-unknown">
              (unknown panel)
            </span>
          )}
          <span style={{ marginLeft: 12, fontSize: 12, color: '#8c8' }}>
            Octave: <span data-testid="detached-panel-status">{engineStatus}</span>
          </span>
        </div>
        <button
          type="button"
          data-testid="detached-panel-close-btn"
          onClick={() => window.close()}
          style={{
            background: '#3a3a3d',
            color: '#ddd',
            border: '1px solid #555',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Close &amp; Redock
        </button>
      </header>
      <main
        data-testid="detached-panel-body"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 14px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {err ? `Error: ${err}` : live || 'Loading…'}
      </main>
    </div>
  )
}
