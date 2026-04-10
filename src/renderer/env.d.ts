/// <reference types="vite/client" />

declare module 'plotly.js-dist-min' {
  interface PlotlyStatic {
    newPlot(
      root: HTMLElement,
      data: unknown[],
      layout?: unknown,
      config?: unknown,
    ): Promise<HTMLElement>
    react(
      root: HTMLElement,
      data: unknown[],
      layout?: unknown,
      config?: unknown,
    ): Promise<HTMLElement>
    purge(root: HTMLElement): void
    relayout(root: HTMLElement, update: unknown): Promise<HTMLElement>
    downloadImage(
      root: HTMLElement,
      opts: {
        format: 'png' | 'svg' | 'jpeg' | 'webp'
        filename?: string
        width?: number
        height?: number
      },
    ): Promise<string>
    toImage(
      root: HTMLElement,
      opts: {
        format: 'png' | 'svg' | 'jpeg' | 'webp'
        width?: number
        height?: number
      },
    ): Promise<string>
    Plots: { resize(root: HTMLElement): void }
  }
  const Plotly: PlotlyStatic
  export default Plotly
}

interface Window {
  matslop: {
    platform: string
    openFile: () => Promise<{ filePath: string; content: string; filename: string } | null>
    saveFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
    saveFileAs: (content: string, defaultName?: string) => Promise<{ filePath: string; filename: string } | null>
    confirmClose: (filename: string) => Promise<number>
    // Filesystem operations for File Browser
    readDir: (dirPath: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
    readFile: (filePath: string) => Promise<{ filePath: string; content: string; filename: string } | null>
    selectDirectory: () => Promise<string | null>
    getHomeDir: () => Promise<string>
    fsRename: (oldPath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>
    fsDelete: (targetPath: string) => Promise<{ success: boolean; error?: string }>
    fsCreateFile: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>
    fsCreateFolder: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>
    confirmDelete: (name: string, isDirectory: boolean) => Promise<boolean>
    // Octave configuration
    octaveAutoDetect: () => Promise<string | null>
    octaveValidate: (binaryPath: string) => Promise<{ valid: boolean; version?: string; error?: string }>
    octaveGetPath: () => Promise<string | null>
    octaveSetPath: (binaryPath: string) => Promise<void>
    octaveBrowse: () => Promise<string | null>
    // Octave process management
    octaveStart: (binaryPath: string) => Promise<{ success: boolean; error?: string }>
    octaveExecute: (command: string) => Promise<{ output: string; error: string; isComplete: boolean }>
    octaveInterrupt: () => Promise<void>
    octaveRestart: (binaryPath: string) => Promise<{ success: boolean }>
    octaveGetStatus: () => Promise<'ready' | 'busy' | 'disconnected'>
    onOctaveStatusChanged: (callback: (status: 'ready' | 'busy' | 'disconnected') => void) => () => void
    onOctaveCrashed: (callback: (info: { code: number | null; signal: string | null; error?: string }) => void) => () => void
    // Command history persistence
    historyLoad: () => Promise<string[]>
    historyAppend: (command: string) => Promise<void>
    historyDeleteEntry: (index: number) => Promise<string[]>
    // Figure/plot support
    figuresReadImage: (filePath: string) => Promise<string | null>
    figuresReadTextFile: (filePath: string) => Promise<string | null>
    figuresSaveDialog: (defaultName: string) => Promise<{ filePath: string; format: string } | null>
    figuresCopyFile: (sourcePath: string, destPath: string) => Promise<{ success: boolean; error?: string }>
    figuresExportPlot: (
      filePath: string,
      data: string,
      encoding: 'base64' | 'utf8',
    ) => Promise<{ success: boolean; error?: string }>
    // Detached plot windows (US-012)
    plotOpenDetached: (figure: unknown) => Promise<{ success: boolean; id?: string; error?: string }>
    plotGetDetachedFigure: (id: string) => Promise<unknown | null>
    _testDetachedPlotCount: () => Promise<number>
    // Menu action events from main process
    onMenuAction: (callback: (action: string) => void) => () => void
    // Theme/config
    configGetTheme: () => Promise<'light' | 'dark' | 'system'>
    configSetTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>
    configGetPreferences: () => Promise<{
      theme: 'light' | 'dark' | 'system'
      fontFamily: string
      fontSize: number
      tabSize: number
      insertSpaces: boolean
      defaultWorkingDirectory: string
    }>
    configSetPreferences: (prefs: Record<string, unknown>) => Promise<void>
    configGetShowWelcome: () => Promise<boolean>
    configSetShowWelcome: (show: boolean) => Promise<void>
    // Layout persistence
    layoutGet: () => Promise<{
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
    }>
    layoutSet: (layout: {
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
    }) => Promise<void>
    layoutGetDefault: () => Promise<{
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
    }>
    // Recent files
    recentFilesGet: () => Promise<string[]>
    recentFilesAdd: (filePath: string) => Promise<string[]>
    recentFilesClear: () => Promise<string[]>
    // Shell helpers
    openExternal: (url: string) => Promise<void>
    // Debugger (US-014+)
    debugSetBreakpoint: (filePath: string | null, line: number) => Promise<{ success: boolean }>
    debugClearBreakpoint: (filePath: string | null, line: number) => Promise<{ success: boolean }>
    // Test-only
    _testMenuAction?: (action: string) => Promise<void>
  }
}
