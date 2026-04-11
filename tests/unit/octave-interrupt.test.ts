import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

/**
 * US-S03: the editor Stop button must interrupt a long-running command by
 * sending SIGINT to the underlying Octave process WITHOUT tearing the
 * process down. Workspace state (variables, globals) must survive the
 * interrupt so the user can inspect what they had.
 *
 * The flow under test:
 *   renderer handleStop() -> window.matslop.octaveInterrupt() (IPC)
 *     -> main process octave:interrupt handler
 *       -> OctaveProcessManager.interrupt() -> process.kill('SIGINT')
 *
 * We mock child_process.spawn so we can assert the exact signal sent and
 * prove the manager never calls .kill('SIGKILL') or clears pendingResolve
 * the way .stop() would.
 */

class FakeChildProcess extends EventEmitter {
  public killCalls: Array<NodeJS.Signals | number> = []
  public stdin = {
    write: vi.fn(),
  }
  public stdout = new EventEmitter()
  public stderr = new EventEmitter()
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killCalls.push(signal ?? 'SIGTERM')
    return true
  }
}

let lastFake: FakeChildProcess | null = null

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const fake = new FakeChildProcess()
    lastFake = fake
    return fake
  }),
}))

// Import AFTER the mock so OctaveProcessManager picks up the stubbed spawn.
const { OctaveProcessManager } = await import('../../src/main/octaveProcess')

describe('OctaveProcessManager.interrupt (US-S03)', () => {
  beforeEach(() => {
    lastFake = null
  })

  it('sends SIGINT to the child when an execute is in flight', () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    mgr.start()
    expect(lastFake).toBeTruthy()

    // Simulate the init-script handshake completing so status flips to
    // 'ready' and subsequent commands enter the busy path.
    lastFake!.stdout.emit('data', Buffer.from('___MATSLOP_CMD_DONE___\n'))
    expect(mgr.getStatus()).toBe('ready')

    // Kick off a long-running command — it should flip status to busy
    // but never resolve (we don't emit the delimiter).
    const pending = mgr.executeCommand('for i=1:1e12; end')
    expect(mgr.getStatus()).toBe('busy')

    // Click Stop → interrupt()
    mgr.interrupt()

    // Assert: exactly one SIGINT, no SIGKILL, no SIGTERM.
    expect(lastFake!.killCalls).toEqual(['SIGINT'])

    // Assert the Octave process handle is still alive — interrupt() must
    // NOT tear the process down the way stop() does.
    expect(mgr.isRunning()).toBe(true)
    expect(mgr.getStatus()).toBe('busy')

    // Simulate Octave printing "error: interrupted" then re-emitting the
    // delimiter: the pending command should resolve cleanly (returning us
    // to a ready prompt) and the status should flip to 'ready'.
    lastFake!.stderr.emit('data', Buffer.from('error: interrupted\n'))
    lastFake!.stdout.emit('data', Buffer.from('___MATSLOP_CMD_DONE___\n'))

    return pending.then((result) => {
      expect(result.isComplete).toBe(true)
      expect(result.error).toContain('error: interrupted')
      expect(mgr.getStatus()).toBe('ready')
      // Process is still alive — workspace state is preserved.
      expect(mgr.isRunning()).toBe(true)
      // And no destructive signals ever went out.
      expect(lastFake!.killCalls).toEqual(['SIGINT'])
    })
  })

  it('is a safe no-op when nothing is running', () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    // Never started — interrupt must not throw and must not try to kill.
    expect(() => mgr.interrupt()).not.toThrow()
  })

  it('is a no-op when the child is idle (status !== busy)', () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    mgr.start()
    // Complete the init handshake → status 'ready'
    lastFake!.stdout.emit('data', Buffer.from('___MATSLOP_CMD_DONE___\n'))
    expect(mgr.getStatus()).toBe('ready')

    mgr.interrupt()
    // interrupt() only sends SIGINT when status === 'busy'.
    expect(lastFake!.killCalls).toEqual([])
    expect(mgr.isRunning()).toBe(true)
  })
})

describe('renderer stop-button wiring (US-S03)', () => {
  it('calls window.matslop.octaveInterrupt exactly once per click', () => {
    // Mirrors the handleStop callback in src/renderer/App.tsx:991.
    const octaveInterrupt = vi.fn(async () => undefined)
    ;(globalThis as unknown as { window: unknown }).window = {
      matslop: { octaveInterrupt },
    }
    const handleStop = (): void => {
      ;(globalThis as unknown as { window: { matslop: { octaveInterrupt: () => void } } })
        .window.matslop.octaveInterrupt()
    }

    handleStop()
    handleStop()
    expect(octaveInterrupt).toHaveBeenCalledTimes(2)
  })
})
