// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDebugIntegration, type PausedLocation } from '../../src/renderer/editor/useDebugIntegration'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'
import type { TabAction } from '../../src/renderer/editor/useTabReducer'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<EditorTab> & { id: string }): EditorTab {
  return {
    filename: 'test.m',
    content: 'x = 1;',
    savedContent: 'x = 1;',
    filePath: '/home/user/test.m',
    mode: 'script',
    ...overrides,
  }
}

function makeMockEditor() {
  return {
    setPosition: vi.fn(),
    revealLineInCenter: vi.fn(),
    focus: vi.fn(),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useDebugIntegration', () => {
  let mockMatslop: {
    readFile: ReturnType<typeof vi.fn>
    debugReapplyBreakpointsForFile: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockMatslop = {
      readFile: vi.fn().mockResolvedValue(null),
      debugReapplyBreakpointsForFile: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as unknown as { matslop: typeof mockMatslop }).matslop = mockMatslop
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as unknown as { matslop?: unknown }).matslop
  })

  // ── isPaused ────────────────────────────────────────────────────────────

  it('isPaused is false when pausedLocation is null', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: null,
        tabs: [],
        activeTabId: null,
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(result.current.isPaused).toBe(false)
  })

  it('isPaused is true when pausedLocation is set', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m', filePath: '/home/user/foo.m' })
    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/foo.m', line: 10 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(result.current.isPaused).toBe(true)
  })

  // ── pausedLocation → SELECT_TAB ─────────────────────────────────────────

  it('dispatches SELECT_TAB when pausedLocation points to an open file', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m', filePath: '/home/user/foo.m' })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/foo.m', line: 5 },
        tabs: [tab],
        activeTabId: 'tab-2', // different tab active
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELECT_TAB',
      payload: { tabId: 'tab-1' },
    })
  })

  it('does not dispatch SELECT_TAB if the paused file is already the active tab', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m', filePath: '/home/user/foo.m' })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/foo.m', line: 5 },
        tabs: [tab],
        activeTabId: 'tab-1', // same tab already active
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('moves cursor to paused line after selecting tab', async () => {
    const dispatch = vi.fn()
    const mockEditor = makeMockEditor()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m', filePath: '/home/user/foo.m' })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/foo.m', line: 42 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => mockEditor as never,
      }),
    )

    // Advance past the setTimeout(50ms) delay
    await act(async () => {
      vi.advanceTimersByTime(60)
    })

    expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 42, column: 1 })
    expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(42)
  })

  // ── pausedLocation → CREATE_TAB (file not open) ──────────────────────────

  it('reads the file and dispatches CREATE_TAB when pausedLocation points to a file not in tabs', async () => {
    const dispatch = vi.fn()
    mockMatslop.readFile.mockResolvedValue({
      filename: 'bar.m',
      content: 'y = 2;',
      filePath: '/home/user/bar.m',
    })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/bar.m', line: 3 },
        tabs: [], // no tabs open
        activeTabId: null,
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    // Flush the readFile promise
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mockMatslop.readFile).toHaveBeenCalledWith('/home/user/bar.m')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'CREATE_TAB',
      payload: {
        filename: 'bar.m',
        content: 'y = 2;',
        filePath: '/home/user/bar.m',
        mode: 'script',
      },
    })
  })

  it('moves cursor to paused line after creating a new tab for a file', async () => {
    const dispatch = vi.fn()
    const mockEditor = makeMockEditor()
    mockMatslop.readFile.mockResolvedValue({
      filename: 'bar.m',
      content: 'y = 2;',
      filePath: '/home/user/bar.m',
    })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/home/user/bar.m', line: 7 },
        tabs: [],
        activeTabId: null,
        dispatch,
        getEditorInstance: () => mockEditor as never,
      }),
    )

    // Flush readFile promise + setTimeout(100ms)
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 1 })
    expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(7)
  })

  it('handles readFile returning null gracefully (no dispatch)', async () => {
    const dispatch = vi.fn()
    mockMatslop.readFile.mockResolvedValue(null)

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/nonexistent/file.m', line: 1 },
        tabs: [],
        activeTabId: null,
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(mockMatslop.readFile).toHaveBeenCalledWith('/nonexistent/file.m')
    expect(dispatch).not.toHaveBeenCalled()
  })

  // ── Basename matching ──────────────────────────────────────────────────

  it('matches by basename when Octave reports a full path', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'myfunc.m' })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: '/opt/octave/funcs/myfunc.m', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-2',
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELECT_TAB',
      payload: { tabId: 'tab-1' },
    })
  })

  it('matches when Octave reports a function name without .m extension', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'myfunc.m' })

    renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: 'myfunc', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-2',
        dispatch,
        getEditorInstance: () => null,
      }),
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SELECT_TAB',
      payload: { tabId: 'tab-1' },
    })
  })

  // ── notifyFileSaved ────────────────────────────────────────────────────

  it('notifyFileSaved() while paused calls onFileSavedWhilePaused with the file path', () => {
    const dispatch = vi.fn()
    const onFileSavedWhilePaused = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m' })

    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: 'foo.m', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => null,
        onFileSavedWhilePaused,
      }),
    )

    act(() => {
      result.current.notifyFileSaved('/home/user/foo.m')
    })

    expect(onFileSavedWhilePaused).toHaveBeenCalledWith('/home/user/foo.m')
  })

  it('notifyFileSaved() while paused calls debugReapplyBreakpointsForFile', () => {
    const dispatch = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m' })

    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: 'foo.m', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => null,
        onFileSavedWhilePaused: vi.fn(),
      }),
    )

    act(() => {
      result.current.notifyFileSaved('/home/user/foo.m')
    })

    expect(mockMatslop.debugReapplyBreakpointsForFile).toHaveBeenCalledWith('/home/user/foo.m')
  })

  it('notifyFileSaved() while NOT paused does nothing', () => {
    const dispatch = vi.fn()
    const onFileSavedWhilePaused = vi.fn()

    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: null, // not paused
        tabs: [],
        activeTabId: null,
        dispatch,
        getEditorInstance: () => null,
        onFileSavedWhilePaused,
      }),
    )

    act(() => {
      result.current.notifyFileSaved('/home/user/foo.m')
    })

    expect(onFileSavedWhilePaused).not.toHaveBeenCalled()
    expect(mockMatslop.debugReapplyBreakpointsForFile).not.toHaveBeenCalled()
  })

  it('notifyFileSaved() while paused ignores non-.m files', () => {
    const dispatch = vi.fn()
    const onFileSavedWhilePaused = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m' })

    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: 'foo.m', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => null,
        onFileSavedWhilePaused,
      }),
    )

    act(() => {
      result.current.notifyFileSaved('/home/user/notes.txt')
    })

    expect(onFileSavedWhilePaused).not.toHaveBeenCalled()
    expect(mockMatslop.debugReapplyBreakpointsForFile).not.toHaveBeenCalled()
  })

  it('notifyFileSaved() while paused ignores null filePath', () => {
    const dispatch = vi.fn()
    const onFileSavedWhilePaused = vi.fn()
    const tab = makeTab({ id: 'tab-1', filename: 'foo.m' })

    const { result } = renderHook(() =>
      useDebugIntegration({
        pausedLocation: { file: 'foo.m', line: 1 },
        tabs: [tab],
        activeTabId: 'tab-1',
        dispatch,
        getEditorInstance: () => null,
        onFileSavedWhilePaused,
      }),
    )

    act(() => {
      result.current.notifyFileSaved(null)
    })

    expect(onFileSavedWhilePaused).not.toHaveBeenCalled()
    expect(mockMatslop.debugReapplyBreakpointsForFile).not.toHaveBeenCalled()
  })
})
