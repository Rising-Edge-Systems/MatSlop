/**
 * US-041 / US-C06: Auto-update notification banner.
 *
 * Subscribes to `update:status` events from the main process (wired via
 * `window.matslop.onUpdateStatus`) and shows a dismissable banner offering
 * "Download" / "Install & Restart" actions. The banner is a pure function of
 * the latest UpdateStatus — main process does all the heavy lifting.
 */

import React, { useEffect, useState, useRef } from 'react'

type Props = {
  /** Test seam: inject a fake status instead of waiting for real events. */
  initialStatus?: UpdateStatus
}

export function UpdateBanner({ initialStatus }: Props): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>(initialStatus ?? { kind: 'idle' })
  const [dismissed, setDismissed] = useState<boolean>(false)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const bridge = (typeof window !== 'undefined' ? window.matslop : undefined) as
      | typeof window.matslop
      | undefined
    if (!bridge || typeof bridge.onUpdateStatus !== 'function') return
    // Seed with the latest known state so hot-reload / remounts pick up
    // an already-downloaded update.
    if (typeof bridge.updateGetState === 'function') {
      bridge
        .updateGetState()
        .then((s) => {
          if (!cancelled && s) setStatus(s as UpdateStatus)
        })
        .catch(() => {
          /* ignore */
        })
    }
    const unsub = bridge.onUpdateStatus((s) => {
      if (!cancelled) {
        setStatus(s)
        setDismissed(false)
      }
    })
    // Expose a renderer-side test hook so Playwright can simulate status
    // transitions without spinning up electron-updater.
    ;(window as unknown as { __matslopSimulateUpdateStatus?: (s: UpdateStatus) => void }).__matslopSimulateUpdateStatus =
      (s: UpdateStatus) => {
        setStatus(s)
        setDismissed(false)
      }
    return () => {
      cancelled = true
      unsub()
      delete (window as unknown as { __matslopSimulateUpdateStatus?: unknown }).__matslopSimulateUpdateStatus
    }
  }, [])

  // Auto-hide error banner after 8 seconds
  useEffect(() => {
    if (status.kind === 'error') {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
      errorTimerRef.current = setTimeout(() => {
        setDismissed(true)
      }, 8000)
    } else {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current)
        errorTimerRef.current = null
      }
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [status])

  if (dismissed) return null

  const closeButton = (
    <button
      type="button"
      className="update-banner-close"
      data-testid="update-banner-close"
      onClick={() => setDismissed(true)}
      aria-label="Dismiss"
    >
      &#x2715;
    </button>
  )

  // Only surface the banner for states the user needs to act on.
  switch (status.kind) {
    case 'available':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            MatSlop v{status.version} is available
            {status.releaseName ? ` — ${status.releaseName}` : ''}
          </span>
          <div className="update-banner-actions">
            <button
              type="button"
              className="update-banner-btn update-banner-btn-primary"
              data-testid="update-banner-download"
              onClick={() => {
                void window.matslop.updateDownload()
              }}
            >
              Download
            </button>
          </div>
          {closeButton}
        </div>
      )
    case 'downloading':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            Downloading update&hellip; {Math.round(status.percent)}%
          </span>
          <div className="update-banner-progress">
            <div
              className="update-banner-progress-bar"
              style={{ width: `${Math.round(status.percent)}%` }}
            />
          </div>
          {closeButton}
        </div>
      )
    case 'downloaded':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            Update ready — Install &amp; Restart
          </span>
          <div className="update-banner-actions">
            <button
              type="button"
              className="update-banner-btn update-banner-btn-primary"
              data-testid="update-banner-install-now"
              onClick={() => {
                if (window.matslop.platform === 'darwin') {
                  // macOS unsigned apps can't do in-place updates — open the release page
                  const version = status.kind === 'downloaded' ? status.version : ''
                  void window.matslop.openExternal(`https://github.com/Rising-Edge-Systems/MatSlop/releases/tag/v${version}`)
                } else {
                  void window.matslop.updateInstall()
                }
              }}
            >
              {window.matslop.platform === 'darwin' ? 'Download Update' : 'Install & Restart'}
            </button>
          </div>
          {closeButton}
        </div>
      )
    case 'error':
      return (
        <div className="update-banner update-banner-error" data-testid="update-banner" role="alert">
          <span className="update-banner-message">Update check failed: {status.message}</span>
          {closeButton}
        </div>
      )
    default:
      return null
  }
}

export default UpdateBanner
