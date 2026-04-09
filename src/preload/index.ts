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
})
