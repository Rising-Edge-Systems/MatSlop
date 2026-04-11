/**
 * US-017: Debug toolbar actions.
 *
 * Pure mapping from UI debug actions to the Octave debugger commands they
 * translate into. Kept in its own module so it's unit-testable in node
 * without pulling in React or IPC.
 */

export type DebugAction = 'continue' | 'stepOver' | 'stepIn' | 'stepOut' | 'stop'

/**
 * Return the exact Octave command string that should be sent when the user
 * invokes a debug action. These are the canonical `dbcont` / `dbstep` /
 * `dbstep in` / `dbstep out` / `dbquit` commands documented by GNU Octave.
 */
export function debugActionToOctaveCommand(action: DebugAction): string {
  switch (action) {
    case 'continue':
      return 'dbcont'
    case 'stepOver':
      return 'dbstep'
    case 'stepIn':
      return 'dbstep in'
    case 'stepOut':
      return 'dbstep out'
    case 'stop':
      return 'dbquit'
  }
}

/**
 * Map a keydown event to the debug action it should trigger, or null if the
 * key combination isn't bound. Pure so it can be unit-tested.
 *
 * Bindings (acceptance criteria):
 *   - F5           -> continue
 *   - F10          -> step over
 *   - F11          -> step in
 *   - Shift+F11    -> step out
 *   - Shift+F5     -> stop
 */
export interface DebugKeyEventLike {
  key: string
  shiftKey: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export function matchDebugShortcut(
  e: DebugKeyEventLike,
): DebugAction | null {
  // Modifier safety: all debug shortcuts use only Shift (optionally). Never
  // fire on Ctrl/Alt/Meta combos so we don't collide with e.g. Cmd+F5.
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'F5' && !e.shiftKey) return 'continue'
  if (e.key === 'F5' && e.shiftKey) return 'stop'
  if (e.key === 'F10' && !e.shiftKey) return 'stepOver'
  if (e.key === 'F11' && !e.shiftKey) return 'stepIn'
  if (e.key === 'F11' && e.shiftKey) return 'stepOut'
  return null
}
