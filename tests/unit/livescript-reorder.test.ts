import { describe, it, expect } from 'vitest'
import { reorderCells } from '../../src/renderer/editor/editorTypes'

describe('reorderCells', () => {
  const cells = ['A', 'B', 'C', 'D']

  it('moves a cell up to the top (cell 2 above cell 1)', () => {
    // source index 1 ('B'), drop slot 0 (above 'A')
    expect(reorderCells(cells, 1, 0)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('moves a cell down to the bottom', () => {
    // source index 0 ('A'), drop slot 4 (after last)
    expect(reorderCells(cells, 0, 4)).toEqual(['B', 'C', 'D', 'A'])
  })

  it('moves a cell one slot down', () => {
    // source index 1 ('B'), drop slot 3 (between C and D)
    expect(reorderCells(cells, 1, 3)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('treats dropping into own immediate-above slot as a no-op', () => {
    expect(reorderCells(cells, 2, 2)).toBe(cells)
  })

  it('treats dropping into own immediate-below slot as a no-op', () => {
    expect(reorderCells(cells, 2, 3)).toBe(cells)
  })

  it('rejects out-of-range indices', () => {
    expect(reorderCells(cells, -1, 0)).toBe(cells)
    expect(reorderCells(cells, 0, 5)).toBe(cells)
    expect(reorderCells(cells, 4, 0)).toBe(cells)
  })

  it('does not mutate the input array', () => {
    const input = ['A', 'B', 'C']
    const snapshot = [...input]
    reorderCells(input, 0, 3)
    expect(input).toEqual(snapshot)
  })

  it('preserves outputs/objects by identity (no orphaned results)', () => {
    const objs = [
      { id: 1, out: 'one' },
      { id: 2, out: 'two' },
      { id: 3, out: 'three' },
    ]
    const reordered = reorderCells(objs, 0, 3)
    // The original object instances remain—outputs travel with their cells.
    expect(reordered[2]).toBe(objs[0])
    expect(reordered[0]).toBe(objs[1])
    expect(reordered[1]).toBe(objs[2])
  })
})
