import { describe, it, expect } from 'vitest'
import {
  isSectionHeaderLine,
  findSectionHeaderLines,
  findSectionRange,
  findNextSectionAdvanceLine,
} from '../../src/renderer/editor/editorTypes'

describe('isSectionHeaderLine', () => {
  it('detects plain %% headers', () => {
    expect(isSectionHeaderLine('%%')).toBe(true)
    expect(isSectionHeaderLine('%% Title')).toBe(true)
    expect(isSectionHeaderLine('%%Section 1')).toBe(true)
  })

  it('allows leading whitespace', () => {
    expect(isSectionHeaderLine('   %% indented')).toBe(true)
    expect(isSectionHeaderLine('\t%% tabbed')).toBe(true)
  })

  it('rejects single % comments and code', () => {
    expect(isSectionHeaderLine('% regular comment')).toBe(false)
    expect(isSectionHeaderLine('x = 1;')).toBe(false)
    expect(isSectionHeaderLine('')).toBe(false)
    expect(isSectionHeaderLine('   ')).toBe(false)
  })
})

describe('findSectionHeaderLines', () => {
  it('returns an empty list for code with no headers', () => {
    expect(findSectionHeaderLines('x = 1;\ny = 2;')).toEqual([])
  })

  it('returns 1-based line numbers for every header', () => {
    const code = [
      '%% First',       // 1
      'x = 1;',         // 2
      '%% Second',      // 3
      'y = 2;',         // 4
      '',               // 5
      '%% Third',       // 6
      'z = 3;',         // 7
    ].join('\n')
    expect(findSectionHeaderLines(code)).toEqual([1, 3, 6])
  })

  it('handles headers at the very end of the file', () => {
    expect(findSectionHeaderLines('a=1;\n%% tail')).toEqual([2])
  })
})

describe('findSectionRange', () => {
  const code = [
    '%% First',   // 1
    'x = 1;',     // 2
    'y = 2;',     // 3
    '%% Second',  // 4
    'z = 3;',     // 5
    '%% Third',   // 6
    'w = 4;',     // 7
  ].join('\n')

  it('finds the first section when cursor is inside it', () => {
    const range = findSectionRange(code, 2)
    expect(range.headerLine).toBe(1)
    expect(range.contentStartLine).toBe(2)
    expect(range.endLine).toBe(3)
    expect(range.code).toBe('x = 1;\ny = 2;')
  })

  it('finds the middle section', () => {
    const range = findSectionRange(code, 5)
    expect(range.headerLine).toBe(4)
    expect(range.code).toBe('z = 3;')
  })

  it('finds the last section (runs to EOF)', () => {
    const range = findSectionRange(code, 7)
    expect(range.headerLine).toBe(6)
    expect(range.endLine).toBe(7)
    expect(range.code).toBe('w = 4;')
  })

  it('treats the cursor ON a header as the start of that section', () => {
    const range = findSectionRange(code, 4)
    expect(range.headerLine).toBe(4)
    expect(range.code).toBe('z = 3;')
  })

  it('returns the whole file when there are no headers', () => {
    const plain = 'a = 1;\nb = 2;\nc = 3;'
    const range = findSectionRange(plain, 2)
    expect(range.headerLine).toBeNull()
    expect(range.contentStartLine).toBe(1)
    expect(range.endLine).toBe(3)
    expect(range.code).toBe('a = 1;\nb = 2;\nc = 3;')
  })

  it('handles prelude content BEFORE the first header', () => {
    const prelude = [
      '% setup',    // 1
      'pkg load;',  // 2
      '%% main',    // 3
      'x = 1;',     // 4
    ].join('\n')
    const range = findSectionRange(prelude, 2)
    expect(range.headerLine).toBeNull()
    expect(range.contentStartLine).toBe(1)
    expect(range.endLine).toBe(2)
    expect(range.code).toBe('% setup\npkg load;')
  })

  it('returns empty body for an empty section', () => {
    const empty = '%% Only header\n%% Next'
    const range = findSectionRange(empty, 1)
    expect(range.headerLine).toBe(1)
    expect(range.code).toBe('')
  })

  it('clamps out-of-range cursor lines', () => {
    const range = findSectionRange(code, 999)
    expect(range.headerLine).toBe(6)
  })
})

describe('findNextSectionAdvanceLine', () => {
  const code = [
    '%% First',   // 1
    'x = 1;',     // 2
    '%% Second',  // 3
    'y = 2;',     // 4
    '%% Third',   // 5
    'z = 3;',     // 6
  ].join('\n')

  it('advances to the first content line of the next section', () => {
    expect(findNextSectionAdvanceLine(code, 2)).toBe(4) // line after %% Second
    expect(findNextSectionAdvanceLine(code, 4)).toBe(6)
  })

  it('advances when cursor is on the header', () => {
    expect(findNextSectionAdvanceLine(code, 1)).toBe(4)
  })

  it('returns null when already in the last section', () => {
    expect(findNextSectionAdvanceLine(code, 6)).toBeNull()
  })

  it('returns null when the file has no sections', () => {
    expect(findNextSectionAdvanceLine('a=1;\nb=2;', 1)).toBeNull()
  })

  it('clamps advance line to the end of the file', () => {
    // next-section header is on the final line → advance clamps to file end.
    const trailing = 'x=1;\n%% tail'
    expect(findNextSectionAdvanceLine(trailing, 1)).toBe(2)
  })
})
