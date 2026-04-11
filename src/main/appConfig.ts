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
  /**
   * US-026: persisted rc-dock layout tree (a rc-dock `LayoutBase` object,
   * serialized as plain JSON). Present when the user has rearranged tabs
   * via drag between docks; absent on first launch. Kept as `unknown`
   * here so appConfig does not need to import rc-dock types.
   */
  dockLayout?: unknown
}

/**
 * US-028: a user-saved layout preset. Mirrors the renderer-side
 * `LayoutPreset` type (see src/renderer/editor/layoutPresets.ts). We
 * intentionally duplicate the shape here rather than importing across
 * the main/renderer boundary to keep `electron-store` typing standalone.
 */
export interface StoredLayoutPreset {
  label: string
  visibility: PanelVisibilityConfig
  sizes: {
    fileBrowserWidth: number
    workspaceWidth: number
    bottomHeight: number
    commandHistoryWidth: number
  }
  dockLayout?: unknown
}

export interface AppConfig extends AppPreferences {
  layout: LayoutConfig
  recentFiles: string[]
  /** US-028: user-saved layout presets, keyed by preset name. */
  layoutPresets: Record<string, StoredLayoutPreset>
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

// Lazily create the electron-store instance. Creating it at module load
// time is dangerous because ESM hoists imports above top-level statements
// like `app.setPath('userData', ...)` — so the store would latch onto the
// production user data dir even when MATSLOP_USER_DATA_DIR has been set
// for test isolation. Lazy construction ensures the store is built only
// after the userData override has taken effect.
let _store: Store<AppConfig> | null = null
function store$(): Store<AppConfig> {
  if (_store === null) {
    _store = new Store<AppConfig>()
  }
  return _store
}
// Backwards-compatible local alias kept for callers below.
const store = new Proxy({} as Store<AppConfig>, {
  get(_t, prop) {
    const s = store$()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (s as any)[prop]
    return typeof v === 'function' ? v.bind(s) : v
  },
})

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

// ---------------------------------------------------------------------------
// US-028: Layout presets
// ---------------------------------------------------------------------------

const MAX_LAYOUT_PRESETS = 50

export function getLayoutPresets(): Record<string, StoredLayoutPreset> {
  const raw = store.get('layoutPresets', {}) as Record<string, StoredLayoutPreset>
  // Defensive copy so callers don't mutate store-held objects.
  return { ...raw }
}

export function getLayoutPreset(name: string): StoredLayoutPreset | null {
  const all = getLayoutPresets()
  return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null
}

export function saveLayoutPreset(name: string, preset: StoredLayoutPreset): void {
  const all = getLayoutPresets()
  // Cap total count: drop the oldest-inserted entry if we'd exceed it AND
  // the new name is not already in the set.
  if (!(name in all) && Object.keys(all).length >= MAX_LAYOUT_PRESETS) {
    const oldest = Object.keys(all)[0]
    if (oldest) delete all[oldest]
  }
  all[name] = preset
  store.set('layoutPresets', all)
}

export function deleteLayoutPreset(name: string): void {
  const all = getLayoutPresets()
  if (name in all) {
    delete all[name]
    store.set('layoutPresets', all)
  }
}

/** Ordered list of custom preset names (insertion order). */
export function listLayoutPresetNames(): string[] {
  return Object.keys(getLayoutPresets())
}
