import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { autoDetectOctavePath, validateOctavePath, getStoredOctavePath, setOctavePath } from './octaveConfig'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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
