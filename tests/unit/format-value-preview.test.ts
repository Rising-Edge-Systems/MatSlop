import { describe, it, expect } from 'vitest'
import { formatValuePreview } from '../../src/renderer/panels/WorkspacePanel'

interface V {
  name: string
  size: string
  bytes: number
  class: string
  value: string
}

const mk = (size: string, cls: string): V => ({
  name: 'x',
  size,
  bytes: 0,
  class: cls,
  value: '',
})

describe('formatValuePreview — US-S04', () => {
  describe('scalar numeric', () => {
    it('renders an integer scalar without a trailing decimal', () => {
      expect(formatValuePreview(mk('1x1', 'double'), 'x = 42')).toBe('42')
    })

    it('renders a float scalar with 6 significant digits (pi)', () => {
      expect(formatValuePreview(mk('1x1', 'double'), 'x = 3.14159265358979')).toBe('3.14159')
    })

    it('trims trailing zeros on fixed-form floats', () => {
      expect(formatValuePreview(mk('1x1', 'double'), 'x = 1.5')).toBe('1.5')
    })

    it('renders a very small number in exponential form with trimmed mantissa', () => {
      const out = formatValuePreview(mk('1x1', 'double'), 'x = 0.00001')
      // 1e-5 (mantissa "1.00000" trimmed to "1")
      expect(out).toBe('1e-5')
    })

    it('renders a very large number in exponential form', () => {
      const out = formatValuePreview(mk('1x1', 'double'), 'x = 1234567')
      // 6 sig digits of 1_234_567 → 1.23457e+6
      expect(out).toMatch(/^1\.23457e\+?6$/)
    })

    it('accepts bare numeric output (no "= ")', () => {
      expect(formatValuePreview(mk('1x1', 'double'), '7')).toBe('7')
    })

    it('renders zero as "0"', () => {
      expect(formatValuePreview(mk('1x1', 'double'), '0')).toBe('0')
    })

    it('renders a negative float', () => {
      expect(formatValuePreview(mk('1x1', 'double'), '-2.5')).toBe('-2.5')
    })

    it('passes Inf / NaN through unchanged', () => {
      expect(formatValuePreview(mk('1x1', 'double'), 'x = Inf')).toBe('Inf')
      expect(formatValuePreview(mk('1x1', 'double'), 'x = NaN')).toBe('NaN')
    })

    it('renders a logical scalar as true/false', () => {
      expect(formatValuePreview(mk('1x1', 'logical'), 'x = 1')).toBe('true')
      expect(formatValuePreview(mk('1x1', 'logical'), 'x = 0')).toBe('false')
    })

    it('falls back to [1x1 class] when output is empty', () => {
      expect(formatValuePreview(mk('1x1', 'double'), '')).toBe('[1x1 double]')
    })
  })

  describe('strings', () => {
    it('shows a short char string verbatim', () => {
      expect(formatValuePreview(mk('1x5', 'char'), 'x = hello')).toBe('hello')
    })

    it('truncates a string longer than 20 chars with ellipsis', () => {
      const long = 'abcdefghijklmnopqrstuvwxyz'
      const out = formatValuePreview(mk('1x26', 'char'), `x = ${long}`)
      expect(out).toBe('abcdefghijklmnopqrst...')
      // 20 visible chars + '...'
      expect(out.length).toBe(23)
    })

    it('treats the "string" class the same as "char"', () => {
      expect(formatValuePreview(mk('1x3', 'string'), 'x = hi!')).toBe('hi!')
    })

    it('strips surrounding double quotes if Octave emits them', () => {
      expect(formatValuePreview(mk('1x5', 'char'), 'x = "hello"')).toBe('hello')
    })

    it('falls back to [size class] when output is empty', () => {
      expect(formatValuePreview(mk('1x5', 'char'), '')).toBe('[1x5 char]')
    })
  })

  describe('non-scalars', () => {
    it('renders a 3x3 double matrix as [3x3 double]', () => {
      expect(formatValuePreview(mk('3x3', 'double'), 'anything')).toBe('[3x3 double]')
    })

    it('renders a struct as [1x1 struct]', () => {
      expect(formatValuePreview(mk('1x1', 'struct'), '')).toBe('[1x1 struct]')
    })

    it('renders a cell array as [2x3 cell]', () => {
      expect(formatValuePreview(mk('2x3', 'cell'), '')).toBe('[2x3 cell]')
    })

    it('renders a 10x10 matrix uniformly regardless of output content', () => {
      expect(formatValuePreview(mk('10x10', 'double'), 'x =\n  1 2\n  3 4')).toBe('[10x10 double]')
    })

    it('renders unknown object classes with the class name', () => {
      expect(formatValuePreview(mk('1x1', 'myClass'), '')).toBe('[1x1 myClass]')
    })
  })
})
