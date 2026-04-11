import { describe, it, expect } from 'vitest'
import {
  buildDefaultDockLayout,
  DOCK_TAB_IDS,
  DOCK_TAB_TITLES,
} from '../../src/renderer/panels/MatslopDockLayout'
import type { BoxData, PanelData } from 'rc-dock'

/**
 * Unit tests for the pure `buildDefaultDockLayout` helper that backs the
 * US-024 rc-dock integration. Keeps the dock-layout shape contract
 * testable without mounting React or rc-dock itself.
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

    // Right: workspace panel
    expect(isPanel(right)).toBe(true)
    expect(collectTabIds(right)).toEqual([DOCK_TAB_IDS.workspace])
  })

  it('contains every well-known tab id exactly once', () => {
    const layout = buildDefaultDockLayout()
    const ids = collectTabIds(layout.dockbox).sort()
    const expected = Object.values(DOCK_TAB_IDS).sort()
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

describe('DOCK_TAB_TITLES', () => {
  it('has a human title for every tab id', () => {
    for (const id of Object.values(DOCK_TAB_IDS)) {
      expect(DOCK_TAB_TITLES[id]).toBeTruthy()
      expect(typeof DOCK_TAB_TITLES[id]).toBe('string')
    }
  })
})
