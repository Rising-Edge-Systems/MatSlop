// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

import {
  useMenuActions,
  type MenuActionPayload,
  type MenuActionMap,
} from '../../src/renderer/editor/useMenuActions'

afterEach(() => {
  cleanup()
})

describe('useMenuActions', () => {
  it("receiving a 'save' menu action calls the save handler", () => {
    const saveFn = vi.fn()
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: saveFn }

    renderHook(() =>
      useMenuActions({
        menuAction: { action: 'save', id: 1 },
        onMenuActionConsumed: consumed,
        actions,
      }),
    )

    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it('receiving the same menu action ID twice only calls the handler once', () => {
    const saveFn = vi.fn()
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: saveFn }
    const menuAction: MenuActionPayload = { action: 'save', id: 1 }

    const { rerender } = renderHook(
      ({ ma }) =>
        useMenuActions({
          menuAction: ma,
          onMenuActionConsumed: consumed,
          actions,
        }),
      { initialProps: { ma: menuAction } },
    )

    expect(saveFn).toHaveBeenCalledTimes(1)

    // Re-render with the same action id
    rerender({ ma: menuAction })

    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it("'recentFile:/path/to/file.m' menu action calls the recentFile: handler", () => {
    const recentFileFn = vi.fn()
    const consumed = vi.fn()
    const actions: MenuActionMap = { 'recentFile:': recentFileFn }

    renderHook(() =>
      useMenuActions({
        menuAction: { action: 'recentFile:/path/to/file.m', id: 1 },
        onMenuActionConsumed: consumed,
        actions,
      }),
    )

    expect(recentFileFn).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it('unknown menu action does not crash and calls onMenuActionConsumed', () => {
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: vi.fn() }

    expect(() =>
      renderHook(() =>
        useMenuActions({
          menuAction: { action: 'unknownAction', id: 1 },
          onMenuActionConsumed: consumed,
          actions,
        }),
      ),
    ).not.toThrow()

    expect(consumed).toHaveBeenCalledTimes(1)
    // The save handler should NOT have been called
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('null menuAction does not call any handler', () => {
    const saveFn = vi.fn()
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: saveFn }

    renderHook(() =>
      useMenuActions({
        menuAction: null,
        onMenuActionConsumed: consumed,
        actions,
      }),
    )

    expect(saveFn).not.toHaveBeenCalled()
    expect(consumed).not.toHaveBeenCalled()
  })

  it('a new action ID after a previous one processes correctly', () => {
    const saveFn = vi.fn()
    const runFn = vi.fn()
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: saveFn, run: runFn }

    const { rerender } = renderHook(
      ({ ma }) =>
        useMenuActions({
          menuAction: ma,
          onMenuActionConsumed: consumed,
          actions,
        }),
      { initialProps: { ma: { action: 'save', id: 1 } as MenuActionPayload } },
    )

    expect(saveFn).toHaveBeenCalledTimes(1)

    // New action with higher ID
    rerender({ ma: { action: 'run', id: 2 } })

    expect(runFn).toHaveBeenCalledTimes(1)
    expect(consumed).toHaveBeenCalledTimes(2)
  })

  it('async handler awaits before calling onMenuActionConsumed', async () => {
    let resolveHandler!: () => void
    const asyncHandler = vi.fn(
      () => new Promise<void>((resolve) => (resolveHandler = resolve)),
    )
    const consumed = vi.fn()
    const actions: MenuActionMap = { save: asyncHandler }

    renderHook(() =>
      useMenuActions({
        menuAction: { action: 'save', id: 1 },
        onMenuActionConsumed: consumed,
        actions,
      }),
    )

    expect(asyncHandler).toHaveBeenCalledTimes(1)
    // consumed should not be called yet (handler hasn't resolved)
    expect(consumed).not.toHaveBeenCalled()

    // Resolve the async handler
    resolveHandler()
    await vi.waitFor(() => {
      expect(consumed).toHaveBeenCalledTimes(1)
    })
  })
})
