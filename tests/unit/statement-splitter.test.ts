import { describe, it, expect } from 'vitest'
import { splitStatements } from '../../src/renderer/editor/editorTypes'

describe('splitStatements', () => {
  it('splits simple one-per-line statements', () => {
    const code = `a = 1;\nb = 2;\nc = a + b;`
    const result = splitStatements(code)
    expect(result.length).toBe(3)
    expect(result[0]).toMatchObject({ code: 'a = 1;', startLine: 1, lineCount: 1 })
    expect(result[1]).toMatchObject({ code: 'b = 2;', startLine: 2, lineCount: 1 })
    expect(result[2]).toMatchObject({ code: 'c = a + b;', startLine: 3, lineCount: 1 })
  })

  it('keeps function blocks together', () => {
    const code = `function y = sq(x)\n  y = x * x;\nendfunction`
    const result = splitStatements(code)
    expect(result.length).toBe(1)
    expect(result[0].lineCount).toBe(3)
    expect(result[0].code).toContain('endfunction')
  })

  it('keeps function with generic end together', () => {
    const code = `function y = sq(x)\n  y = x * x;\nend`
    const result = splitStatements(code)
    expect(result.length).toBe(1)
    expect(result[0].lineCount).toBe(3)
  })

  it('keeps for loops together', () => {
    const code = `for i = 1:10\n  disp(i);\nend`
    const result = splitStatements(code)
    expect(result.length).toBe(1)
  })

  it('keeps nested blocks together', () => {
    const code = `for i = 1:3\n  if i > 1\n    disp(i);\n  end\nend`
    const result = splitStatements(code)
    expect(result.length).toBe(1)
    expect(result[0].lineCount).toBe(5)
  })

  it('handles multiple separate plot calls', () => {
    const code = `x = 1:10;\nplot(x);\nplot(x.^2);\nplot(x.^3);`
    const result = splitStatements(code)
    expect(result.length).toBe(4)
    expect(result[1].code).toBe('plot(x);')
    expect(result[2].code).toBe('plot(x.^2);')
    expect(result[3].code).toBe('plot(x.^3);')
  })

  it('handles line continuations', () => {
    const code = `a = 1 + 2 + ...\n    3 + 4;\nb = 5;`
    const result = splitStatements(code)
    expect(result.length).toBe(2)
    expect(result[0].lineCount).toBe(2)
    expect(result[1].code).toBe('b = 5;')
  })

  it('ignores keywords inside strings', () => {
    const code = `msg = 'end of file';\nx = 1;`
    const result = splitStatements(code)
    expect(result.length).toBe(2)
  })

  it('ignores keywords in comments', () => {
    const code = `x = 1; % this ends the line\ny = 2;`
    const result = splitStatements(code)
    expect(result.length).toBe(2)
  })

  it('skips blank lines between statements', () => {
    const code = `a = 1;\n\n\nb = 2;`
    const result = splitStatements(code)
    expect(result.length).toBe(2)
    expect(result[1].startLine).toBe(4)
  })

  it('handles empty input', () => {
    expect(splitStatements('')).toEqual([])
    expect(splitStatements('\n\n\n')).toEqual([])
  })

  it('handles do-until blocks', () => {
    const code = `i = 0;\ndo\n  i = i + 1;\nuntil i >= 5`
    const result = splitStatements(code)
    expect(result.length).toBe(2)
    // do-until spans 3 lines (do, body, until)
    expect(result[1].lineCount).toBe(3)
    expect(result[1].code).toContain('until')
  })

  it('handles try-catch blocks', () => {
    const code = `try\n  x = 1 / 0;\ncatch err\n  disp(err.message);\nend`
    const result = splitStatements(code)
    expect(result.length).toBe(1)
  })
})
