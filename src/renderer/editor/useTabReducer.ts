import { useReducer } from 'react'
import type { EditorTab, EditorTabMode } from './editorTypes'

// ── State ──────────────────────────────────────────────────────────────────

export interface TabState {
  tabs: EditorTab[]
  activeTabId: string | null
}

const initialState: TabState = {
  tabs: [],
  activeTabId: null,
}

// ── Actions ────────────────────────────────────────────────────────────────

export type TabAction =
  | { type: 'CREATE_TAB'; payload: { filename: string; content: string; filePath: string | null; mode: EditorTabMode } }
  | { type: 'CLOSE_TAB'; payload: { tabId: string } }
  | { type: 'SELECT_TAB'; payload: { tabId: string } }
  | { type: 'UPDATE_CONTENT'; payload: { tabId: string; content: string } }
  | { type: 'RESTORE_SESSION'; payload: { tabs: EditorTab[]; activeTabId: string | null } }
  | { type: 'UPDATE_SAVED_CONTENT'; payload: { tabId: string; savedContent: string } }
  | { type: 'RENAME_TAB'; payload: { tabId: string; filename: string; filePath: string | null } }

// ── ID counter ─────────────────────────────────────────────────────────────

let nextId = 1

/**
 * Reset the internal ID counter. Exported solely for test isolation —
 * production code should never call this.
 */
export function _resetIdCounter(): void {
  nextId = 1
}

function generateTabId(): string {
  return `tab-${nextId++}`
}

/**
 * Advance the ID counter past any IDs present in the given tabs so that
 * newly-created tabs never collide with restored ones.
 */
function syncIdCounter(tabs: { id: string }[]): void {
  for (const tab of tabs) {
    const match = tab.id.match(/^tab-(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n >= nextId) {
        nextId = n + 1
      }
    }
  }
}

// ── Reducer ────────────────────────────────────────────────────────────────

export function tabReducer(state: TabState, action: TabAction): TabState {
  switch (action.type) {
    case 'CREATE_TAB': {
      const { filename, content, filePath, mode } = action.payload
      const newTab: EditorTab = {
        id: generateTabId(),
        filename,
        content,
        savedContent: content,
        filePath,
        mode,
      }
      return {
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
      }
    }

    case 'CLOSE_TAB': {
      const { tabId } = action.payload
      const idx = state.tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) return state

      const newTabs = state.tabs.filter((t) => t.id !== tabId)

      // If we're closing the active tab, pick an adjacent replacement.
      let newActiveId = state.activeTabId
      if (state.activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveId = null
        } else {
          // Prefer same index position; fall back to last tab.
          const nextIdx = Math.min(idx, newTabs.length - 1)
          newActiveId = newTabs[nextIdx].id
        }
      }

      return { tabs: newTabs, activeTabId: newActiveId }
    }

    case 'SELECT_TAB': {
      const { tabId } = action.payload
      if (!state.tabs.some((t) => t.id === tabId)) return state
      return { ...state, activeTabId: tabId }
    }

    case 'UPDATE_CONTENT': {
      const { tabId, content } = action.payload
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, content } : t)),
      }
    }

    case 'RESTORE_SESSION': {
      const { tabs, activeTabId } = action.payload
      syncIdCounter(tabs)
      return { tabs, activeTabId }
    }

    case 'UPDATE_SAVED_CONTENT': {
      const { tabId, savedContent } = action.payload
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, savedContent } : t)),
      }
    }

    case 'RENAME_TAB': {
      const { tabId, filename, filePath } = action.payload
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, filename, filePath } : t)),
      }
    }

    default:
      return state
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTabReducer(): [TabState, React.Dispatch<TabAction>] {
  return useReducer(tabReducer, initialState)
}
