// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  tabReducer,
  useTabReducer,
  _resetIdCounter,
  type TabState,
} from '../../src/renderer/editor/useTabReducer'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    filename: 'untitled.m',
    content: '',
    savedContent: '',
    filePath: null,
    mode: 'script',
    ...overrides,
  }
}

const emptyState: TabState = { tabs: [], activeTabId: null }

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetIdCounter()
})

describe('tabReducer', () => {
  // ── CREATE_TAB ──────────────────────────────────────────────────────────

  describe('CREATE_TAB', () => {
    it('generates incrementing unique IDs', () => {
      let state = tabReducer(emptyState, {
        type: 'CREATE_TAB',
        payload: { filename: 'a.m', content: 'a', filePath: null, mode: 'script' },
      })
      expect(state.tabs[0].id).toBe('tab-1')

      state = tabReducer(state, {
        type: 'CREATE_TAB',
        payload: { filename: 'b.m', content: 'b', filePath: null, mode: 'script' },
      })
      expect(state.tabs[1].id).toBe('tab-2')
    })

    it('sets the new tab as active', () => {
      const state = tabReducer(emptyState, {
        type: 'CREATE_TAB',
        payload: { filename: 'a.m', content: '', filePath: null, mode: 'script' },
      })
      expect(state.activeTabId).toBe('tab-1')
    })

    it('sets savedContent equal to content', () => {
      const state = tabReducer(emptyState, {
        type: 'CREATE_TAB',
        payload: { filename: 'a.m', content: 'hello', filePath: null, mode: 'script' },
      })
      expect(state.tabs[0].savedContent).toBe('hello')
    })

    it('after RESTORE_SESSION with tabs [tab-5, tab-3] produces tab-6', () => {
      const restored: TabState = tabReducer(emptyState, {
        type: 'RESTORE_SESSION',
        payload: {
          tabs: [
            makeTab({ id: 'tab-5', filename: 'x.m' }),
            makeTab({ id: 'tab-3', filename: 'y.m' }),
          ],
          activeTabId: 'tab-5',
        },
      })

      const state = tabReducer(restored, {
        type: 'CREATE_TAB',
        payload: { filename: 'z.m', content: '', filePath: null, mode: 'script' },
      })
      expect(state.tabs[2].id).toBe('tab-6')
    })
  })

  // ── CLOSE_TAB ───────────────────────────────────────────────────────────

  describe('CLOSE_TAB', () => {
    it('closing the active tab selects the next tab at the same index', () => {
      // Create 3 tabs: tab-1, tab-2, tab-3. Active = tab-2
      let state = emptyState
      for (const name of ['a.m', 'b.m', 'c.m']) {
        state = tabReducer(state, {
          type: 'CREATE_TAB',
          payload: { filename: name, content: '', filePath: null, mode: 'script' },
        })
      }
      state = { ...state, activeTabId: 'tab-2' }

      // Close tab-2 → should select tab-3 (same index position)
      state = tabReducer(state, { type: 'CLOSE_TAB', payload: { tabId: 'tab-2' } })
      expect(state.activeTabId).toBe('tab-3')
      expect(state.tabs).toHaveLength(2)
    })

    it('closing the last tab in the list selects the previous tab', () => {
      let state = emptyState
      for (const name of ['a.m', 'b.m']) {
        state = tabReducer(state, {
          type: 'CREATE_TAB',
          payload: { filename: name, content: '', filePath: null, mode: 'script' },
        })
      }
      // Active is tab-2 (last). Close it.
      state = tabReducer(state, { type: 'CLOSE_TAB', payload: { tabId: 'tab-2' } })
      expect(state.activeTabId).toBe('tab-1')
    })

    it('closing a non-active tab does not change activeTabId', () => {
      let state = emptyState
      for (const name of ['a.m', 'b.m', 'c.m']) {
        state = tabReducer(state, {
          type: 'CREATE_TAB',
          payload: { filename: name, content: '', filePath: null, mode: 'script' },
        })
      }
      // Active = tab-3. Close tab-1.
      state = tabReducer(state, { type: 'CLOSE_TAB', payload: { tabId: 'tab-1' } })
      expect(state.activeTabId).toBe('tab-3')
      expect(state.tabs).toHaveLength(2)
    })

    it('closing the only remaining tab sets activeTabId to null', () => {
      let state = tabReducer(emptyState, {
        type: 'CREATE_TAB',
        payload: { filename: 'a.m', content: '', filePath: null, mode: 'script' },
      })
      state = tabReducer(state, { type: 'CLOSE_TAB', payload: { tabId: 'tab-1' } })
      expect(state.activeTabId).toBeNull()
      expect(state.tabs).toHaveLength(0)
    })

    it('closing a nonexistent tab is a no-op', () => {
      const state: TabState = {
        tabs: [makeTab({ id: 'tab-1' })],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, { type: 'CLOSE_TAB', payload: { tabId: 'tab-999' } })
      expect(result).toBe(state)
    })
  })

  // ── SELECT_TAB ──────────────────────────────────────────────────────────

  describe('SELECT_TAB', () => {
    it('updates activeTabId for a valid ID', () => {
      const state: TabState = {
        tabs: [makeTab({ id: 'tab-1' }), makeTab({ id: 'tab-2' })],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, { type: 'SELECT_TAB', payload: { tabId: 'tab-2' } })
      expect(result.activeTabId).toBe('tab-2')
    })

    it('is a no-op when the ID is not in tabs', () => {
      const state: TabState = {
        tabs: [makeTab({ id: 'tab-1' })],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, { type: 'SELECT_TAB', payload: { tabId: 'tab-999' } })
      expect(result).toBe(state)
    })
  })

  // ── UPDATE_CONTENT ──────────────────────────────────────────────────────

  describe('UPDATE_CONTENT', () => {
    it('updates the correct tab content without affecting other tabs', () => {
      const state: TabState = {
        tabs: [
          makeTab({ id: 'tab-1', content: 'old1' }),
          makeTab({ id: 'tab-2', content: 'old2' }),
        ],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, {
        type: 'UPDATE_CONTENT',
        payload: { tabId: 'tab-1', content: 'new1' },
      })
      expect(result.tabs[0].content).toBe('new1')
      expect(result.tabs[1].content).toBe('old2')
    })
  })

  // ── RESTORE_SESSION ─────────────────────────────────────────────────────

  describe('RESTORE_SESSION', () => {
    it('replaces all tabs and activeTabId atomically', () => {
      const initial: TabState = {
        tabs: [makeTab({ id: 'tab-1' })],
        activeTabId: 'tab-1',
      }
      const restoredTabs = [
        makeTab({ id: 'tab-10', filename: 'restored.m' }),
        makeTab({ id: 'tab-20', filename: 'other.m' }),
      ]
      const result = tabReducer(initial, {
        type: 'RESTORE_SESSION',
        payload: { tabs: restoredTabs, activeTabId: 'tab-20' },
      })
      expect(result.tabs).toEqual(restoredTabs)
      expect(result.activeTabId).toBe('tab-20')
    })
  })

  // ── UPDATE_SAVED_CONTENT ────────────────────────────────────────────────

  describe('UPDATE_SAVED_CONTENT', () => {
    it('updates savedContent for the target tab', () => {
      const state: TabState = {
        tabs: [makeTab({ id: 'tab-1', savedContent: 'old' })],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, {
        type: 'UPDATE_SAVED_CONTENT',
        payload: { tabId: 'tab-1', savedContent: 'new' },
      })
      expect(result.tabs[0].savedContent).toBe('new')
    })
  })

  // ── RENAME_TAB ──────────────────────────────────────────────────────────

  describe('RENAME_TAB', () => {
    it('updates filename and filePath for the target tab', () => {
      const state: TabState = {
        tabs: [makeTab({ id: 'tab-1', filename: 'old.m', filePath: null })],
        activeTabId: 'tab-1',
      }
      const result = tabReducer(state, {
        type: 'RENAME_TAB',
        payload: { tabId: 'tab-1', filename: 'new.m', filePath: '/path/new.m' },
      })
      expect(result.tabs[0].filename).toBe('new.m')
      expect(result.tabs[0].filePath).toBe('/path/new.m')
    })
  })
})

// ── Hook integration test ─────────────────────────────────────────────────

describe('useTabReducer hook', () => {
  it('returns initial empty state', () => {
    const { result } = renderHook(() => useTabReducer())
    const [state] = result.current
    expect(state.tabs).toEqual([])
    expect(state.activeTabId).toBeNull()
  })

  it('dispatches CREATE_TAB and updates state', () => {
    const { result } = renderHook(() => useTabReducer())

    act(() => {
      const [, dispatch] = result.current
      dispatch({
        type: 'CREATE_TAB',
        payload: { filename: 'test.m', content: 'x=1', filePath: null, mode: 'script' },
      })
    })

    const [state] = result.current
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].filename).toBe('test.m')
    expect(state.activeTabId).toBe(state.tabs[0].id)
  })
})
