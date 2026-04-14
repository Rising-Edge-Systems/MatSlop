// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// ── Mock shortcutManager singleton ───────────────────────────────────────
vi.mock('../../src/renderer/shortcuts/shortcutManager', () => {
  const SHORTCUT_DEFINITIONS = [
    { action: 'run', key: 'F5', label: 'F5', description: 'Run Script' },
    { action: 'save', key: 's', ctrl: true, label: 'Ctrl+S', description: 'Save' },
  ]

  return {
    shortcutManager: {
      start: vi.fn(),
      stop: vi.fn(),
      setActiveDefinitions: vi.fn(),
    },
    SHORTCUT_DEFINITIONS,
  }
})

// ── Mock customShortcuts ─────────────────────────────────────────────────
vi.mock('../../src/renderer/shortcuts/customShortcuts', () => ({
  parseStoredOverrides: vi.fn().mockReturnValue([]),
  applyShortcutOverrides: vi.fn().mockImplementation((defs: any) => defs),
}))

import { useEditorShortcuts } from '../../src/renderer/editor/useEditorShortcuts'
import {
  shortcutManager,
  type ShortcutAction,
} from '../../src/renderer/shortcuts/shortcutManager'
import {
  applyShortcutOverrides,
  parseStoredOverrides,
} from '../../src/renderer/shortcuts/customShortcuts'

// Type-cast mocked module exports for easy access
const mockedManager = vi.mocked(shortcutManager)
const mockedParse = vi.mocked(parseStoredOverrides)
const mockedApply = vi.mocked(applyShortcutOverrides)

// ── window.matslop mock ──────────────────────────────────────────────────
beforeEach(() => {
  ;(window as any).matslop = {
    configGetShortcuts: vi.fn().mockResolvedValue(null),
  }
  vi.clearAllMocks()
  // Re-setup default return values after clearAllMocks
  mockedParse.mockReturnValue([])
  mockedApply.mockImplementation((defs: any) => defs)
  ;(window as any).matslop.configGetShortcuts.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  delete (window as any).matslop
})

describe('useEditorShortcuts', () => {
  it('registers a handler with ShortcutManager on mount', () => {
    const actionMap: Partial<Record<ShortcutAction, () => void>> = {
      run: vi.fn(),
    }

    renderHook(() => useEditorShortcuts(actionMap))

    expect(mockedManager.start).toHaveBeenCalledTimes(1)
    expect(mockedManager.start).toHaveBeenCalledWith(expect.any(Function))
  })

  it('calls stop() on ShortcutManager when unmounted', () => {
    const actionMap: Partial<Record<ShortcutAction, () => void>> = {
      run: vi.fn(),
    }

    const { unmount } = renderHook(() => useEditorShortcuts(actionMap))

    vi.mocked(mockedManager.stop).mockClear()
    unmount()

    expect(mockedManager.stop).toHaveBeenCalledTimes(1)
  })

  it('dispatches the correct action from the action map when handler is called', () => {
    const runFn = vi.fn()
    const saveFn = vi.fn()
    const actionMap: Partial<Record<ShortcutAction, () => void>> = {
      run: runFn,
      save: saveFn,
    }

    renderHook(() => useEditorShortcuts(actionMap))

    // Grab the handler function that was passed to start()
    const handler = vi.mocked(mockedManager.start).mock.calls[0][0] as (
      action: ShortcutAction,
    ) => void

    handler('run')
    expect(runFn).toHaveBeenCalledTimes(1)
    expect(saveFn).not.toHaveBeenCalled()

    handler('save')
    expect(saveFn).toHaveBeenCalledTimes(1)
  })

  it('does not crash when handler receives an action not in the action map', () => {
    const actionMap: Partial<Record<ShortcutAction, () => void>> = {
      run: vi.fn(),
    }

    renderHook(() => useEditorShortcuts(actionMap))

    const handler = vi.mocked(mockedManager.start).mock.calls[0][0] as (
      action: ShortcutAction,
    ) => void

    // 'stop' is not in the action map — should not throw
    expect(() => handler('stop')).not.toThrow()
  })

  it('loads custom shortcut overrides from config on mount and applies them', async () => {
    const mockOverrides = [{ action: 'run', key: 'F6' }]
    const mockMergedDefs = [
      { action: 'run', key: 'F6', label: 'F6', description: 'Run Script' },
      { action: 'save', key: 's', ctrl: true, label: 'Ctrl+S', description: 'Save' },
    ]

    ;(window as any).matslop.configGetShortcuts.mockResolvedValue('{"run":"F6"}')
    mockedParse.mockReturnValue(mockOverrides as any)
    mockedApply.mockReturnValue(mockMergedDefs as any)

    await act(async () => {
      renderHook(() => useEditorShortcuts({ run: vi.fn() }))
    })

    expect((window as any).matslop.configGetShortcuts).toHaveBeenCalledTimes(1)
    expect(mockedParse).toHaveBeenCalledWith('{"run":"F6"}')
    expect(mockedApply).toHaveBeenCalledWith(expect.any(Array), mockOverrides)
    expect(mockedManager.setActiveDefinitions).toHaveBeenCalledWith(mockMergedDefs)
  })

  it('falls back to default definitions when configGetShortcuts rejects', async () => {
    ;(window as any).matslop.configGetShortcuts.mockRejectedValue(
      new Error('IPC error'),
    )

    await act(async () => {
      renderHook(() => useEditorShortcuts({ run: vi.fn() }))
    })

    // Should still call setActiveDefinitions with defaults (copy of SHORTCUT_DEFINITIONS)
    expect(mockedManager.setActiveDefinitions).toHaveBeenCalledTimes(1)
    expect(mockedManager.setActiveDefinitions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ action: 'run' })]),
    )
    // parseStoredOverrides should NOT have been called
    expect(mockedParse).not.toHaveBeenCalled()
  })
})
