import { useEffect, useRef } from 'react'

/**
 * Shape of a menu action forwarded from the main process via App.tsx.
 * The `id` field is an incrementing counter that prevents duplicate processing.
 */
export interface MenuActionPayload {
  action: string
  id: number
}

/**
 * Map of menu action strings to handler functions.
 * Handlers may be sync or async — the hook awaits async ones before
 * calling onMenuActionConsumed.
 */
export type MenuActionMap = Record<string, (() => void | Promise<void>) | undefined>

interface UseMenuActionsOptions {
  /** The current menu action from the parent (or null/undefined if none). */
  menuAction: MenuActionPayload | null | undefined
  /** Called after a menu action has been dispatched (or ignored). */
  onMenuActionConsumed: (() => void) | undefined
  /**
   * Map of action name → handler.
   *
   * For prefix-based actions like `recentFile:/path/to/file.m`, register
   * the prefix with trailing colon as the key (e.g. `'recentFile:'`).
   * The hook first tries an exact match, then falls back to prefix matching.
   */
  actions: MenuActionMap
}

/**
 * Resolve a handler from the action map. Tries exact match first, then
 * checks if the action starts with any registered prefix key (keys ending
 * with `:`).
 */
function resolveHandler(
  actions: MenuActionMap,
  actionName: string,
): (() => void | Promise<void>) | undefined {
  // Exact match
  const exact = actions[actionName]
  if (exact) return exact

  // Prefix match — look for keys that end with ':' and match the action start
  for (const key of Object.keys(actions)) {
    if (key.endsWith(':') && actionName.startsWith(key)) {
      return actions[key]
    }
  }

  return undefined
}

/**
 * Hook that processes menu actions forwarded from the main process.
 *
 * Tracks the last-processed action ID via a ref to prevent duplicate
 * processing when the same menuAction prop is seen across re-renders.
 */
export function useMenuActions({
  menuAction,
  onMenuActionConsumed,
  actions,
}: UseMenuActionsOptions): void {
  const lastMenuActionIdRef = useRef(0)
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (!menuAction || menuAction.id <= lastMenuActionIdRef.current) return
    lastMenuActionIdRef.current = menuAction.id

    const handler = resolveHandler(actionsRef.current, menuAction.action)
    if (handler) {
      const result = handler()
      if (result && typeof result.then === 'function') {
        result.then(() => onMenuActionConsumed?.())
      } else {
        onMenuActionConsumed?.()
      }
    } else {
      // Unknown/unhandled action — consume it so the queue isn't blocked
      onMenuActionConsumed?.()
    }
  }, [menuAction, onMenuActionConsumed])
}
