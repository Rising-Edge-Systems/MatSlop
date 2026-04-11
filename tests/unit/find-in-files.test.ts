import { describe, expect, it } from 'vitest'
import {
  buildSearchRegex,
  globToRegExp,
  matchesGlob,
  searchFileText,
  truncateContext,
} from '../../src/renderer/editor/findInFiles'

describe('globToRegExp', () => {
  it('matches a single extension glob', () => {
    const re = globToRegExp('*.m')
    expect(re.test('foo.m')).toBe(true)
    expect(re.test('foo.mls')).toBe(false)
    expect(re.test('a/foo.m')).toBe(false) // glob is filename-only
  })
  it('supports {a,b} alternation', () => {
    const re = globToRegExp('*.{m,mls}')
    expect(re.test('x.m')).toBe(true)
    expect(re.test('x.mls')).toBe(true)
    expect(re.test('x.txt')).toBe(false)
  })
  it('supports ? for single char', () => {
    const re = globToRegExp('a?.m')
    expect(re.test('ab.m')).toBe(true)
    expect(re.test('abc.m')).toBe(false)
  })
})

describe('matchesGlob', () => {
  it('empty pattern matches everything', () => {
    expect(matchesGlob('foo.m', '')).toBe(true)
    expect(matchesGlob('foo.m', '   ')).toBe(true)
  })
  it('comma separated patterns OR together', () => {
    expect(matchesGlob('foo.m', '*.m,*.mls')).toBe(true)
    expect(matchesGlob('foo.mls', '*.m,*.mls')).toBe(true)
    expect(matchesGlob('foo.txt', '*.m,*.mls')).toBe(false)
  })
})

describe('buildSearchRegex', () => {
  it('returns null for empty query', () => {
    expect(buildSearchRegex('')).toBeNull()
  })
  it('escapes literal regex metachars by default', () => {
    const re = buildSearchRegex('a.b')
    expect(re).not.toBeNull()
    expect(re!.test('a.b')).toBe(true)
    expect(re!.test('axb')).toBe(false)
  })
  it('honors regex mode', () => {
    const re = buildSearchRegex('a.b', { regex: true })
    expect(re!.test('axb')).toBe(true)
  })
  it('returns null for invalid regex', () => {
    expect(buildSearchRegex('a[', { regex: true })).toBeNull()
  })
  it('wholeWord wraps with \\b', () => {
    const re = buildSearchRegex('foo', { wholeWord: true })
    expect(re!.test('foo bar')).toBe(true)
    expect(re!.test('foobar')).toBe(false)
  })
  it('caseInsensitive flag', () => {
    const re = buildSearchRegex('FOO', { caseInsensitive: true })
    expect(re!.test('foo')).toBe(true)
  })
})

describe('searchFileText', () => {
  const content = [
    'function y = add(a, b)',
    '  y = a + b;  % add two numbers',
    'endfunction',
    '',
    'x = add(1, 2);',
  ].join('\n')

  it('finds one match per line with 1-based line and column', () => {
    const results = searchFileText('/tmp/a.m', content, 'add')
    expect(results.map((r) => r.line)).toEqual([1, 2, 5])
    expect(results[0].column).toBeGreaterThan(0)
    expect(results[0].text).toBe('function y = add(a, b)')
    expect(results[0].file).toBe('/tmp/a.m')
  })

  it('returns empty for no-match', () => {
    expect(searchFileText('/tmp/a.m', content, 'zzz')).toEqual([])
  })

  it('handles \\r\\n line endings', () => {
    const crlf = 'abc\r\nxyz add\r\nok'
    const r = searchFileText('/tmp/f', crlf, 'add')
    expect(r).toHaveLength(1)
    expect(r[0].line).toBe(2)
  })

  it('respects maxPerFile cap', () => {
    const spam = 'foo\n'.repeat(1000)
    const r = searchFileText('/tmp/s', spam, 'foo', { maxPerFile: 3 })
    expect(r).toHaveLength(3)
  })

  it('case-insensitive', () => {
    const r = searchFileText('/tmp/a.m', content, 'ADD', { caseInsensitive: true })
    expect(r).toHaveLength(3)
  })
})

describe('truncateContext', () => {
  it('returns full string when short', () => {
    expect(truncateContext('hello', 10)).toBe('hello')
  })
  it('truncates with ellipsis when long', () => {
    expect(truncateContext('x'.repeat(20), 5)).toBe('xxxxx…')
  })
})
