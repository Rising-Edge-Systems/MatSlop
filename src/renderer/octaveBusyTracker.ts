/**
 * US-S02: Ref-counted "Octave is running" tracker.
 *
 * Every renderer-side `window.matslop.octaveExecute` call goes through this
 * tracker (via `wrapOctaveExecute`) so that when a command takes longer than
 * ~250ms the status bar can flip from "Ready" to "Running…" without flicker
 * on fast / nested executes.
 *
 * Design:
 *   - A single module-level singleton so every caller (CommandWindow,
 *     WorkspacePanel, LiveScriptEditor, etc.) contributes to the same count.
 *   - State only flips to `running` after `delayMs` (default 250) so
 *     sub-threshold commands stay silent.
 *   - If `inFlight` drops to 0 before the timer fires, the timer is
 *     cancelled and no state change is emitted at all — this prevents the
 *     flicker the PRD calls out.
 *   - Nested / overlapping executes (e.g. a workspace `whos` refresh that
 *     lands mid-command) are covered by the ref count: the state only
 *     returns to `idle` after the LAST in-flight execute settles.
 */

export type OctaveBusyState = 'idle' | 'running'

type Listener = (state: OctaveBusyState) => void

const DEFAULT_DELAY_MS = 250

/** Exported for test-only visibility. */
export class OctaveBusyTracker {
  private inFlight = 0
  private state: OctaveBusyState = 'idle'
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<Listener>()
  private delayMs: number = DEFAULT_DELAY_MS

  /** Test helper — override the debounce window. */
  setDelayMs(ms: number): void {
    this.delayMs = ms
  }

  getState(): OctaveBusyState {
    return this.state
  }

  /** Primarily for tests/telemetry. */
  getPendingCount(): number {
    return this.inFlight
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Call at the start of an `octaveExecute` IPC. */
  begin(): void {
    this.inFlight += 1
    if (this.inFlight === 1 && this.state === 'idle' && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        // If everything finished before the debounce elapsed we must NOT
        // flip to running — that would be a flicker right before we go
        // back to idle.
        if (this.inFlight > 0 && this.state === 'idle') {
          this.state = 'running'
          this.emit()
        }
      }, this.delayMs)
    }
  }

  /** Call when an `octaveExecute` IPC settles (resolve or reject). */
  end(): void {
    if (this.inFlight === 0) return
    this.inFlight -= 1
    if (this.inFlight === 0) {
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }
      if (this.state !== 'idle') {
        this.state = 'idle'
        this.emit()
      }
    }
  }

  /** Test helper — drop everything and return to the default state. */
  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.inFlight = 0
    this.state = 'idle'
    this.delayMs = DEFAULT_DELAY_MS
    this.listeners.clear()
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state)
  }
}

export const octaveBusyTracker = new OctaveBusyTracker()

interface ExecuteBridge {
  octaveExecute: (command: string) => Promise<{ output: string; error: string; isComplete: boolean }>
}

const WRAPPED_MARKER = '__matslopBusyTrackerWrapped'

/**
 * Idempotently wrap `bridge.octaveExecute` so that every call increments /
 * decrements the shared tracker.
 *
 * `bridge` is the object exposed by `contextBridge.exposeInMainWorld` —
 * its properties are frozen (strict-mode read-only) so we cannot mutate
 * `bridge.octaveExecute` directly. Instead, we return a Proxy that
 * intercepts the `octaveExecute` property and returns a tracked wrapper,
 * falling through to the original bridge for every other property. The
 * caller is responsible for reassigning `window.matslop = wrapped(...)`.
 * `window.matslop` itself is a regular property of `window` and IS
 * writable, so replacing it is safe.
 */
export function wrapOctaveExecute<T extends ExecuteBridge>(bridge: T | undefined | null): T | null {
  if (!bridge || typeof bridge.octaveExecute !== 'function') return bridge ?? null
  const maybeMarked = bridge as T & { [WRAPPED_MARKER]?: boolean }
  if (maybeMarked[WRAPPED_MARKER]) return bridge
  const original = bridge.octaveExecute.bind(bridge)
  const tracked = async (command: string) => {
    octaveBusyTracker.begin()
    try {
      return await original(command)
    } finally {
      octaveBusyTracker.end()
    }
  }
  const proxied = new Proxy(bridge, {
    get(target, prop, receiver) {
      if (prop === 'octaveExecute') return tracked
      if (prop === WRAPPED_MARKER) return true
      const value = Reflect.get(target, prop, receiver)
      // Bind methods back to the original target so `this` resolves
      // correctly when the caller invokes them via the proxy.
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
  return proxied
}
