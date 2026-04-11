/**
 * US-028: Layout presets.
 *
 * A layout preset captures the user-toggleable panel visibility, the
 * companion panel sizes (Allotment-legacy, still persisted for schema
 * stability), and an optional rc-dock `LayoutBase` tree. Presets come in
 * two flavours:
 *
 * 1. Built-ins (`BUILTIN_LAYOUT_PRESETS`): shipped with the app, appear
 *    in the View → Layouts menu regardless of user state. They never
 *    carry a stored `dockLayout` — the renderer builds a fresh tree from
 *    visibility each time so they always restore a canonical arrangement.
 *
 * 2. Custom presets: user-saved via "Save Current as Preset...". They
 *    live in `electron-store` (main side) and round-trip through the
 *    `layoutPresets:*` IPCs. When applied, the stored `dockLayout` (if
 *    any) is rehydrated so the user's drag-rearranged arrangement comes
 *    back verbatim.
 *
 * This file is PURE (no React, no IPC) so it is unit-testable in node
 * and can be imported from both main and renderer.
 */

export interface LayoutPresetVisibility {
  fileBrowser: boolean
  workspace: boolean
  commandWindow: boolean
  commandHistory: boolean
}

export interface LayoutPresetSizes {
  fileBrowserWidth: number
  workspaceWidth: number
  bottomHeight: number
  commandHistoryWidth: number
}

export interface LayoutPreset {
  /** Human-readable label shown in the View → Layouts menu. */
  label: string
  /** Panel visibility flags (the 4 user-toggleable panels). */
  visibility: LayoutPresetVisibility
  /** Allotment-legacy panel sizes (still persisted). */
  sizes: LayoutPresetSizes
  /**
   * Optional stored rc-dock layout tree. When present, applying the
   * preset feeds it to `<MatslopDockLayout>` via `savedDockLayout` so
   * the user's drag-rearranged arrangement is restored verbatim. When
   * absent, the dock layout is rebuilt from `visibility` (default
   * behaviour). Built-in presets intentionally omit this field.
   */
  dockLayout?: unknown
}

/** Default ("MATLAB-like first launch") visibility + sizes. */
export const DEFAULT_PRESET_VISIBILITY: LayoutPresetVisibility = {
  fileBrowser: true,
  workspace: true,
  commandWindow: true,
  commandHistory: false,
}

export const DEFAULT_PRESET_SIZES: LayoutPresetSizes = {
  fileBrowserWidth: 220,
  workspaceWidth: 280,
  bottomHeight: 200,
  commandHistoryWidth: 250,
}

/** Stable ids for built-in presets (also used as the menu action suffix). */
export type BuiltinPresetId = 'default' | 'debugger' | 'twoColumn' | 'codeOnly'

/**
 * Canonical built-in presets. Order here is the order they appear in the
 * View → Layouts submenu.
 */
export const BUILTIN_LAYOUT_PRESETS: Record<BuiltinPresetId, LayoutPreset> = {
  default: {
    label: 'Default',
    visibility: { ...DEFAULT_PRESET_VISIBILITY },
    sizes: { ...DEFAULT_PRESET_SIZES },
  },
  debugger: {
    label: 'Debugger',
    // Debugger preset keeps File Browser + Workspace visible and brings up
    // the Command Window and History side-by-side at the bottom so the
    // user can see both the live stream and recent commands while paused.
    visibility: {
      fileBrowser: true,
      workspace: true,
      commandWindow: true,
      commandHistory: true,
    },
    sizes: {
      fileBrowserWidth: 200,
      workspaceWidth: 320,
      bottomHeight: 240,
      commandHistoryWidth: 260,
    },
  },
  twoColumn: {
    label: 'Two-Column',
    // Editor on the left, Command Window beneath it, nothing else.
    visibility: {
      fileBrowser: false,
      workspace: false,
      commandWindow: true,
      commandHistory: false,
    },
    sizes: { ...DEFAULT_PRESET_SIZES },
  },
  codeOnly: {
    label: 'Code-Only',
    // Only the editor. Everything else hidden — useful for writing mode.
    visibility: {
      fileBrowser: false,
      workspace: false,
      commandWindow: false,
      commandHistory: false,
    },
    sizes: { ...DEFAULT_PRESET_SIZES },
  },
}

/** List built-in preset ids in menu order. */
export const BUILTIN_PRESET_IDS: BuiltinPresetId[] = [
  'default',
  'debugger',
  'twoColumn',
  'codeOnly',
]

/** Menu-action prefix for a built-in preset. */
export function builtinPresetAction(id: BuiltinPresetId): string {
  return `layoutPreset:builtin:${id}`
}

/** Menu-action prefix for a custom preset. */
export function customPresetAction(name: string): string {
  return `layoutPreset:custom:${name}`
}

/** Menu-action prefix for deleting a custom preset. */
export function deleteCustomPresetAction(name: string): string {
  return `layoutPreset:delete:${name}`
}

/**
 * Parse a menu action and, if it matches the `layoutPreset:*` scheme,
 * return its kind and payload. Returns `null` otherwise.
 *
 * Built-in:  `layoutPreset:builtin:<id>`   -> { kind: 'builtin', id }
 * Custom:    `layoutPreset:custom:<name>`  -> { kind: 'custom',  name }
 * Delete:    `layoutPreset:delete:<name>`  -> { kind: 'delete',  name }
 */
export type ParsedLayoutPresetAction =
  | { kind: 'builtin'; id: BuiltinPresetId }
  | { kind: 'custom'; name: string }
  | { kind: 'delete'; name: string }

export function parseLayoutPresetAction(
  action: string,
): ParsedLayoutPresetAction | null {
  if (!action.startsWith('layoutPreset:')) return null
  const rest = action.slice('layoutPreset:'.length)
  if (rest.startsWith('builtin:')) {
    const id = rest.slice('builtin:'.length) as BuiltinPresetId
    if (BUILTIN_PRESET_IDS.includes(id)) {
      return { kind: 'builtin', id }
    }
    return null
  }
  if (rest.startsWith('custom:')) {
    const name = rest.slice('custom:'.length)
    if (name.length === 0) return null
    return { kind: 'custom', name }
  }
  if (rest.startsWith('delete:')) {
    const name = rest.slice('delete:'.length)
    if (name.length === 0) return null
    return { kind: 'delete', name }
  }
  return null
}

/**
 * Validate a user-supplied preset name. Presets are keyed by name in the
 * store, so we enforce a small character set and length cap. Built-in
 * preset ids are reserved.
 *
 * Returns `null` if valid, or a human-readable error string otherwise.
 */
export function validatePresetName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Name cannot be empty'
  if (trimmed.length > 40) return 'Name is too long (max 40 characters)'
  // Disallow characters that would break the `layoutPreset:custom:<name>`
  // menu-action encoding.
  if (/[:\n\r\t]/.test(trimmed)) return 'Name contains invalid characters'
  // Reserve the built-in labels + ids (case-insensitive) so users can't
  // shadow them.
  const lower = trimmed.toLowerCase()
  for (const id of BUILTIN_PRESET_IDS) {
    if (lower === id.toLowerCase()) return `"${trimmed}" is a reserved name`
    if (lower === BUILTIN_LAYOUT_PRESETS[id].label.toLowerCase()) {
      return `"${trimmed}" is a reserved name`
    }
  }
  return null
}

/**
 * Capture the "current layout" into a `LayoutPreset` ready to be stored.
 * Takes in the live visibility, sizes, and optional dockLayout tree and
 * returns a plain object that can be JSON-encoded and sent over IPC.
 */
export function captureLayoutPreset(
  label: string,
  visibility: LayoutPresetVisibility,
  sizes: LayoutPresetSizes,
  dockLayout: unknown | null | undefined,
): LayoutPreset {
  const captured: LayoutPreset = {
    label,
    visibility: { ...visibility },
    sizes: { ...sizes },
  }
  if (dockLayout != null) {
    captured.dockLayout = dockLayout
  }
  return captured
}

/**
 * Look up a built-in preset by id. Returns a FRESH copy (deep-cloned
 * visibility + sizes) so callers can mutate without affecting the module
 * constant.
 */
export function getBuiltinPreset(id: BuiltinPresetId): LayoutPreset {
  const src = BUILTIN_LAYOUT_PRESETS[id]
  return {
    label: src.label,
    visibility: { ...src.visibility },
    sizes: { ...src.sizes },
  }
}
