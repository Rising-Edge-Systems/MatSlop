import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('matslop', {
  platform: process.platform,
  openFile: (): Promise<{ filePath: string; content: string; filename: string } | null> =>
    ipcRenderer.invoke('file:open'),
  saveFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content: string, defaultName?: string): Promise<{ filePath: string; filename: string } | null> =>
    ipcRenderer.invoke('file:saveAs', content, defaultName),
  confirmClose: (filename: string): Promise<number> =>
    ipcRenderer.invoke('file:confirmClose', filename),
  // Filesystem operations for File Browser
  readDir: (dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> =>
    ipcRenderer.invoke('fs:readDir', dirPath),
  readFile: (filePath: string): Promise<{ filePath: string; content: string; filename: string } | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('fs:selectDirectory'),
  getHomeDir: (): Promise<string> =>
    ipcRenderer.invoke('fs:getHomeDir'),
  fsRename: (oldPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),
  fsDelete: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('fs:delete', targetPath),
  fsCreateFile: (dirPath: string, name: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('fs:createFile', dirPath, name),
  fsCreateFolder: (dirPath: string, name: string): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('fs:createFolder', dirPath, name),
  confirmDelete: (name: string, isDirectory: boolean): Promise<boolean> =>
    ipcRenderer.invoke('fs:confirmDelete', name, isDirectory),
})
