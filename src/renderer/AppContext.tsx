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

export interface AppContextValue {
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
}

/* eslint-disable @typescript-eslint/no-empty-function */
const noop = (): void => {}
/* eslint-enable @typescript-eslint/no-empty-function */

export const AppContext = createContext<AppContextValue>({
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
})

export function useAppContext(): AppContextValue {
  return useContext(AppContext)
}
