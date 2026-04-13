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
    // US-030: Publish to HTML
    publishSaveDialog: (defaultName: string) => Promise<{ filePath: string } | null>
    publishWriteFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
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
    octaveSendRaw: (command: string) => Promise<{ sent: boolean }>
    octavePauseForDebug: () => Promise<{ sent: boolean }>
    octaveRestart: (binaryPath: string) => Promise<{ success: boolean }>
    octaveGetStatus: () => Promise<'ready' | 'busy' | 'disconnected'>
    onOctaveStatusChanged: (callback: (status: 'ready' | 'busy' | 'disconnected') => void) => () => void
    onOctaveCrashed: (callback: (info: { code: number | null; signal: string | null; error?: string }) => void) => () => void
    onOctavePaused: (callback: (loc: { file: string; line: number }) => void) => () => void
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
    // Detached panel windows (US-027)
    panelOpenDetached: (tabId: string) => Promise<{ success: boolean; tabId?: string; error?: string }>
    panelCloseDetached: (tabId: string) => Promise<{ success: boolean }>
    onPanelRedocked: (callback: (tabId: string) => void) => () => void
    _testDetachedPanelList: () => Promise<string[]>
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
    // US-035: Keyboard shortcut overrides
    configGetShortcuts: () => Promise<Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>>
    configSetShortcuts: (overrides: Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>) => Promise<void>
    configGetShowWelcome: () => Promise<boolean>
    configSetShowWelcome: (show: boolean) => Promise<void>
    // Layout persistence
    layoutGet: () => Promise<{
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
      dockLayout?: unknown
    }>
    layoutSet: (layout: {
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
      dockLayout?: unknown
    }) => Promise<void>
    layoutGetDefault: () => Promise<{
      panelVisibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      panelSizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
    }>
    // US-028: Layout presets
    layoutPresetsList: () => Promise<Record<string, {
      label: string
      visibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      sizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
      dockLayout?: unknown
    }>>
    layoutPresetsGet: (name: string) => Promise<{
      label: string
      visibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
      sizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
      dockLayout?: unknown
    } | null>
    layoutPresetsSave: (
      name: string,
      preset: {
        label: string
        visibility: { fileBrowser: boolean; workspace: boolean; commandWindow: boolean; commandHistory: boolean }
        sizes: { fileBrowserWidth: number; workspaceWidth: number; bottomHeight: number; commandHistoryWidth: number }
        dockLayout?: unknown
      },
    ) => Promise<{ success: boolean; error?: string }>
    layoutPresetsDelete: (name: string) => Promise<{ success: boolean }>
    // Recent files
    recentFilesGet: () => Promise<string[]>
    recentFilesAdd: (filePath: string) => Promise<string[]>
    recentFilesClear: () => Promise<string[]>
    // Shell helpers
    openExternal: (url: string) => Promise<void>
    // US-032: Find in Files
    findInFiles: (
      cwd: string,
      query: string,
      options?: {
        glob?: string
        caseInsensitive?: boolean
        regex?: boolean
        wholeWord?: boolean
        maxResults?: number
        maxFiles?: number
        maxDepth?: number
      },
    ) => Promise<{
      matches: Array<{ file: string; line: number; column: number; text: string }>
      filesScanned: number
      truncated: boolean
      error?: string
    }>
    // Debugger (US-014+)
    debugSetBreakpoint: (filePath: string | null, line: number) => Promise<{ success: boolean }>
    debugClearBreakpoint: (filePath: string | null, line: number) => Promise<{ success: boolean }>
    debugSetBreakpointCondition: (
      filePath: string | null,
      line: number,
      condition: string | null,
    ) => Promise<{ success: boolean }>
    debugGetCallStack: () => Promise<Array<{ name: string; file: string; line: number }>>
    // US-023: edit-and-continue (best effort) — re-apply breakpoints for a
    // single file after it was saved while paused.
    debugReapplyBreakpointsForFile: (filePath: string | null) => Promise<{ sent: string[] }>
    // US-034: Session save/restore
    sessionGet: () => Promise<{
      version: 1
      savedAt: number
      activeTabId: string | null
      tabs: Array<{
        id: string
        filename: string
        filePath: string | null
        mode: string
        content: string
        savedContent: string
        cursorLine?: number
        cursorColumn?: number
      }>
    } | null>
    sessionSet: (state: {
      version: 1
      savedAt: number
      activeTabId: string | null
      tabs: Array<{
        id: string
        filename: string
        filePath: string | null
        mode: string
        content: string
        savedContent: string
        cursorLine?: number
        cursorColumn?: number
      }>
    }) => Promise<void>
    sessionClear: () => Promise<void>
    sessionGetRestoreEnabled: () => Promise<boolean>
    sessionSetRestoreEnabled: (enabled: boolean) => Promise<void>
    // US-037: Git integration
    gitStatus: (cwd: string) => Promise<{
      isRepo: boolean
      repoRoot: string | null
      branch: string | null
      entries: Array<{
        path: string
        origPath?: string
        indexStatus: string
        workTreeStatus: string
        staged: boolean
        unstaged: boolean
        untracked: boolean
        badge: string
      }>
      error?: string
    }>
    gitDiff: (
      cwd: string,
      filePath: string,
      staged: boolean,
      untracked: boolean,
    ) => Promise<{
      isRepo: boolean
      diff: {
        oldPath: string | null
        newPath: string | null
        hunks: Array<{
          header: string
          oldStart: number
          oldLines: number
          newStart: number
          newLines: number
          lines: Array<{ kind: 'context' | 'add' | 'del'; text: string; oldLine?: number; newLine?: number }>
        }>
        empty: boolean
      } | null
      error?: string
    }>
    gitStageFile: (cwd: string, filePath: string, stage: boolean) => Promise<{ success: boolean; error?: string }>
    gitCommit: (cwd: string, message: string) => Promise<{ success: boolean; commit?: string; error?: string }>
    // US-041: Auto-update channel
    updateCheckNow: () => Promise<UpdateStatus>
    updateCheckIfDue: () => Promise<UpdateStatus>
    updateInstall: () => Promise<void>
    updateGetState: () => Promise<UpdateStatus>
    updateGetIntervalHours: () => Promise<number>
    updateSetIntervalHours: (hours: number) => Promise<number>
    updateGetEnabled: () => Promise<boolean>
    updateSetEnabled: (enabled: boolean) => Promise<void>
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
    // Test-only
    _testMenuAction?: (action: string) => Promise<void>
    // US-L01: Busy tracking callback registration
    registerBusyCallbacks?: (begin: () => void, end: () => void) => void
  }
}

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string; releaseName?: string }
  | { kind: 'not-available'; version: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string; releaseNotes?: string; releaseName?: string }
  | { kind: 'error'; message: string }
