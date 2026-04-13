import { createContext, useContext } from 'react'
import type { ProfilerEntry, ProfilerMode } from './editor/profilerStore'

/**
 * US-L02: Application-wide React Context for dynamic panel state.
 *
 * rc-dock caches the React elements returned by its `loadTab` factory.
 * When App.tsx state changes (e.g. a new help topic), the cached elements
 * still hold the OLD props — rc-dock's PureComponent optimization prevents
 * re-rendering. Previously a `contentVersion` string forced a full layout
 * rebuild, which destroyed component state (scroll position, undo history).
 *
 * This context bypasses rc-dock's caching: panel components call
 * `useAppContext()` and React's context propagation re-renders them
 * regardless of rc-dock's cache.
 */

// ── Inline types to avoid circular imports ───────────────────────────
/** Mirrors PendingCommand from CommandWindow.tsx */
export interface CtxPendingCommand {
  command: string
  display: string
  id: number
}

/** Mirrors WatchEntry from editor/watchesStore.ts */
export interface CtxWatchEntry {
  id: string
  expression: string
  value: string | null
  error: string | null
}

/** Mirrors CallStackFrame from CallStackPanel.tsx */
export interface CtxCallStackFrame {
  name: string
  file: string
  line: number
}

/** Mirrors FigureData from FigurePanel.tsx */
export interface CtxFigureData {
  handle: number
  imageDataUrl: string
  tempPath: string
}

export interface AppContextValue {
  /** True when the real AppContext.Provider is mounted (vs createContext default). */
  _provided: boolean
  // ── Help panel ──────────────────────────────────────────────────────
  helpTopic: string | null
  helpContent: string | null
  helpError: string | null
  helpLoading: boolean
  helpCanGoBack: boolean
  onHelpNavigate: (topic: string) => void
  onHelpBack: () => void
  onHelpClose: () => void

  // ── Profiler panel ──────────────────────────────────────────────────
  profilerMode: ProfilerMode
  profilerEntries: ProfilerEntry[]
  profilerError: string | null
  profilerLoading: boolean
  onProfilerStart: () => void
  onProfilerStop: () => void
  onProfilerReport: () => void
  onProfilerNavigate: (functionName: string) => void
  onProfilerClose: () => void

  // ── Shared: current working directory ───────────────────────────────
  cwd: string

  // ── File open requests (FileBrowser → EditorPanel) ─────────────────
  pendingOpenPath: string | null
  pendingOpenLine: number | null
  onFileOpened: () => void

  // ── US-SC03: Dynamic panel state (bypasses rc-dock caching) ────────
  pendingCommand: CtxPendingCommand | null
  pasteCommand: string | null
  menuAction: { action: string; id: number } | null
  refreshTrigger: number
  debugPaused: boolean
  debugFrameName: string | null
  pausedLocation: { file: string; line: number } | null
  editorTheme: string
  editorSettings: {
    fontFamily: string
    fontSize: number
    tabSize: number
    insertSpaces: boolean
  }
  callStack: CtxCallStackFrame[]
  callStackSelected: number
  watches: CtxWatchEntry[]
  figures: CtxFigureData[]
  historyVersion: number
  gitBadges: ReadonlyMap<string, string>

  // ── US-SC03: Stable callbacks (ref-based, [] deps) ─────────────────
  onRunScript: (filePath: string, dirPath: string) => void
  onRunSection: (code: string) => void
  onCommandExecuted: () => void
  onDocCommand: (topic: string) => void
  onMenuActionConsumed: () => void
  onPasteConsumed: () => void
  onHistoryChanged: () => void
  onCallStackSelect: (index: number) => void
  onAddWatch: (expression: string) => void
  onRemoveWatch: (id: string) => void
  onUpdateWatch: (id: string, expression: string) => void
  onRefreshWatches: () => void
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = (): void => {}

export const AppContext = createContext<AppContextValue>({
  _provided: false,
  helpTopic: null,
  helpContent: null,
  helpError: null,
  helpLoading: false,
  helpCanGoBack: false,
  onHelpNavigate: noop,
  onHelpBack: noop,
  onHelpClose: noop,

  profilerMode: 'idle',
  profilerEntries: [],
  profilerError: null,
  profilerLoading: false,
  onProfilerStart: noop,
  onProfilerStop: noop,
  onProfilerReport: noop,
  onProfilerNavigate: noop,
  onProfilerClose: noop,

  cwd: '',

  pendingOpenPath: null,
  pendingOpenLine: null,
  onFileOpened: noop,

  // US-SC03: dynamic panel state defaults
  pendingCommand: null,
  pasteCommand: null,
  menuAction: null,
  refreshTrigger: 0,
  debugPaused: false,
  debugFrameName: null,
  pausedLocation: null,
  editorTheme: 'vs-dark',
  editorSettings: {
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 14,
    tabSize: 4,
    insertSpaces: true,
  },
  callStack: [],
  callStackSelected: -1,
  watches: [],
  figures: [],
  historyVersion: 0,
  gitBadges: new Map(),

  // US-SC03: stable callback defaults
  onRunScript: noop as (filePath: string, dirPath: string) => void,
  onRunSection: noop as (code: string) => void,
  onCommandExecuted: noop,
  onDocCommand: noop as (topic: string) => void,
  onMenuActionConsumed: noop,
  onPasteConsumed: noop,
  onHistoryChanged: noop,
  onCallStackSelect: noop as (index: number) => void,
  onAddWatch: noop as (expression: string) => void,
  onRemoveWatch: noop as (id: string) => void,
  onUpdateWatch: noop as (id: string, expression: string) => void,
  onRefreshWatches: noop,
})

export function useAppContext(): AppContextValue {
  return useContext(AppContext)
}
