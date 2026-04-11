import { describe, it, expect } from 'vitest'
import {
  buildDefaultDockLayout,
  buildDockLayoutFromVisibility,
  DEFAULT_DOCK_VISIBILITY,
  DOCK_TAB_IDS,
  DOCK_TAB_TITLES,
  type DockVisibility,
} from '../../src/renderer/panels/MatslopDockLayout'
import type { BoxData, PanelData } from 'rc-dock'

/**
 * Unit tests for the pure dock-layout helpers that back the US-025
 * rc-dock migration. Keeps the dock-layout shape contract testable
 * without mounting React or rc-dock itself.
 */

function isPanel(node: BoxData | PanelData): node is PanelData {
  return 'tabs' in node
}

function isBox(node: BoxData | PanelData): node is BoxData {
  return 'mode' in node && 'children' in node
}

function collectTabIds(node: BoxData | PanelData): string[] {
  if (isPanel(node)) {
    return node.tabs.map((t) => String(t.id ?? ''))
  }
  if (isBox(node)) {
    return node.children.flatMap(collectTabIds)
  }
  return []
}

describe('buildDefaultDockLayout', () => {
  it('returns a layout with a top-level horizontal dockbox', () => {
    const layout = buildDefaultDockLayout()
    expect(layout.dockbox).toBeDefined()
    expect(layout.dockbox.mode).toBe('horizontal')
    expect(Array.isArray(layout.dockbox.children)).toBe(true)
    // File Browser | Center(Editor/CommandWindow) | Workspace column
    expect(layout.dockbox.children.length).toBe(3)
  })

  it('places FileBrowser, (Editor+CommandWindow), Workspace in left-center-right order', () => {
    const layout = buildDefaultDockLayout()
    const [left, center, right] = layout.dockbox.children

    // Left: file browser panel
    expect(isPanel(left)).toBe(true)
    expect(collectTabIds(left)).toEqual([DOCK_TAB_IDS.fileBrowser])

    // Center: vertical box with editor on top, command window below
    expect(isBox(center)).toBe(true)
    if (isBox(center)) {
      expect(center.mode).toBe('vertical')
      expect(center.children.length).toBe(2)
      expect(collectTabIds(center.children[0])).toEqual([DOCK_TAB_IDS.editor])
      expect(collectTabIds(center.children[1])).toEqual([DOCK_TAB_IDS.commandWindow])
    }

    // Right: vertical box wrapping just the workspace at first launch
    expect(isBox(right)).toBe(true)
    if (isBox(right)) {
      expect(right.mode).toBe('vertical')
      expect(right.children.length).toBe(1)
      expect(collectTabIds(right.children[0])).toEqual([DOCK_TAB_IDS.workspace])
    }
  })

  it('only contains the panels that are visible at first launch', () => {
    const layout = buildDefaultDockLayout()
    const ids = collectTabIds(layout.dockbox).sort()
    // Default visibility: fileBrowser, editor, commandWindow, workspace.
    // commandHistory / callStack / watches / figure are off at first launch.
    const expected = [
      DOCK_TAB_IDS.commandWindow,
      DOCK_TAB_IDS.editor,
      DOCK_TAB_IDS.fileBrowser,
      DOCK_TAB_IDS.workspace,
    ].sort()
    expect(ids).toEqual(expected)
  })

  it('assigns non-negative sizes to every pane', () => {
    const layout = buildDefaultDockLayout()

    function walk(node: BoxData | PanelData): void {
      const size = (node as { size?: number }).size
      if (size !== undefined) {
        expect(size).toBeGreaterThan(0)
      }
      if (isBox(node)) {
        for (const child of node.children) walk(child)
      }
    }
    walk(layout.dockbox)
  })

  it('returns a fresh object on each call (safe to mutate per-caller)', () => {
    const a = buildDefaultDockLayout()
    const b = buildDefaultDockLayout()
    expect(a).not.toBe(b)
    expect(a.dockbox).not.toBe(b.dockbox)
  })
})

describe('buildDockLayoutFromVisibility', () => {
  it('omits file browser when hidden', () => {
    const layout = buildDockLayoutFromVisibility({
      ...DEFAULT_DOCK_VISIBILITY,
      fileBrowser: false,
    })
    const ids = collectTabIds(layout.dockbox)
    expect(ids).not.toContain(DOCK_TAB_IDS.fileBrowser)
    expect(ids).toContain(DOCK_TAB_IDS.editor)
  })

  it('omits command window when hidden but keeps the editor', () => {
    const layout = buildDockLayoutFromVisibility({
      ...DEFAULT_DOCK_VISIBILITY,
      commandWindow: false,
    })
    const ids = collectTabIds(layout.dockbox)
    expect(ids).not.toContain(DOCK_TAB_IDS.commandWindow)
    expect(ids).toContain(DOCK_TAB_IDS.editor)
  })

  it('groups command window and history as tabs in the same panel', () => {
    const layout = buildDockLayoutFromVisibility({
      ...DEFAULT_DOCK_VISIBILITY,
      commandWindow: true,
      commandHistory: true,
    })
    // Find the panel with both ids
    const stack: (BoxData | PanelData)[] = [layout.dockbox]
    let found: PanelData | null = null
    while (stack.length > 0) {
      const node = stack.pop() as BoxData | PanelData
      if (isPanel(node)) {
        const tabIds = node.tabs.map((t) => String(t.id))
        if (tabIds.includes(DOCK_TAB_IDS.commandWindow)) {
          found = node
          break
        }
      } else if (isBox(node)) {
        stack.push(...node.children)
      }
    }
    expect(found).not.toBeNull()
    if (found) {
      const tabIds = found.tabs.map((t) => String(t.id))
      expect(tabIds).toContain(DOCK_TAB_IDS.commandWindow)
      expect(tabIds).toContain(DOCK_TAB_IDS.commandHistory)
    }
  })

  it('adds call stack / watches / figure to the right column when visible', () => {
    const fullVis: DockVisibility = {
      fileBrowser: true,
      commandWindow: true,
      commandHistory: false,
      workspace: true,
      callStack: true,
      watches: true,
      figure: true,
      helpBrowser: false,
      findInFiles: false,
      profiler: false,
    }
    const layout = buildDockLayoutFromVisibility(fullVis)
    const ids = collectTabIds(layout.dockbox).sort()
    expect(ids).toEqual(
      [
        DOCK_TAB_IDS.fileBrowser,
        DOCK_TAB_IDS.editor,
        DOCK_TAB_IDS.commandWindow,
        DOCK_TAB_IDS.workspace,
        DOCK_TAB_IDS.callStack,
        DOCK_TAB_IDS.watches,
        DOCK_TAB_IDS.figure,
      ].sort(),
    )
  })

  it('adds the help browser as a tab in the center-bottom panel when visible', () => {
    const vis: DockVisibility = {
      fileBrowser: true,
      commandWindow: true,
      commandHistory: false,
      workspace: true,
      callStack: false,
      watches: false,
      figure: false,
      helpBrowser: true,
      findInFiles: false,
      profiler: false,
    }
    const layout = buildDockLayoutFromVisibility(vis)
    const ids = collectTabIds(layout.dockbox)
    expect(ids).toContain(DOCK_TAB_IDS.helpBrowser)
    // Help should appear alongside the command window in one panel.
    const centerBox = layout.dockbox.children?.find(
      (c): c is { mode: 'vertical'; children: unknown[] } =>
        (c as { mode?: string }).mode === 'vertical',
    )
    expect(centerBox).toBeDefined()
  })

  it('drops the right column entirely when no right-side panel is visible', () => {
    const layout = buildDockLayoutFromVisibility({
      ...DEFAULT_DOCK_VISIBILITY,
      workspace: false,
    })
    // Only file browser + center column remain
    expect(layout.dockbox.children.length).toBe(2)
  })
})

describe('buildDockLayoutFromVisibility – US-027 detached panels', () => {
  it('omits a detached tab from the layout tree even when visibility=true', () => {
    const layout = buildDockLayoutFromVisibility(
      DEFAULT_DOCK_VISIBILITY,
      new Set([DOCK_TAB_IDS.workspace]),
    )
    const ids = collectTabIds(layout.dockbox)
    expect(ids).not.toContain(DOCK_TAB_IDS.workspace)
    expect(ids).toContain(DOCK_TAB_IDS.fileBrowser)
    expect(ids).toContain(DOCK_TAB_IDS.editor)
    expect(ids).toContain(DOCK_TAB_IDS.commandWindow)
  })

  it('removes the right column when its only visible panel is detached', () => {
    const layout = buildDockLayoutFromVisibility(
      DEFAULT_DOCK_VISIBILITY,
      new Set([DOCK_TAB_IDS.workspace]),
    )
    expect(layout.dockbox.children.length).toBe(2)
  })

  it('keeps the center column when only the editor is detached but cmd window remains', () => {
    const layout = buildDockLayoutFromVisibility(
      DEFAULT_DOCK_VISIBILITY,
      new Set([DOCK_TAB_IDS.editor]),
    )
    const ids = collectTabIds(layout.dockbox)
    expect(ids).not.toContain(DOCK_TAB_IDS.editor)
    expect(ids).toContain(DOCK_TAB_IDS.commandWindow)
  })

  it('drops the center column entirely when every center panel is detached', () => {
    const layout = buildDockLayoutFromVisibility(
      DEFAULT_DOCK_VISIBILITY,
      new Set([DOCK_TAB_IDS.editor, DOCK_TAB_IDS.commandWindow]),
    )
    const ids = collectTabIds(layout.dockbox)
    expect(ids).not.toContain(DOCK_TAB_IDS.editor)
    expect(ids).not.toContain(DOCK_TAB_IDS.commandWindow)
    expect(ids).toContain(DOCK_TAB_IDS.fileBrowser)
    expect(ids).toContain(DOCK_TAB_IDS.workspace)
  })

  it('no-op when detached set is empty', () => {
    const withEmpty = buildDockLayoutFromVisibility(DEFAULT_DOCK_VISIBILITY, new Set())
    const baseline = buildDockLayoutFromVisibility(DEFAULT_DOCK_VISIBILITY)
    expect(collectTabIds(withEmpty.dockbox).sort()).toEqual(
      collectTabIds(baseline.dockbox).sort(),
    )
  })
})

describe('DOCK_TAB_TITLES', () => {
  it('has a human title for every tab id', () => {
    for (const id of Object.values(DOCK_TAB_IDS)) {
      expect(DOCK_TAB_TITLES[id]).toBeTruthy()
      expect(typeof DOCK_TAB_TITLES[id]).toBe('string')
    }
  })
})
