import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  OctaveBusyTracker,
  octaveBusyTracker,
  wrapOctaveExecute,
} from '../../src/renderer/octaveBusyTracker'

/**
 * US-S02: ref-counted "Octave is running" tracker.
 *
 * These tests pin:
 *   - Sub-threshold commands never flip to 'running' (no flicker).
 *   - Long commands flip to 'running' after the debounce delay.
 *   - Nested / overlapping executes reuse a single ref-counted state and
 *     only return to 'idle' when the last execute settles.
 *   - wrapOctaveExecute increments / decrements the tracker exactly once
 *     per call and is idempotent across re-wraps.
 */

describe('OctaveBusyTracker', () => {
  let tracker: OctaveBusyTracker

  beforeEach(() => {
    vi.useFakeTimers()
    tracker = new OctaveBusyTracker()
    tracker.setDelayMs(250)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts idle with no in-flight commands', () => {
    expect(tracker.getState()).toBe('idle')
    expect(tracker.getPendingCount()).toBe(0)
  })

  it('does NOT flip to running for a sub-threshold (fast) command', () => {
    const seen: string[] = []
    tracker.subscribe((s) => seen.push(s))

    tracker.begin()
    vi.advanceTimersByTime(100) // still under 250ms
    tracker.end()
    vi.advanceTimersByTime(500) // timer should have been cleared

    expect(tracker.getState()).toBe('idle')
    expect(seen).toEqual([]) // no transitions, no flicker
  })

  it('flips to running after delayMs when a command stays in flight', () => {
    const seen: string[] = []
    tracker.subscribe((s) => seen.push(s))

    tracker.begin()
    vi.advanceTimersByTime(249)
    expect(tracker.getState()).toBe('idle')
    vi.advanceTimersByTime(1) // crosses the 250ms boundary
    expect(tracker.getState()).toBe('running')

    tracker.end()
    expect(tracker.getState()).toBe('idle')
    expect(seen).toEqual(['running', 'idle'])
  })

  it('ref-counts nested executes and only returns to idle when ALL settle', () => {
    const seen: string[] = []
    tracker.subscribe((s) => seen.push(s))

    tracker.begin() // workspace whos refresh
    tracker.begin() // user command lands while whos is still running
    vi.advanceTimersByTime(300)
    expect(tracker.getState()).toBe('running')
    expect(tracker.getPendingCount()).toBe(2)

    tracker.end() // whos settles
    expect(tracker.getState()).toBe('running') // still 1 in flight
    tracker.end() // user command settles
    expect(tracker.getState()).toBe('idle')
    expect(tracker.getPendingCount()).toBe(0)

    // One rising edge, one falling edge — no flicker.
    expect(seen).toEqual(['running', 'idle'])
  })

  it('overlapping begin() calls that cross the threshold emit a single rising edge', () => {
    const seen: string[] = []
    tracker.subscribe((s) => seen.push(s))

    tracker.begin()
    vi.advanceTimersByTime(100)
    tracker.begin() // adds to count but should NOT restart the timer
    vi.advanceTimersByTime(200) // 300ms total since first begin — threshold crossed
    expect(tracker.getState()).toBe('running')
    expect(seen).toEqual(['running'])

    tracker.end()
    tracker.end()
    expect(seen).toEqual(['running', 'idle'])
  })

  it('subscribe returns an unsubscribe that detaches the listener', () => {
    const calls: string[] = []
    const unsub = tracker.subscribe((s) => calls.push(s))
    unsub()
    tracker.begin()
    vi.advanceTimersByTime(500)
    tracker.end()
    expect(calls).toEqual([])
  })

  it('end() below zero is a safe no-op', () => {
    expect(() => tracker.end()).not.toThrow()
    expect(tracker.getPendingCount()).toBe(0)
    expect(tracker.getState()).toBe('idle')
  })
})

describe('wrapOctaveExecute', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    octaveBusyTracker.reset()
    octaveBusyTracker.setDelayMs(250)
  })

  afterEach(() => {
    vi.useRealTimers()
    octaveBusyTracker.reset()
  })

  it('drives the module-level tracker through a slow execute', async () => {
    // Mock a slow octaveExecute — resolves only when we advance the
    // fake timers past the debounce window.
    const bridge = {
      octaveExecute: (_cmd: string) =>
        new Promise<{ output: string; error: string; isComplete: boolean }>((resolve) => {
          setTimeout(() => resolve({ output: 'done', error: '', isComplete: true }), 1000)
        }),
    }

    const seen: string[] = []
    octaveBusyTracker.subscribe((s) => seen.push(s))

    const wrapped = wrapOctaveExecute(bridge)!
    const pending = wrapped.octaveExecute('long_op')

    // At t=200ms we're still idle (under the 250ms threshold).
    await vi.advanceTimersByTimeAsync(200)
    expect(octaveBusyTracker.getState()).toBe('idle')
    expect(seen).toEqual([])

    // Cross the threshold — status bar should flip to "running".
    await vi.advanceTimersByTimeAsync(100)
    expect(octaveBusyTracker.getState()).toBe('running')

    // Let the mock execute resolve — we should fall back to idle.
    await vi.advanceTimersByTimeAsync(1000)
    const result = await pending
    expect(result.output).toBe('done')
    expect(octaveBusyTracker.getState()).toBe('idle')
    expect(seen).toEqual(['running', 'idle'])
  })

  it('still decrements the counter if the underlying execute rejects', async () => {
    const bridge = {
      octaveExecute: (_cmd: string) =>
        new Promise<{ output: string; error: string; isComplete: boolean }>((_r, reject) => {
          setTimeout(() => reject(new Error('boom')), 10)
        }),
    }
    const wrapped = wrapOctaveExecute(bridge)!

    const p = wrapped.octaveExecute('bad').catch(() => 'caught')
    await vi.advanceTimersByTimeAsync(50)
    await p
    expect(octaveBusyTracker.getPendingCount()).toBe(0)
    expect(octaveBusyTracker.getState()).toBe('idle')
  })

  it('is idempotent — wrapping twice does not double-count', async () => {
    const bridge = {
      octaveExecute: (_cmd: string) =>
        Promise.resolve({ output: '', error: '', isComplete: true }),
    }
    const wrapped1 = wrapOctaveExecute(bridge)!
    const wrapped2 = wrapOctaveExecute(wrapped1)!
    // Second call sees the WRAPPED_MARKER and returns the same proxy.
    expect(wrapped2).toBe(wrapped1)
    await wrapped2.octaveExecute('x')
    // If double-wrapping had happened, pendingCount would go to 2 then
    // only decrement once via the outer try/finally — it would leak.
    expect(octaveBusyTracker.getPendingCount()).toBe(0)
  })

  it('gracefully ignores null / undefined bridges', () => {
    expect(() => wrapOctaveExecute(null)).not.toThrow()
    expect(() => wrapOctaveExecute(undefined)).not.toThrow()
  })
})
