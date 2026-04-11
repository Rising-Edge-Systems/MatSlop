import { useMemo, type ReactNode } from 'react'
import DockLayout, { type LayoutData, type TabData } from 'rc-dock'
import 'rc-dock/dist/rc-dock.css'

/**
 * US-024: Minimal `rc-dock` integration.
 *
 * This is the feature-flagged preview of the dock-layout system chosen in
 * docs/adr/0002-dock-layout-library.md. It is NOT wired into App.tsx yet —
 * US-025 does that migration. This file intentionally keeps the surface
 * area tiny:
 *
 *   - A pure `buildDefaultDockLayout` helper produces the `LayoutData` tree
 *     for the MATLAB-default arrangement (FileBrowser left, Editor +
 *     CommandWindow center, Workspace right). Pure function, unit-tested
 *     in `tests/unit/dock-layout.test.ts`.
 *
 *   - A `MatslopDockLayout` React component that accepts one `ReactNode`
 *     slot per panel and mounts them inside an `rc-dock` `DockLayout` via
 *     a `loadTab(id)` factory. The factory pattern lets the host keep live
 *     refs / state in each panel instead of baking content into a static
 *     JSON snapshot (see ADR-0002 for rationale).
 *
 * Only the panels the roadmap explicitly calls out are exposed here. The
 * full migration (Call Stack, Watches, Figure, Command History) happens in
 * US-025.
 */

/** Stable tab ids used by `loadTab` and by the default layout tree. */
export const DOCK_TAB_IDS = {
  fileBrowser: 'matslop-file-browser',
  editor: 'matslop-editor',
  commandWindow: 'matslop-command-window',
  workspace: 'matslop-workspace',
} as const

export type MatslopDockTabId = (typeof DOCK_TAB_IDS)[keyof typeof DOCK_TAB_IDS]

/** Human titles for each tab id — also used by the loadTab factory. */
export const DOCK_TAB_TITLES: Record<MatslopDockTabId, string> = {
  [DOCK_TAB_IDS.fileBrowser]: 'File Browser',
  [DOCK_TAB_IDS.editor]: 'Editor',
  [DOCK_TAB_IDS.commandWindow]: 'Command Window',
  [DOCK_TAB_IDS.workspace]: 'Workspace',
}

/**
 * Pure helper: produce the default MATLAB-like dock layout tree.
 *
 * Structure:
 *
 *   horizontal
 *   ├── File Browser         (width 220)
 *   ├── vertical             (width 900)
 *   │   ├── Editor           (height 600)
 *   │   └── Command Window   (height 300)
 *   └── Workspace            (width 280)
 *
 * All top-level tabs share the `'main'` group so US-026 (drag tabs between
 * docks) works out of the box.
 */
export function buildDefaultDockLayout(): LayoutData {
  // When a `loadTab(tab)` factory is provided to `<DockLayout>`, the tab
  // entries in `defaultLayout` only need an `id` — rc-dock calls the
  // factory to hydrate `title` and `content`. The TS types still require
  // the full `TabData` shape though, so we cast id-only entries through
  // `unknown` at the edges. See rc-dock README, "loadTab".
  const idOnly = (id: string) => ({ id }) as unknown as LayoutData['dockbox']['children'][number]
  return {
    dockbox: {
      mode: 'horizontal',
      children: [
        {
          size: 220,
          tabs: [idOnly(DOCK_TAB_IDS.fileBrowser) as unknown as never],
        },
        {
          mode: 'vertical',
          size: 900,
          children: [
            {
              size: 600,
              tabs: [idOnly(DOCK_TAB_IDS.editor) as unknown as never],
            },
            {
              size: 300,
              tabs: [idOnly(DOCK_TAB_IDS.commandWindow) as unknown as never],
            },
          ],
        },
        {
          size: 280,
          tabs: [idOnly(DOCK_TAB_IDS.workspace) as unknown as never],
        },
      ],
    },
  }
}

export interface MatslopDockLayoutProps {
  fileBrowser: ReactNode
  editor: ReactNode
  commandWindow: ReactNode
  workspace: ReactNode
  /** Optional override layout (for tests / presets). */
  defaultLayout?: LayoutData
}

/**
 * Minimal `<DockLayout>` wrapping the four "main" MatSlop panels as dock
 * panes. Uses `loadTab(id)` so the panel React trees are owned by the host
 * (App.tsx) and not re-created when the layout re-renders.
 */
export default function MatslopDockLayout(props: MatslopDockLayoutProps) {
  const { fileBrowser, editor, commandWindow, workspace, defaultLayout } = props

  // Stable map of id -> rendered content. Recomputed only when a slot
  // changes so rc-dock's internal diff keeps tab state (scroll position,
  // active tab, …) stable across renders.
  const slotsById = useMemo<Record<MatslopDockTabId, ReactNode>>(
    () => ({
      [DOCK_TAB_IDS.fileBrowser]: fileBrowser,
      [DOCK_TAB_IDS.editor]: editor,
      [DOCK_TAB_IDS.commandWindow]: commandWindow,
      [DOCK_TAB_IDS.workspace]: workspace,
    }),
    [fileBrowser, editor, commandWindow, workspace],
  )

  const loadTab = (tab: TabData): TabData => {
    const id = tab.id as MatslopDockTabId | undefined
    if (!id || !(id in slotsById)) {
      return {
        ...tab,
        title: tab.title ?? 'Untitled',
        content: <div data-testid="dock-tab-missing">unknown tab: {String(tab.id)}</div>,
        group: 'main',
      }
    }
    return {
      ...tab,
      title: DOCK_TAB_TITLES[id],
      group: 'main',
      content: (
        <div data-testid={`dock-tab-${id}`} style={{ width: '100%', height: '100%' }}>
          {slotsById[id]}
        </div>
      ),
    }
  }

  const layout = defaultLayout ?? buildDefaultDockLayout()

  return (
    <div data-testid="matslop-dock-layout" style={{ width: '100%', height: '100%' }}>
      <DockLayout
        defaultLayout={layout}
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
