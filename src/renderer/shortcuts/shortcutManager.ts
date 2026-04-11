/**
 * Centralized Shortcut Manager
 *
 * All keyboard shortcuts are defined here to avoid conflicts and provide
 * a single source of truth. Shortcuts are dispatched via a single global
 * keydown listener.
 *
 * Some shortcuts (Ctrl+N, Ctrl+O, Ctrl+S, etc.) are also registered as
 * Electron menu accelerators — those fire menu:action IPC events handled
 * by App.tsx. The shortcuts registered here cover renderer-only actions
 * and provide a fallback for when menu accelerators don't fire (e.g.,
 * when focus is inside Monaco).
 */

export type ShortcutAction =
  | 'run'
  | 'runSection'
  | 'runAndAdvance'
  | 'save'
  | 'saveAs'
  | 'newFile'
  | 'openFile'
  | 'closeTab'
  | 'find'
  | 'findReplace'
  | 'goToLine'
  | 'toggleComment'
  | 'stop'

export interface ShortcutDefinition {
  action: ShortcutAction
  key: string // e.g. 'F5', 's', '/', 'Enter'
  ctrl?: boolean // Ctrl (or Cmd on Mac)
  shift?: boolean
  alt?: boolean
  label: string // Human-readable label for display
  description: string
}

/**
 * All keyboard shortcuts defined in one place.
 * Ctrl means Ctrl on Windows/Linux, Cmd on Mac.
 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Run
  { action: 'run', key: 'F5', label: 'F5', description: 'Run Script' },
  { action: 'runSection', key: 'Enter', ctrl: true, label: 'Ctrl+Enter', description: 'Run Section' },
  { action: 'runAndAdvance', key: 'Enter', ctrl: true, shift: true, label: 'Ctrl+Shift+Enter', description: 'Run Section and Advance' },
  { action: 'stop', key: 'F5', shift: true, label: 'Shift+F5', description: 'Stop Execution' },

  // File operations
  { action: 'newFile', key: 'n', ctrl: true, label: 'Ctrl+N', description: 'New File' },
  { action: 'openFile', key: 'o', ctrl: true, label: 'Ctrl+O', description: 'Open File' },
  { action: 'save', key: 's', ctrl: true, label: 'Ctrl+S', description: 'Save' },
  { action: 'saveAs', key: 's', ctrl: true, shift: true, label: 'Ctrl+Shift+S', description: 'Save As' },
  { action: 'closeTab', key: 'w', ctrl: true, label: 'Ctrl+W', description: 'Close Tab' },

  // Edit / Navigation
  { action: 'find', key: 'f', ctrl: true, label: 'Ctrl+F', description: 'Find' },
  { action: 'findReplace', key: 'h', ctrl: true, label: 'Ctrl+H', description: 'Find & Replace' },
  { action: 'goToLine', key: 'g', ctrl: true, label: 'Ctrl+G', description: 'Go to Line' },
  { action: 'toggleComment', key: '/', ctrl: true, label: 'Ctrl+/', description: 'Toggle Comment' },
]

type ShortcutHandler = (action: ShortcutAction) => void

/**
 * Centralized keyboard shortcut manager.
 * Registers a single global keydown listener and dispatches matched
 * shortcuts to the registered handler.
 */
export class ShortcutManager {
  private handler: ShortcutHandler | null = null
  private boundListener: ((e: KeyboardEvent) => void) | null = null

  /**
   * Start listening for keyboard shortcuts.
   * Only one handler is active at a time.
   */
  start(handler: ShortcutHandler): void {
    this.stop()
    this.handler = handler
    this.boundListener = this.onKeyDown.bind(this)
    window.addEventListener('keydown', this.boundListener)
  }

  /** Stop listening and clean up. */
  stop(): void {
    if (this.boundListener) {
      window.removeEventListener('keydown', this.boundListener)
      this.boundListener = null
    }
    this.handler = null
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.handler) return

    // Don't intercept shortcuts when typing in input/textarea elements
    // (except for specific global shortcuts like F5)
    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

    const ctrl = e.ctrlKey || e.metaKey

    for (const def of SHORTCUT_DEFINITIONS) {
      const ctrlMatch = def.ctrl ? ctrl : !ctrl
      const shiftMatch = def.shift ? e.shiftKey : !e.shiftKey
      const altMatch = def.alt ? e.altKey : !e.altKey
      const keyMatch = e.key.toLowerCase() === def.key.toLowerCase()

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        // Skip most shortcuts when focus is in an input field
        // Allow: F5, Shift+F5 (global run/stop)
        if (isInput && def.ctrl) continue

        e.preventDefault()
        this.handler(def.action)
        return
      }
    }
  }
}

/** Singleton instance */
export const shortcutManager = new ShortcutManager()

/**
 * Get the keyboard shortcut label for a given action.
 * Useful for displaying shortcut hints in tooltips.
 */
export function getShortcutLabel(action: ShortcutAction): string {
  const def = SHORTCUT_DEFINITIONS.find((d) => d.action === action)
  return def?.label ?? ''
}
