import { useCallback, useEffect } from 'react'
import {
  shortcutManager,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
} from '../shortcuts/shortcutManager'
import {
  applyShortcutOverrides,
  parseStoredOverrides,
} from '../shortcuts/customShortcuts'

/**
 * Hook that registers keyboard shortcuts with the centralized ShortcutManager.
 *
 * Accepts an action map that maps each ShortcutAction to a handler function.
 * On mount, loads any custom shortcut overrides from config and applies them.
 * On unmount, stops the shortcut listener.
 */
export function useEditorShortcuts(
  actionMap: Partial<Record<ShortcutAction, () => void>>,
): void {
  const handler = useCallback(
    (action: ShortcutAction) => {
      const fn = actionMap[action]
      if (fn) fn()
    },
    // The actionMap is expected to contain stable (useCallback) handlers.
    // We intentionally depend on the object reference here; callers should
    // memoise the map if they want to avoid re-registering.
    [actionMap],
  )

  // Register / unregister the global keyboard listener
  useEffect(() => {
    shortcutManager.start(handler)
    return () => shortcutManager.stop()
  }, [handler])

  // Load persisted custom shortcut overrides on mount and push the merged
  // definition list into the ShortcutManager singleton.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = await window.matslop.configGetShortcuts()
        if (cancelled) return
        const overrides = parseStoredOverrides(raw)
        shortcutManager.setActiveDefinitions(
          applyShortcutOverrides(SHORTCUT_DEFINITIONS, overrides),
        )
      } catch {
        // Fall back to defaults
        shortcutManager.setActiveDefinitions([...SHORTCUT_DEFINITIONS])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
}
