import Store from 'electron-store'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppPreferences {
  theme: ThemeMode
  fontFamily: string
  fontSize: number
  tabSize: number
  insertSpaces: boolean
  defaultWorkingDirectory: string
  showWelcome: boolean
}

export interface PanelVisibilityConfig {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
  commandHistory: boolean
}

export interface LayoutConfig {
  panelVisibility: PanelVisibilityConfig
  panelSizes: {
    fileBrowserWidth: number
    workspaceWidth: number
    bottomHeight: number
    commandHistoryWidth: number
  }
}

export interface AppConfig extends AppPreferences {
  layout: LayoutConfig
  recentFiles: string[]
}

const defaultLayout: LayoutConfig = {
  panelVisibility: {
    fileBrowser: true,
    workspace: true,
    commandWindow: true,
    commandHistory: false,
  },
  panelSizes: {
    fileBrowserWidth: 220,
    workspaceWidth: 280,
    bottomHeight: 200,
    commandHistoryWidth: 250,
  },
}

const defaults: AppPreferences = {
  theme: 'system',
  fontFamily: "'Consolas', 'Courier New', monospace",
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  defaultWorkingDirectory: '',
  showWelcome: true,
}

const store = new Store<AppConfig>()

export function getStoredTheme(): ThemeMode {
  return store.get('theme', defaults.theme) as ThemeMode
}

export function setStoredTheme(theme: ThemeMode): void {
  store.set('theme', theme)
}

export function getPreferences(): AppPreferences {
  return {
    theme: store.get('theme', defaults.theme) as ThemeMode,
    fontFamily: store.get('fontFamily', defaults.fontFamily) as string,
    fontSize: store.get('fontSize', defaults.fontSize) as number,
    tabSize: store.get('tabSize', defaults.tabSize) as number,
    insertSpaces: store.get('insertSpaces', defaults.insertSpaces) as boolean,
    defaultWorkingDirectory: store.get('defaultWorkingDirectory', defaults.defaultWorkingDirectory) as string,
    showWelcome: store.get('showWelcome', defaults.showWelcome) as boolean,
  }
}

export function setPreferences(prefs: Partial<AppPreferences>): void {
  for (const [key, value] of Object.entries(prefs)) {
    store.set(key, value)
  }
}

// Layout persistence
export function getLayoutConfig(): LayoutConfig {
  return store.get('layout', defaultLayout) as LayoutConfig
}

export function setLayoutConfig(layout: LayoutConfig): void {
  store.set('layout', layout)
}

export function getDefaultLayout(): LayoutConfig {
  return { ...defaultLayout, panelVisibility: { ...defaultLayout.panelVisibility }, panelSizes: { ...defaultLayout.panelSizes } }
}

// Recent files
const MAX_RECENT_FILES = 10

export function getRecentFiles(): string[] {
  return (store.get('recentFiles', []) as string[]).slice(0, MAX_RECENT_FILES)
}

export function addRecentFile(filePath: string): string[] {
  const recent = getRecentFiles().filter((f) => f !== filePath)
  recent.unshift(filePath)
  const trimmed = recent.slice(0, MAX_RECENT_FILES)
  store.set('recentFiles', trimmed)
  return trimmed
}

export function clearRecentFiles(): string[] {
  store.set('recentFiles', [])
  return []
}
