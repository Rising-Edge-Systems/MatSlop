import { describe, it, expect } from 'vitest'
import { parseWhosOutput } from '../../src/renderer/panels/WorkspacePanel'

describe('parseWhosOutput', () => {
  it('parses a single scalar variable', () => {
    const output = `Variables visible from the current scope:

variables in scope: top scope

  Attr   Name              Size                     Bytes  Class
  ====   ====              ====                     =====  =====
         wspace_var_1      1x1                          8  double

Total is 1 element using 8 bytes`
    const vars = parseWhosOutput(output)
    expect(vars.length).toBe(1)
    expect(vars[0].name).toBe('wspace_var_1')
    expect(vars[0].size).toBe('1x1')
    expect(vars[0].class).toBe('double')
  })

  it('parses multiple variables', () => {
    const output = `  Attr   Name              Size                     Bytes  Class
  ====   ====              ====                     =====  =====
         a                 1x1                          8  double
         b                 1x3                         24  double
         c                 1x5                          5  char

Total is 9 elements using 37 bytes`
    const vars = parseWhosOutput(output)
    expect(vars.length).toBe(3)
    expect(vars.map((v) => v.name).sort()).toEqual(['a', 'b', 'c'])
    const b = vars.find((v) => v.name === 'b')!
    expect(b.size).toBe('1x3')
    expect(b.class).toBe('double')
  })

  it('parses a matrix variable', () => {
    const output = `  Attr   Name        Size                     Bytes  Class
  ====   ====        ====                     =====  =====
         M           3x3                         72  double

Total is 9 elements using 72 bytes`
    const vars = parseWhosOutput(output)
    expect(vars.length).toBe(1)
    expect(vars[0].size).toBe('3x3')
  })

  it('returns empty array on no variables', () => {
    expect(parseWhosOutput('')).toEqual([])
  })

  it('returns empty when whos reports no variables', () => {
    const output = `variables in scope: top scope
`
    expect(parseWhosOutput(output)).toEqual([])
  })
})
