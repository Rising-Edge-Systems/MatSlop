import { describe, it, expect } from 'vitest'
import {
  setBreakpointCondition,
  getBreakpointCondition,
  clearBreakpointConditionsForTab,
  type BreakpointConditionStore,
} from '../../src/renderer/editor/editorTypes'

/**
 * US-021: Conditional breakpoint store is a parallel Record<string,
 * Record<number, string>> keyed by tabId, and the helpers must be
 * referentially-stable (return same reference on no-op) so React state
 * comparisons don't cause needless re-renders.
 */
describe('setBreakpointCondition', () => {
  it('attaches a condition to a tab/line', () => {
    const next = setBreakpointCondition({}, 'tab-1', 5, 'i > 10')
    expect(getBreakpointCondition(next, 'tab-1', 5)).toBe('i > 10')
  })

  it('trims the condition before storing', () => {
    const next = setBreakpointCondition({}, 'tab-1', 5, '   x == 3   ')
    expect(getBreakpointCondition(next, 'tab-1', 5)).toBe('x == 3')
  })

  it('replaces an existing condition with a new one', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 5, 'i > 10')
    store = setBreakpointCondition(store, 'tab-1', 5, 'i > 20')
    expect(getBreakpointCondition(store, 'tab-1', 5)).toBe('i > 20')
  })

  it('passing null removes the condition', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 5, 'i > 10')
    store = setBreakpointCondition(store, 'tab-1', 5, null)
    expect(getBreakpointCondition(store, 'tab-1', 5)).toBeNull()
  })

  it('passing empty/whitespace removes the condition', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 5, 'i > 10')
    store = setBreakpointCondition(store, 'tab-1', 5, '   ')
    expect(getBreakpointCondition(store, 'tab-1', 5)).toBeNull()
  })

  it('returns a NEW store object on add', () => {
    const before: BreakpointConditionStore = {}
    const after = setBreakpointCondition(before, 'tab-1', 5, 'i > 10')
    expect(after).not.toBe(before)
  })

  it('returns the SAME store reference on no-op (same value)', () => {
    const before = setBreakpointCondition({}, 'tab-1', 5, 'i > 10')
    const after = setBreakpointCondition(before, 'tab-1', 5, 'i > 10')
    expect(after).toBe(before)
  })

  it('returns the SAME store reference when clearing a non-existent condition', () => {
    const before: BreakpointConditionStore = {}
    const after = setBreakpointCondition(before, 'tab-1', 5, null)
    expect(after).toBe(before)
  })

  it('removes the tab entry entirely when the last condition is cleared', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 5, 'i > 10')
    store = setBreakpointCondition(store, 'tab-1', 5, null)
    expect('tab-1' in store).toBe(false)
  })

  it('rejects non-positive / NaN line numbers', () => {
    const before: BreakpointConditionStore = {}
    expect(setBreakpointCondition(before, 'tab-1', 0, 'i > 0')).toBe(before)
    expect(setBreakpointCondition(before, 'tab-1', -1, 'i > 0')).toBe(before)
    expect(setBreakpointCondition(before, 'tab-1', Number.NaN, 'i > 0')).toBe(before)
  })

  it('floors fractional line numbers on both set and get', () => {
    const store = setBreakpointCondition({}, 'tab-1', 5.7, 'ok')
    expect(getBreakpointCondition(store, 'tab-1', 5)).toBe('ok')
    expect(getBreakpointCondition(store, 'tab-1', 5.2)).toBe('ok')
  })

  it('keeps conditions for different tabs isolated', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 3, 'a')
    store = setBreakpointCondition(store, 'tab-2', 3, 'b')
    expect(getBreakpointCondition(store, 'tab-1', 3)).toBe('a')
    expect(getBreakpointCondition(store, 'tab-2', 3)).toBe('b')
  })
})

describe('getBreakpointCondition', () => {
  it('returns null for unknown tab ids', () => {
    expect(getBreakpointCondition({}, 'nope', 1)).toBeNull()
  })

  it('returns null for a tab that has conditions but not on this line', () => {
    const store = setBreakpointCondition({}, 'tab-1', 5, 'i > 10')
    expect(getBreakpointCondition(store, 'tab-1', 9)).toBeNull()
  })

  it('returns null for bad line numbers', () => {
    const store = setBreakpointCondition({}, 'tab-1', 5, 'i > 10')
    expect(getBreakpointCondition(store, 'tab-1', 0)).toBeNull()
    expect(getBreakpointCondition(store, 'tab-1', Number.NaN)).toBeNull()
  })
})

describe('clearBreakpointConditionsForTab', () => {
  it('drops the tab entry entirely', () => {
    let store: BreakpointConditionStore = {}
    store = setBreakpointCondition(store, 'tab-1', 1, 'a')
    store = setBreakpointCondition(store, 'tab-1', 2, 'b')
    store = setBreakpointCondition(store, 'tab-2', 3, 'c')
    const after = clearBreakpointConditionsForTab(store, 'tab-1')
    expect('tab-1' in after).toBe(false)
    expect(getBreakpointCondition(after, 'tab-2', 3)).toBe('c')
  })

  it('is a no-op when the tab is not in the store', () => {
    const before: BreakpointConditionStore = {}
    const after = clearBreakpointConditionsForTab(before, 'tab-missing')
    expect(after).toBe(before)
  })
})
