/**
 * US-035: Custom keyboard shortcuts
 *
 * Pure helpers for describing, normalizing, and merging user-customized
 * keyboard shortcut bindings. No React/DOM/Electron imports — unit-testable
 * in a plain node context.
 *
 * A "binding" is the trio of (key, ctrl, shift, alt) that triggers a
 * `ShortcutAction`. The app ships a set of default bindings in
 * `shortcutManager.ts` (SHORTCUT_DEFINITIONS). Users can override any of
 * those bindings via Preferences → Keyboard; overrides are stored as a
 * plain `ShortcutOverrides` object keyed by action name and persisted
 * through the `config:getShortcuts` / `config:setShortcuts` IPC pair.
 */
import { SHORTCUT_DEFINITIONS, type ShortcutAction, type ShortcutDefinition } from './shortcutManager'

/** A key combo that a user has assigned to an action. */
export interface ShortcutBinding {
  key: string // canonical lowercase key (e.g. 'f5', 'enter', 's', '/')
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

/** Map of action → user-assigned binding. Missing entries = use default. */
export type ShortcutOverrides = Partial<Record<ShortcutAction, ShortcutBinding>>

/**
 * Normalize a binding for stable equality/serialization. Lowercases the
 * key and drops false/undefined modifier flags so two "equal" bindings
 * always have the same serialized form.
 */
export function normalizeBinding(b: ShortcutBinding): Required<ShortcutBinding> {
  return {
    key: b.key.toLowerCase(),
    ctrl: Boolean(b.ctrl),
    shift: Boolean(b.shift),
    alt: Boolean(b.alt),
  }
}

/** Canonical serialization of a binding, e.g. "ctrl+shift+s" or "f5". */
export function serializeBinding(b: ShortcutBinding): string {
  const n = normalizeBinding(b)
  const parts: string[] = []
  if (n.ctrl) parts.push('ctrl')
  if (n.alt) parts.push('alt')
  if (n.shift) parts.push('shift')
  parts.push(prettyKey(n.key).toLowerCase())
  return parts.join('+')
}

/**
 * Human-readable binding label (e.g. "Ctrl+Shift+S", "F5", "Ctrl+/").
 * Used in the preferences UI table and tooltip hints.
 */
export function formatBindingLabel(b: ShortcutBinding): string {
  const n = normalizeBinding(b)
  const parts: string[] = []
  if (n.ctrl) parts.push('Ctrl')
  if (n.alt) parts.push('Alt')
  if (n.shift) parts.push('Shift')
  parts.push(prettyKey(n.key))
  return parts.join('+')
}

function prettyKey(lower: string): string {
  if (lower.length === 1) return lower.toUpperCase()
  // Friendly names
  if (lower === 'enter') return 'Enter'
  if (lower === 'escape' || lower === 'esc') return 'Esc'
  if (lower === 'tab') return 'Tab'
  if (lower === 'space' || lower === ' ') return 'Space'
  if (lower === 'arrowup') return '↑'
  if (lower === 'arrowdown') return '↓'
  if (lower === 'arrowleft') return '←'
  if (lower === 'arrowright') return '→'
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase()
  // Fallback: Title-case
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Two bindings are equivalent when their normalized fields match exactly.
 * Used to detect conflicts in the preferences UI.
 */
export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
  const na = normalizeBinding(a)
  const nb = normalizeBinding(b)
  return na.key === nb.key && na.ctrl === nb.ctrl && na.shift === nb.shift && na.alt === nb.alt
}

/** Check if a KeyboardEvent matches a binding. */
export function eventMatchesBinding(e: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}, b: ShortcutBinding): boolean {
  const n = normalizeBinding(b)
  const ctrl = Boolean(e.ctrlKey) || Boolean(e.metaKey)
  if ((n.ctrl ? ctrl : !ctrl) === false) return false
  if ((n.shift ? Boolean(e.shiftKey) : !e.shiftKey) === false) return false
  if ((n.alt ? Boolean(e.altKey) : !e.altKey) === false) return false
  return e.key.toLowerCase() === n.key
}

/**
 * Derive a binding from a raw KeyboardEvent (used by the "Press a key
 * combination..." capture in PreferencesDialog). Returns null for naked
 * modifier keypresses (Ctrl/Shift/Alt/Meta alone).
 */
export function bindingFromKeyboardEvent(e: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): ShortcutBinding | null {
  const k = e.key
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'OS') return null
  if (!k) return null
  return normalizeBinding({
    key: k,
    ctrl: Boolean(e.ctrlKey) || Boolean(e.metaKey),
    shift: Boolean(e.shiftKey),
    alt: Boolean(e.altKey),
  })
}

/** Strip any overrides whose binding is equal to the default for that action. */
export function pruneRedundantOverrides(
  overrides: ShortcutOverrides,
  defaults: ShortcutDefinition[] = SHORTCUT_DEFINITIONS,
): ShortcutOverrides {
  const out: ShortcutOverrides = {}
  for (const [action, binding] of Object.entries(overrides)) {
    if (!binding) continue
    const def = defaults.find((d) => d.action === action)
    if (def && bindingsEqual(binding, defToBinding(def))) continue
    out[action as ShortcutAction] = normalizeBinding(binding)
  }
  return out
}

/** Extract the binding portion of a `ShortcutDefinition`. */
export function defToBinding(def: ShortcutDefinition): ShortcutBinding {
  return { key: def.key, ctrl: def.ctrl, shift: def.shift, alt: def.alt }
}

/**
 * Merge user overrides on top of `SHORTCUT_DEFINITIONS` and return a fresh
 * list of `ShortcutDefinition` objects with updated key/modifiers/label.
 * Never mutates its inputs.
 */
export function applyShortcutOverrides(
  defaults: ShortcutDefinition[],
  overrides: ShortcutOverrides,
): ShortcutDefinition[] {
  return defaults.map((d) => {
    const ov = overrides[d.action]
    if (!ov) return { ...d }
    const n = normalizeBinding(ov)
    return {
      ...d,
      key: n.key,
      ctrl: n.ctrl,
      shift: n.shift,
      alt: n.alt,
      label: formatBindingLabel(n),
    }
  })
}

/**
 * Detect conflicts inside a list of active shortcut definitions.
 * Returns a Map from serialized binding → list of actions that share it.
 * Only entries with 2+ actions are reported.
 */
export function findShortcutConflicts(defs: ShortcutDefinition[]): Map<string, ShortcutAction[]> {
  const buckets = new Map<string, ShortcutAction[]>()
  for (const d of defs) {
    const key = serializeBinding(defToBinding(d))
    const arr = buckets.get(key) ?? []
    arr.push(d.action)
    buckets.set(key, arr)
  }
  const conflicts = new Map<string, ShortcutAction[]>()
  for (const [k, v] of buckets) {
    if (v.length >= 2) conflicts.set(k, v)
  }
  return conflicts
}

/** Convenience: set of actions that currently participate in a conflict. */
export function conflictingActions(defs: ShortcutDefinition[]): Set<ShortcutAction> {
  const out = new Set<ShortcutAction>()
  for (const actions of findShortcutConflicts(defs).values()) {
    for (const a of actions) out.add(a)
  }
  return out
}

/**
 * Runtime-safe parse of an untrusted `ShortcutOverrides` value loaded from
 * electron-store. Unknown keys are dropped and malformed entries are
 * skipped silently. Returns a fresh object.
 */
export function parseStoredOverrides(
  raw: unknown,
  defaults: ShortcutDefinition[] = SHORTCUT_DEFINITIONS,
): ShortcutOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: ShortcutOverrides = {}
  const actionSet = new Set(defaults.map((d) => d.action))
  for (const [action, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!actionSet.has(action as ShortcutAction)) continue
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.key !== 'string' || !v.key) continue
    out[action as ShortcutAction] = normalizeBinding({
      key: v.key,
      ctrl: Boolean(v.ctrl),
      shift: Boolean(v.shift),
      alt: Boolean(v.alt),
    })
  }
  return out
}
