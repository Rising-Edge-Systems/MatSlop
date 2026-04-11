import { describe, it, expect } from 'vitest'
import {
  parseDimensionString,
  extraDimensionCount,
  buildSliceDispCommand,
  buildCellAssignCommand,
  normalizeNumericInput,
  parseMatrixOutput,
  createEmptyUndoState,
  pushEdit,
  canUndo,
  canRedo,
  undoStep,
  redoStep,
} from '../../src/renderer/dialogs/variableEditorCore'

describe('parseDimensionString', () => {
  it('parses 2D size', () => {
    expect(parseDimensionString('3x4')).toEqual([3, 4])
  })
  it('parses 3D size', () => {
    expect(parseDimensionString('3x4x2')).toEqual([3, 4, 2])
  })
  it('parses 4D size', () => {
    expect(parseDimensionString('2x3x4x5')).toEqual([2, 3, 4, 5])
  })
  it('pads scalar size to [n,1]', () => {
    expect(parseDimensionString('5')).toEqual([5, 1])
  })
  it('defaults to [1,1] for empty input', () => {
    expect(parseDimensionString('')).toEqual([1, 1])
  })
  it('coerces non-positive entries to 1', () => {
    expect(parseDimensionString('0x-3')).toEqual([1, 1])
  })
})

describe('extraDimensionCount', () => {
  it('is 0 for 2D', () => {
    expect(extraDimensionCount([3, 4])).toBe(0)
  })
  it('is 1 for 3D', () => {
    expect(extraDimensionCount([3, 4, 2])).toBe(1)
  })
  it('is 2 for 4D', () => {
    expect(extraDimensionCount([3, 4, 2, 5])).toBe(2)
  })
})

describe('buildSliceDispCommand', () => {
  it('produces plain disp for 2D', () => {
    expect(buildSliceDispCommand('A', [])).toBe('disp(A)')
  })
  it('includes trailing indices for 3D', () => {
    expect(buildSliceDispCommand('A', [2])).toBe('disp(A(:,:,2))')
  })
  it('includes multiple trailing indices for 4D', () => {
    expect(buildSliceDispCommand('A', [2, 3])).toBe('disp(A(:,:,2,3))')
  })
})

describe('buildCellAssignCommand', () => {
  it('2D assignment uses 1-based indices', () => {
    expect(buildCellAssignCommand('A', [], 0, 0, '7')).toBe('A(1,1) = 7;')
  })
  it('3D assignment appends slice index', () => {
    expect(buildCellAssignCommand('A', [2], 1, 2, '9')).toBe('A(2,3,2) = 9;')
  })
  it('4D assignment appends all slice indices', () => {
    expect(buildCellAssignCommand('A', [2, 3], 0, 1, '-1.5')).toBe('A(1,2,2,3) = -1.5;')
  })
})

describe('normalizeNumericInput', () => {
  it('accepts integers', () => {
    expect(normalizeNumericInput('42')).toBe('42')
  })
  it('accepts negatives', () => {
    expect(normalizeNumericInput('-7')).toBe('-7')
  })
  it('accepts decimals', () => {
    expect(normalizeNumericInput('3.14')).toBe('3.14')
  })
  it('accepts exponentials', () => {
    expect(normalizeNumericInput('1.5e-3')).toBe('1.5e-3')
  })
  it('trims whitespace', () => {
    expect(normalizeNumericInput('  5  ')).toBe('5')
  })
  it('rejects empty', () => {
    expect(normalizeNumericInput('')).toBeNull()
  })
  it('rejects letters', () => {
    expect(normalizeNumericInput('abc')).toBeNull()
  })
  it('rejects injection attempts', () => {
    expect(normalizeNumericInput('1; rmdir /')).toBeNull()
  })
})

describe('parseMatrixOutput', () => {
  it('parses a simple 2x3 matrix', () => {
    const out = '   1   2   3\n   4   5   6'
    const data = parseMatrixOutput(out, 2, 3)
    expect(data.values).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })
  it('pads missing rows', () => {
    const data = parseMatrixOutput('1 2', 2, 2)
    expect(data.values.length).toBe(2)
  })
})

describe('undo stack', () => {
  const rec = (v: string) => ({
    sliceIndices: [],
    row: 0,
    col: 0,
    previousValue: '0',
    newValue: v,
  })

  it('starts empty', () => {
    const s = createEmptyUndoState()
    expect(canUndo(s)).toBe(false)
    expect(canRedo(s)).toBe(false)
  })

  it('push records and advances cursor', () => {
    let s = createEmptyUndoState()
    s = pushEdit(s, rec('1'))
    s = pushEdit(s, rec('2'))
    expect(s.history.length).toBe(2)
    expect(s.cursor).toBe(2)
    expect(canUndo(s)).toBe(true)
    expect(canRedo(s)).toBe(false)
  })

  it('undo returns the last record and moves cursor back', () => {
    let s = createEmptyUndoState()
    s = pushEdit(s, rec('1'))
    s = pushEdit(s, rec('2'))
    const u = undoStep(s)!
    expect(u.record.newValue).toBe('2')
    expect(u.next.cursor).toBe(1)
    expect(canRedo(u.next)).toBe(true)
  })

  it('redo replays the undone record', () => {
    let s = createEmptyUndoState()
    s = pushEdit(s, rec('1'))
    s = pushEdit(s, rec('2'))
    const u = undoStep(s)!
    const r = redoStep(u.next)!
    expect(r.record.newValue).toBe('2')
    expect(r.next.cursor).toBe(2)
  })

  it('push after undo trims the redo tail', () => {
    let s = createEmptyUndoState()
    s = pushEdit(s, rec('1'))
    s = pushEdit(s, rec('2'))
    s = pushEdit(s, rec('3'))
    s = undoStep(s)!.next
    s = undoStep(s)!.next
    s = pushEdit(s, rec('99'))
    expect(s.history.length).toBe(2)
    expect(s.history[1].newValue).toBe('99')
    expect(canRedo(s)).toBe(false)
  })

  it('undo at empty returns null', () => {
    expect(undoStep(createEmptyUndoState())).toBeNull()
  })

  it('redo at end returns null', () => {
    let s = createEmptyUndoState()
    s = pushEdit(s, rec('1'))
    expect(redoStep(s)).toBeNull()
  })
})
