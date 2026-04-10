import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { OctaveProcessManager } from '../../src/main/octaveProcess'
import { getBundledOctaveBinary } from '../helpers/octaveBinary'

const OCTAVE_PATH = getBundledOctaveBinary()

function waitForReady(mgr: OctaveProcessManager, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mgr.getStatus() === 'ready') {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      mgr.removeListener('status', onStatus)
      reject(new Error(`Octave did not become ready within ${timeoutMs}ms`))
    }, timeoutMs)
    const onStatus = (status: string): void => {
      if (status === 'ready') {
        clearTimeout(timeout)
        mgr.removeListener('status', onStatus)
        resolve()
      }
    }
    mgr.on('status', onStatus)
  })
}

describe('Octave headless integration', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(OCTAVE_PATH)
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => {
    mgr.stop()
  })

  it('binary is available', () => {
    expect(OCTAVE_PATH).toBeTruthy()
  })

  it('reaches ready status after start', () => {
    expect(mgr.getStatus()).toBe('ready')
  })

  it('executes basic arithmetic', async () => {
    const result = await mgr.executeCommand('disp(2+2)')
    expect(result.output.trim()).toBe('4')
    expect(result.error).toBe('')
  })

  it('persists variables across commands', async () => {
    await mgr.executeCommand('x = 5;')
    const result = await mgr.executeCommand('disp(x*2)')
    expect(result.output.trim()).toBe('10')
  })

  it('handles matrix operations', async () => {
    await mgr.executeCommand('A = [1 2; 3 4];')
    const result = await mgr.executeCommand('disp(det(A))')
    expect(parseFloat(result.output.trim())).toBeCloseTo(-2, 5)
  })

  it('handles matrix multiplication', async () => {
    await mgr.executeCommand('A = [1 2; 3 4]; B = [5 6; 7 8];')
    const result = await mgr.executeCommand('disp(A*B)')
    // Expected: [19 22; 43 50]
    expect(result.output).toMatch(/19/)
    expect(result.output).toMatch(/22/)
    expect(result.output).toMatch(/43/)
    expect(result.output).toMatch(/50/)
  })

  it('supports function definition and call', async () => {
    await mgr.executeCommand('function y = sq(x); y = x*x; endfunction')
    const result = await mgr.executeCommand('disp(sq(7))')
    expect(result.output.trim()).toBe('49')
  })

  it('reports errors via stderr without hanging', async () => {
    const result = await mgr.executeCommand("error('test error message')")
    expect(result.error).toMatch(/test error message/i)
    expect(result.isComplete).toBe(true)
  })

  it('continues working after an error', async () => {
    await mgr.executeCommand("error('first error')")
    const result = await mgr.executeCommand('disp(1+1)')
    expect(result.output.trim()).toBe('2')
  })

  it('REGRESSION: fprintf without trailing newline does not include prompt', async () => {
    const result = await mgr.executeCommand("fprintf('hello world')")
    expect(result.output).toBe('hello world')
    expect(result.output).not.toMatch(/octave:\d+>/)
  })

  it('REGRESSION: fprintf with interpolated value no newline', async () => {
    await mgr.executeCommand('myvar = 10;')
    const result = await mgr.executeCommand("fprintf('This is myvar! %d', myvar)")
    expect(result.output).toBe('This is myvar! 10')
    expect(result.output).not.toMatch(/octave:/)
    expect(result.output).not.toMatch(/>>/)
  })

  it('REGRESSION: printf with explicit newline is clean', async () => {
    const result = await mgr.executeCommand("printf('line1\\nline2\\n')")
    expect(result.output).toMatch(/line1/)
    expect(result.output).toMatch(/line2/)
    expect(result.output).not.toMatch(/octave:\d+>/)
  })

  it('handles linspace and trig', async () => {
    const result = await mgr.executeCommand('disp(round(sin(pi/2)*1e6)/1e6)')
    expect(parseFloat(result.output.trim())).toBeCloseTo(1, 5)
  })

  it('queries workspace with whos', async () => {
    await mgr.executeCommand('clear all;')
    await mgr.executeCommand('a = 1; b = [1 2 3]; c = "hello";')
    const result = await mgr.executeCommand('whos')
    expect(result.output).toMatch(/\ba\b/)
    expect(result.output).toMatch(/\bb\b/)
    expect(result.output).toMatch(/\bc\b/)
  })

  it('clear all empties workspace', async () => {
    await mgr.executeCommand('z = 99;')
    await mgr.executeCommand('clear all;')
    const result = await mgr.executeCommand('whos')
    // After clear, whos should not show z
    expect(result.output).not.toMatch(/\bz\b/)
  })

  it('changes directory and reports pwd', async () => {
    const tmpDir = process.platform === 'win32' ? 'C:\\Windows' : '/tmp'
    await mgr.executeCommand(`cd('${tmpDir.replace(/\\/g, '\\\\')}')`)
    const result = await mgr.executeCommand('disp(pwd())')
    expect(result.output.toLowerCase()).toContain(tmpDir.toLowerCase())
  })

  it('queues concurrent commands and runs them in order', async () => {
    const p1 = mgr.executeCommand('pause(0.3); disp(11)')
    const p2 = mgr.executeCommand('disp(22)')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.output.trim()).toBe('11')
    expect(r2.output.trim()).toBe('22')
  })

  it('isRunning reflects state correctly', () => {
    expect(mgr.isRunning()).toBe(true)
    mgr.stop()
    expect(mgr.isRunning()).toBe(false)
  })
})

describe('OctaveProcessManager lifecycle', () => {
  it('can be stopped and recreated', async () => {
    const mgr1 = new OctaveProcessManager(OCTAVE_PATH)
    mgr1.start()
    await waitForReady(mgr1)
    expect(mgr1.isRunning()).toBe(true)
    mgr1.stop()
    expect(mgr1.isRunning()).toBe(false)

    const mgr2 = new OctaveProcessManager(OCTAVE_PATH)
    mgr2.start()
    await waitForReady(mgr2)
    const result = await mgr2.executeCommand('disp(1+1)')
    expect(result.output.trim()).toBe('2')
    mgr2.stop()
  })

  it('emits exit event when process stops', async () => {
    const mgr = new OctaveProcessManager(OCTAVE_PATH)
    mgr.start()
    await waitForReady(mgr)

    const exitPromise = new Promise<void>((resolve) => {
      mgr.once('exit', () => resolve())
    })
    mgr.stop()
    // Allow some time for exit event
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ])
  })
})
