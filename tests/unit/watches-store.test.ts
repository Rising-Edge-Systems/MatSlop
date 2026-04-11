import { describe, it, expect, beforeEach } from 'vitest'
import {
  addWatch,
  removeWatch,
  updateWatchExpression,
  setWatchValue,
  setWatchError,
  clearWatchValues,
  formatWatchValue,
  buildWatchCommand,
  parseWatchOutput,
  createWatch,
  __resetWatchIdsForTests,
  type WatchEntry,
} from '../../src/renderer/editor/watchesStore'

describe('watchesStore', () => {
  beforeEach(() => {
    __resetWatchIdsForTests()
  })

  it('createWatch assigns monotonic ids', () => {
    const a = createWatch('x')
    const b = createWatch('y')
    expect(a.id).toBe('watch-1')
    expect(b.id).toBe('watch-2')
    expect(a.value).toBeNull()
    expect(a.error).toBeNull()
    expect(a.expression).toBe('x')
  })

  it('addWatch appends trimmed expressions and ignores blanks', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, '  x ')
    list = addWatch(list, 'y')
    list = addWatch(list, '   ')
    expect(list).toHaveLength(2)
    expect(list[0].expression).toBe('x')
    expect(list[1].expression).toBe('y')
  })

  it('addWatch does not mutate the input list', () => {
    const original: WatchEntry[] = []
    const next = addWatch(original, 'x')
    expect(original).toHaveLength(0)
    expect(next).toHaveLength(1)
  })

  it('removeWatch filters by id', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    list = addWatch(list, 'y')
    const toRemove = list[0].id
    const next = removeWatch(list, toRemove)
    expect(next).toHaveLength(1)
    expect(next[0].expression).toBe('y')
  })

  it('updateWatchExpression rewrites and clears stale value/error', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    list = setWatchValue(list, list[0].id, '42')
    list = updateWatchExpression(list, list[0].id, 'y+1')
    expect(list[0].expression).toBe('y+1')
    expect(list[0].value).toBeNull()
    expect(list[0].error).toBeNull()
  })

  it('updateWatchExpression with blank text removes the row', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    const id = list[0].id
    list = updateWatchExpression(list, id, '   ')
    expect(list).toHaveLength(0)
  })

  it('setWatchValue clears a previous error for the same id', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    const id = list[0].id
    list = setWatchError(list, id, 'undefined')
    list = setWatchValue(list, id, '3')
    expect(list[0].value).toBe('3')
    expect(list[0].error).toBeNull()
  })

  it('setWatchError clears a previous value', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    const id = list[0].id
    list = setWatchValue(list, id, '3')
    list = setWatchError(list, id, 'oops')
    expect(list[0].value).toBeNull()
    expect(list[0].error).toBe('oops')
  })

  it('clearWatchValues drops readings on every row', () => {
    let list: WatchEntry[] = []
    list = addWatch(list, 'x')
    list = addWatch(list, 'y')
    list = setWatchValue(list, list[0].id, '1')
    list = setWatchError(list, list[1].id, 'bad')
    list = clearWatchValues(list)
    expect(list[0].value).toBeNull()
    expect(list[0].error).toBeNull()
    expect(list[1].value).toBeNull()
    expect(list[1].error).toBeNull()
    // expressions preserved
    expect(list.map((w) => w.expression)).toEqual(['x', 'y'])
  })

  describe('formatWatchValue', () => {
    it('collapses disp() multi-line output into one line', () => {
      const raw = 'x =\n\n   42\n\n'
      expect(formatWatchValue(raw)).toBe('x = 42')
    })
    it('strips \\r characters', () => {
      expect(formatWatchValue('a\r\nb\r\n')).toBe('a b')
    })
    it('truncates long output with an ellipsis', () => {
      const out = formatWatchValue('x'.repeat(200), 50)
      expect(out).toHaveLength(50)
      expect(out.endsWith('…')).toBe(true)
    })
    it('returns empty string for null/empty input', () => {
      expect(formatWatchValue('')).toBe('')
      // @ts-expect-error deliberate null for robustness
      expect(formatWatchValue(null)).toBe('')
    })
  })

  describe('buildWatchCommand + parseWatchOutput', () => {
    it('builds a try/catch wrapping disp(expr)', () => {
      const cmd = buildWatchCommand('x')
      expect(cmd).toContain('disp(x)')
      expect(cmd).toContain('try')
      expect(cmd).toContain('catch')
      expect(cmd).toContain('__MSLP_WATCH_ERR__')
    })

    it('parses a successful disp output as ok=true', () => {
      const parsed = parseWatchOutput('x = 42\n')
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value).toBe('x = 42\n')
    })

    it('parses the error marker as ok=false with the Octave message', () => {
      const parsed = parseWatchOutput("__MSLP_WATCH_ERR__:'foo' undefined\n")
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toBe("'foo' undefined")
    })

    it('trims whitespace in the error message', () => {
      const parsed = parseWatchOutput('__MSLP_WATCH_ERR__:   bad thing   \n')
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toBe('bad thing')
    })

    it('returns empty-value ok for blank output', () => {
      const parsed = parseWatchOutput('')
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value).toBe('')
    })
  })
})
