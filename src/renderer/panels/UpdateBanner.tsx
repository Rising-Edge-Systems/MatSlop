/**
 * US-041: Auto-update notification banner.
 *
 * Subscribes to `update:status` events from the main process (wired via
 * `window.matslop.onUpdateStatus`) and shows a dismissable banner offering
 * "Install now" / "Later" once an update has been fully downloaded (or a
 * progress indicator while downloading). The banner is a pure function of
 * the latest UpdateStatus — main process does all the heavy lifting.
 */

import React, { useEffect, useState } from 'react'

type Props = {
  /** Test seam: inject a fake status instead of waiting for real events. */
  initialStatus?: UpdateStatus
}

export function UpdateBanner({ initialStatus }: Props): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>(initialStatus ?? { kind: 'idle' })
  const [dismissed, setDismissed] = useState<boolean>(false)

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

  if (dismissed) return null

  // Only surface the banner for states the user needs to act on.
  switch (status.kind) {
    case 'available':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            MatSlop {status.version} is available
            {status.releaseName ? ` — ${status.releaseName}` : ''}.
          </span>
          <div className="update-banner-actions">
            <button
              type="button"
              className="update-banner-btn update-banner-btn-primary"
              data-testid="update-banner-install"
              onClick={() => {
                // Trigger a real download; once it completes we'll flip to
                // the 'downloaded' state and the user can confirm install.
                void window.matslop.updateCheckNow()
              }}
            >
              Download
            </button>
            <button
              type="button"
              className="update-banner-btn"
              data-testid="update-banner-later"
              onClick={() => setDismissed(true)}
            >
              Later
            </button>
          </div>
        </div>
      )
    case 'downloading':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            Downloading update… {Math.round(status.percent)}%
          </span>
        </div>
      )
    case 'downloaded':
      return (
        <div className="update-banner" data-testid="update-banner" role="status">
          <span className="update-banner-message">
            MatSlop {status.version} is ready to install.
          </span>
          <div className="update-banner-actions">
            <button
              type="button"
              className="update-banner-btn update-banner-btn-primary"
              data-testid="update-banner-install-now"
              onClick={() => {
                void window.matslop.updateInstall()
              }}
            >
              Install now
            </button>
            <button
              type="button"
              className="update-banner-btn"
              data-testid="update-banner-later"
              onClick={() => setDismissed(true)}
            >
              Later
            </button>
          </div>
        </div>
      )
    case 'error':
      return (
        <div className="update-banner update-banner-error" data-testid="update-banner" role="alert">
          <span className="update-banner-message">Update check failed: {status.message}</span>
          <button
            type="button"
            className="update-banner-btn"
            data-testid="update-banner-dismiss"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      )
    default:
      return null
  }
}

export default UpdateBanner
