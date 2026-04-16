import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Suppress Windows Error Reporting crash dialogs for child processes
// (Octave's bundled Java/JVM can trigger these on shutdown)
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'WinRetrieveSuggestionsOnlyOnDemand')
}
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
})

// Allow tests to override user data dir for isolation
if (process.env.MATSLOP_USER_DATA_DIR) {
  app.setPath('userData', process.env.MATSLOP_USER_DATA_DIR)
}

import { autoDetectOctavePath, validateOctavePath, getStoredOctavePath, setOctavePath, getMatslopScriptsDir } from './octaveConfig'
import { OctaveProcessManager } from './octaveProcess'
import {
  setBreakpoint as applySetBreakpoint,
  clearBreakpoint as applyClearBreakpoint,
  setBreakpointWithCondition as applySetBreakpointWithCondition,
  reapplyAllBreakpoints,
  reapplyBreakpointsForFile,
  breakpointBucketKey,
} from './debugBridge'
import {
  formatCallStackQuery,
  parseCallStack,
  type CallStackFrame,
} from './callStack'
import { buildAppMenu } from './appMenu'
import { findInFiles, type FindInFilesOptions } from './findInFilesWalker'
import { getGitStatus, getGitDiff, stageFile as gitStageFile, gitCommit } from './gitBridge'
import {
  getStoredTheme,
  setStoredTheme,
  getPreferences,
  setPreferences,
  getLayoutConfig,
  setLayoutConfig,
  getDefaultLayout,
  getRecentFiles,
  addRecentFile,
  clearRecentFiles,
  getLayoutPresets,
  getLayoutPreset,
  saveLayoutPreset as saveLayoutPresetStore,
  deleteLayoutPreset as deleteLayoutPresetStore,
  listLayoutPresetNames,
  getShortcutOverrides,
  setShortcutOverrides,
  type ThemeMode,
  type AppPreferences,
  type LayoutConfig,
  type StoredLayoutPreset,
  type StoredShortcutBinding,
} from './appConfig'
import {
  readSession,
  writeSession,
  clearSession,
  type SessionState,
} from './sessionStore'
import {
  readWindowState,
  writeWindowState,
  type WindowStateSnapshot,
} from './windowStateStore'
import {
  getUpdateCheckEnabled,
  getUpdateCheckIntervalHours,
  getUpdateLastCheckMs,
  setUpdateCheckEnabled,
  setUpdateCheckIntervalHours,
  setUpdateLastCheckMs,
} from './appConfig'
import {
  createUpdateBridge,
  makeWindowSender,
  normalizeUpdateCheckIntervalHours,
  type UpdateBridge,
  type UpdateStatus,
} from './updateBridge'

// Command history file path
function getHistoryFilePath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'command-history.json')
}

function readCommandHistory(): string[] {
  try {
    const filePath = getHistoryFilePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (Array.isArray(data)) return data
    }
  } catch {
    // ignore read errors
  }
  return []
}

function writeCommandHistory(history: string[]): void {
  try {
    const filePath = getHistoryFilePath()
    fs.writeFileSync(filePath, JSON.stringify(history), 'utf-8')
  } catch {
    // ignore write errors
  }
}

let octaveProcess: OctaveProcessManager | null = null
let mainWindow: BrowserWindow | null = null

// Registry of figures currently hosted in detached plot windows.
// The renderer calls `plot:openDetached(figure)` to register a figure and open
// a new BrowserWindow; the detached renderer then calls
// `plot:getDetachedFigure(id)` from its own webContents to pull the payload.
const detachedFigures = new Map<string, unknown>()
const detachedWindows = new Map<string, BrowserWindow>()
let detachedCounter = 0

// US-027: Registry of panels currently hosted in detached OS windows.
// Keyed by panel/tab id (e.g. `matslop-workspace`), not unique per-window,
// so attempts to detach an already-detached panel are idempotent. The main
// process notifies the main renderer on window close via `panel:redocked`
// so the panel can be restored to the dock layout.
const detachedPanelWindows = new Map<string, BrowserWindow>()

/**
 * US-P05: Compute the initial BrowserWindow bounds for the main window.
 *
 * Priority:
 *   1. Persisted bounds from `window-state.json` (last user-resized state)
 *   2. The primary display's work area, capped at 1920x1200
 *   3. A small legacy default (1400x900) when running under E2E tests
 *      so test viewport assertions stay deterministic.
 *
 * The E2E guard piggybacks on `MATSLOP_USER_DATA_DIR`, which the
 * Playwright launcher already sets to isolate userData per run.
 */
function computeInitialWindowState(): {
  bounds: { width: number; height: number; x?: number; y?: number }
  maximized: boolean
} {
  const persisted = readWindowState()
  if (persisted) {
    return {
      bounds: {
        width: persisted.width,
        height: persisted.height,
        x: persisted.x,
        y: persisted.y,
      },
      maximized: persisted.maximized === true,
    }
  }
  // E2E guard: when an isolated userData dir is set (Playwright launcher),
  // fall back to the legacy fixed default so tests don't get a screen-sized
  // window depending on the host display.
  if (process.env.MATSLOP_USER_DATA_DIR) {
    return { bounds: { width: 1400, height: 900 }, maximized: false }
  }
  try {
    const work = screen.getPrimaryDisplay().workAreaSize
    return {
      bounds: {
        width: Math.min(work.width, 1920),
        height: Math.min(work.height, 1200),
      },
      maximized: false,
    }
  } catch {
    return { bounds: { width: 1400, height: 900 }, maximized: false }
  }
}

function persistMainWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const isMax = mainWindow.isMaximized()
    const bounds = isMax ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    const snapshot: WindowStateSnapshot = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: isMax,
    }
    writeWindowState(snapshot)
  } catch {
    // ignore — non-fatal
  }
}

function createWindow(): void {
  const initial = computeInitialWindowState()
  mainWindow = new BrowserWindow({
    width: initial.bounds.width,
    height: initial.bounds.height,
    x: initial.bounds.x,
    y: initial.bounds.y,
    minWidth: 800,
    minHeight: 600,
    title: 'MatSlop',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (initial.maximized) {
    mainWindow.maximize()
  }

  // US-P05: Persist window bounds on resize/move/close so the next launch
  // restores the user's chosen size and position.
  const schedulePersist = (() => {
    let t: NodeJS.Timeout | null = null
    return () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        persistMainWindowState()
      }, 300)
    }
  })()
  mainWindow.on('resize', schedulePersist)
  mainWindow.on('move', schedulePersist)
  mainWindow.on('maximize', schedulePersist)
  mainWindow.on('unmaximize', schedulePersist)
  mainWindow.on('close', () => {
    persistMainWindowState()
  })

  // Build and set the application menu
  const recentFiles = getRecentFiles()
  const presetNames = listLayoutPresetNames()
  const appMenu = buildAppMenu(mainWindow, recentFiles, presetNames, {
    onCheckForUpdates: handleCheckForUpdates,
  })
  Menu.setApplicationMenu(appMenu)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// IPC handlers for file operations
ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'MATLAB & Live Scripts', extensions: ['m', 'mls'] },
      { name: 'MATLAB Files', extensions: ['m'] },
      { name: 'MatSlop Live Scripts', extensions: ['mls'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  const filePath = result.filePaths[0]
  const content = fs.readFileSync(filePath, 'utf-8')
  return { filePath, content, filename: path.basename(filePath) }
})

ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('file:saveAs', async (_event, content: string, defaultName?: string) => {
  const isLiveScript = defaultName?.endsWith('.mls')
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName ?? 'untitled.m',
    filters: isLiveScript
      ? [
          { name: 'MatSlop Live Scripts', extensions: ['mls'] },
          { name: 'All Files', extensions: ['*'] },
        ]
      : [
          { name: 'MATLAB Files', extensions: ['m'] },
          { name: 'All Files', extensions: ['*'] },
        ]
  })
  if (result.canceled || !result.filePath) {
    return null
  }
  try {
    fs.writeFileSync(result.filePath, content, 'utf-8')
    return { filePath: result.filePath, filename: path.basename(result.filePath) }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('file:confirmClose', async (_event, filename: string) => {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Save', 'Discard', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved Changes',
    message: `"${filename}" has unsaved changes.`,
    detail: 'Do you want to save the changes before closing?'
  })
  // 0 = Save, 1 = Discard, 2 = Cancel
  return result.response
})

// Filesystem IPC handlers for File Browser
ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDirectory: e.isDirectory()
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch {
    return []
  }
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return { filePath, content, filename: path.basename(filePath) }
  } catch {
    return null
  }
})

ipcMain.handle('fs:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('fs:getHomeDir', () => os.homedir())

ipcMain.handle('fs:rename', async (_event, oldPath: string, newName: string) => {
  try {
    const dir = path.dirname(oldPath)
    const newPath = path.join(dir, newName)
    fs.renameSync(oldPath, newPath)
    return { success: true, newPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
  try {
    const stat = fs.statSync(targetPath)
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true })
    } else {
      fs.unlinkSync(targetPath)
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:createFile', async (_event, dirPath: string, name: string) => {
  try {
    const filePath = path.join(dirPath, name)
    fs.writeFileSync(filePath, '', 'utf-8')
    return { success: true, path: filePath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:createFolder', async (_event, dirPath: string, name: string) => {
  try {
    const folderPath = path.join(dirPath, name)
    fs.mkdirSync(folderPath)
    return { success: true, path: folderPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

// US-032: Find in Files — walk `cwd` filtered by `glob`, search every
// matching file's text content for `query`, and return the results plus
// a scan summary (counts, truncated flag).
ipcMain.handle(
  'find:inFiles',
  async (
    _event,
    cwd: string,
    query: string,
    options: FindInFilesOptions = {},
  ) => {
    if (!cwd || typeof cwd !== 'string') {
      return { matches: [], filesScanned: 0, truncated: false, error: 'cwd required' }
    }
    if (!query || typeof query !== 'string') {
      return { matches: [], filesScanned: 0, truncated: false }
    }
    try {
      return findInFiles(cwd, query, options)
    } catch (err) {
      return { matches: [], filesScanned: 0, truncated: false, error: String(err) }
    }
  },
)

// US-037: Git integration IPC handlers.
ipcMain.handle('git:status', async (_event, cwd: string) => {
  if (!cwd || typeof cwd !== 'string') {
    return { isRepo: false, repoRoot: null, branch: null, entries: [], error: 'cwd required' }
  }
  try {
    return await getGitStatus(cwd)
  } catch (err) {
    return { isRepo: false, repoRoot: null, branch: null, entries: [], error: String(err) }
  }
})

ipcMain.handle(
  'git:diff',
  async (_event, cwd: string, filePath: string, staged: boolean, untracked: boolean) => {
    if (!cwd || !filePath) {
      return { isRepo: false, diff: null, error: 'cwd and filePath required' }
    }
    try {
      return await getGitDiff(cwd, filePath, !!staged, !!untracked)
    } catch (err) {
      return { isRepo: false, diff: null, error: String(err) }
    }
  },
)

ipcMain.handle(
  'git:stageFile',
  async (_event, cwd: string, filePath: string, stage: boolean) => {
    if (!cwd || !filePath) return { success: false, error: 'cwd and filePath required' }
    try {
      return await gitStageFile(cwd, filePath, !!stage)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
)

ipcMain.handle('git:commit', async (_event, cwd: string, message: string) => {
  if (!cwd) return { success: false, error: 'cwd required' }
  try {
    return await gitCommit(cwd, message ?? '')
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:confirmDelete', async (_event, name: string, isDirectory: boolean) => {
  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm Delete',
    message: `Delete ${isDirectory ? 'folder' : 'file'} "${name}"?`,
    detail: isDirectory ? 'This will delete the folder and all its contents.' : 'This action cannot be undone.'
  })
  return result.response === 0
})

// IPC handlers for Octave configuration
ipcMain.handle('octave:autoDetect', () => {
  return autoDetectOctavePath()
})

ipcMain.handle('octave:download', async () => {
  // Download Octave to a writable directory, then return the binary path.
  // In packaged mode, resources/ is read-only, so download to userData.
  const targetDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'octave')
    : path.join(app.getAppPath(), 'resources', 'octave')

  const https = await import('https')
  const http = await import('http')

  function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      const file = fs.createWriteStream(dest)
      const doGet = url.startsWith('https') ? https.get : http.get
      function follow(u: string, depth = 0): void {
        if (depth > 10) { reject(new Error('Too many redirects')); return }
        const getter = u.startsWith('https') ? https.get : http.get
        getter(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume(); follow(res.headers.location, depth + 1); return
          }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      }
      follow(url)
    })
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true })
    if (process.platform === 'win32') {
      const zipUrl = 'https://ftpmirror.gnu.org/octave/windows/octave-9.4.0-w64.zip'
      const zipPath = path.join(targetDir, 'octave.zip')
      const binaryPath = path.join(targetDir, 'mingw64', 'bin', 'octave-cli.exe')
      if (!fs.existsSync(binaryPath)) {
        console.log('Downloading Octave for Windows...')
        await downloadFile(zipUrl, zipPath)
        console.log('Extracting...')
        const { execSync } = await import('child_process')
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`, { timeout: 600000 })
        // Move from subdirectory to root
        const subdir = path.join(targetDir, 'octave-9.4.0-w64')
        if (fs.existsSync(subdir)) {
          for (const entry of fs.readdirSync(subdir)) {
            const src = path.join(subdir, entry)
            const dst = path.join(targetDir, entry)
            if (!fs.existsSync(dst)) fs.renameSync(src, dst)
          }
          fs.rmSync(subdir, { recursive: true, force: true })
        }
        try { fs.unlinkSync(zipPath) } catch {}
        console.log('Octave ready at:', binaryPath)
      }
      if (fs.existsSync(binaryPath)) return binaryPath
    }
    // For other platforms, fall back to auto-detect (system Octave)
    return autoDetectOctavePath()
  } catch (err) {
    console.error('Octave download failed:', err)
    return null
  }
})

ipcMain.handle('octave:validate', async (_event, binaryPath: string) => {
  return validateOctavePath(binaryPath)
})

ipcMain.handle('octave:getPath', () => {
  return getStoredOctavePath()
})

ipcMain.handle('octave:setPath', (_event, binaryPath: string) => {
  setOctavePath(binaryPath)
})

// IPC handlers for Octave process management
ipcMain.handle('octave:start', async (_event, binaryPath: string) => {
  try {
    if (octaveProcess) {
      octaveProcess.stop()
    }
    octaveProcess = new OctaveProcessManager(binaryPath, getMatslopScriptsDir())

    octaveProcess.on('status', (status: string) => {
      mainWindow?.webContents.send('octave:statusChanged', status)
    })

    octaveProcess.on('exit', (info: { code: number | null; signal: string | null }) => {
      mainWindow?.webContents.send('octave:crashed', info)
    })

    octaveProcess.on('error', (err: Error) => {
      mainWindow?.webContents.send('octave:crashed', { code: null, signal: null, error: err.message })
    })

    // US-016: forward debug-pause events to the renderer so the UI can
    // highlight the paused line and flip the status bar into debug mode.
    octaveProcess.on('paused', (loc: { file: string; line: number }) => {
      mainWindow?.webContents.send('octave:paused', loc)
    })

    // US-015: reapply any previously-set breakpoints once Octave is ready.
    attachBreakpointReapplier(octaveProcess)

    octaveProcess.start()
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('octave:execute', async (_event, command: string) => {
  if (!octaveProcess || !octaveProcess.isRunning()) {
    return { output: '', error: 'Octave is not running', isComplete: true }
  }
  try {
    return await octaveProcess.executeCommand(command)
  } catch (err) {
    return { output: '', error: String(err), isComplete: true }
  }
})

ipcMain.handle('octave:interrupt', () => {
  octaveProcess?.interrupt()
})

// Send a raw debug command to Octave's stdin, bypassing the command queue.
// Returns the output produced after the command (e.g. script output after dbcont).
ipcMain.handle('octave:sendRaw', async (_event, command: string) => {
  if (!octaveProcess) return { output: '', error: '', isComplete: true }
  return await octaveProcess.sendRawCommand(command)
})


// US-020: Pause a running script and drop into the debugger at the
// currently-executing line. See OctaveProcessManager.pauseForDebug() for
// the mechanism (SIGINT + debug_on_interrupt(true)).
ipcMain.handle('octave:pauseForDebug', () => {
  const sent = octaveProcess?.pauseForDebug() ?? false
  return { sent }
})

ipcMain.handle('octave:restart', async (_event, binaryPath: string) => {
  if (octaveProcess) {
    octaveProcess.stop()
  }
  octaveProcess = new OctaveProcessManager(binaryPath)

  octaveProcess.on('status', (status: string) => {
    mainWindow?.webContents.send('octave:statusChanged', status)
  })

  octaveProcess.on('exit', (info: { code: number | null; signal: string | null }) => {
    mainWindow?.webContents.send('octave:crashed', info)
  })

  octaveProcess.on('error', (err: Error) => {
    mainWindow?.webContents.send('octave:crashed', { code: null, signal: null, error: err.message })
  })

  // US-016: forward debug-pause events after a restart as well.
  octaveProcess.on('paused', (loc: { file: string; line: number }) => {
    mainWindow?.webContents.send('octave:paused', loc)
  })

  // US-015: reapply any previously-set breakpoints on restart so debug state
  // survives Octave coming back up.
  attachBreakpointReapplier(octaveProcess)

  octaveProcess.start()
  return { success: true }
})

ipcMain.handle('octave:getStatus', () => {
  return octaveProcess?.getStatus() ?? 'disconnected'
})

ipcMain.handle('octave:browse', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select GNU Octave Binary',
    filters:
      process.platform === 'win32'
        ? [{ name: 'Executables', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
        : [],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// IPC handlers for figure/plot support
ipcMain.handle('figures:readImage', async (_event, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath)
    return data.toString('base64')
  } catch {
    return null
  }
})

ipcMain.handle('figures:readTextFile', async (_event, filePath: string) => {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

/**
 * US-030: Publish to HTML. Renderer computes the HTML content (see
 * src/renderer/editor/publishHtml.ts) and passes it here to be written
 * to a user-chosen .html file. Split into `publish:saveDialog` and
 * `publish:writeFile` to mirror the figures export flow and to keep
 * the main-process handler dependency-free.
 */
ipcMain.handle('publish:saveDialog', async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [
      { name: 'HTML Document', extensions: ['html'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return null
  return { filePath: result.filePath }
})

ipcMain.handle('publish:writeFile', async (_event, filePath: string, content: string) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'invalid file path' }
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('figures:saveDialog', async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'SVG Image', extensions: ['svg'] },
      { name: 'PDF Document', extensions: ['pdf'] }
    ]
  })
  if (result.canceled || !result.filePath) return null
  const ext = path.extname(result.filePath).slice(1).toLowerCase()
  return { filePath: result.filePath, format: ext || 'png' }
})

ipcMain.handle('figures:copyFile', async (_event, sourcePath: string, destPath: string) => {
  try {
    fs.copyFileSync(sourcePath, destPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

/**
 * Write a plot export to disk. `data` is either a base64-encoded PNG payload
 * (strip any `data:image/...;base64,` prefix) or raw UTF-8 text for SVG.
 * Used by the renderer's PlotRenderer export button (US-011).
 */
ipcMain.handle(
  'figures:exportPlot',
  async (_event, filePath: string, data: string, encoding: 'base64' | 'utf8') => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'invalid file path' }
      }
      const commaIdx = data.indexOf(',')
      const payload = encoding === 'base64' && data.startsWith('data:') && commaIdx >= 0
        ? data.slice(commaIdx + 1)
        : data
      if (encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(payload, 'base64'))
      } else {
        fs.writeFileSync(filePath, payload, 'utf-8')
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },
)

/**
 * US-012: Open a plot figure in its own OS window. The figure payload is
 * registered in the main-process `detachedFigures` map under a fresh id;
 * a new BrowserWindow is spawned that loads the same renderer bundle with
 * `?detachedFigureId=<id>`. The renderer entry (main.tsx) detects the
 * query param and mounts the lightweight `DetachedPlot` component instead
 * of the full `App`. Closing the detached window frees the map entry and
 * returns focus to the main window.
 */
ipcMain.handle('plot:openDetached', async (_event, figure: unknown) => {
  try {
    const id = `detfig-${++detachedCounter}`
    detachedFigures.set(id, figure)

    const win = new BrowserWindow({
      width: 960,
      height: 720,
      minWidth: 400,
      minHeight: 300,
      title: 'MatSlop – Detached Plot',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    // Detached windows don't need the app menu.
    win.setMenu(null)
    detachedWindows.set(id, win)

    win.on('closed', () => {
      detachedFigures.delete(id)
      detachedWindows.delete(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Return focus to the main window as per US-012 acceptance criteria.
        mainWindow.focus()
      }
    })

    const search = `detachedFigureId=${encodeURIComponent(id)}`
    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${search}`)
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'), {
        search,
      })
    }
    return { success: true, id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('plot:getDetachedFigure', (_event, id: string) => {
  return detachedFigures.get(id) ?? null
})

/** Test-only helper: how many detached plot windows are currently open. */
ipcMain.handle('plot:_testDetachedCount', () => {
  if (!process.env.MATSLOP_USER_DATA_DIR) return 0
  return detachedWindows.size
})

/**
 * US-027: Open a panel in its own OS window. `tabId` is one of the stable
 * `DOCK_TAB_IDS` values from the renderer. A fresh `BrowserWindow` is
 * spawned pointing at the same renderer bundle with `?detachedPanelId=<tabId>`;
 * the renderer entry (main.tsx) detects the query param and mounts the
 * lightweight `DetachedPanel` component. When the window is closed, the
 * main renderer is notified via `panel:redocked` so the panel is restored
 * to the dock layout at its previous location.
 */
ipcMain.handle('panel:openDetached', async (_event, tabId: unknown) => {
  try {
    if (typeof tabId !== 'string' || tabId.length === 0) {
      return { success: false, error: 'invalid tabId' }
    }
    // Idempotent: if already detached, just focus the existing window.
    const existing = detachedPanelWindows.get(tabId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return { success: true, tabId }
    }

    const win = new BrowserWindow({
      width: 640,
      height: 480,
      minWidth: 300,
      minHeight: 200,
      title: `MatSlop – ${tabId}`,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.mjs'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.setMenu(null)
    detachedPanelWindows.set(tabId, win)

    win.on('closed', () => {
      detachedPanelWindows.delete(tabId)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('panel:redocked', tabId)
        mainWindow.focus()
      }
    })

    const search = `detachedPanelId=${encodeURIComponent(tabId)}`
    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${search}`)
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'), {
        search,
      })
    }
    return { success: true, tabId }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

/**
 * US-027: Programmatically close a detached panel window (e.g. when the
 * renderer toggles the panel's visibility off while it is detached). The
 * normal `closed` handler fires and emits `panel:redocked`.
 */
ipcMain.handle('panel:closeDetached', (_event, tabId: unknown) => {
  if (typeof tabId !== 'string') return { success: false }
  const win = detachedPanelWindows.get(tabId)
  if (!win || win.isDestroyed()) return { success: false }
  win.close()
  return { success: true }
})

/** Test-only helper: list of tab ids that are currently detached. */
ipcMain.handle('panel:_testDetachedList', () => {
  if (!process.env.MATSLOP_USER_DATA_DIR) return []
  return Array.from(detachedPanelWindows.keys())
})

// ---------------------------------------------------------------------------
// Debugger bridge (US-014+)
// ---------------------------------------------------------------------------
// Records the set of active breakpoints by file path and, as of US-015,
// forwards `dbstop` / `dbclear` commands to the running Octave process so
// breakpoints are honored at runtime. The map is also the single source of
// truth used to reapply breakpoints after an Octave restart.
const debugBreakpoints = new Map<string, Set<number>>()

/**
 * US-021: Conditions attached to the entries in `debugBreakpoints`. Keys
 * are the same bucket keys used by the breakpoint registry; values map
 * 1-based line numbers to condition-expression strings. A breakpoint line
 * that is absent from this map (or whose entry is an empty string) is
 * considered unconditional and reapplied via plain `dbstop`. Passed to
 * `reapplyAllBreakpoints` so conditional breakpoints survive an Octave
 * restart just like plain ones.
 */
const debugBreakpointConditions = new Map<string, Map<number, string>>()

function setConditionEntry(key: string, line: number, condition: string | null): void {
  const trimmed = (condition ?? '').trim()
  if (!trimmed) {
    const inner = debugBreakpointConditions.get(key)
    if (!inner) return
    inner.delete(line)
    if (inner.size === 0) debugBreakpointConditions.delete(key)
    return
  }
  const inner = debugBreakpointConditions.get(key) ?? new Map<number, string>()
  inner.set(line, trimmed)
  debugBreakpointConditions.set(key, inner)
}

/**
 * Return the current Octave command executor if the process is running,
 * otherwise null. Set/clear operations gracefully no-op the dbstop/dbclear
 * side-effect when Octave is down; the in-memory registry still updates so
 * the next start/restart can reapply them.
 */
function currentOctaveExecutor(): ((cmd: string) => Promise<unknown>) | null {
  if (octaveProcess && octaveProcess.isRunning()) {
    const proc = octaveProcess
    return (cmd: string) => proc.executeCommand(cmd)
  }
  return null
}

ipcMain.handle(
  'debug:setBreakpoint',
  async (_event, filePath: string | null, line: number) => {
    const exec = currentOctaveExecutor()
    // Ensure the file's directory is on Octave's path so dbstop can find it
    if (exec && filePath) {
      const dir = path.dirname(filePath).replace(/'/g, "''")
      try {
        await exec(`addpath('${dir}')`)
      } catch { /* ignore — best effort */ }
    }
    const ok = applySetBreakpoint(debugBreakpoints, filePath, line, exec)
    return { success: ok }
  },
)

ipcMain.handle(
  'debug:clearBreakpoint',
  (_event, filePath: string | null, line: number) => {
    const ok = applyClearBreakpoint(debugBreakpoints, filePath, line, currentOctaveExecutor())
    if (ok) {
      // Conditions are keyed parallel to the breakpoint registry — drop any
      // condition attached to a breakpoint we just cleared so a later
      // retoggle starts out unconditional.
      const key = breakpointBucketKey(filePath)
      const lineInt = Math.floor(line)
      setConditionEntry(key, lineInt, null)
    }
    return { success: ok }
  },
)

/**
 * US-021: Set (or clear) the condition expression attached to a breakpoint.
 * The line must already exist in the registry — the renderer calls
 * `debug:setBreakpoint` before this — but we tolerate missing entries by
 * creating them here so the IPC stays idempotent. A null/empty condition
 * reverts the breakpoint to unconditional.
 */
ipcMain.handle(
  'debug:setBreakpointCondition',
  (_event, filePath: string | null, line: number, condition: string | null) => {
    if (!Number.isFinite(line) || line <= 0) return { success: false }
    const lineInt = Math.floor(line)
    const ok = applySetBreakpointWithCondition(
      debugBreakpoints,
      filePath,
      lineInt,
      condition,
      currentOctaveExecutor(),
    )
    if (ok) {
      const key = breakpointBucketKey(filePath)
      setConditionEntry(key, lineInt, condition)
    }
    return { success: ok }
  },
)

/**
 * US-023 (edit-and-continue, best effort): invoked by the renderer after a
 * .m file was saved while the debugger is paused. We re-apply every
 * remembered breakpoint for the saved file (dbclear + dbstop) so Octave
 * re-reads the freshly-written source the next time the function is
 * entered. Returns the list of Octave commands we sent so the renderer /
 * tests can assert the bridge did something.
 *
 * Safe to call even if Octave is not running — this is a best-effort nudge,
 * not a correctness requirement.
 */
ipcMain.handle(
  'debug:reapplyBreakpointsForFile',
  async (_event, filePath: string | null): Promise<{ sent: string[] }> => {
    const exec = currentOctaveExecutor()
    if (!exec) return { sent: [] }
    const sent = reapplyBreakpointsForFile(
      debugBreakpoints,
      filePath,
      exec,
      debugBreakpointConditions,
    )
    return { sent }
  },
)

/**
 * US-018: Query the running Octave for its current call stack. Runs the
 * pure `formatCallStackQuery()` command, parses the emitted marker rows,
 * and returns an array of frames. If Octave is not running (e.g. during
 * tests that only simulate a paused state) the bridge returns an empty
 * array so the renderer can still render a graceful "no frames" state.
 */
ipcMain.handle('debug:getCallStack', async (): Promise<CallStackFrame[]> => {
  const exec = currentOctaveExecutor()
  if (!exec) return []
  try {
    const result = (await exec(formatCallStackQuery())) as
      | { output?: string; error?: string }
      | undefined
    const combined = `${result?.output ?? ''}\n${result?.error ?? ''}`
    return parseCallStack(combined)
  } catch {
    return []
  }
})

/**
 * Wire an `OctaveProcessManager` instance so that when it first reaches the
 * `ready` status (i.e. initial startup is done) we replay every remembered
 * breakpoint via `dbstop`. This is what guarantees breakpoints survive an
 * Octave restart: the map in this module outlives the process.
 */
function attachBreakpointReapplier(proc: OctaveProcessManager): void {
  let replayed = false
  proc.on('status', (status: string) => {
    if (replayed) return
    if (status !== 'ready') return
    replayed = true
    reapplyAllBreakpoints(
      debugBreakpoints,
      (cmd: string) => proc.executeCommand(cmd),
      debugBreakpointConditions,
    )
  })
}

// IPC handlers for command history persistence
ipcMain.handle('history:load', () => {
  return readCommandHistory()
})

ipcMain.handle('history:save', (_event, history: string[]) => {
  writeCommandHistory(history)
})

ipcMain.handle('history:append', (_event, command: string) => {
  const history = readCommandHistory()
  history.push(command)
  // Keep max 10000 entries
  if (history.length > 10000) {
    history.splice(0, history.length - 10000)
  }
  writeCommandHistory(history)
})

ipcMain.handle('history:deleteEntry', (_event, index: number) => {
  const history = readCommandHistory()
  if (index >= 0 && index < history.length) {
    history.splice(index, 1)
    writeCommandHistory(history)
  }
  return history
})

// IPC handlers for theme/config
ipcMain.handle('config:getTheme', () => {
  return getStoredTheme()
})

ipcMain.handle('config:setTheme', (_event, theme: ThemeMode) => {
  setStoredTheme(theme)
})

ipcMain.handle('config:getPreferences', () => {
  return getPreferences()
})

ipcMain.handle('config:setPreferences', (_event, prefs: Partial<AppPreferences>) => {
  setPreferences(prefs)
})

// US-035: Keyboard shortcut overrides
ipcMain.handle('config:getShortcuts', () => {
  return getShortcutOverrides()
})

ipcMain.handle('config:setShortcuts', (_event, overrides: Record<string, StoredShortcutBinding>) => {
  setShortcutOverrides(overrides ?? {})
})

ipcMain.handle('config:getShowWelcome', () => {
  return getPreferences().showWelcome
})

ipcMain.handle('config:setShowWelcome', (_event, show: boolean) => {
  setPreferences({ showWelcome: show })
})

// IPC handlers for layout persistence
ipcMain.handle('layout:get', () => {
  return getLayoutConfig()
})

ipcMain.handle('layout:set', (_event, layout: LayoutConfig) => {
  setLayoutConfig(layout)
})

ipcMain.handle('layout:getDefault', () => {
  return getDefaultLayout()
})

// IPC handlers for recent files
ipcMain.handle('recentFiles:get', () => {
  return getRecentFiles()
})

ipcMain.handle('recentFiles:add', (_event, filePath: string) => {
  const updated = addRecentFile(filePath)
  rebuildMenu()
  return updated
})

ipcMain.handle('recentFiles:clear', () => {
  const updated = clearRecentFiles()
  rebuildMenu()
  return updated
})

// ---------------------------------------------------------------------------
// US-028: Layout presets
// ---------------------------------------------------------------------------

ipcMain.handle('layoutPresets:list', () => {
  // Return the full map so the renderer can show labels/metadata as well
  // as the name list — used by the View → Layouts menu AND the in-app
  // "Manage Presets" UI.
  return getLayoutPresets()
})

ipcMain.handle('layoutPresets:get', (_event, name: string) => {
  if (typeof name !== 'string') return null
  return getLayoutPreset(name)
})

ipcMain.handle('layoutPresets:save', (_event, name: string, preset: StoredLayoutPreset) => {
  if (typeof name !== 'string' || name.length === 0) {
    return { success: false, error: 'invalid name' }
  }
  if (!preset || typeof preset !== 'object') {
    return { success: false, error: 'invalid preset' }
  }
  saveLayoutPresetStore(name, preset)
  rebuildMenu()
  return { success: true }
})

ipcMain.handle('layoutPresets:delete', (_event, name: string) => {
  if (typeof name !== 'string') return { success: false }
  deleteLayoutPresetStore(name)
  rebuildMenu()
  return { success: true }
})

// Open a URL in the user's default browser (used for plot-export help links).
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  // Guard against opening non-http(s) URLs — this bridge is for help docs only.
  if (typeof url !== 'string') return
  if (!/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})

// Test-only: programmatically trigger a menu action. Guarded by env var.
// ---------------------------------------------------------------------------
// US-034: Session save/restore
// ---------------------------------------------------------------------------

ipcMain.handle('session:get', () => {
  return readSession()
})

ipcMain.handle('session:set', (_event, state: SessionState) => {
  writeSession(state)
})

ipcMain.handle('session:clear', () => {
  clearSession()
})

ipcMain.handle('session:getRestoreEnabled', () => {
  const prefs = getPreferences()
  return prefs.sessionRestore !== false
})

ipcMain.handle('session:setRestoreEnabled', (_event, enabled: boolean) => {
  setPreferences({ sessionRestore: !!enabled })
})

// ---------------------------------------------------------------------------
// US-041: Auto-update channel — IPC handlers and bridge lifecycle.
// ---------------------------------------------------------------------------
let updateBridge: UpdateBridge | null = null

function getUpdateBridge(): UpdateBridge {
  if (!updateBridge) {
    updateBridge = createUpdateBridge({
      getAppVersion: () => app.getVersion(),
      sendStatus: makeWindowSender(() => mainWindow),
      setLastCheckMs: setUpdateLastCheckMs,
      getLastCheckMs: getUpdateLastCheckMs,
      getIntervalHours: () => normalizeUpdateCheckIntervalHours(getUpdateCheckIntervalHours()),
    })
  }
  return updateBridge
}

ipcMain.handle('update:checkNow', async (): Promise<UpdateStatus> => {
  return getUpdateBridge().checkNow()
})

// US-C05: Alias for the renderer's updateCheck() method.
ipcMain.handle('update:check', async (): Promise<UpdateStatus> => {
  return getUpdateBridge().checkNow()
})

// US-C05: Trigger download of an available update.
ipcMain.handle('update:download', async (): Promise<void> => {
  return getUpdateBridge().downloadUpdate()
})

ipcMain.handle('update:checkIfDue', async (): Promise<UpdateStatus> => {
  return getUpdateBridge().checkIfDue()
})

ipcMain.handle('update:install', () => {
  getUpdateBridge().quitAndInstall()
})

ipcMain.handle('update:getState', (): UpdateStatus => {
  return getUpdateBridge().getState()
})

ipcMain.handle('update:getIntervalHours', (): number => {
  return normalizeUpdateCheckIntervalHours(getUpdateCheckIntervalHours())
})

ipcMain.handle('update:setIntervalHours', (_event, hours: number) => {
  const normalized = normalizeUpdateCheckIntervalHours(hours)
  setUpdateCheckIntervalHours(normalized)
  return normalized
})

ipcMain.handle('update:getEnabled', (): boolean => {
  return getUpdateCheckEnabled()
})

ipcMain.handle('update:setEnabled', (_event, enabled: boolean) => {
  setUpdateCheckEnabled(!!enabled)
})

ipcMain.handle('test:menuAction', (_event, action: string) => {
  if (!process.env.MATSLOP_USER_DATA_DIR) return // only enabled during tests
  mainWindow?.webContents.send('menu:action', action)
})

/**
 * US-C07: Handle the "Check for Updates..." menu action. Triggers an
 * immediate update check and shows a native dialog for "up to date" or
 * error results. If an update is available the banner in the renderer
 * will appear automatically (the bridge's sendStatus pushes
 * 'update:status' events to the renderer).
 */
async function handleCheckForUpdates(): Promise<void> {
  const bridge = getUpdateBridge()
  const status = await bridge.checkNow()
  if (status.kind === 'not-available') {
    dialog.showMessageBox({
      type: 'info',
      title: 'No Updates Available',
      message: `You are up to date (v${status.version})`,
      buttons: ['OK'],
    })
  } else if (status.kind === 'error') {
    dialog.showMessageBox({
      type: 'error',
      title: 'Update Check Failed',
      message: status.message,
      buttons: ['OK'],
    })
  }
  // 'available' / 'downloading' / 'downloaded' → the renderer banner handles these
}

function rebuildMenu(): void {
  if (!mainWindow) return
  const recentFiles = getRecentFiles()
  const presetNames = listLayoutPresetNames()
  const appMenu = buildAppMenu(mainWindow, recentFiles, presetNames, {
    onCheckForUpdates: handleCheckForUpdates,
  })
  Menu.setApplicationMenu(appMenu)
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // US-C04: kick off an auto-update check after a 10-second delay on startup
  // so the renderer has time to mount and subscribe to 'update:status' events.
  // Then re-check every hour (the bridge internally decides if 24h has elapsed).
  // Skipped in test/dev e2e envs (MATSLOP_USER_DATA_DIR is set there) so we
  // don't reach out to GitHub during CI.
  if (
    !process.env.MATSLOP_USER_DATA_DIR &&
    !process.env.MATSLOP_SKIP_AUTO_UPDATE &&
    app.isPackaged &&
    getUpdateCheckEnabled()
  ) {
    setTimeout(() => {
      getUpdateBridge()
        .checkIfDue()
        .catch(() => {
          /* errors are surfaced via the update:status event */
        })
    }, 10_000)

    // Re-check every hour; checkIfDue() is a no-op if the configured
    // interval (default 24h) hasn't elapsed yet.
    setInterval(() => {
      if (getUpdateCheckEnabled()) {
        getUpdateBridge()
          .checkIfDue()
          .catch(() => {
            /* errors are surfaced via the update:status event */
          })
      }
    }, 60 * 60 * 1000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (octaveProcess) {
    octaveProcess.stop()
    octaveProcess = null
  }
})
