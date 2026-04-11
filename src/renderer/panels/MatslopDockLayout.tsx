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
export function buildDockLayoutFromVisibility(vis: DockVisibility): LayoutData {
  const dockboxChildren: (BoxData | PanelData)[] = []

  // Left column: File Browser (optional)
  if (vis.fileBrowser) {
    dockboxChildren.push({
      size: 220,
      tabs: [idOnly(DOCK_TAB_IDS.fileBrowser)],
    } as PanelData)
  }

  // Center column: Editor on top, Command Window / History panel beneath
  const centerChildren: (BoxData | PanelData)[] = [
    {
      size: 600,
      tabs: [idOnly(DOCK_TAB_IDS.editor)],
    } as PanelData,
  ]
  if (vis.commandWindow || vis.commandHistory) {
    const bottomTabs: TabData[] = []
    if (vis.commandWindow) bottomTabs.push(idOnly(DOCK_TAB_IDS.commandWindow))
    if (vis.commandHistory) bottomTabs.push(idOnly(DOCK_TAB_IDS.commandHistory))
    centerChildren.push({
      size: 300,
      tabs: bottomTabs,
    } as PanelData)
  }
  dockboxChildren.push({
    mode: 'vertical',
    size: 900,
    children: centerChildren,
  } as BoxData)

  // Right column: Workspace / Call Stack / Watches / Figure (stacked)
  const rightChildren: PanelData[] = []
  if (vis.workspace) {
    rightChildren.push({
      size: 300,
      tabs: [idOnly(DOCK_TAB_IDS.workspace)],
    } as PanelData)
  }
  if (vis.callStack) {
    rightChildren.push({
      size: 180,
      tabs: [idOnly(DOCK_TAB_IDS.callStack)],
    } as PanelData)
  }
  if (vis.watches) {
    rightChildren.push({
      size: 180,
      tabs: [idOnly(DOCK_TAB_IDS.watches)],
    } as PanelData)
  }
  if (vis.figure) {
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
}

/**
 * `<DockLayout>` wrapping every MatSlop panel. The host (App.tsx) passes
 * React nodes for each slot — slots for panels whose visibility flag is
 * `false` may be `null`, in which case the tab is both omitted from the
 * layout and has no content (so its data-testid does not leak into DOM).
 */
export default function MatslopDockLayout(props: MatslopDockLayoutProps): React.JSX.Element {
  const { visibility, savedDockLayout, onDockLayoutChange } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<DockLayout>(null)
  // Keep the latest change handler in a ref so we don't need to re-bind
  // the DockLayout `onLayoutChange` prop each render.
  const onDockLayoutChangeRef = useRef(onDockLayoutChange)
  onDockLayoutChangeRef.current = onDockLayoutChange

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
        // `LayoutBase` is a subset of `LayoutData`; rc-dock's `loadTab`
        // factory will hydrate id-only tabs on render.
        return savedDockLayout as LayoutData
      } catch {
        // fall through to default
      }
    }
    return buildDockLayoutFromVisibility(visibility)
  })
  // Track whether we already consumed the initial saved layout so the
  // visibility-effect below knows to rebuild instead of re-applying it.
  const visKey = JSON.stringify(visibility)
  const prevVisKeyRef = useRef(visKey)
  useEffect(() => {
    if (prevVisKeyRef.current === visKey) return
    prevVisKeyRef.current = visKey
    setLayout(buildDockLayoutFromVisibility(visibility))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visKey])

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
    return {
      ...tab,
      title: DOCK_TAB_TITLES[id],
      group: 'main',
      content: (
        <div
          data-testid={`dock-tab-${id}`}
          style={{ width: '100%', height: '100%', display: 'flex', overflow: 'hidden' }}
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
    </div>
  )
}
