import { describe, it, expect } from 'vitest'
import {
  BUILTIN_LAYOUT_PRESETS,
  BUILTIN_PRESET_IDS,
  DEFAULT_PRESET_SIZES,
  DEFAULT_PRESET_VISIBILITY,
  builtinPresetAction,
  customPresetAction,
  deleteCustomPresetAction,
  parseLayoutPresetAction,
  validatePresetName,
  captureLayoutPreset,
  getBuiltinPreset,
} from '../../src/renderer/editor/layoutPresets'

describe('layoutPresets', () => {
  describe('built-in presets', () => {
    it('defines the four required presets', () => {
      expect(BUILTIN_PRESET_IDS).toEqual(['default', 'debugger', 'twoColumn', 'codeOnly'])
      for (const id of BUILTIN_PRESET_IDS) {
        expect(BUILTIN_LAYOUT_PRESETS[id]).toBeDefined()
        expect(BUILTIN_LAYOUT_PRESETS[id].label.length).toBeGreaterThan(0)
      }
    })

    it('default preset matches the MATLAB-like first-launch defaults', () => {
      const def = BUILTIN_LAYOUT_PRESETS.default
      expect(def.visibility).toEqual(DEFAULT_PRESET_VISIBILITY)
      expect(def.sizes).toEqual(DEFAULT_PRESET_SIZES)
      expect(def.dockLayout).toBeUndefined()
    })

    it('code-only preset hides every non-editor panel', () => {
      const p = BUILTIN_LAYOUT_PRESETS.codeOnly
      expect(p.visibility.fileBrowser).toBe(false)
      expect(p.visibility.workspace).toBe(false)
      expect(p.visibility.commandWindow).toBe(false)
      expect(p.visibility.commandHistory).toBe(false)
    })

    it('two-column preset keeps only Command Window alongside the editor', () => {
      const p = BUILTIN_LAYOUT_PRESETS.twoColumn
      expect(p.visibility.commandWindow).toBe(true)
      expect(p.visibility.fileBrowser).toBe(false)
      expect(p.visibility.workspace).toBe(false)
      expect(p.visibility.commandHistory).toBe(false)
    })

    it('debugger preset shows workspace + command history alongside the main layout', () => {
      const p = BUILTIN_LAYOUT_PRESETS.debugger
      expect(p.visibility.fileBrowser).toBe(true)
      expect(p.visibility.workspace).toBe(true)
      expect(p.visibility.commandWindow).toBe(true)
      expect(p.visibility.commandHistory).toBe(true)
    })

    it('getBuiltinPreset returns a fresh copy each call', () => {
      const a = getBuiltinPreset('default')
      const b = getBuiltinPreset('default')
      expect(a).not.toBe(b)
      expect(a.visibility).not.toBe(b.visibility)
      a.visibility.fileBrowser = false
      expect(BUILTIN_LAYOUT_PRESETS.default.visibility.fileBrowser).toBe(true)
    })
  })

  describe('action string helpers', () => {
    it('builtinPresetAction round-trips via parseLayoutPresetAction', () => {
      for (const id of BUILTIN_PRESET_IDS) {
        const action = builtinPresetAction(id)
        expect(action).toBe(`layoutPreset:builtin:${id}`)
        const parsed = parseLayoutPresetAction(action)
        expect(parsed).toEqual({ kind: 'builtin', id })
      }
    })

    it('customPresetAction round-trips via parseLayoutPresetAction', () => {
      const action = customPresetAction('My Layout')
      expect(action).toBe('layoutPreset:custom:My Layout')
      const parsed = parseLayoutPresetAction(action)
      expect(parsed).toEqual({ kind: 'custom', name: 'My Layout' })
    })

    it('deleteCustomPresetAction round-trips via parseLayoutPresetAction', () => {
      const parsed = parseLayoutPresetAction(deleteCustomPresetAction('Foo'))
      expect(parsed).toEqual({ kind: 'delete', name: 'Foo' })
    })

    it('parseLayoutPresetAction rejects unknown built-in ids', () => {
      expect(parseLayoutPresetAction('layoutPreset:builtin:unknown')).toBeNull()
    })

    it('parseLayoutPresetAction rejects non-preset actions', () => {
      expect(parseLayoutPresetAction('resetLayout')).toBeNull()
      expect(parseLayoutPresetAction('toggleFileBrowser')).toBeNull()
      expect(parseLayoutPresetAction('')).toBeNull()
    })

    it('parseLayoutPresetAction rejects empty custom names', () => {
      expect(parseLayoutPresetAction('layoutPreset:custom:')).toBeNull()
      expect(parseLayoutPresetAction('layoutPreset:delete:')).toBeNull()
    })
  })

  describe('validatePresetName', () => {
    it('accepts a reasonable name', () => {
      expect(validatePresetName('My Layout')).toBeNull()
      expect(validatePresetName('Research 1')).toBeNull()
    })

    it('rejects empty / whitespace-only names', () => {
      expect(validatePresetName('')).toMatch(/empty/i)
      expect(validatePresetName('   ')).toMatch(/empty/i)
    })

    it('rejects over-long names', () => {
      expect(validatePresetName('x'.repeat(41))).toMatch(/too long/i)
    })

    it('rejects reserved built-in names (case-insensitive)', () => {
      expect(validatePresetName('Default')).toMatch(/reserved/i)
      expect(validatePresetName('default')).toMatch(/reserved/i)
      expect(validatePresetName('DEBUGGER')).toMatch(/reserved/i)
      expect(validatePresetName('Two-Column')).toMatch(/reserved/i)
      expect(validatePresetName('Code-Only')).toMatch(/reserved/i)
    })

    it('rejects names containing reserved characters', () => {
      expect(validatePresetName('bad:name')).toMatch(/invalid/i)
      expect(validatePresetName('one\ttwo')).toMatch(/invalid/i)
      expect(validatePresetName('line\nbreak')).toMatch(/invalid/i)
    })
  })

  describe('captureLayoutPreset', () => {
    it('captures visibility and sizes by value', () => {
      const vis = { ...DEFAULT_PRESET_VISIBILITY }
      const sizes = { ...DEFAULT_PRESET_SIZES }
      const preset = captureLayoutPreset('Snap', vis, sizes, null)
      vis.fileBrowser = false
      sizes.fileBrowserWidth = 999
      expect(preset.visibility.fileBrowser).toBe(true)
      expect(preset.sizes.fileBrowserWidth).toBe(220)
      expect(preset.label).toBe('Snap')
      expect(preset.dockLayout).toBeUndefined()
    })

    it('includes dockLayout when provided', () => {
      const tree = { dockbox: { mode: 'horizontal', children: [] } }
      const preset = captureLayoutPreset(
        'WithDock',
        DEFAULT_PRESET_VISIBILITY,
        DEFAULT_PRESET_SIZES,
        tree,
      )
      expect(preset.dockLayout).toEqual(tree)
    })

    it('omits dockLayout when null / undefined', () => {
      const p1 = captureLayoutPreset('a', DEFAULT_PRESET_VISIBILITY, DEFAULT_PRESET_SIZES, null)
      const p2 = captureLayoutPreset(
        'b',
        DEFAULT_PRESET_VISIBILITY,
        DEFAULT_PRESET_SIZES,
        undefined,
      )
      expect('dockLayout' in p1).toBe(false)
      expect('dockLayout' in p2).toBe(false)
    })
  })
})
