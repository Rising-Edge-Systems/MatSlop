import { describe, it, expect } from 'vitest'
import {
  tabsToSession,
  sessionToTabs,
  sessionHasDirtyTabs,
  type SessionStateWire,
} from '../../src/renderer/editor/sessionState'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'
import { normalizeSession } from '../../src/main/sessionStore'

function tab(partial: Partial<EditorTab>): EditorTab {
  return {
    id: 'tab-1',
    filename: 'untitled.m',
    content: '',
    savedContent: '',
    filePath: null,
    mode: 'script',
    ...partial,
  }
}

describe('tabsToSession', () => {
  it('serializes tabs, cursors, and activeTabId', () => {
    const tabs: EditorTab[] = [
      tab({ id: 'tab-1', filename: 'a.m', content: 'x=1', savedContent: 'x=1' }),
      tab({
        id: 'tab-2',
        filename: 'b.m',
        content: 'y=2',
        savedContent: '',
        filePath: '/tmp/b.m',
      }),
    ]
    const state = tabsToSession(tabs, 'tab-2', {
      'tab-1': { line: 3, column: 4 },
      'tab-2': { line: 1, column: 1 },
    })
    expect(state.version).toBe(1)
    expect(state.activeTabId).toBe('tab-2')
    expect(state.tabs).toHaveLength(2)
    expect(state.tabs[0].cursorLine).toBe(3)
    expect(state.tabs[0].cursorColumn).toBe(4)
    expect(state.tabs[1].filePath).toBe('/tmp/b.m')
  })

  it('drops welcome tabs and falls back to first non-welcome for activeTabId', () => {
    const tabs: EditorTab[] = [
      tab({ id: 'welcome', filename: 'Welcome', mode: 'welcome' }),
      tab({ id: 'tab-1', filename: 'a.m' }),
    ]
    const state = tabsToSession(tabs, 'welcome', {})
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].id).toBe('tab-1')
    expect(state.activeTabId).toBe('tab-1')
  })

  it('preserves dirty content separately from savedContent', () => {
    const tabs: EditorTab[] = [
      tab({
        id: 'tab-1',
        filename: 'a.m',
        content: 'dirty edit',
        savedContent: 'original',
        filePath: '/tmp/a.m',
      }),
    ]
    const state = tabsToSession(tabs, 'tab-1', {})
    expect(state.tabs[0].content).toBe('dirty edit')
    expect(state.tabs[0].savedContent).toBe('original')
    expect(sessionHasDirtyTabs(state)).toBe(true)
  })
})

describe('sessionToTabs', () => {
  it('round-trips a session snapshot', () => {
    const tabs: EditorTab[] = [
      tab({ id: 't1', filename: 'a.m', content: 'x=1', savedContent: 'x=1' }),
      tab({ id: 't2', filename: 'b.m', content: 'y=2', savedContent: '' }),
    ]
    const state = tabsToSession(tabs, 't2', {
      t1: { line: 5, column: 6 },
    })
    const back = sessionToTabs(state)
    expect(back).not.toBeNull()
    expect(back!.tabs).toHaveLength(2)
    expect(back!.activeTabId).toBe('t2')
    expect(back!.tabs[0].id).toBe('t1')
    expect(back!.cursors.t1).toEqual({ line: 5, column: 6 })
  })

  it('returns null for empty/missing sessions', () => {
    expect(sessionToTabs(null)).toBeNull()
    expect(
      sessionToTabs({
        version: 1,
        savedAt: 0,
        activeTabId: null,
        tabs: [],
      } as SessionStateWire),
    ).toBeNull()
  })

  it('falls back to first tab id if activeTabId is stale', () => {
    const state: SessionStateWire = {
      version: 1,
      savedAt: 0,
      activeTabId: 'ghost',
      tabs: [
        {
          id: 't1',
          filename: 'a.m',
          filePath: null,
          mode: 'script',
          content: '',
          savedContent: '',
        },
      ],
    }
    const back = sessionToTabs(state)
    expect(back!.activeTabId).toBe('t1')
  })

  it('coerces unknown mode strings back to "script"', () => {
    const state: SessionStateWire = {
      version: 1,
      savedAt: 0,
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          filename: 'a.m',
          filePath: null,
          mode: 'garbage',
          content: '',
          savedContent: '',
        },
      ],
    }
    const back = sessionToTabs(state)
    expect(back!.tabs[0].mode).toBe('script')
  })
})

describe('sessionHasDirtyTabs', () => {
  it('returns false for null / clean sessions', () => {
    expect(sessionHasDirtyTabs(null)).toBe(false)
    expect(
      sessionHasDirtyTabs({
        version: 1,
        savedAt: 0,
        activeTabId: null,
        tabs: [
          {
            id: 't1',
            filename: 'a.m',
            filePath: null,
            mode: 'script',
            content: 'x',
            savedContent: 'x',
          },
        ],
      }),
    ).toBe(false)
  })
})

describe('normalizeSession (main-side validator)', () => {
  it('rejects non-object input', () => {
    expect(normalizeSession(null)).toBeNull()
    expect(normalizeSession('string')).toBeNull()
    expect(normalizeSession(42)).toBeNull()
  })

  it('rejects wrong version', () => {
    expect(normalizeSession({ version: 2, tabs: [] })).toBeNull()
  })

  it('drops malformed tab entries but keeps well-formed ones', () => {
    const raw = {
      version: 1,
      savedAt: 123,
      activeTabId: 't1',
      tabs: [
        null,
        { filename: 'no-id.m' },
        { id: 't1', filename: 'a.m', content: 'x', savedContent: 'x' },
      ],
    }
    const norm = normalizeSession(raw)
    expect(norm).not.toBeNull()
    expect(norm!.tabs).toHaveLength(1)
    expect(norm!.tabs[0].id).toBe('t1')
    expect(norm!.activeTabId).toBe('t1')
  })

  it('clears activeTabId when it does not match any surviving tab', () => {
    const norm = normalizeSession({
      version: 1,
      activeTabId: 'ghost',
      tabs: [{ id: 't1', filename: 'a.m' }],
    })
    expect(norm!.activeTabId).toBeNull()
  })
})
