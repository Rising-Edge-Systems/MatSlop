import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { autoDetectOctavePath, validateOctavePath, getStoredOctavePath, setOctavePath } from './octaveConfig'
import { OctaveProcessManager } from './octaveProcess'
import { buildAppMenu } from './appMenu'

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'MatSlop',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Build and set the application menu
  const appMenu = buildAppMenu(mainWindow)
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
      { name: 'MATLAB Files', extensions: ['m'] },
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
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName ?? 'untitled.m',
    filters: [
      { name: 'MATLAB Files', extensions: ['m'] },
      { name: 'All Files', extensions: ['*'] }
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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
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
