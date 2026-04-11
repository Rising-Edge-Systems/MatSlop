import { describe, it, expect } from 'vitest'
import {
  parseCallStack,
  formatCallStackQuery,
  CALL_STACK_BEGIN,
  CALL_STACK_END,
  CALL_STACK_ROW,
  CALL_STACK_SEP,
} from '../../src/main/callStack'

describe('formatCallStackQuery', () => {
  it('wraps the payload with begin/end markers', () => {
    const cmd = formatCallStackQuery()
    expect(cmd).toContain(`disp('${CALL_STACK_BEGIN}')`)
    expect(cmd).toContain(`disp('${CALL_STACK_END}')`)
  })

  it('references dbstack() and iterates each frame', () => {
    const cmd = formatCallStackQuery()
    expect(cmd).toContain('dbstack()')
    expect(cmd).toContain('for __mslp_csk__=1:length(__mslp_cs__)')
    expect(cmd).toContain(CALL_STACK_ROW)
  })

  it('clears its temporary workspace variables', () => {
    expect(formatCallStackQuery()).toContain('clear __mslp_cs__ __mslp_csk__')
  })
})

describe('parseCallStack', () => {
  function row(name: string, line: number, file: string): string {
    return `${CALL_STACK_ROW}${CALL_STACK_SEP}${name}${CALL_STACK_SEP}${line}${CALL_STACK_SEP}${file}`
  }

  it('returns [] on empty/whitespace input', () => {
    expect(parseCallStack('')).toEqual([])
    expect(parseCallStack('   \n\n')).toEqual([])
  })

  it('parses a single frame row', () => {
    const text = [CALL_STACK_BEGIN, row('myfunc', 7, '/proj/myfunc.m'), CALL_STACK_END].join('\n')
    expect(parseCallStack(text)).toEqual([
      { name: 'myfunc', line: 7, file: '/proj/myfunc.m' },
    ])
  })

  it('preserves frame order: top of stack first', () => {
    const text = [
      CALL_STACK_BEGIN,
      row('inner', 3, '/p/inner.m'),
      row('middle', 12, '/p/middle.m'),
      row('outer', 1, '/p/outer.m'),
      CALL_STACK_END,
    ].join('\n')
    expect(parseCallStack(text)).toEqual([
      { name: 'inner', line: 3, file: '/p/inner.m' },
      { name: 'middle', line: 12, file: '/p/middle.m' },
      { name: 'outer', line: 1, file: '/p/outer.m' },
    ])
  })

  it('ignores non-marker output around the payload', () => {
    const text = [
      'warning: some noise',
      CALL_STACK_BEGIN,
      row('foo', 5, '/x/foo.m'),
      'another noise line',
      row('bar', 9, '/x/bar.m'),
      CALL_STACK_END,
      'debug> ',
    ].join('\n')
    expect(parseCallStack(text)).toEqual([
      { name: 'foo', line: 5, file: '/x/foo.m' },
      { name: 'bar', line: 9, file: '/x/bar.m' },
    ])
  })

  it('drops rows with non-numeric or non-positive line values', () => {
    const text = [
      row('broken', Number.NaN, '/x/b.m'),
      row('zero', 0, '/x/z.m'),
      `${CALL_STACK_ROW}${CALL_STACK_SEP}foo${CALL_STACK_SEP}notanumber${CALL_STACK_SEP}/x/foo.m`,
      row('good', 4, '/x/good.m'),
    ].join('\n')
    expect(parseCallStack(text)).toEqual([
      { name: 'good', line: 4, file: '/x/good.m' },
    ])
  })

  it('handles rows where the file path is empty (top-level script with no file)', () => {
    const text = row('scriptname', 2, '')
    expect(parseCallStack(text)).toEqual([
      { name: 'scriptname', line: 2, file: '' },
    ])
  })

  it('is lossless if the file path (pathologically) contains the separator', () => {
    const weirdFile = `/weird${CALL_STACK_SEP}name.m`
    const r = `${CALL_STACK_ROW}${CALL_STACK_SEP}fn${CALL_STACK_SEP}3${CALL_STACK_SEP}${weirdFile}`
    expect(parseCallStack(r)).toEqual([
      { name: 'fn', line: 3, file: weirdFile },
    ])
  })
})
