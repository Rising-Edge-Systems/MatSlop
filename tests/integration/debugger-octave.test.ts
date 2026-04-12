/**
 * US-L07: Integration tests for the debugger against real Octave 8.4.
 *
 * These tests spawn a real OctaveProcessManager instance and exercise
 * the dbstop → run → pause → dbstep → dbcont cycle, verifying that:
 *   - parsePausedMarker correctly handles Octave 8.4's output format
 *   - The 'paused' event fires with the correct file and line
 *   - dbstep advances one line and fires a new paused event
 *   - Variable inspection works while paused
 *   - Call stack query returns correct frames while paused
 *
 * Requires: Octave CLI available at /tmp/octave-root/octave-cli-wrap
 * or system `octave-cli`. Tests are skipped if Octave is not available.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { OctaveProcessManager, type CommandResult } from '../../src/main/octaveProcess'
import { parsePausedMarker, type PausedLocation } from '../../src/main/debugBridge'
import { parseCallStack, formatCallStackQuery } from '../../src/main/callStack'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Locate Octave CLI
function findOctave(): string | null {
  const candidates = [
    '/tmp/octave-root/octave-cli-wrap',
    '/usr/bin/octave-cli',
    '/usr/bin/octave',
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {
      // skip
    }
  }
  return null
}

const octavePath = findOctave()
const SKIP = !octavePath
const TIMEOUT = 30_000 // 30s for real Octave operations

/**
 * Helper: wait for the 'paused' event on an OctaveProcessManager, with timeout.
 */
function waitForPaused(opm: OctaveProcessManager, timeoutMs = 10_000): Promise<PausedLocation> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for paused event')), timeoutMs)
    opm.once('paused', (loc: PausedLocation) => {
      clearTimeout(timer)
      resolve(loc)
    })
  })
}

/**
 * Helper: wait for the OctaveProcessManager to become 'ready'.
 */
function waitForReady(opm: OctaveProcessManager, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opm.getStatus() === 'ready') { resolve(); return }
    const timer = setTimeout(() => reject(new Error('Timed out waiting for ready')), timeoutMs)
    const handler = (status: string): void => {
      if (status === 'ready') {
        clearTimeout(timer)
        opm.removeListener('status', handler)
        resolve()
      }
    }
    opm.on('status', handler)
  })
}

describe.skipIf(SKIP)('Debugger integration with real Octave', () => {
  let opm: OctaveProcessManager
  let tmpDir: string
  let testFile: string

  beforeAll(async () => {
    // Create a temp directory with test .m files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matslop-debug-test-'))

    // A simple sequential script for stepping through
    testFile = path.join(tmpDir, 'test_dbg.m')
    fs.writeFileSync(testFile, [
      'x = 10;',
      'y = 20;',
      'z = x + y;',
      'w = z * 2;',
      "disp('done');",
    ].join('\n'))

    // Start Octave
    opm = new OctaveProcessManager(octavePath!)
    opm.start()
    await waitForReady(opm)

    // Add temp dir to Octave path so dbstop can find the script
    await opm.executeCommand(`addpath('${tmpDir.replace(/\\/g, '/').replace(/'/g, "''")}')`)
  }, TIMEOUT)

  afterAll(() => {
    if (opm?.isRunning()) opm.stop()
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  afterEach(async () => {
    // Clear all breakpoints after each test to avoid interference
    if (opm?.isRunning()) {
      try {
        await opm.executeCommand('dbclear all')
      } catch {
        // ignore
      }
    }
  })

  it('dbstop → run → pause fires paused event with correct file and line', async () => {
    // Set a breakpoint at line 2
    await opm.executeCommand(`dbstop in test_dbg at 2`)

    // Run the file and wait for the paused event
    const pausedPromise = waitForPaused(opm)
    // Don't await executeCommand — it won't resolve until Octave finishes,
    // but the file will pause at the breakpoint first.
    void opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)

    const loc = await pausedPromise
    expect(loc).toBeDefined()
    expect(loc.line).toBe(2)
    // Octave 8.4 should provide the full path in brackets
    // The file could be the full path or the script name, depending on
    // whether parsePausedMarker picked up the bracketed path.
    expect(loc.file).toMatch(/test_dbg/)

    // Resume execution
    await opm.executeCommand('dbcont')
  }, TIMEOUT)

  it('parsePausedMarker extracts full path from Octave 8.4 bracket format', () => {
    // Real Octave 8.4 output format
    const text = `stopped in test_dbg at line 2 [${testFile}] \n2: y = 20;\n`
    const loc = parsePausedMarker(text)
    expect(loc).toEqual({ file: testFile, line: 2 })
  })

  it('dbstep advances one line and fires a new paused event', async () => {
    // Set breakpoint at line 1
    await opm.executeCommand('dbstop in test_dbg at 1')

    // Run the file
    const pause1Promise = waitForPaused(opm)
    void opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)
    const loc1 = await pause1Promise
    expect(loc1.line).toBe(1)

    // Step to line 2
    const pause2Promise = waitForPaused(opm)
    void opm.executeCommand('dbstep')
    const loc2 = await pause2Promise
    expect(loc2.line).toBe(2)

    // Step to line 3
    const pause3Promise = waitForPaused(opm)
    void opm.executeCommand('dbstep')
    const loc3 = await pause3Promise
    expect(loc3.line).toBe(3)

    // Resume
    await opm.executeCommand('dbcont')
  }, TIMEOUT)

  it('variable inspection works while paused', async () => {
    // Set breakpoint at line 3 (after x=10 and y=20 are assigned)
    await opm.executeCommand('dbstop in test_dbg at 3')

    const pausedPromise = waitForPaused(opm)
    void opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)
    await pausedPromise

    // Inspect x — should be 10
    const xResult = await opm.executeCommand('disp(x)')
    expect(xResult.output.trim()).toContain('10')

    // Inspect y — should be 20
    const yResult = await opm.executeCommand('disp(y)')
    expect(yResult.output.trim()).toContain('20')

    // Resume
    await opm.executeCommand('dbcont')
  }, TIMEOUT)

  it('call stack query returns correct frames while paused', async () => {
    // Set breakpoint at line 2
    await opm.executeCommand('dbstop in test_dbg at 2')

    const pausedPromise = waitForPaused(opm)
    void opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)
    await pausedPromise

    // Run the call stack query
    const query = formatCallStackQuery()
    const result = await opm.executeCommand(query)
    const frames = parseCallStack(result.output)

    expect(frames.length).toBeGreaterThanOrEqual(1)
    expect(frames[0].name).toBe('test_dbg')
    expect(frames[0].line).toBe(2)
    expect(frames[0].file).toMatch(/test_dbg\.m$/)

    // Resume
    await opm.executeCommand('dbcont')
  }, TIMEOUT)

  it('dbcont resumes execution to completion', async () => {
    // Set breakpoint at line 1
    await opm.executeCommand('dbstop in test_dbg at 1')

    const pausedPromise = waitForPaused(opm)
    // We need to capture the execution result to verify it completes
    const execPromise = opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)
    await pausedPromise

    // Continue — the source command should now complete
    const contResult = await opm.executeCommand('dbcont')
    // After dbcont, the original source command resolves
    const result = await execPromise
    // The script ends with disp('done'), so output should contain 'done'
    const allOutput = result.output + contResult.output
    expect(allOutput).toContain('done')
  }, TIMEOUT)

  it('full dbstop → dbstep → inspect → dbcont cycle', async () => {
    // Set breakpoint at line 1
    await opm.executeCommand('dbstop in test_dbg at 1')

    // Run script
    const pausedPromise = waitForPaused(opm)
    void opm.executeCommand(`source('${testFile.replace(/\\/g, '/')}')`)
    const loc = await pausedPromise
    expect(loc.line).toBe(1)

    // Step past x=10
    const pause2 = waitForPaused(opm)
    void opm.executeCommand('dbstep')
    await pause2

    // Verify x is set
    const xRes = await opm.executeCommand('disp(x)')
    expect(xRes.output.trim()).toContain('10')

    // Step past y=20
    const pause3 = waitForPaused(opm)
    void opm.executeCommand('dbstep')
    await pause3

    // Verify y is set
    const yRes = await opm.executeCommand('disp(y)')
    expect(yRes.output.trim()).toContain('20')

    // Continue to end
    await opm.executeCommand('dbcont')
  }, TIMEOUT)
})

describe('parsePausedMarker handles Octave 8.4 format (unit)', () => {
  it('extracts full path from bracketed format', () => {
    const loc = parsePausedMarker('stopped in test_dbg at line 2 [/tmp/test_dbg.m]')
    expect(loc).toEqual({ file: '/tmp/test_dbg.m', line: 2 })
  })

  it('falls back to function name without brackets', () => {
    const loc = parsePausedMarker('stopped in test_dbg at line 2')
    expect(loc).toEqual({ file: 'test_dbg', line: 2 })
  })

  it('handles Windows bracketed path', () => {
    const loc = parsePausedMarker('stopped in myfunc at line 5 [C:\\Users\\me\\myfunc.m]')
    expect(loc).toEqual({ file: 'C:\\Users\\me\\myfunc.m', line: 5 })
  })

  it('handles multi-line output with source preview', () => {
    const text = 'stopped in test_dbg at line 3 [/home/user/test_dbg.m] \n3: z = x + y;\n'
    const loc = parsePausedMarker(text)
    expect(loc).toEqual({ file: '/home/user/test_dbg.m', line: 3 })
  })
})
