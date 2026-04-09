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

const defaults: AppPreferences = {
  theme: 'system',
  fontFamily: "'Consolas', 'Courier New', monospace",
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  defaultWorkingDirectory: '',
  showWelcome: true,
}

const store = new Store<AppPreferences>()

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
