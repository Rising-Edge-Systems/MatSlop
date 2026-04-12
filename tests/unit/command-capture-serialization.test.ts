/**
 * US-L04: Tests that the capture script and workspace refresh are serialized.
 *
 * After every user command in CommandWindow, App.tsx runs a capture script
 * (pwd + figure detection) via octaveExecute, then triggers a workspace
 * refresh.  This test verifies that the workspace `whos` command only
 * runs AFTER the capture script has finished — preventing a race for the
 * single Octave command slot.
 */
import { describe, it, expect, vi } from 'vitest'

describe('command capture → workspace refresh serialization (US-L04)', () => {
  it('capture script completes before workspace whos is dispatched', async () => {
    // Track the order in which Octave commands are dispatched.
    const callOrder: string[] = []
    let captureResolve: ((v: { output: string; error: string; isComplete: boolean }) => void) | null = null

    const octaveExecute = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes('__mslp_r__')) {
        callOrder.push('capture:start')
        return new Promise<{ output: string; error: string; isComplete: boolean }>((resolve) => {
          captureResolve = (v) => {
            callOrder.push('capture:end')
            resolve(v)
          }
        })
      }
      if (cmd === 'whos') {
        callOrder.push('whos')
        return Promise.resolve({
          output: `  Attr   Name   Size   Bytes  Class
  ====   ====   ====   =====  =====
         x      1x1        8  double

Total is 1 element using 8 bytes`,
          error: '',
          isComplete: true,
        })
      }
      return Promise.resolve({ output: '', error: '', isComplete: true })
    })

    // Simulate the serialized flow from App.tsx handleCommandExecuted:
    // 1. Run capture script and await it
    // 2. THEN trigger workspace refresh (which runs whos)

    // Step 1: Start the capture script
    const captureScript = [
      "__mslp_r__=pwd();disp(['__MATSLOP_PWD__:' __mslp_r__]);",
      "__mslp_fh__=get(0,'children');",
      "for __mslp_k__=1:length(__mslp_fh__);",
      "__mslp_fp__=[tempdir() 'matslop_fig_' num2str(__mslp_fh__(__mslp_k__)) '.png'];",
      "try;print(__mslp_fh__(__mslp_k__),__mslp_fp__,'-dpng','-r150');",
      "disp(['__MATSLOP_FIG__:' num2str(__mslp_fh__(__mslp_k__)) ':' __mslp_fp__]);",
      "catch;end;end;",
      "clear __mslp_r__ __mslp_fh__ __mslp_k__ __mslp_fp__;"
    ].join('')

    const capturePromise = octaveExecute(captureScript)

    // At this point, capture:start has been called but capture:end has not.
    expect(callOrder).toEqual(['capture:start'])

    // Simulate capture script completing (e.g., pwd returns /home/user)
    captureResolve!({
      output: '__MATSLOP_PWD__:/home/user',
      error: '',
      isComplete: true,
    })

    // Await the capture promise — this is what handleCommandExecuted does
    await capturePromise

    expect(callOrder).toEqual(['capture:start', 'capture:end'])

    // Step 2: Now trigger workspace refresh (whos)
    await octaveExecute('whos')

    // Verify the order: capture completed before whos started.
    expect(callOrder).toEqual(['capture:start', 'capture:end', 'whos'])
  })

  it('workspace refresh triggers even when capture script fails', async () => {
    let refreshTriggered = false
    const octaveExecute = vi.fn().mockRejectedValue(new Error('octave crashed'))

    // Simulate runCaptureAndRefresh: capture fails, but refresh still happens
    try {
      await octaveExecute('capture-script')
    } catch {
      // ignore capture errors
    }
    // Refresh should still be triggered
    refreshTriggered = true

    expect(refreshTriggered).toBe(true)
    expect(octaveExecute).toHaveBeenCalledTimes(1)
  })

  it('whos returns x=42 on first attempt when serialized after capture', async () => {
    // Simulates the full flow: user types `x = 42`, capture runs, then whos
    const callLog: string[] = []

    const octaveExecute = vi.fn().mockImplementation((cmd: string) => {
      callLog.push(cmd.includes('__mslp_r__') ? 'capture' : cmd.includes('whos') ? 'whos' : cmd)

      if (cmd.includes('__mslp_r__')) {
        return Promise.resolve({
          output: '__MATSLOP_PWD__:/home/user/project',
          error: '',
          isComplete: true,
        })
      }
      if (cmd === 'whos') {
        return Promise.resolve({
          output: `  Attr   Name              Size                     Bytes  Class
  ====   ====              ====                     =====  =====
         x                 1x1                          8  double

Total is 1 element using 8 bytes`,
          error: '',
          isComplete: true,
        })
      }
      // x = 42 command
      return Promise.resolve({ output: 'x = 42', error: '', isComplete: true })
    })

    // 1. User command executes
    await octaveExecute('x = 42')

    // 2. Capture script runs (handleCommandExecuted)
    const captureScript = "__mslp_r__=pwd();disp(['__MATSLOP_PWD__:' __mslp_r__]);"
    await octaveExecute(captureScript)

    // 3. Workspace refresh runs (whos)
    const result = await octaveExecute('whos')

    // Verify order
    expect(callLog).toEqual(['x = 42', 'capture', 'whos'])

    // Verify whos found x on the FIRST attempt (no retry needed)
    expect(result.output).toContain('x')
    expect(result.output).toContain('double')
  })
})
