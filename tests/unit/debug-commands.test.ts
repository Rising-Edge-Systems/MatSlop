import { describe, expect, it } from 'vitest'
import {
  debugActionToOctaveCommand,
  matchDebugShortcut,
  type DebugAction,
  type DebugKeyEventLike,
} from '../../src/renderer/editor/debugCommands'

describe('debugActionToOctaveCommand', () => {
  const cases: Array<[DebugAction, string]> = [
    ['continue', 'dbcont'],
    ['stepOver', 'dbstep'],
    ['stepIn', 'dbstep in'],
    ['stepOut', 'dbstep out'],
    ['stop', 'dbquit'],
  ]
  for (const [action, cmd] of cases) {
    it(`${action} -> ${cmd}`, () => {
      expect(debugActionToOctaveCommand(action)).toBe(cmd)
    })
  }
})

describe('matchDebugShortcut', () => {
  const ev = (over: Partial<DebugKeyEventLike>): DebugKeyEventLike => ({
    key: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  })

  it('F5 -> continue', () => {
    expect(matchDebugShortcut(ev({ key: 'F5' }))).toBe('continue')
  })
  it('Shift+F5 -> stop', () => {
    expect(matchDebugShortcut(ev({ key: 'F5', shiftKey: true }))).toBe('stop')
  })
  it('F10 -> stepOver', () => {
    expect(matchDebugShortcut(ev({ key: 'F10' }))).toBe('stepOver')
  })
  it('F11 -> stepIn', () => {
    expect(matchDebugShortcut(ev({ key: 'F11' }))).toBe('stepIn')
  })
  it('Shift+F11 -> stepOut', () => {
    expect(matchDebugShortcut(ev({ key: 'F11', shiftKey: true }))).toBe('stepOut')
  })
  it('unrelated keys return null', () => {
    expect(matchDebugShortcut(ev({ key: 'Enter' }))).toBeNull()
    expect(matchDebugShortcut(ev({ key: 'F6' }))).toBeNull()
    expect(matchDebugShortcut(ev({ key: 'F12' }))).toBeNull()
  })
  it('does not fire when Ctrl/Meta/Alt are held', () => {
    expect(matchDebugShortcut(ev({ key: 'F5', ctrlKey: true }))).toBeNull()
    expect(matchDebugShortcut(ev({ key: 'F5', metaKey: true }))).toBeNull()
    expect(matchDebugShortcut(ev({ key: 'F10', altKey: true }))).toBeNull()
  })
})
