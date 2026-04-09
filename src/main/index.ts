import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

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
