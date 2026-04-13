import { describe, it, expect } from 'vitest'
import {
  formatDbstopCommand,
  formatDbclearCommand,
  formatDbstopConditionalCommand,
  setBreakpoint,
  setBreakpointWithCondition,
  clearBreakpoint,
  reapplyAllBreakpoints,
  reapplyBreakpointsForFile,
  breakpointBucketKey,
  UNSAVED_BUCKET,
} from '../../src/main/debugBridge'

/**
 * Tiny helper: a fake OctaveProcessManager that just records the commands it
 * would have executed. Matches the shape expected by the bridge's
 * `CommandExecutor` signature (`(cmd: string) => void | Promise<unknown>`).
 */
function makeRecorder(): {
  sent: string[]
  exec: (cmd: string) => Promise<void>
} {
  const sent: string[] = []
  return {
    sent,
    exec: async (cmd: string) => {
      sent.push(cmd)
    },
  }
}

describe('formatDbstopCommand', () => {
  it('quotes the basename without .m extension', () => {
    expect(formatDbstopCommand('/home/user/project/myfunc.m', 12)).toBe(
      'dbstop in "myfunc" at 12',
    )
  })

  it('floors fractional lines', () => {
    expect(formatDbstopCommand('foo.m', 3.9)).toBe('dbstop in "foo" at 3')
  })

  it('handles windows-style paths', () => {
    // path.basename in node handles forward slashes on all platforms; back
    // slashes only get stripped on win32. The important part is that file
    // paths with forward slashes collapse to just the file name.
    expect(formatDbstopCommand('C:/work/alpha.m', 1)).toBe(
      'dbstop in "alpha" at 1',
    )
  })

  it('escapes embedded double quotes in the file name', () => {
    expect(formatDbstopCommand('weird"name.m', 7)).toBe(
      'dbstop in "weird\\"name" at 7',
    )
  })
})

describe('formatDbstopConditionalCommand (US-021)', () => {
  it('formats a conditional dbstop with single-quoted expression', () => {
    expect(formatDbstopConditionalCommand('/abs/foo.m', 12, 'i > 10')).toBe(
      `dbstop in "foo" at 12 if 'i > 10'`,
    )
  })

  it('falls back to a plain dbstop when the condition is null or empty', () => {
    expect(formatDbstopConditionalCommand('/abs/foo.m', 12, null)).toBe(
      'dbstop in "foo" at 12',
    )
    expect(formatDbstopConditionalCommand('/abs/foo.m', 12, '')).toBe(
      'dbstop in "foo" at 12',
    )
    expect(formatDbstopConditionalCommand('/abs/foo.m', 12, '   ')).toBe(
      'dbstop in "foo" at 12',
    )
  })

  it('escapes embedded single quotes in the condition (Octave string escape)', () => {
    expect(
      formatDbstopConditionalCommand('/abs/foo.m', 3, "strcmp(s, 'hi')"),
    ).toBe(`dbstop in "foo" at 3 if 'strcmp(s, ''hi'')'`)
  })

  it('floors fractional lines', () => {
    expect(formatDbstopConditionalCommand('foo.m', 3.9, 'ok')).toBe(
      `dbstop in "foo" at 3 if 'ok'`,
    )
  })

  it('trims surrounding whitespace on the condition', () => {
    expect(formatDbstopConditionalCommand('foo.m', 1, '   i > 10   ')).toBe(
      `dbstop in "foo" at 1 if 'i > 10'`,
    )
  })
})

describe('setBreakpointWithCondition (US-021)', () => {
  it('records the line and sends dbclear + conditional dbstop', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    const ok = setBreakpointWithCondition(map, '/p/foo.m', 7, 'i > 10', rec.exec)
    expect(ok).toBe(true)
    expect(map.get('/p/foo.m')).toEqual(new Set([7]))
    await Promise.resolve()
    expect(rec.sent).toEqual([
      'dbclear in "foo" at 7',
      `dbstop in "foo" at 7 if 'i > 10'`,
    ])
  })

  it('sends a plain dbstop when the condition is cleared', async () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/foo.m', new Set([7]))
    const rec = makeRecorder()
    const ok = setBreakpointWithCondition(map, '/p/foo.m', 7, null, rec.exec)
    expect(ok).toBe(true)
    await Promise.resolve()
    expect(rec.sent).toEqual([
      'dbclear in "foo" at 7',
      'dbstop in "foo" at 7',
    ])
  })

  it('still records unsaved-tab lines but does NOT forward to Octave', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    const ok = setBreakpointWithCondition(map, null, 2, 'true', rec.exec)
    expect(ok).toBe(true)
    expect(map.get(UNSAVED_BUCKET)).toEqual(new Set([2]))
    await Promise.resolve()
    expect(rec.sent).toEqual([])
  })

  it('rejects bad lines', () => {
    const map = new Map<string, Set<number>>()
    expect(setBreakpointWithCondition(map, '/p/x.m', 0, 'a', null)).toBe(false)
    expect(setBreakpointWithCondition(map, '/p/x.m', Number.NaN, 'a', null)).toBe(false)
  })
})

describe('formatDbclearCommand', () => {
  it('produces a dbclear line for the same inputs', () => {
    expect(formatDbclearCommand('/abs/plot.m', 5)).toBe(
      'dbclear in "plot" at 5',
    )
  })
})

describe('breakpointBucketKey', () => {
  it('uses the file path as the key when present', () => {
    expect(breakpointBucketKey('/tmp/foo.m')).toBe('/tmp/foo.m')
  })

  it('falls back to the unsaved bucket when the path is missing', () => {
    expect(breakpointBucketKey(null)).toBe(UNSAVED_BUCKET)
    expect(breakpointBucketKey('')).toBe(UNSAVED_BUCKET)
    expect(breakpointBucketKey(undefined)).toBe(UNSAVED_BUCKET)
  })
})

describe('setBreakpoint', () => {
  it('records the line and forwards a dbstop command when an executor is attached', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    const ok = setBreakpoint(map, '/proj/foo.m', 42, rec.exec)
    expect(ok).toBe(true)
    expect(map.get('/proj/foo.m')).toEqual(new Set([42]))
    // allow microtask for the Promise.resolve
    await Promise.resolve()
    expect(rec.sent).toEqual(['dbstop in "foo" at 42'])
  })

  it('still records unsaved-tab breakpoints but does NOT forward to Octave', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    const ok = setBreakpoint(map, null, 3, rec.exec)
    expect(ok).toBe(true)
    expect(map.get(UNSAVED_BUCKET)).toEqual(new Set([3]))
    await Promise.resolve()
    expect(rec.sent).toEqual([])
  })

  it('records the line without a command when the executor is null (Octave not running)', () => {
    const map = new Map<string, Set<number>>()
    const ok = setBreakpoint(map, '/p/x.m', 9, null)
    expect(ok).toBe(true)
    expect(map.get('/p/x.m')).toEqual(new Set([9]))
  })

  it('rejects non-positive / NaN lines and returns false', () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    expect(setBreakpoint(map, '/p/x.m', 0, rec.exec)).toBe(false)
    expect(setBreakpoint(map, '/p/x.m', -1, rec.exec)).toBe(false)
    expect(setBreakpoint(map, '/p/x.m', Number.NaN, rec.exec)).toBe(false)
    expect(map.size).toBe(0)
    expect(rec.sent).toEqual([])
  })

  it('adds multiple lines to the same file as a single set', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    setBreakpoint(map, '/p/x.m', 3, rec.exec)
    setBreakpoint(map, '/p/x.m', 9, rec.exec)
    expect(map.get('/p/x.m')).toEqual(new Set([3, 9]))
    await Promise.resolve()
    expect(rec.sent).toEqual(['dbstop in "x" at 3', 'dbstop in "x" at 9'])
  })
})

describe('clearBreakpoint', () => {
  it('removes the line and forwards a dbclear command', async () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/x.m', new Set([3, 9]))
    const rec = makeRecorder()
    const ok = clearBreakpoint(map, '/p/x.m', 3, rec.exec)
    expect(ok).toBe(true)
    expect(map.get('/p/x.m')).toEqual(new Set([9]))
    await Promise.resolve()
    expect(rec.sent).toEqual(['dbclear in "x" at 3'])
  })

  it('drops the bucket entirely when the last line is cleared', () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/x.m', new Set([5]))
    clearBreakpoint(map, '/p/x.m', 5, null)
    expect(map.has('/p/x.m')).toBe(false)
  })

  it('is idempotent on unknown lines (no crash, no command sent for missing bucket)', async () => {
    const map = new Map<string, Set<number>>()
    const rec = makeRecorder()
    // Note: we DO still forward the dbclear on a valid path even if the map
    // didn't have the line — Octave will just no-op. What matters is we
    // don't crash.
    const ok = clearBreakpoint(map, '/p/x.m', 11, rec.exec)
    expect(ok).toBe(true)
    await Promise.resolve()
    expect(rec.sent).toEqual(['dbclear in "x" at 11'])
  })

  it('rejects bad lines', () => {
    const map = new Map<string, Set<number>>()
    expect(clearBreakpoint(map, '/p/x.m', 0, null)).toBe(false)
    expect(clearBreakpoint(map, '/p/x.m', Number.NaN, null)).toBe(false)
  })
})

describe('reapplyAllBreakpoints', () => {
  it('emits a dbstop command for every remembered line in deterministic order', async () => {
    const map = new Map<string, Set<number>>()
    map.set('/project/b.m', new Set([7, 2]))
    map.set('/project/a.m', new Set([5]))
    const rec = makeRecorder()
    const sent = reapplyAllBreakpoints(map, rec.exec)
    // Keys sort ascending, lines sort ascending within each key.
    expect(sent).toEqual([
      'dbstop in "a" at 5',
      'dbstop in "b" at 2',
      'dbstop in "b" at 7',
    ])
    await Promise.resolve()
    expect(rec.sent).toEqual(sent)
  })

  it('skips the unsaved bucket because Octave cannot address it', () => {
    const map = new Map<string, Set<number>>()
    map.set(UNSAVED_BUCKET, new Set([1, 2, 3]))
    map.set('/project/real.m', new Set([9]))
    const rec = makeRecorder()
    const sent = reapplyAllBreakpoints(map, rec.exec)
    expect(sent).toEqual(['dbstop in "real" at 9'])
  })

  it('is a no-op on an empty registry', () => {
    const rec = makeRecorder()
    const sent = reapplyAllBreakpoints(new Map(), rec.exec)
    expect(sent).toEqual([])
    expect(rec.sent).toEqual([])
  })

  it('emits conditional dbstop when a conditions map is provided', async () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/foo.m', new Set([5, 12]))
    const conds = new Map<string, Map<number, string>>()
    conds.set('/p/foo.m', new Map([[12, 'i > 10']]))
    const rec = makeRecorder()
    const sent = reapplyAllBreakpoints(map, rec.exec, conds)
    expect(sent).toEqual([
      'dbstop in "foo" at 5',
      `dbstop in "foo" at 12 if 'i > 10'`,
    ])
    await Promise.resolve()
    expect(rec.sent).toEqual(sent)
  })

  it('accepts a plain-object conditions map (e.g. Record<number,string>)', () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/a.m', new Set([7]))
    // Shape: Map<string, Record<number, string>> is also supported
    const conds = new Map<string, Record<number, string>>()
    conds.set('/p/a.m', { 7: 'x == 0' })
    const rec = makeRecorder()
    const sent = reapplyAllBreakpoints(map, rec.exec, conds)
    expect(sent).toEqual([`dbstop in "a" at 7 if 'x == 0'`])
  })

  it('survives a throwing executor and still records the full command list', () => {
    const map = new Map<string, Set<number>>()
    map.set('/a.m', new Set([1]))
    map.set('/b.m', new Set([2]))
    const throwingExec = (cmd: string): Promise<unknown> => {
      if (cmd.includes('a.m')) throw new Error('boom')
      return Promise.resolve()
    }
    // Should not bubble; both commands should still appear in the return.
    const sent = reapplyAllBreakpoints(map, throwingExec)
    expect(sent).toEqual(['dbstop in "a" at 1', 'dbstop in "b" at 2'])
  })
})

describe('reapplyBreakpointsForFile (US-023 edit-and-continue)', () => {
  it('emits dbclear+dbstop pairs for only the requested file', async () => {
    const map = new Map<string, Set<number>>()
    map.set('/project/a.m', new Set([5, 12]))
    map.set('/project/b.m', new Set([3]))
    const rec = makeRecorder()
    const sent = reapplyBreakpointsForFile(map, '/project/a.m', rec.exec)
    // Phase 1 clears ALL lines (sorted), phase 2 stops them back.
    expect(sent).toEqual([
      'dbclear in "a" at 5',
      'dbclear in "a" at 12',
      'dbstop in "a" at 5',
      'dbstop in "a" at 12',
    ])
    await Promise.resolve()
    expect(rec.sent).toEqual(sent)
    // b.m was NOT touched.
    expect(rec.sent.some((c) => c.includes('b.m'))).toBe(false)
  })

  it('preserves conditions on re-apply', () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/foo.m', new Set([2, 7]))
    const conds = new Map<string, Map<number, string>>()
    conds.set('/p/foo.m', new Map([[7, 'i > 10']]))
    const rec = makeRecorder()
    const sent = reapplyBreakpointsForFile(map, '/p/foo.m', rec.exec, conds)
    expect(sent).toEqual([
      'dbclear in "foo" at 2',
      'dbclear in "foo" at 7',
      'dbstop in "foo" at 2',
      `dbstop in "foo" at 7 if 'i > 10'`,
    ])
  })

  it('returns an empty list for unknown / no-breakpoint files', () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/a.m', new Set([1]))
    const rec = makeRecorder()
    expect(reapplyBreakpointsForFile(map, '/p/other.m', rec.exec)).toEqual([])
    expect(rec.sent).toEqual([])
  })

  it('returns an empty list for null/empty paths and for unsaved tabs', () => {
    const map = new Map<string, Set<number>>()
    map.set(UNSAVED_BUCKET, new Set([1, 2]))
    const rec = makeRecorder()
    expect(reapplyBreakpointsForFile(map, null, rec.exec)).toEqual([])
    expect(reapplyBreakpointsForFile(map, '', rec.exec)).toEqual([])
    // An unsaved tab would map into UNSAVED_BUCKET, not a real file path —
    // callers pass the tab's filePath so this branch is only reachable via
    // an empty/null path, covered above. But we also guarantee the bridge
    // never tries to address UNSAVED_BUCKET as a real file.
    expect(rec.sent).toEqual([])
  })

  it('survives a throwing executor and still returns the command list', () => {
    const map = new Map<string, Set<number>>()
    map.set('/p/a.m', new Set([1, 2]))
    const throwingExec = (cmd: string): Promise<unknown> => {
      if (cmd.includes('dbclear') && cmd.includes('at 1')) {
        throw new Error('boom')
      }
      return Promise.resolve()
    }
    const sent = reapplyBreakpointsForFile(map, '/p/a.m', throwingExec)
    expect(sent).toEqual([
      'dbclear in "a" at 1',
      'dbclear in "a" at 2',
      'dbstop in "a" at 1',
      'dbstop in "a" at 2',
    ])
  })
})
