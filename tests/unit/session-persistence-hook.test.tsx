// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useSessionPersistence } from '../../src/renderer/editor/useSessionPersistence'
import type { SessionStateWire } from '../../src/renderer/editor/sessionState'
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

function makeSessionWire(tabs: EditorTab[], activeTabId: string | null): SessionStateWire {
  return {
    version: 1,
    savedAt: Date.now(),
    activeTabId,
    tabs: tabs.map((t) => ({
      id: t.id,
      filename: t.filename,
      filePath: t.filePath,
      mode: t.mode,
      content: t.content,
      savedContent: t.savedContent,
    })),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useSessionPersistence', () => {
  let mockMatslop: {
    sessionGetRestoreEnabled: ReturnType<typeof vi.fn>
    sessionGet: ReturnType<typeof vi.fn>
    sessionSet: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers()
    // Create fresh mocks each test to avoid leakage
    mockMatslop = {
      sessionGetRestoreEnabled: vi.fn().mockResolvedValue(false),
      sessionGet: vi.fn().mockResolvedValue(null),
      sessionSet: vi.fn().mockResolvedValue(undefined),
    }
    ;(window as unknown as { matslop: typeof mockMatslop }).matslop = mockMatslop
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete (window as unknown as { matslop?: unknown }).matslop
  })

  // ── Restore on mount ──────────────────────────────────────────────────────

  describe('restore on mount', () => {
    it('with restore enabled, calls sessionGet and invokes restore callback with parsed tabs', async () => {
      const tab = makeTab({ id: 'tab-1', filename: 'foo.m', content: 'x=1' })
      const sessionWire = makeSessionWire([tab], 'tab-1')
      mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(true)
      mockMatslop.sessionGet.mockResolvedValue(sessionWire)

      const onRestore = vi.fn()
      renderHook(() =>
        useSessionPersistence({ tabs: [], activeTabId: null, onRestore }),
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockMatslop.sessionGetRestoreEnabled).toHaveBeenCalled()
      expect(mockMatslop.sessionGet).toHaveBeenCalled()
      expect(onRestore).toHaveBeenCalled()
      const restored = onRestore.mock.calls[0][0]
      expect(restored).not.toBeNull()
      expect(restored.tabs).toHaveLength(1)
      expect(restored.tabs[0].id).toBe('tab-1')
      expect(restored.tabs[0].filename).toBe('foo.m')
      expect(restored.activeTabId).toBe('tab-1')
    })

    it('with restore disabled, does not call sessionGet', async () => {
      mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(false)

      const onRestore = vi.fn()
      renderHook(() =>
        useSessionPersistence({ tabs: [], activeTabId: null, onRestore }),
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(mockMatslop.sessionGetRestoreEnabled).toHaveBeenCalled()
      expect(mockMatslop.sessionGet).not.toHaveBeenCalled()
      expect(onRestore).toHaveBeenCalledWith(null)
    })

    it('with corrupt session data, does not crash and invokes callback with null', async () => {
      mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(true)
      mockMatslop.sessionGet.mockResolvedValue({
        version: 1,
        savedAt: Date.now(),
        activeTabId: null,
        tabs: [],
      })

      const onRestore = vi.fn()
      renderHook(() =>
        useSessionPersistence({ tabs: [], activeTabId: null, onRestore }),
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(onRestore).toHaveBeenCalledWith(null)
    })

    it('when sessionGet throws, invokes callback with null', async () => {
      mockMatslop.sessionGetRestoreEnabled.mockResolvedValue(true)
      mockMatslop.sessionGet.mockRejectedValue(new Error('IPC error'))

      const onRestore = vi.fn()
      renderHook(() =>
        useSessionPersistence({ tabs: [], activeTabId: null, onRestore }),
      )

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(onRestore).toHaveBeenCalledWith(null)
    })
  })

  // ── Debounced save ────────────────────────────────────────────────────────

  describe('debounced save', () => {
    it('when tabs change, calls sessionSet after 400ms debounce', async () => {
      const onRestore = vi.fn()
      const tab = makeTab({ id: 'tab-1', filename: 'a.m', content: 'x=1' })

      const { rerender } = renderHook(
        (props: { tabs: EditorTab[]; activeTabId: string | null }) =>
          useSessionPersistence({ ...props, onRestore }),
        { initialProps: { tabs: [], activeTabId: null } },
      )

      // Let mount complete (sets sessionReady)
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Clear any mount-related calls
      mockMatslop.sessionSet.mockClear()

      // Now update tabs — triggers the debounced save effect
      rerender({ tabs: [tab], activeTabId: 'tab-1' })

      // Before 400ms, sessionSet should NOT have been called
      expect(mockMatslop.sessionSet).not.toHaveBeenCalled()

      // Advance past the debounce
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(mockMatslop.sessionSet).toHaveBeenCalledOnce()
      const savedState = mockMatslop.sessionSet.mock.calls[0][0]
      expect(savedState.tabs).toHaveLength(1)
      expect(savedState.tabs[0].id).toBe('tab-1')
    })

    it('rapid tab changes only trigger one sessionSet call (debounce coalescing)', async () => {
      const onRestore = vi.fn()
      const tab1 = makeTab({ id: 'tab-1', filename: 'a.m' })
      const tab2 = makeTab({ id: 'tab-2', filename: 'b.m' })

      const { rerender } = renderHook(
        (props: { tabs: EditorTab[]; activeTabId: string | null }) =>
          useSessionPersistence({ ...props, onRestore }),
        { initialProps: { tabs: [], activeTabId: null } },
      )

      // Let mount complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Clear any mount-related calls
      mockMatslop.sessionSet.mockClear()

      // Rapid updates — each within the 400ms window
      rerender({ tabs: [tab1], activeTabId: 'tab-1' })
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      rerender({ tabs: [tab1, tab2], activeTabId: 'tab-2' })
      await act(async () => {
        vi.advanceTimersByTime(100)
      })

      rerender({ tabs: [tab1, tab2], activeTabId: 'tab-1' })

      // Now let the final debounce fire
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      // Should only have called sessionSet once (the last coalesced state)
      expect(mockMatslop.sessionSet).toHaveBeenCalledOnce()
      const savedState = mockMatslop.sessionSet.mock.calls[0][0]
      expect(savedState.tabs).toHaveLength(2)
      expect(savedState.activeTabId).toBe('tab-1')
    })
  })

  // ── beforeunload flush ────────────────────────────────────────────────────

  describe('beforeunload flush', () => {
    it('beforeunload event triggers immediate sessionSet call', async () => {
      const onRestore = vi.fn()
      const tab = makeTab({ id: 'tab-1', filename: 'a.m', content: 'y=2' })

      renderHook(() =>
        useSessionPersistence({ tabs: [tab], activeTabId: 'tab-1', onRestore }),
      )

      // Let mount complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Clear any prior calls
      mockMatslop.sessionSet.mockClear()

      // Fire beforeunload
      window.dispatchEvent(new Event('beforeunload'))

      expect(mockMatslop.sessionSet).toHaveBeenCalledOnce()
      const savedState = mockMatslop.sessionSet.mock.calls[0][0]
      expect(savedState.tabs).toHaveLength(1)
      expect(savedState.tabs[0].id).toBe('tab-1')
    })
  })

  // ── updateCursor ──────────────────────────────────────────────────────────

  describe('updateCursor', () => {
    it('updates cursor data that is included in subsequent session saves', async () => {
      const onRestore = vi.fn()
      const tab = makeTab({ id: 'tab-1', filename: 'a.m', content: 'x=1' })

      const { result } = renderHook(() =>
        useSessionPersistence({ tabs: [tab], activeTabId: 'tab-1', onRestore }),
      )

      // Let mount complete
      await act(async () => {
        await vi.runAllTimersAsync()
      })

      // Clear any calls from mount
      mockMatslop.sessionSet.mockClear()

      // Update cursor position
      act(() => {
        result.current.updateCursor('tab-1', 10, 5)
      })

      // Trigger a flush via beforeunload to capture the cursor in the saved session
      window.dispatchEvent(new Event('beforeunload'))

      expect(mockMatslop.sessionSet).toHaveBeenCalled()
      // Get the last sessionSet call (the beforeunload flush)
      const lastCall = mockMatslop.sessionSet.mock.calls[mockMatslop.sessionSet.mock.calls.length - 1]
      const savedState = lastCall[0]
      expect(savedState.tabs).toHaveLength(1)
      expect(savedState.tabs[0].cursorLine).toBe(10)
      expect(savedState.tabs[0].cursorColumn).toBe(5)
    })
  })
})
