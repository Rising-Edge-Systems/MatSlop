import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

/**
 * US-T02: the very first `executeCommand` after `start()` used to hang
 * when the renderer queued a command (e.g. `whos`) in the same tick as
 * `octave:start` — before the init-script delimiter had arrived. The bug:
 * start() installed a noop `pendingResolve` for the init handshake; when
 * handleStdout fired, it nulled `pendingResolve` and called the noop, but
 * nothing drained the `commandQueue`. `processQueue()` is only re-entered
 * from inside an executing command's resolver or from `executeCommand()`
 * itself, so the queued command sat there forever and the renderer's
 * IPC promise never resolved.
 *
 * This test simulates the exact race and asserts the queued command
 * resolves once init completes.
 */

class FakeChildProcess extends EventEmitter {
  public writes: string[] = []
  public stdin = {
    write: (data: string) => {
      this.writes.push(data)
      return true
    },
  }
  public stdout = new EventEmitter()
  public stderr = new EventEmitter()
  kill(): boolean {
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

const { OctaveProcessManager } = await import('../../src/main/octaveProcess')

describe('OctaveProcessManager init race (US-T02)', () => {
  beforeEach(() => {
    lastFake = null
  })

  it('drains commands queued before the init handshake completes', async () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    mgr.start()
    expect(lastFake).toBeTruthy()

    // Simulate the renderer firing `whos` before Octave has finished
    // processing the init script. The command should enter commandQueue
    // because pendingResolve is currently the init handler.
    const whosPromise = mgr.executeCommand('whos')

    // The command must NOT have been written yet — pendingResolve is set
    // to the init handler, so processQueue() returned early.
    expect(lastFake!.writes.some((w) => w.startsWith('whos'))).toBe(false)

    // Now Octave finishes the init script and emits the delimiter.
    // Previously this would resolve the init noop and the whos command
    // would sit in the queue forever. With the fix, the init handler
    // schedules processQueue() via setImmediate, which dispatches whos.
    lastFake!.stdout.emit('data', Buffer.from('___MATSLOP_CMD_DONE___\n'))

    // Yield to setImmediate so processQueue() can run.
    await new Promise<void>((r) => setImmediate(r))

    // whos should now have been written to stdin.
    expect(lastFake!.writes.some((w) => w.startsWith('whos'))).toBe(true)
    expect(mgr.getStatus()).toBe('busy')

    // Simulate Octave replying with whos output + delimiter.
    lastFake!.stdout.emit(
      'data',
      Buffer.from('Variables visible from the current scope:\n\n  x  1x1  double\n\n___MATSLOP_CMD_DONE___\n')
    )

    const result = await whosPromise
    expect(result.isComplete).toBe(true)
    expect(result.output).toContain('Variables visible from the current scope')
    expect(mgr.getStatus()).toBe('ready')
  })

  it('still works when no command is queued during init', async () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    mgr.start()
    // Init handshake completes before anything is queued.
    lastFake!.stdout.emit('data', Buffer.from('___MATSLOP_CMD_DONE___\n'))
    await new Promise<void>((r) => setImmediate(r))
    expect(mgr.getStatus()).toBe('ready')

    // A command issued AFTER init should still dispatch normally.
    const p = mgr.executeCommand('disp(1)')
    await new Promise<void>((r) => setImmediate(r))
    expect(lastFake!.writes.some((w) => w.startsWith('disp(1)'))).toBe(true)
    lastFake!.stdout.emit('data', Buffer.from('1\n___MATSLOP_CMD_DONE___\n'))
    const result = await p
    expect(result.output).toContain('1')
  })
})
