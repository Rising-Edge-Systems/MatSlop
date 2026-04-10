import { describe, it, expect } from 'vitest'
import {
  toggleBreakpoint,
  clearBreakpointsForTab,
  getBreakpointsForTab,
  type BreakpointStore,
} from '../../src/renderer/editor/editorTypes'

describe('toggleBreakpoint', () => {
  it('adds a breakpoint to an empty store', () => {
    const next = toggleBreakpoint({}, 'tab-1', 5)
    expect(getBreakpointsForTab(next, 'tab-1')).toEqual([5])
  })

  it('adds a second breakpoint in sorted order', () => {
    let store: BreakpointStore = {}
    store = toggleBreakpoint(store, 'tab-1', 10)
    store = toggleBreakpoint(store, 'tab-1', 3)
    store = toggleBreakpoint(store, 'tab-1', 7)
    expect(getBreakpointsForTab(store, 'tab-1')).toEqual([3, 7, 10])
  })

  it('removes an existing breakpoint', () => {
    let store: BreakpointStore = { 'tab-1': [3, 5, 7] }
    store = toggleBreakpoint(store, 'tab-1', 5)
    expect(getBreakpointsForTab(store, 'tab-1')).toEqual([3, 7])
  })

  it('returns a new store object on add (referentially inequal)', () => {
    const before: BreakpointStore = {}
    const after = toggleBreakpoint(before, 'tab-1', 1)
    expect(after).not.toBe(before)
  })

  it('returns a new store object on remove', () => {
    const before: BreakpointStore = { 'tab-1': [5] }
    const after = toggleBreakpoint(before, 'tab-1', 5)
    expect(after).not.toBe(before)
    expect(after['tab-1']).toEqual([])
  })

  it('keeps separate entries per tab', () => {
    let store: BreakpointStore = {}
    store = toggleBreakpoint(store, 'tab-1', 3)
    store = toggleBreakpoint(store, 'tab-2', 8)
    expect(getBreakpointsForTab(store, 'tab-1')).toEqual([3])
    expect(getBreakpointsForTab(store, 'tab-2')).toEqual([8])
  })

  it('rejects non-positive line numbers', () => {
    const before: BreakpointStore = {}
    expect(toggleBreakpoint(before, 'tab-1', 0)).toBe(before)
    expect(toggleBreakpoint(before, 'tab-1', -3)).toBe(before)
    expect(toggleBreakpoint(before, 'tab-1', Number.NaN)).toBe(before)
  })

  it('floors fractional line numbers', () => {
    const store = toggleBreakpoint({}, 'tab-1', 5.7)
    expect(getBreakpointsForTab(store, 'tab-1')).toEqual([5])
  })

  it('toggling the same fractional line clears the floored breakpoint', () => {
    let store: BreakpointStore = {}
    store = toggleBreakpoint(store, 'tab-1', 5.2)
    store = toggleBreakpoint(store, 'tab-1', 5.9)
    expect(getBreakpointsForTab(store, 'tab-1')).toEqual([])
  })
})

describe('clearBreakpointsForTab', () => {
  it('drops the tab entry entirely', () => {
    const before: BreakpointStore = { 'tab-1': [1, 2], 'tab-2': [5] }
    const after = clearBreakpointsForTab(before, 'tab-1')
    expect('tab-1' in after).toBe(false)
    expect(after['tab-2']).toEqual([5])
  })

  it('is a no-op when the tab is not in the store', () => {
    const before: BreakpointStore = { 'tab-1': [1] }
    const after = clearBreakpointsForTab(before, 'tab-missing')
    expect(after).toBe(before)
  })
})

describe('getBreakpointsForTab', () => {
  it('returns an empty array for unknown tab ids', () => {
    expect(getBreakpointsForTab({}, 'nope')).toEqual([])
  })
})
