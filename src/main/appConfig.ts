import Store from 'electron-store'

export type ThemeMode = 'light' | 'dark' | 'system'

const store = new Store<{ theme: ThemeMode }>()

export function getStoredTheme(): ThemeMode {
  return store.get('theme', 'system') as ThemeMode
}

export function setStoredTheme(theme: ThemeMode): void {
  store.set('theme', theme)
}
