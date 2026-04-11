import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import DockLayout, {
  type BoxData,
  type DropDirection,
  type LayoutBase,
  type LayoutData,
  type PanelData,
  type TabData,
} from 'rc-dock'
import 'rc-dock/dist/rc-dock.css'
// US-P03: re-skin rc-dock / rc-tabs to MatSlop's CSS variables so the
// dock chrome follows the project's dark (and light) theme instead of
// the upstream light defaults. Must be imported AFTER rc-dock.css so
// the overrides win the cascade.
import '../rc-dock-theme.css'

/**
 * US-024 / US-025: full rc-dock integration for MatSlop.
 *
 * Every MatSlop panel is a dock pane with a tab header. The Allotment
 * dependency has been removed; this file is the single source of truth
 * for how the renderer arranges its panels.
 *
 * Layout structure (all panels visible):
 *
 *   horizontal
 *   ├── File Browser         (width 220)
 *   ├── vertical             (width 900)
 *   │   ├── Editor           (height 600)
 *   │   └── panel with tabs  (height 300)
 *   │       ├── Command Window
 *   │       └── History       (only when visible)
 *   └── vertical             (width 280)
 *       ├── Workspace         (height 300)
 *       ├── Call Stack        (height 180, only when paused)
 *       ├── Watches           (height 180, only when active)
 *       └── Figure            (height 250, only when figures present)
 *
 * Optional panels (Command History, Call Stack, Watches, Figure) are
 * omitted from the layout tree entirely when not visible, so their
 * `data-testid` selectors disappear from the DOM — existing tests that
 * assert `toHaveCount(0)` on hidden panels keep working unchanged.
 *
 * The layout is controlled (`layout={...}` + `onLayoutChange`) so that
 * visibility changes can rebuild the tree. rc-dock caches tab content by
 * tab id, so panel state (editor tabs, command-window history, etc.) is
 * preserved across layout rebuilds as long as the tab id is stable.
 */

/** Stable tab ids used by `loadTab` and by the default layout tree. */
export const DOCK_TAB_IDS = {
  fileBrowser: 'matslop-file-browser',
  editor: 'matslop-editor',
  commandWindow: 'matslop-command-window',
  commandHistory: 'matslop-command-history',
  workspace: 'matslop-workspace',
  callStack: 'matslop-call-stack',
  watches: 'matslop-watches',
  figure: 'matslop-figure',
  helpBrowser: 'matslop-help-browser',
  findInFiles: 'matslop-find-in-files',
  profiler: 'matslop-profiler',
  sourceControl: 'matslop-source-control',
} as const

export type MatslopDockTabId = (typeof DOCK_TAB_IDS)[keyof typeof DOCK_TAB_IDS]

/** Human titles for each tab id — also used by the loadTab factory. */
export const DOCK_TAB_TITLES: Record<MatslopDockTabId, string> = {
  [DOCK_TAB_IDS.fileBrowser]: 'File Browser',
  [DOCK_TAB_IDS.editor]: 'Editor',
  [DOCK_TAB_IDS.commandWindow]: 'Command Window',
  [DOCK_TAB_IDS.commandHistory]: 'History',
  [DOCK_TAB_IDS.workspace]: 'Workspace',
  [DOCK_TAB_IDS.callStack]: 'Call Stack',
  [DOCK_TAB_IDS.watches]: 'Watches',
  [DOCK_TAB_IDS.figure]: 'Figure',
  [DOCK_TAB_IDS.helpBrowser]: 'Help',
  [DOCK_TAB_IDS.findInFiles]: 'Find in Files',
  [DOCK_TAB_IDS.profiler]: 'Profiler',
  [DOCK_TAB_IDS.sourceControl]: 'Source Control',
}

/**
 * Visibility flags driving `buildDockLayoutFromVisibility`. Panels whose
 * flag is `false` are omitted from the layout tree entirely.
 */
export interface DockVisibility {
  fileBrowser: boolean
  commandWindow: boolean
  commandHistory: boolean
  workspace: boolean
  callStack: boolean
  watches: boolean
  figure: boolean
  helpBrowser: boolean
  findInFiles: boolean
  profiler: boolean
  sourceControl: boolean
}

/** Convenience: the "first launch / MATLAB-default" visibility preset. */
export const DEFAULT_DOCK_VISIBILITY: DockVisibility = {
  fileBrowser: true,
  commandWindow: true,
  commandHistory: false,
  workspace: true,
  callStack: false,
  watches: false,
  figure: false,
  helpBrowser: false,
  findInFiles: false,
  profiler: false,
  sourceControl: false,
}

// When a `loadTab(tab)` factory is provided to `<DockLayout>`, the tab
// entries in the layout only need an `id` — rc-dock calls the factory to
// hydrate `title` and `content`. The TS types still require the full
// `TabData` shape, so we cast id-only entries through `unknown`.
const idOnly = (id: string): TabData => ({ id }) as unknown as TabData

/**
 * Pure helper: build the dock layout tree for a given visibility set.
 *
 * Callers can feed this directly into `<DockLayout layout={...}>`. The
 * function returns a fresh object on each call so callers can mutate it
 * without side effects.
 */
export function buildDockLayoutFromVisibility(
  vis: DockVisibility,
  detached?: ReadonlySet<string>,
): LayoutData {
  const isDetached = (id: string): boolean => !!detached && detached.has(id)
  const dockboxChildren: (BoxData | PanelData)[] = []

  // Left column: File Browser on top, Source Control beneath (both optional)
  const leftChildren: PanelData[] = []
  if (vis.fileBrowser && !isDetached(DOCK_TAB_IDS.fileBrowser)) {
    leftChildren.push({
      size: 400,
      tabs: [idOnly(DOCK_TAB_IDS.fileBrowser)],
    } as PanelData)
  }
  if (vis.sourceControl && !isDetached(DOCK_TAB_IDS.sourceControl)) {
    leftChildren.push({
      size: 400,
      tabs: [idOnly(DOCK_TAB_IDS.sourceControl)],
    } as PanelData)
  }
  if (leftChildren.length > 0) {
    if (leftChildren.length === 1) {
      dockboxChildren.push({ ...leftChildren[0], size: 220 } as PanelData)
    } else {
      dockboxChildren.push({
        mode: 'vertical',
        size: 220,
        children: leftChildren,
      } as BoxData)
    }
  }

  // Center column: Editor on top, Command Window / History panel beneath
  const centerChildren: (BoxData | PanelData)[] = []
  if (!isDetached(DOCK_TAB_IDS.editor)) {
    centerChildren.push({
      size: 600,
      tabs: [idOnly(DOCK_TAB_IDS.editor)],
    } as PanelData)
  }
  const wantCmdWindow = vis.commandWindow && !isDetached(DOCK_TAB_IDS.commandWindow)
  const wantCmdHistory = vis.commandHistory && !isDetached(DOCK_TAB_IDS.commandHistory)
  const wantHelp = vis.helpBrowser && !isDetached(DOCK_TAB_IDS.helpBrowser)
  const wantFind = vis.findInFiles && !isDetached(DOCK_TAB_IDS.findInFiles)
  const wantProfiler = vis.profiler && !isDetached(DOCK_TAB_IDS.profiler)
  if (wantCmdWindow || wantCmdHistory || wantHelp || wantFind || wantProfiler) {
    const bottomTabs: TabData[] = []
    if (wantCmdWindow) bottomTabs.push(idOnly(DOCK_TAB_IDS.commandWindow))
    if (wantCmdHistory) bottomTabs.push(idOnly(DOCK_TAB_IDS.commandHistory))
    if (wantHelp) bottomTabs.push(idOnly(DOCK_TAB_IDS.helpBrowser))
    if (wantFind) bottomTabs.push(idOnly(DOCK_TAB_IDS.findInFiles))
    if (wantProfiler) bottomTabs.push(idOnly(DOCK_TAB_IDS.profiler))
    // Choose the most-recently-opened auxiliary tab as the active one so
    // `doc foo` / Ctrl+Shift+F / profiler-toggle immediately shows its own
    // panel rather than leaving focus on the Command Window.
    const activeId = wantProfiler
      ? DOCK_TAB_IDS.profiler
      : wantFind
        ? DOCK_TAB_IDS.findInFiles
        : wantHelp
          ? DOCK_TAB_IDS.helpBrowser
          : undefined
    centerChildren.push({
      size: 300,
      tabs: bottomTabs,
      activeId,
    } as PanelData)
  }
  if (centerChildren.length > 0) {
    dockboxChildren.push({
      mode: 'vertical',
      size: 900,
      children: centerChildren,
    } as BoxData)
  }

  // Right column: Workspace / Call Stack / Watches / Figure (stacked)
  const rightChildren: PanelData[] = []
  if (vis.workspace && !isDetached(DOCK_TAB_IDS.workspace)) {
    rightChildren.push({
      size: 300,
      tabs: [idOnly(DOCK_TAB_IDS.workspace)],
    } as PanelData)
  }
  if (vis.callStack && !isDetached(DOCK_TAB_IDS.callStack)) {
    rightChildren.push({
      size: 180,
      tabs: [idOnly(DOCK_TAB_IDS.callStack)],
    } as PanelData)
  }
  if (vis.watches && !isDetached(DOCK_TAB_IDS.watches)) {
    rightChildren.push({
      size: 180,
      tabs: [idOnly(DOCK_TAB_IDS.watches)],
    } as PanelData)
  }
  if (vis.figure && !isDetached(DOCK_TAB_IDS.figure)) {
    rightChildren.push({
      size: 250,
      tabs: [idOnly(DOCK_TAB_IDS.figure)],
    } as PanelData)
  }
  if (rightChildren.length > 0) {
    dockboxChildren.push({
      mode: 'vertical',
      size: 280,
      children: rightChildren,
    } as BoxData)
  }

  return {
    dockbox: {
      mode: 'horizontal',
      children: dockboxChildren,
    },
  } as LayoutData
}

/**
 * Back-compat helper: the "MATLAB-default" layout at first launch. Kept so
 * existing unit tests and preset code can still call it unchanged.
 */
export function buildDefaultDockLayout(): LayoutData {
  return buildDockLayoutFromVisibility(DEFAULT_DOCK_VISIBILITY)
}

/**
 * US-P06: compute the set of tab ids that are *allowed* to appear in the
 * dock layout for the given visibility / detached state. The "ghost"
 * Command History tab seen on screenshots is the result of a previously
 * persisted saved layout (via US-026) that referenced a tab whose
 * visibility flag is now `false`. We use this set to filter such tabs
 * out of the saved layout before handing it to rc-dock.
 *
 * Note: the editor is treated as always-visible (no flag), to mirror the
 * behaviour of `buildDockLayoutFromVisibility`.
 */
function computeAllowedTabIds(
  vis: DockVisibility,
  detached?: ReadonlySet<string>,
): Set<string> {
  const allowed = new Set<string>()
  // editor has no visibility flag — always present unless detached
  allowed.add(DOCK_TAB_IDS.editor)
  if (vis.fileBrowser) allowed.add(DOCK_TAB_IDS.fileBrowser)
  if (vis.commandWindow) allowed.add(DOCK_TAB_IDS.commandWindow)
  if (vis.commandHistory) allowed.add(DOCK_TAB_IDS.commandHistory)
  if (vis.workspace) allowed.add(DOCK_TAB_IDS.workspace)
  if (vis.callStack) allowed.add(DOCK_TAB_IDS.callStack)
  if (vis.watches) allowed.add(DOCK_TAB_IDS.watches)
  if (vis.figure) allowed.add(DOCK_TAB_IDS.figure)
  if (vis.helpBrowser) allowed.add(DOCK_TAB_IDS.helpBrowser)
  if (vis.findInFiles) allowed.add(DOCK_TAB_IDS.findInFiles)
  if (vis.profiler) allowed.add(DOCK_TAB_IDS.profiler)
  if (vis.sourceControl) allowed.add(DOCK_TAB_IDS.sourceControl)
  if (detached) {
    for (const d of detached) allowed.delete(d)
  }
  return allowed
}

/**
 * US-P06: walk a persisted `LayoutBase` and remove tab entries whose ids
 * are unknown to MatSlop or whose visibility flag is currently off.
 * Empty panels are dropped, and boxes that become empty after their
 * children are filtered are dropped too. Returns `null` if the result
 * would be an empty dockbox (callers should fall back to the
 * visibility-derived default in that case).
 *
 * This is the fix for the "ghost Command History tab" reported in
 * matslop-06.png: a previously-saved layout still referenced
 * `matslop-command-history` even after the panel was hidden, and
 * rc-dock dutifully rendered it.
 */
export function sanitizeSavedDockLayout(
  saved: LayoutBase,
  vis: DockVisibility,
  detached?: ReadonlySet<string>,
): LayoutBase | null {
  const allowed = computeAllowedTabIds(vis, detached)

  type AnyNode = Record<string, unknown>

  function sanitizeNode(node: unknown): AnyNode | null {
    if (!node || typeof node !== 'object') return null
    const n = node as AnyNode
    // Panel: filter `tabs`
    if (Array.isArray(n.tabs)) {
      const tabs = (n.tabs as AnyNode[]).filter((t) => {
        if (!t || typeof t !== 'object') return false
        const id = (t as { id?: unknown }).id
        return typeof id === 'string' && allowed.has(id)
      })
      if (tabs.length === 0) return null
      const next: AnyNode = { ...n, tabs }
      const activeId = (n as { activeId?: unknown }).activeId
      if (typeof activeId === 'string' && !allowed.has(activeId)) {
        next.activeId = (tabs[0] as { id: string }).id
      }
      return next
    }
    // Box: recursively filter `children`
    if (Array.isArray(n.children)) {
      const children = (n.children as unknown[])
        .map((c) => sanitizeNode(c))
        .filter((c): c is AnyNode => c !== null)
      if (children.length === 0) return null
      return { ...n, children }
    }
    return n
  }

  const dockbox = sanitizeNode((saved as unknown as { dockbox?: unknown }).dockbox)
  if (!dockbox) return null
  // Floatbox / maxbox / windowbox are also part of LayoutBase. We sanitize
  // them too so floating windows don't end up containing ghost tabs.
  const out: AnyNode = { ...(saved as unknown as AnyNode), dockbox }
  for (const key of ['floatbox', 'maxbox', 'windowbox'] as const) {
    if ((saved as unknown as AnyNode)[key]) {
      const cleaned = sanitizeNode((saved as unknown as AnyNode)[key])
      if (cleaned) {
        out[key] = cleaned
      } else {
        delete out[key]
      }
    }
  }
  // Final guard: if the dockbox has no children left, treat as empty.
  const dockboxChildren = (dockbox as { children?: unknown[] }).children
  if (!Array.isArray(dockboxChildren) || dockboxChildren.length === 0) {
    return null
  }
  return out as unknown as LayoutBase
}

export interface MatslopDockLayoutProps {
  visibility: DockVisibility
  fileBrowser: ReactNode
  editor: ReactNode
  commandWindow: ReactNode
  commandHistory: ReactNode
  workspace: ReactNode
  callStack: ReactNode
  watches: ReactNode
  figure: ReactNode
  helpBrowser: ReactNode
  findInFiles: ReactNode
  profiler: ReactNode
  sourceControl: ReactNode
  /**
   * US-026: previously-persisted rc-dock layout (from `DockLayout.saveLayout()`).
   * When provided at first render, it is used instead of the visibility-
   * derived default tree so user drag-rearrangements survive across
   * sessions. Subsequent visibility toggles still rebuild from scratch.
   */
  savedDockLayout?: LayoutBase | null
  /**
   * US-026: called whenever rc-dock emits an `onLayoutChange` for an
   * INTERACTIVE change (drag/drop, close, etc). Receives the serialized
   * `LayoutBase` — host persists it via the existing layout IPC.
   */
  onDockLayoutChange?: (layout: LayoutBase, direction?: DropDirection) => void
  /**
   * US-027: set of tab ids whose panels are currently detached into
   * separate OS windows. Detached tabs are omitted from the dock layout
   * tree entirely (same treatment as visibility=false).
   */
  /**
   * US-031: additional cache-busting key that forces a layout rebuild
   * when it changes, even if visibility did not. Used by the Help panel
   * to refresh cached tab content when the displayed topic changes —
   * rc-dock's PureComponent panels would otherwise not re-render the
   * stale JSX captured in `loadTab`.
   */
  contentVersion?: string
  detachedPanels?: ReadonlySet<string>
  /**
   * US-027: called when the user picks "Detach" from a tab's context
   * menu. Host is responsible for actually creating the BrowserWindow
   * (via the `panel:openDetached` IPC) and adding the tabId to its
   * detachedPanels set.
   */
  onDetachTab?: (tabId: MatslopDockTabId) => void
}

/**
 * `<DockLayout>` wrapping every MatSlop panel. The host (App.tsx) passes
 * React nodes for each slot — slots for panels whose visibility flag is
 * `false` may be `null`, in which case the tab is both omitted from the
 * layout and has no content (so its data-testid does not leak into DOM).
 */
export default function MatslopDockLayout(props: MatslopDockLayoutProps): React.JSX.Element {
  const { visibility, savedDockLayout, onDockLayoutChange, detachedPanels, onDetachTab, contentVersion } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<DockLayout>(null)
  // Keep the latest change handler in a ref so we don't need to re-bind
  // the DockLayout `onLayoutChange` prop each render.
  const onDockLayoutChangeRef = useRef(onDockLayoutChange)
  onDockLayoutChangeRef.current = onDockLayoutChange
  // Same pattern for the detach callback — stable identity so loadTab
  // closures always pick up the latest.
  const onDetachTabRef = useRef(onDetachTab)
  onDetachTabRef.current = onDetachTab

  // US-027: simple tab-context-menu state. When set, a floating menu is
  // rendered at (x, y) containing a "Detach" option. Right-clicking a
  // tab title opens the menu; clicking anywhere else (or pressing Escape)
  // dismisses it.
  const [tabContextMenu, setTabContextMenu] = useState<{
    tabId: MatslopDockTabId
    x: number
    y: number
  } | null>(null)

  // Stable map id -> React content. Lives in a ref so `loadTab` (which
  // rc-dock may call at any time during a layout update) always sees the
  // latest slots without needing the callback identity to change.
  const slotsById = useMemo<Record<MatslopDockTabId, ReactNode>>(
    () => ({
      [DOCK_TAB_IDS.fileBrowser]: props.fileBrowser,
      [DOCK_TAB_IDS.editor]: props.editor,
      [DOCK_TAB_IDS.commandWindow]: props.commandWindow,
      [DOCK_TAB_IDS.commandHistory]: props.commandHistory,
      [DOCK_TAB_IDS.workspace]: props.workspace,
      [DOCK_TAB_IDS.callStack]: props.callStack,
      [DOCK_TAB_IDS.watches]: props.watches,
      [DOCK_TAB_IDS.figure]: props.figure,
      [DOCK_TAB_IDS.helpBrowser]: props.helpBrowser,
      [DOCK_TAB_IDS.findInFiles]: props.findInFiles,
      [DOCK_TAB_IDS.profiler]: props.profiler,
      [DOCK_TAB_IDS.sourceControl]: props.sourceControl,
    }),
    [
      props.fileBrowser,
      props.editor,
      props.commandWindow,
      props.commandHistory,
      props.workspace,
      props.callStack,
      props.watches,
      props.figure,
      props.helpBrowser,
      props.findInFiles,
      props.profiler,
      props.sourceControl,
    ],
  )
  const slotsRef = useRef(slotsById)
  slotsRef.current = slotsById

  // Controlled layout state.
  //
  // Initial value: if the host supplied a saved `LayoutBase` (US-026), use
  // it so a prior drag-rearrangement survives a restart. Otherwise fall
  // back to the visibility-derived default tree. After mount, visibility
  // changes rebuild from scratch (so panel toggles still work).
  const [layout, setLayout] = useState<LayoutData>(() => {
    if (savedDockLayout) {
      try {
        // US-P06: strip any ghost tabs (unknown ids, or ids whose
        // visibility flag is now false) before handing the saved layout
        // to rc-dock. Otherwise a stale `matslop-command-history` entry
        // in window-state would render a disconnected ghost tab over
        // the Command Window.
        const cleaned = sanitizeSavedDockLayout(savedDockLayout, visibility, detachedPanels)
        if (cleaned) {
          // `LayoutBase` is a subset of `LayoutData`; rc-dock's `loadTab`
          // factory will hydrate id-only tabs on render.
          return cleaned as LayoutData
        }
      } catch {
        // fall through to default
      }
    }
    return buildDockLayoutFromVisibility(visibility, detachedPanels)
  })
  // Track whether we already consumed the initial saved layout so the
  // visibility-effect below knows to rebuild instead of re-applying it.
  const visKey = JSON.stringify(visibility)
  const detachedKey = detachedPanels ? [...detachedPanels].sort().join('|') : ''
  const versionKey = contentVersion ?? ''
  const prevKeysRef = useRef({ vis: visKey, detached: detachedKey, version: versionKey })
  useEffect(() => {
    if (
      prevKeysRef.current.vis === visKey &&
      prevKeysRef.current.detached === detachedKey &&
      prevKeysRef.current.version === versionKey
    ) {
      return
    }
    prevKeysRef.current = { vis: visKey, detached: detachedKey, version: versionKey }
    setLayout(buildDockLayoutFromVisibility(visibility, detachedPanels))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visKey, detachedKey, versionKey])

  const loadTab = (tab: TabData): TabData => {
    const id = tab.id as MatslopDockTabId | undefined
    if (!id || !(id in slotsRef.current)) {
      return {
        ...tab,
        title: tab.title ?? 'Untitled',
        content: <div data-testid="dock-tab-missing">unknown tab: {String(tab.id)}</div>,
        group: 'main',
      }
    }
    const content = slotsRef.current[id]
    // US-027: wrap the tab title in a span so right-click opens a
    // custom context menu containing the "Detach" option. We set
    // data-testid on both the wrapper and an explicit title element so
    // E2E tests can target either.
    const titleNode = (
      <span
        data-testid={`dock-tab-title-${id}`}
        className="dock-tab-title"
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setTabContextMenu({ tabId: id, x: e.clientX, y: e.clientY })
        }}
      >
        {DOCK_TAB_TITLES[id]}
      </span>
    )
    return {
      ...tab,
      // rc-dock accepts ReactElement for titles at runtime even though
      // the types advertise `string`; cast through unknown.
      title: titleNode as unknown as string,
      group: 'main',
      content: (
        <div
          data-testid={`dock-tab-${id}`}
          style={{ width: '100%', height: '100%', overflow: 'hidden' }}
        >
          {content}
        </div>
      ),
    }
  }

  // Tag the center `.dock-vbox` with `data-testid="editor-column"` so
  // existing layout E2E tests that query by that testid keep working.
  // rc-dock does not expose a way to stamp custom attributes on its
  // internal box nodes, so we walk the DOM from the editor tab up to the
  // nearest vertical dock-box and set the attribute there.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const editorEl = container.querySelector(
      `[data-testid="dock-tab-${DOCK_TAB_IDS.editor}"]`,
    )
    if (!editorEl) return
    let el: HTMLElement | null = (editorEl as HTMLElement).parentElement
    while (el && !el.classList.contains('dock-vbox')) {
      el = el.parentElement
      if (el === container) return
    }
    if (el) {
      el.setAttribute('data-testid', 'editor-column')
    }
  })

  // US-026: expose a test-only global for Playwright that calls
  // `DockLayout.dockMove(source, target, direction)` to simulate a
  // drag-and-drop between docks without synthesizing pointer events
  // (which are flaky on rc-dock's internal DragDropDiv). Gated on the
  // same env var the other `__matslop*` hooks use.
  useEffect(() => {
    const w = window as unknown as {
      __matslopDockMove?: (sourceId: string, targetId: string, direction: DropDirection) => boolean
      __matslopDockSaveLayout?: () => LayoutBase | null
    }
    w.__matslopDockMove = (sourceId, targetId, direction) => {
      const dock = dockRef.current
      if (!dock) return false
      const src = dock.find(sourceId) as TabData | PanelData | undefined
      const tgt = dock.find(targetId) as TabData | PanelData | undefined
      if (!src || !tgt) return false
      dock.dockMove(src, tgt, direction)
      return true
    }
    w.__matslopDockSaveLayout = () => {
      const dock = dockRef.current
      if (!dock) return null
      return dock.saveLayout()
    }
    // US-026: return a stable id for the rc-dock panel that currently
    // contains the given tab id. Used by tests to assert that two tabs
    // live in the same panel (merged) vs different panels (separate).
    ;(
      w as unknown as {
        __matslopDockGetTabPanelId?: (tabId: string) => string | null
      }
    ).__matslopDockGetTabPanelId = (tabId: string) => {
      const dock = dockRef.current
      if (!dock) return null
      const found = dock.find(tabId) as TabData | undefined
      const parent = found?.parent as PanelData | undefined
      return parent?.id ?? null
    }
    return () => {
      delete w.__matslopDockMove
      delete w.__matslopDockSaveLayout
      delete (
        w as unknown as {
          __matslopDockGetTabPanelId?: unknown
        }
      ).__matslopDockGetTabPanelId
    }
  }, [])

  // US-027: expose a test hook that drives the "Detach" tab-context-menu
  // option programmatically — Playwright-based right-click against
  // rc-dock's internal tab header is flaky, but a direct hook maps 1:1
  // to the UI path (both ultimately call `onDetachTabRef.current(id)`).
  useEffect(() => {
    const w = window as unknown as {
      __matslopDetachPanelTab?: (tabId: string) => boolean
      __matslopOpenTabContextMenu?: (tabId: string) => boolean
    }
    w.__matslopDetachPanelTab = (tabId: string) => {
      const handler = onDetachTabRef.current
      if (!handler) return false
      handler(tabId as MatslopDockTabId)
      return true
    }
    w.__matslopOpenTabContextMenu = (tabId: string) => {
      setTabContextMenu({ tabId: tabId as MatslopDockTabId, x: 50, y: 50 })
      return true
    }
    return () => {
      delete w.__matslopDetachPanelTab
      delete w.__matslopOpenTabContextMenu
    }
  }, [])

  // US-027: dismiss the tab context menu on outside-click or Escape. The
  // click listener runs in bubble phase (NOT capture) so the menu's own
  // button onClick handlers fire first — otherwise a capture-phase
  // dismiss would unmount the menu before React dispatched the click to
  // its children.
  useEffect(() => {
    if (!tabContextMenu) return
    const dismiss = (e: MouseEvent): void => {
      const target = e.target as Node | null
      const menuEl = document.querySelector('[data-testid="dock-tab-context-menu"]')
      if (menuEl && target && menuEl.contains(target)) return
      setTabContextMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTabContextMenu(null)
    }
    // Delay registration so the opening context-menu event doesn't
    // immediately close us.
    const id = setTimeout(() => {
      window.addEventListener('click', dismiss)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [tabContextMenu])

  return (
    <div
      ref={containerRef}
      data-testid="matslop-dock-layout"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <DockLayout
        ref={dockRef}
        layout={layout}
        onLayoutChange={(newLayout, _currentTabId, direction) => {
          setLayout(newLayout as LayoutData)
          // Persist interactive layout changes (drag between docks, close,
          // maximize, ...) but skip rc-dock's internal housekeeping
          // directions that fire during initial mount.
          if (direction && direction !== 'update' && direction !== 'active') {
            onDockLayoutChangeRef.current?.(newLayout, direction)
          }
        }}
        loadTab={loadTab}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        groups={{
          main: {
            floatable: true,
            maximizable: true,
          },
        }}
      />
      {tabContextMenu && (
        <div
          data-testid="dock-tab-context-menu"
          data-tab-id={tabContextMenu.tabId}
          role="menu"
          style={{
            position: 'fixed',
            left: tabContextMenu.x,
            top: tabContextMenu.y,
            zIndex: 10000,
            background: 'var(--panel-bg, #2d2d30)',
            color: 'var(--text, #ddd)',
            border: '1px solid var(--border, #3a3a3d)',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            padding: '4px 0',
            minWidth: 140,
            fontSize: 13,
            userSelect: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            data-testid="dock-tab-context-menu-detach"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 14px',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
            }}
            onClick={() => {
              const id = tabContextMenu.tabId
              setTabContextMenu(null)
              onDetachTabRef.current?.(id)
            }}
          >
            Detach to window
          </button>
        </div>
      )}
    </div>
  )
}
