/**
 * US-035: Unit tests for the pure custom-shortcuts helpers.
 */
import { describe, it, expect } from 'vitest'
import { SHORTCUT_DEFINITIONS } from '../../src/renderer/shortcuts/shortcutManager'
import {
  applyShortcutOverrides,
  bindingFromKeyboardEvent,
  bindingsEqual,
  conflictingActions,
  defToBinding,
  findShortcutConflicts,
  eventMatchesBinding,
  formatBindingLabel,
  normalizeBinding,
  parseStoredOverrides,
  pruneRedundantOverrides,
  serializeBinding,
} from '../../src/renderer/shortcuts/customShortcuts'

describe('normalizeBinding', () => {
  it('lowercases keys and normalizes modifier flags', () => {
    const n = normalizeBinding({ key: 'S', ctrl: true })
    expect(n).toEqual({ key: 's', ctrl: true, shift: false, alt: false })
  })
  it('accepts all modifiers', () => {
    const n = normalizeBinding({ key: 'F5', ctrl: true, shift: true, alt: true })
    expect(n).toEqual({ key: 'f5', ctrl: true, shift: true, alt: true })
  })
})

describe('bindingsEqual', () => {
  it('treats case-insensitive keys as equal', () => {
    expect(bindingsEqual({ key: 'S', ctrl: true }, { key: 's', ctrl: true })).toBe(true)
  })
  it('distinguishes different modifiers', () => {
    expect(bindingsEqual({ key: 's', ctrl: true }, { key: 's', ctrl: true, shift: true })).toBe(false)
  })
})

describe('serializeBinding / formatBindingLabel', () => {
  it('produces canonical "ctrl+shift+s" style keys', () => {
    expect(serializeBinding({ key: 'S', ctrl: true, shift: true })).toBe('ctrl+shift+s')
  })
  it('formats F5 label', () => {
    expect(formatBindingLabel({ key: 'F5' })).toBe('F5')
    expect(formatBindingLabel({ key: 'F5', shift: true })).toBe('Shift+F5')
  })
  it('formats special keys nicely', () => {
    expect(formatBindingLabel({ key: 'Enter', ctrl: true })).toBe('Ctrl+Enter')
    expect(formatBindingLabel({ key: '/', ctrl: true })).toBe('Ctrl+/')
  })
})

describe('eventMatchesBinding', () => {
  it('matches ctrl+s', () => {
    expect(
      eventMatchesBinding({ key: 's', ctrlKey: true }, { key: 's', ctrl: true }),
    ).toBe(true)
  })
  it('requires all modifiers to match', () => {
    expect(
      eventMatchesBinding({ key: 's', ctrlKey: true, shiftKey: true }, { key: 's', ctrl: true }),
    ).toBe(false)
  })
  it('treats metaKey as ctrl', () => {
    expect(
      eventMatchesBinding({ key: 's', metaKey: true }, { key: 's', ctrl: true }),
    ).toBe(true)
  })
})

describe('bindingFromKeyboardEvent', () => {
  it('rejects naked modifier keys', () => {
    expect(bindingFromKeyboardEvent({ key: 'Control', ctrlKey: true })).toBeNull()
    expect(bindingFromKeyboardEvent({ key: 'Shift', shiftKey: true })).toBeNull()
    expect(bindingFromKeyboardEvent({ key: 'Alt', altKey: true })).toBeNull()
    expect(bindingFromKeyboardEvent({ key: 'Meta', metaKey: true })).toBeNull()
  })
  it('captures ctrl+shift+k', () => {
    const b = bindingFromKeyboardEvent({ key: 'K', ctrlKey: true, shiftKey: true })
    expect(b).toEqual({ key: 'k', ctrl: true, shift: true, alt: false })
  })
})

describe('applyShortcutOverrides', () => {
  it('returns a copy of defaults when no overrides given', () => {
    const out = applyShortcutOverrides(SHORTCUT_DEFINITIONS, {})
    expect(out.length).toBe(SHORTCUT_DEFINITIONS.length)
    expect(out[0]).not.toBe(SHORTCUT_DEFINITIONS[0]) // fresh objects
  })
  it('replaces a single action binding and updates its label', () => {
    const out = applyShortcutOverrides(SHORTCUT_DEFINITIONS, {
      save: { key: 'k', ctrl: true, alt: true },
    })
    const save = out.find((d) => d.action === 'save')!
    expect(save.key).toBe('k')
    expect(save.ctrl).toBe(true)
    expect(save.alt).toBe(true)
    expect(save.label).toBe('Ctrl+Alt+K')
  })
  it('never mutates its inputs', () => {
    const before = JSON.stringify(SHORTCUT_DEFINITIONS)
    applyShortcutOverrides(SHORTCUT_DEFINITIONS, { run: { key: 'F9' } })
    expect(JSON.stringify(SHORTCUT_DEFINITIONS)).toBe(before)
  })
})

describe('findShortcutConflicts / conflictingActions', () => {
  it('detects when two actions share a binding', () => {
    const merged = applyShortcutOverrides(SHORTCUT_DEFINITIONS, {
      // Map "save" onto Ctrl+F which is already "find" — instant conflict.
      save: { key: 'f', ctrl: true },
    })
    const conflicts = findShortcutConflicts(merged)
    expect(conflicts.has('ctrl+f')).toBe(true)
    const actions = conflicts.get('ctrl+f')!
    expect(actions).toContain('save')
    expect(actions).toContain('find')

    const set = conflictingActions(merged)
    expect(set.has('save')).toBe(true)
    expect(set.has('find')).toBe(true)
    // Unrelated actions should not be flagged.
    expect(set.has('run')).toBe(false)
  })
  it('returns no conflicts on the default definition list', () => {
    const conflicts = findShortcutConflicts(SHORTCUT_DEFINITIONS)
    expect(conflicts.size).toBe(0)
  })
})

describe('pruneRedundantOverrides', () => {
  it('removes overrides that equal the default binding', () => {
    const runDef = SHORTCUT_DEFINITIONS.find((d) => d.action === 'run')!
    const pruned = pruneRedundantOverrides(
      { run: defToBinding(runDef), save: { key: 'k', ctrl: true } },
      SHORTCUT_DEFINITIONS,
    )
    expect(pruned.run).toBeUndefined()
    expect(pruned.save).toBeDefined()
  })
})

describe('parseStoredOverrides', () => {
  it('drops unknown actions', () => {
    const out = parseStoredOverrides({
      save: { key: 'k', ctrl: true },
      notARealAction: { key: 'x', ctrl: true },
    })
    expect(out.save).toBeDefined()
    expect((out as Record<string, unknown>).notARealAction).toBeUndefined()
  })
  it('drops malformed values', () => {
    const out = parseStoredOverrides({
      save: null,
      find: 'broken',
      run: { key: '', ctrl: true },
      goToLine: { key: 'l', ctrl: true },
    })
    expect(out.save).toBeUndefined()
    expect(out.find).toBeUndefined()
    expect(out.run).toBeUndefined()
    expect(out.goToLine).toEqual({ key: 'l', ctrl: true, shift: false, alt: false })
  })
  it('returns empty object for non-object input', () => {
    expect(parseStoredOverrides(null)).toEqual({})
    expect(parseStoredOverrides(undefined)).toEqual({})
    expect(parseStoredOverrides('x')).toEqual({})
  })
})
