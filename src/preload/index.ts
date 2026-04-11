import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

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
  // Octave configuration
  octaveAutoDetect: (): Promise<string | null> =>
    ipcRenderer.invoke('octave:autoDetect'),
  octaveValidate: (binaryPath: string): Promise<{ valid: boolean; version?: string; error?: string }> =>
    ipcRenderer.invoke('octave:validate', binaryPath),
  octaveGetPath: (): Promise<string | null> =>
    ipcRenderer.invoke('octave:getPath'),
  octaveSetPath: (binaryPath: string): Promise<void> =>
    ipcRenderer.invoke('octave:setPath', binaryPath),
  octaveBrowse: (): Promise<string | null> =>
    ipcRenderer.invoke('octave:browse'),
  // Octave process management
  octaveStart: (binaryPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('octave:start', binaryPath),
  octaveExecute: (command: string): Promise<{ output: string; error: string; isComplete: boolean }> =>
    ipcRenderer.invoke('octave:execute', command),
  octaveInterrupt: (): Promise<void> =>
    ipcRenderer.invoke('octave:interrupt'),
  // US-020: Pause a running script and drop into the debugger at the
  // currently-executing line.
  octavePauseForDebug: (): Promise<{ sent: boolean }> =>
    ipcRenderer.invoke('octave:pauseForDebug'),
  octaveRestart: (binaryPath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('octave:restart', binaryPath),
  octaveGetStatus: (): Promise<'ready' | 'busy' | 'disconnected'> =>
    ipcRenderer.invoke('octave:getStatus'),
  onOctaveStatusChanged: (callback: (status: 'ready' | 'busy' | 'disconnected') => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: 'ready' | 'busy' | 'disconnected'): void => callback(status)
    ipcRenderer.on('octave:statusChanged', handler)
    return () => ipcRenderer.removeListener('octave:statusChanged', handler)
  },
  onOctaveCrashed: (callback: (info: { code: number | null; signal: string | null; error?: string }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, info: { code: number | null; signal: string | null; error?: string }): void => callback(info)
    ipcRenderer.on('octave:crashed', handler)
    return () => ipcRenderer.removeListener('octave:crashed', handler)
  },
  // US-016: debugger-paused events (Octave hit a breakpoint).
  onOctavePaused: (callback: (loc: { file: string; line: number }) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, loc: { file: string; line: number }): void => callback(loc)
    ipcRenderer.on('octave:paused', handler)
    return () => ipcRenderer.removeListener('octave:paused', handler)
  },
  // Command history persistence
  historyLoad: (): Promise<string[]> =>
    ipcRenderer.invoke('history:load'),
  historyAppend: (command: string): Promise<void> =>
    ipcRenderer.invoke('history:append', command),
  historyDeleteEntry: (index: number): Promise<string[]> =>
    ipcRenderer.invoke('history:deleteEntry', index),
  // Figure/plot support
  figuresReadImage: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('figures:readImage', filePath),
  figuresReadTextFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('figures:readTextFile', filePath),
  figuresSaveDialog: (defaultName: string): Promise<{ filePath: string; format: string } | null> =>
    ipcRenderer.invoke('figures:saveDialog', defaultName),
  figuresCopyFile: (sourcePath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('figures:copyFile', sourcePath, destPath),
  figuresExportPlot: (
    filePath: string,
    data: string,
    encoding: 'base64' | 'utf8',
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('figures:exportPlot', filePath, data, encoding),
  // Detached plot windows (US-012)
  plotOpenDetached: (figure: unknown): Promise<{ success: boolean; id?: string; error?: string }> =>
    ipcRenderer.invoke('plot:openDetached', figure),
  plotGetDetachedFigure: (id: string): Promise<unknown | null> =>
    ipcRenderer.invoke('plot:getDetachedFigure', id),
  _testDetachedPlotCount: (): Promise<number> =>
    ipcRenderer.invoke('plot:_testDetachedCount'),
  // Menu action events from main process
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, action: string): void => callback(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
  // Theme/config
  configGetTheme: (): Promise<'light' | 'dark' | 'system'> =>
    ipcRenderer.invoke('config:getTheme'),
  configSetTheme: (theme: 'light' | 'dark' | 'system'): Promise<void> =>
    ipcRenderer.invoke('config:setTheme', theme),
  configGetPreferences: (): Promise<{
    theme: 'light' | 'dark' | 'system'
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
    defaultWorkingDirectory: string
  }> => ipcRenderer.invoke('config:getPreferences'),
  configSetPreferences: (prefs: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('config:setPreferences', prefs),
  configGetShowWelcome: (): Promise<boolean> =>
    ipcRenderer.invoke('config:getShowWelcome'),
  configSetShowWelcome: (show: boolean): Promise<void> =>
    ipcRenderer.invoke('config:setShowWelcome', show),
  // Layout persistence
  layoutGet: (): Promise<{
    panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
    panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
  }> => ipcRenderer.invoke('layout:get'),
  layoutSet: (layout: {
    panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
    panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
  }): Promise<void> => ipcRenderer.invoke('layout:set', layout),
  layoutGetDefault: (): Promise<{
    panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
    panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
  }> => ipcRenderer.invoke('layout:getDefault'),
  // Recent files
  recentFilesGet: (): Promise<string[]> =>
    ipcRenderer.invoke('recentFiles:get'),
  recentFilesAdd: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('recentFiles:add', filePath),
  recentFilesClear: (): Promise<string[]> =>
    ipcRenderer.invoke('recentFiles:clear'),
  // Shell helpers
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  // Debugger: breakpoint bridge (US-014)
  // filePath may be null for unsaved tabs; main-side handler accepts it and
  // (for now) just records it so future stories can wire to Octave's dbstop.
  debugSetBreakpoint: (filePath: string | null, line: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('debug:setBreakpoint', filePath, line),
  debugClearBreakpoint: (filePath: string | null, line: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('debug:clearBreakpoint', filePath, line),
  // US-021: attach (or clear) a condition expression on an existing
  // breakpoint. Pass null/empty-string to revert to an unconditional bp.
  debugSetBreakpointCondition: (
    filePath: string | null,
    line: number,
    condition: string | null,
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('debug:setBreakpointCondition', filePath, line, condition),
  // US-018: Query Octave's current call stack (dbstack()). Returns the
  // frames top-to-bottom, or [] if Octave isn't running.
  debugGetCallStack: (): Promise<Array<{ name: string; file: string; line: number }>> =>
    ipcRenderer.invoke('debug:getCallStack'),
  // Test-only helper
  _testMenuAction: (action: string): Promise<void> =>
    ipcRenderer.invoke('test:menuAction', action),
})
