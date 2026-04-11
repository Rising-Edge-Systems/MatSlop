import { describe, it, expect } from 'vitest'
import { parsePausedMarker } from '../../src/main/debugBridge'

/**
 * US-016: unit tests for the Octave debug-pause marker parser.
 *
 * `parsePausedMarker` is a pure string→(file,line) helper; these tests pin
 * the shapes we know Octave emits and guard against regressions in the
 * OctaveProcessManager wiring.
 */

describe('parsePausedMarker', () => {
  it('parses the canonical "stopped in <file> at line N" form', () => {
    expect(parsePausedMarker('stopped in /home/me/proj/myfunc.m at line 12')).toEqual({
      file: '/home/me/proj/myfunc.m',
      line: 12,
    })
  })

  it('parses a Windows-style absolute path', () => {
    expect(parsePausedMarker('stopped in C:\\work\\alpha.m at line 3')).toEqual({
      file: 'C:\\work\\alpha.m',
      line: 3,
    })
  })

  it('parses a bare function name (no .m extension)', () => {
    expect(parsePausedMarker('stopped in myfunc at line 5')).toEqual({
      file: 'myfunc',
      line: 5,
    })
  })

  it('is case-insensitive on the marker', () => {
    expect(parsePausedMarker('Stopped In foo.m At Line 7')).toEqual({
      file: 'foo.m',
      line: 7,
    })
  })

  it('parses the secondary "stopped at <func>, line N" form', () => {
    expect(parsePausedMarker('stopped at myfunc, line 9')).toEqual({
      file: 'myfunc',
      line: 9,
    })
  })

  it('parses the "stopped at <func>: line N" variant', () => {
    expect(parsePausedMarker('stopped at myfunc: line 11')).toEqual({
      file: 'myfunc',
      line: 11,
    })
  })

  it('extracts the first marker when multiple lines are present', () => {
    const text = 'some noise\nstopped in a.m at line 3\nstopped in b.m at line 7\n'
    expect(parsePausedMarker(text)).toEqual({ file: 'a.m', line: 3 })
  })

  it('returns null when no marker is present', () => {
    expect(parsePausedMarker('nothing interesting here')).toBeNull()
    expect(parsePausedMarker('')).toBeNull()
  })

  it('rejects markers with a zero or negative line number', () => {
    expect(parsePausedMarker('stopped in foo.m at line 0')).toBeNull()
  })

  it('ignores the "line" word without a number following it', () => {
    // The regex requires a positive integer; anything else is just noise.
    expect(parsePausedMarker('stopped in foo.m at line abc')).toBeNull()
  })

  it('handles embedded spaces in the file token (greedy stops at " at line")', () => {
    expect(
      parsePausedMarker('stopped in /tmp/with space/name.m at line 4'),
    ).toEqual({ file: '/tmp/with space/name.m', line: 4 })
  })
})
