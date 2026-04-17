/**
 * US-041: Auto-update channel.
 *
 * This module wires electron-updater into MatSlop. The bulk of the file is
 * pure helper logic (interval scheduling, version comparison, banner
 * payload building) so it can be unit-tested without importing electron or
 * electron-updater. The `initializeAutoUpdater(...)` wrapper lazily imports
 * `electron-updater` at runtime, so dev/test contexts without a packaged
 * app don't fail to load the main bundle.
 *
 * Update server: GitHub Releases (configured in package.json
 * `build.publish: [{ provider: 'github' }]`). electron-updater reads the
 * owner/repo from `app-update.yml` at runtime in the packaged app.
 */

import type { BrowserWindow } from 'electron'
import https from 'https'

// ---------------------------------------------------------------------------
// Pure helpers (no electron / electron-updater imports — unit-testable)
// ---------------------------------------------------------------------------

/** Default check interval: 24h. */
export const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 24
/** Minimum check interval: 1h (guards against pathological config). */
export const MIN_UPDATE_CHECK_INTERVAL_HOURS = 1
/** Maximum check interval: 30 days. */
export const MAX_UPDATE_CHECK_INTERVAL_HOURS = 24 * 30

export function normalizeUpdateCheckIntervalHours(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_UPDATE_CHECK_INTERVAL_HOURS
  }
  if (raw < MIN_UPDATE_CHECK_INTERVAL_HOURS) return MIN_UPDATE_CHECK_INTERVAL_HOURS
  if (raw > MAX_UPDATE_CHECK_INTERVAL_HOURS) return MAX_UPDATE_CHECK_INTERVAL_HOURS
  return Math.floor(raw)
}

/**
 * Decide whether we should run an update check right now. We check if
 * `lastCheckMs` is missing or older than `intervalHours`.
 */
export function shouldCheckForUpdateNow(
  lastCheckMs: number | null | undefined,
  intervalHours: number,
  nowMs: number,
): boolean {
  if (!lastCheckMs || lastCheckMs <= 0) return true
  const intervalMs = normalizeUpdateCheckIntervalHours(intervalHours) * 60 * 60 * 1000
  return nowMs - lastCheckMs >= intervalMs
}

/**
 * Strict semver compare for dotted numeric versions (e.g. "1.2.3" vs
 * "1.2.10"). Pre-release suffixes like "-beta.1" are compared
 * lexicographically (best-effort). Returns -1 / 0 / 1.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, pre = ''] = v.split('-', 2)
    const nums = core.split('.').map((s) => {
      const n = parseInt(s, 10)
      return Number.isNaN(n) ? 0 : n
    })
    return { nums, pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i += 1) {
    const na = pa.nums[i] ?? 0
    const nb = pb.nums[i] ?? 0
    if (na !== nb) return na < nb ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  // A version WITH a pre-release is lower than one without.
  if (!pa.pre && pb.pre) return 1
  if (pa.pre && !pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** True if `remoteVersion` is strictly newer than `currentVersion`. */
export function isUpdateAvailable(currentVersion: string, remoteVersion: string): boolean {
  return compareVersions(remoteVersion, currentVersion) > 0
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string; releaseName?: string }
  | { kind: 'not-available'; version: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string; releaseNotes?: string; releaseName?: string }
  | { kind: 'error'; message: string }

/**
 * Build a banner-ready payload from an electron-updater UpdateInfo object.
 * We accept `unknown` and pluck the fields we care about so we don't take
 * a hard type dependency on electron-updater.
 */
export function buildUpdateAvailableStatus(updateInfo: unknown): UpdateStatus {
  const info = (updateInfo ?? {}) as {
    version?: unknown
    releaseNotes?: unknown
    releaseName?: unknown
  }
  const version = typeof info.version === 'string' ? info.version : 'unknown'
  const releaseName = typeof info.releaseName === 'string' ? info.releaseName : undefined
  let releaseNotes: string | undefined
  if (typeof info.releaseNotes === 'string') {
    releaseNotes = info.releaseNotes
  } else if (Array.isArray(info.releaseNotes)) {
    // electron-updater sometimes yields an array of { note }.
    releaseNotes = (info.releaseNotes as Array<{ note?: string }>)
      .map((r) => r?.note ?? '')
      .filter(Boolean)
      .join('\n')
  }
  return { kind: 'available', version, releaseName, releaseNotes }
}

export function buildUpdateDownloadedStatus(updateInfo: unknown): UpdateStatus {
  const available = buildUpdateAvailableStatus(updateInfo)
  if (available.kind !== 'available') return { kind: 'idle' }
  return {
    kind: 'downloaded',
    version: available.version,
    releaseNotes: available.releaseNotes,
    releaseName: available.releaseName,
  }
}

export function buildDownloadProgressStatus(progress: unknown): UpdateStatus {
  const p = (progress ?? {}) as {
    percent?: unknown
    transferred?: unknown
    total?: unknown
  }
  const percent = typeof p.percent === 'number' ? p.percent : 0
  const transferred = typeof p.transferred === 'number' ? p.transferred : 0
  const total = typeof p.total === 'number' ? p.total : 0
  return { kind: 'downloading', percent, transferred, total }
}

// ---------------------------------------------------------------------------
// Wrapper around electron-updater
// ---------------------------------------------------------------------------

export interface UpdateBridgeDeps {
  /** Current app version — injected so helpers can be tested. */
  getAppVersion: () => string
  /** Called to broadcast state changes to the renderer. */
  sendStatus: (status: UpdateStatus) => void
  /** Called to persist the last-check timestamp. */
  setLastCheckMs: (ms: number) => void
  /** Called to read the last-check timestamp. */
  getLastCheckMs: () => number | null
  /** Called to read the current user-configured interval hours. */
  getIntervalHours: () => number
  /**
   * True when electron-updater cannot perform an in-place install on this
   * platform (unsigned macOS, non-AppImage Linux). In that mode we skip
   * electron-updater entirely and do a direct GitHub API version check; the
   * UI routes the user to the release page for manual install.
   */
  manualInstallOnly?: boolean
  /**
   * GitHub repo used for manual-install version checks. Required when
   * `manualInstallOnly` is true. Ignored otherwise (electron-updater reads
   * this from app-update.yml baked in by electron-builder).
   */
  githubRepo?: { owner: string; repo: string }
  /** Test seam: override the HTTP fetcher used for manual-install checks. */
  fetchJson?: (url: string) => Promise<unknown>
}

export interface UpdateBridge {
  /** Force an update check immediately (ignoring the scheduled interval). */
  checkNow(): Promise<UpdateStatus>
  /**
   * Run a check only if the scheduled interval has elapsed since the last
   * one. Returns the resolved status (or 'idle' if skipped).
   */
  checkIfDue(nowMs?: number): Promise<UpdateStatus>
  /** Trigger the download of an available update. */
  downloadUpdate(): Promise<void>
  /** Quit the app and install the downloaded update. */
  quitAndInstall(): void
  /** Latest known status. */
  getState(): UpdateStatus
}

let _latestState: UpdateStatus = { kind: 'idle' }

export function getLatestUpdateState(): UpdateStatus {
  return _latestState
}

/** @internal test-only hook to reset module state between tests. */
export function _resetUpdateBridgeForTests(): void {
  _latestState = { kind: 'idle' }
}

/**
 * Default JSON fetcher used by the manual-install path. Uses Node's https
 * module so we avoid pulling electron into unit tests.
 */
function defaultFetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'MatSlop-UpdateCheck',
          Accept: 'application/vnd.github+json',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          defaultFetchJson(res.headers.location).then(resolve, reject)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode ?? '?'} fetching ${url}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('Update check timed out'))
    })
    req.on('error', reject)
  })
}

/**
 * Bridge for platforms where electron-updater can't perform an in-place
 * install (unsigned macOS, non-AppImage Linux). Uses the GitHub Releases
 * API to detect a new version; the renderer then opens the release page
 * in the user's browser for manual download.
 */
function createManualUpdateBridge(deps: UpdateBridgeDeps): UpdateBridge {
  const fetchJson = deps.fetchJson ?? defaultFetchJson
  const repo = deps.githubRepo

  async function checkNow(): Promise<UpdateStatus> {
    deps.setLastCheckMs(Date.now())
    if (!repo) {
      _latestState = { kind: 'error', message: 'No GitHub repo configured for update checks' }
      deps.sendStatus(_latestState)
      return _latestState
    }
    _latestState = { kind: 'checking' }
    deps.sendStatus(_latestState)
    try {
      const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`
      const data = (await fetchJson(url)) as {
        tag_name?: unknown
        name?: unknown
        body?: unknown
      }
      const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
      const remoteVersion = tag.replace(/^v/, '')
      const current = deps.getAppVersion()
      if (remoteVersion && isUpdateAvailable(current, remoteVersion)) {
        _latestState = {
          kind: 'available',
          version: remoteVersion,
          releaseName: typeof data.name === 'string' ? data.name : undefined,
          releaseNotes: typeof data.body === 'string' ? data.body : undefined,
        }
      } else {
        _latestState = { kind: 'not-available', version: current }
      }
    } catch (e) {
      _latestState = {
        kind: 'error',
        message: e instanceof Error ? e.message : 'Update check failed',
      }
    }
    deps.sendStatus(_latestState)
    return _latestState
  }

  async function checkIfDue(nowMs?: number): Promise<UpdateStatus> {
    const now = typeof nowMs === 'number' ? nowMs : Date.now()
    const last = deps.getLastCheckMs()
    const interval = deps.getIntervalHours()
    if (!shouldCheckForUpdateNow(last, interval, now)) {
      return _latestState
    }
    return checkNow()
  }

  async function downloadUpdate(): Promise<void> {
    // No-op: in manual-install mode the UI routes the user to the release
    // page instead of calling this.
  }

  function quitAndInstall(): void {
    // No-op: in-place install is not possible on this platform.
  }

  function getState(): UpdateStatus {
    return _latestState
  }

  return { checkNow, checkIfDue, downloadUpdate, quitAndInstall, getState }
}

/**
 * Create an UpdateBridge. Lazily imports `electron-updater` on the first
 * check so environments without it (some test setups) don't crash.
 */
export function createUpdateBridge(deps: UpdateBridgeDeps): UpdateBridge {
  if (deps.manualInstallOnly) {
    return createManualUpdateBridge(deps)
  }
  type AutoUpdaterLike = {
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    currentVersion?: unknown
    on: (event: string, handler: (...args: unknown[]) => void) => void
    checkForUpdates: () => Promise<unknown>
    downloadUpdate: () => Promise<unknown>
    quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  }

  let updater: AutoUpdaterLike | null = null
  let wired = false

  async function ensureUpdater(): Promise<AutoUpdaterLike | null> {
    if (updater) return updater
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import('electron-updater')
      const au = (mod.autoUpdater ?? mod.default?.autoUpdater) as AutoUpdaterLike | undefined
      if (!au) return null
      updater = au
      // We want to notify the user BEFORE downloading so they can choose
      // Install now / Later. electron-updater's `autoDownload` defaults to
      // true; set it false so `update-available` fires but nothing
      // downloads until the user consents.
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = true
      if (!wired) {
        wired = true
        updater.on('checking-for-update', () => {
          _latestState = { kind: 'checking' }
          deps.sendStatus(_latestState)
        })
        updater.on('update-available', (info: unknown) => {
          _latestState = buildUpdateAvailableStatus(info)
          deps.sendStatus(_latestState)
        })
        updater.on('update-not-available', (info: unknown) => {
          const v =
            (info && typeof (info as { version?: unknown }).version === 'string'
              ? (info as { version: string }).version
              : deps.getAppVersion())
          _latestState = { kind: 'not-available', version: v }
          deps.sendStatus(_latestState)
        })
        updater.on('download-progress', (p: unknown) => {
          _latestState = buildDownloadProgressStatus(p)
          deps.sendStatus(_latestState)
        })
        updater.on('update-downloaded', (info: unknown) => {
          _latestState = buildUpdateDownloadedStatus(info)
          deps.sendStatus(_latestState)
        })
        updater.on('error', (err: unknown) => {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown update error'
          _latestState = { kind: 'error', message }
          deps.sendStatus(_latestState)
        })
      }
      return updater
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load electron-updater'
      _latestState = { kind: 'error', message }
      deps.sendStatus(_latestState)
      return null
    }
  }

  async function checkNow(): Promise<UpdateStatus> {
    const au = await ensureUpdater()
    if (!au) return _latestState
    deps.setLastCheckMs(Date.now())
    try {
      await au.checkForUpdates()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update check failed'
      _latestState = { kind: 'error', message }
      deps.sendStatus(_latestState)
    }
    return _latestState
  }

  async function checkIfDue(nowMs?: number): Promise<UpdateStatus> {
    const now = typeof nowMs === 'number' ? nowMs : Date.now()
    const last = deps.getLastCheckMs()
    const interval = deps.getIntervalHours()
    if (!shouldCheckForUpdateNow(last, interval, now)) {
      return _latestState
    }
    return checkNow()
  }

  async function downloadUpdate(): Promise<void> {
    if (!updater) return
    try {
      await updater.downloadUpdate()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Download failed'
      _latestState = { kind: 'error', message }
      deps.sendStatus(_latestState)
    }
  }

  function quitAndInstall(): void {
    if (!updater) return
    try {
      // autoInstallOnAppQuit ensures the update is applied when the app exits.
      // On macOS, quitAndInstall may fail silently for unsigned apps, so we
      // also set autoInstallOnAppQuit=true as a fallback — the update will
      // apply next time the user manually restarts.
      updater.autoInstallOnAppQuit = true
      updater.quitAndInstall(true, true)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to install update'
      _latestState = { kind: 'error', message }
      deps.sendStatus(_latestState)
      // Fallback: just quit and let autoInstallOnAppQuit handle it
      try {
        const { app } = require('electron')
        app.quit()
      } catch {}
    }
  }

  function getState(): UpdateStatus {
    return _latestState
  }

  return { checkNow, checkIfDue, downloadUpdate, quitAndInstall, getState }
}

/**
 * Wire an UpdateBridge to a BrowserWindow so status updates flow into the
 * renderer as `update:status` events.
 */
export function makeWindowSender(
  windowRef: () => BrowserWindow | null,
): (status: UpdateStatus) => void {
  return (status) => {
    const w = windowRef()
    if (!w || w.isDestroyed()) return
    w.webContents.send('update:status', status)
  }
}
