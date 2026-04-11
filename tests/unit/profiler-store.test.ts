import { describe, it, expect } from 'vitest'
import {
  buildProfileStartCommand,
  buildProfileStopCommand,
  buildProfileReportCommand,
  parseProfileReport,
  sortProfileEntries,
  buildWhichCommand,
  parseWhichOutput,
  formatProfileTime,
  type ProfilerEntry,
} from '../../src/renderer/editor/profilerStore'

describe('buildProfileStartCommand / buildProfileStopCommand', () => {
  it('returns the literal Octave commands', () => {
    expect(buildProfileStartCommand()).toBe('profile on')
    expect(buildProfileStopCommand()).toBe('profile off')
  })
})

describe('buildProfileReportCommand', () => {
  it('builds a safe printf loop that emits __MSLP_PROF__ markers', () => {
    const cmd = buildProfileReportCommand()
    expect(cmd).toContain('profile("info")')
    expect(cmd).toContain('FunctionTable')
    expect(cmd).toContain('__MSLP_PROF__')
    expect(cmd).toContain('__MSLP_PROF_ERR__')
    expect(cmd).toContain('try;')
    expect(cmd).toContain('end_try_catch')
    // Must clear temp vars so the workspace stays clean.
    expect(cmd).toContain('clear __mslp_info __mslp_f __mslp_i __mslp_err')
  })
})

describe('parseProfileReport', () => {
  it('parses one row per __MSLP_PROF__ line', () => {
    const raw = [
      '__MSLP_PROF__|main|0.123456|1',
      '__MSLP_PROF__|inner_loop|0.100000|100',
      '__MSLP_PROF__|plot|0.050000|5',
    ].join('\n')
    const result = parseProfileReport(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([
      { functionName: 'main', totalTime: 0.123456, numCalls: 1 },
      { functionName: 'inner_loop', totalTime: 0.1, numCalls: 100 },
      { functionName: 'plot', totalTime: 0.05, numCalls: 5 },
    ])
  })

  it('returns an empty list when no marker lines are present', () => {
    const result = parseProfileReport('some unrelated text\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([])
  })

  it('handles an empty / null raw string', () => {
    expect(parseProfileReport('')).toEqual({ ok: true, entries: [] })
    expect(parseProfileReport(null as unknown as string)).toEqual({
      ok: true,
      entries: [],
    })
  })

  it('surfaces a __MSLP_PROF_ERR__ marker as an error', () => {
    const raw = '__MSLP_PROF_ERR__:profiler was not started\n'
    const result = parseProfileReport(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('profiler was not started')
  })

  it('ignores malformed rows (bad numbers, missing fields)', () => {
    const raw = [
      '__MSLP_PROF__|bad|not-a-number|3',
      '__MSLP_PROF__|missing-fields',
      '__MSLP_PROF__|good|1.5|2',
    ].join('\n')
    const result = parseProfileReport(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toEqual({
      functionName: 'good',
      totalTime: 1.5,
      numCalls: 2,
    })
  })

  it('ignores leading prompt noise on the same line', () => {
    const raw = '>> __MSLP_PROF__|fn|0.01|3\n'
    const result = parseProfileReport(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toEqual([
      { functionName: 'fn', totalTime: 0.01, numCalls: 3 },
    ])
  })

  it('handles CRLF line endings', () => {
    const raw = '__MSLP_PROF__|fn|0.01|3\r\n__MSLP_PROF__|gn|0.02|4\r\n'
    const result = parseProfileReport(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toHaveLength(2)
  })
})

describe('sortProfileEntries', () => {
  const sample: ProfilerEntry[] = [
    { functionName: 'beta', totalTime: 0.2, numCalls: 10 },
    { functionName: 'alpha', totalTime: 0.5, numCalls: 1 },
    { functionName: 'gamma', totalTime: 0.2, numCalls: 100 },
  ]

  it('sorts by totalTime descending by default', () => {
    const sorted = sortProfileEntries(sample)
    expect(sorted.map((e) => e.functionName)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('sorts by numCalls descending', () => {
    const sorted = sortProfileEntries(sample, 'numCalls', 'desc')
    expect(sorted[0].functionName).toBe('gamma')
  })

  it('sorts by functionName ascending', () => {
    const sorted = sortProfileEntries(sample, 'functionName', 'asc')
    expect(sorted.map((e) => e.functionName)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('is a pure function (does not mutate input)', () => {
    const before = [...sample]
    sortProfileEntries(sample, 'numCalls', 'desc')
    expect(sample).toEqual(before)
  })
})

describe('buildWhichCommand / parseWhichOutput', () => {
  it('builds a which() wrapper that marks output with __MSLP_WHICH__', () => {
    const cmd = buildWhichCommand('plot')
    expect(cmd).toContain("which('plot')")
    expect(cmd).toContain('__MSLP_WHICH__')
    expect(cmd).toContain('end_try_catch')
  })

  it('escapes embedded single quotes', () => {
    const cmd = buildWhichCommand("it's bad")
    expect(cmd).toContain("which('it''s bad')")
  })

  it('parses a path out of the marker line', () => {
    expect(parseWhichOutput('__MSLP_WHICH__:/usr/share/octave/plot.m\n')).toBe(
      '/usr/share/octave/plot.m',
    )
  })

  it('returns null for an empty path (built-in)', () => {
    expect(parseWhichOutput('__MSLP_WHICH__:\n')).toBeNull()
  })

  it('returns null when no marker present', () => {
    expect(parseWhichOutput('random output')).toBeNull()
    expect(parseWhichOutput('')).toBeNull()
  })
})

describe('formatProfileTime', () => {
  it('formats seconds above 1s with 3 decimals', () => {
    expect(formatProfileTime(1.23456)).toBe('1.235 s')
    expect(formatProfileTime(12)).toBe('12.000 s')
  })

  it('formats ms-scale values as ms', () => {
    expect(formatProfileTime(0.012)).toBe('12.00 ms')
    expect(formatProfileTime(0.999)).toBe('999.00 ms')
  })

  it('formats sub-ms values as microseconds', () => {
    expect(formatProfileTime(0.0001)).toBe('100 µs')
  })

  it('handles zero and negatives defensively', () => {
    expect(formatProfileTime(0)).toBe('0 s')
    expect(formatProfileTime(-1)).toBe('—')
    expect(formatProfileTime(Number.NaN)).toBe('—')
  })
})
