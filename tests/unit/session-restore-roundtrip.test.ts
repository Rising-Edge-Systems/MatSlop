/**
 * US-L06: Session restore after rc-dock migration.
 *
 * Verifies that both the editor session (tabs + cursors) and the rc-dock
 * layout survive a full JSON round-trip — the critical path for session
 * restore after an app restart. Also tests graceful degradation for
 * old/invalid persisted data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  tabsToSession,
  sessionToTabs,
  type SessionStateWire,
} from '../../src/renderer/editor/sessionState'
import type { EditorTab } from '../../src/renderer/editor/editorTypes'
import { normalizeSession } from '../../src/main/sessionStore'
import {
  buildDefaultDockLayout,
  buildDockLayoutFromVisibility,
  sanitizeSavedDockLayout,
  DEFAULT_DOCK_VISIBILITY,
  DOCK_TAB_IDS,
  type DockVisibility,
} from '../../src/renderer/panels/MatslopDockLayout'
import type { BoxData, LayoutBase, PanelData } from 'rc-dock'

// --- helpers ---------------------------------------------------------------

function collectTabIds(node: BoxData | PanelData): string[] {
  if ('tabs' in node) {
    return (node as PanelData).tabs.map((t) => String(t.id ?? ''))
  }
  if ('children' in node) {
    return (node as BoxData).children.flatMap(collectTabIds)
  }
  return []
}

function makeTab(overrides: Partial<EditorTab>): EditorTab {
  return {
    id: 'tab-1',
    filename: 'untitled.m',
    content: '',
    savedContent: '',
    filePath: null,
    mode: 'script',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// rc-dock layout JSON round-trip
// ---------------------------------------------------------------------------

describe('US-L06: rc-dock layout JSON round-trip', () => {
  it('default layout survives JSON.stringify → JSON.parse', () => {
    const layout = buildDefaultDockLayout()
    const json = JSON.stringify(layout)
    const parsed = JSON.parse(json) as LayoutBase

    // Structural integrity
    expect(parsed.dockbox).toBeDefined()
    expect((parsed.dockbox as BoxData).mode).toBe('horizontal')

    // All tab ids survive
    const beforeIds = collectTabIds(layout.dockbox).sort()
    const afterIds = collectTabIds(parsed.dockbox as BoxData).sort()
    expect(afterIds).toEqual(beforeIds)
  })

  it('custom visibility layout survives JSON round-trip', () => {
    const vis: DockVisibility = {
      ...DEFAULT_DOCK_VISIBILITY,
      commandHistory: true,
      callStack: true,
      watches: true,
      helpBrowser: true,
    }
    const layout = buildDockLayoutFromVisibility(vis)
    const json = JSON.stringify(layout)
    const parsed = JSON.parse(json) as LayoutBase

    const beforeIds = collectTabIds(layout.dockbox).sort()
    const afterIds = collectTabIds(parsed.dockbox as BoxData).sort()
    expect(afterIds).toEqual(beforeIds)
    expect(afterIds).toContain(DOCK_TAB_IDS.commandHistory)
    expect(afterIds).toContain(DOCK_TAB_IDS.callStack)
    expect(afterIds).toContain(DOCK_TAB_IDS.watches)
    expect(afterIds).toContain(DOCK_TAB_IDS.helpBrowser)
  })

  it('sanitized layout survives a second JSON round-trip (idempotent)', () => {
    const layout = buildDefaultDockLayout()
    const sanitized = sanitizeSavedDockLayout(
      layout as unknown as LayoutBase,
      DEFAULT_DOCK_VISIBILITY,
    )!

    // First round-trip
    const json1 = JSON.stringify(sanitized)
    const parsed1 = JSON.parse(json1) as LayoutBase

    // Second round-trip (idempotent)
    const json2 = JSON.stringify(parsed1)
    expect(json2).toBe(json1)
  })

  it('layout with floatbox survives JSON round-trip', () => {
    const layout: LayoutBase = {
      dockbox: {
        mode: 'horizontal',
        children: [
          { tabs: [{ id: DOCK_TAB_IDS.editor }] } as unknown as PanelData,
          { tabs: [{ id: DOCK_TAB_IDS.commandWindow }] } as unknown as PanelData,
        ],
      } as BoxData,
      floatbox: {
        mode: 'float',
        children: [
          {
            tabs: [{ id: DOCK_TAB_IDS.workspace }],
            x: 100,
            y: 200,
            w: 300,
            h: 400,
          } as unknown as PanelData,
        ],
      } as BoxData,
    }

    const json = JSON.stringify(layout)
    const parsed = JSON.parse(json) as LayoutBase & { floatbox?: BoxData }
    expect(parsed.floatbox).toBeDefined()
    expect(parsed.floatbox!.children).toHaveLength(1)

    const floatPanel = parsed.floatbox!.children[0] as PanelData & {
      x: number
      y: number
      w: number
      h: number
    }
    expect(floatPanel.x).toBe(100)
    expect(floatPanel.y).toBe(200)
    expect(floatPanel.w).toBe(300)
    expect(floatPanel.h).toBe(400)
    expect(collectTabIds(floatPanel)).toEqual([DOCK_TAB_IDS.workspace])
  })

  it('sanitizer correctly handles floatbox with ghost tabs', () => {
    const layout: LayoutBase = {
      dockbox: {
        mode: 'horizontal',
        children: [
          { tabs: [{ id: DOCK_TAB_IDS.editor }] } as unknown as PanelData,
        ],
      } as BoxData,
      floatbox: {
        mode: 'float',
        children: [
          {
            tabs: [{ id: 'matslop-bogus-float' }],
          } as unknown as PanelData,
        ],
      } as BoxData,
    }

    const cleaned = sanitizeSavedDockLayout(layout, DEFAULT_DOCK_VISIBILITY)
    expect(cleaned).not.toBeNull()
    // The bogus float tab should be stripped and the floatbox deleted
    const asAny = cleaned as unknown as Record<string, unknown>
    expect(asAny.floatbox).toBeUndefined()
  })

  it('sanitizer preserves valid floatbox panels after JSON round-trip', () => {
    const layout: LayoutBase = {
      dockbox: {
        mode: 'horizontal',
        children: [
          { tabs: [{ id: DOCK_TAB_IDS.editor }] } as unknown as PanelData,
        ],
      } as BoxData,
      floatbox: {
        mode: 'float',
        children: [
          {
            tabs: [{ id: DOCK_TAB_IDS.workspace }],
            x: 50,
            y: 50,
            w: 200,
            h: 300,
          } as unknown as PanelData,
        ],
      } as BoxData,
    }

    // Simulate persist → restore
    const json = JSON.stringify(layout)
    const parsed = JSON.parse(json) as LayoutBase

    const cleaned = sanitizeSavedDockLayout(parsed, DEFAULT_DOCK_VISIBILITY)
    expect(cleaned).not.toBeNull()
    const asAny = cleaned as unknown as Record<string, unknown>
    expect(asAny.floatbox).toBeDefined()
    const fb = asAny.floatbox as BoxData
    expect(fb.children).toHaveLength(1)
    expect(collectTabIds(fb.children[0])).toEqual([DOCK_TAB_IDS.workspace])
  })

  it('layout size/flex values survive JSON round-trip', () => {
    const layout = buildDefaultDockLayout()
    const json = JSON.stringify(layout)
    const parsed = JSON.parse(json)

    // Check that size values are preserved
    const origSizes = layout.dockbox.children.map(
      (c) => (c as { size?: number }).size,
    )
    const parsedSizes = (parsed as { dockbox: BoxData }).dockbox.children.map(
      (c) => (c as { size?: number }).size,
    )
    expect(parsedSizes).toEqual(origSizes)
  })
})

// ---------------------------------------------------------------------------
// Editor session JSON round-trip
// ---------------------------------------------------------------------------

describe('US-L06: editor session JSON round-trip', () => {
  it('full session round-trips through JSON.stringify → JSON.parse → normalize → restore', () => {
    const tabs: EditorTab[] = [
      makeTab({
        id: 'tab-A',
        filename: 'script.m',
        filePath: '/home/user/script.m',
        content: 'x = magic(5);\ndisp(x);',
        savedContent: 'x = magic(5);\ndisp(x);',
        mode: 'script',
      }),
      makeTab({
        id: 'tab-B',
        filename: 'analysis.m',
        filePath: '/home/user/analysis.m',
        content: 'modified content',
        savedContent: 'original content',
        mode: 'script',
      }),
    ]
    const cursors = {
      'tab-A': { line: 2, column: 7 },
      'tab-B': { line: 1, column: 1 },
    }

    // Save
    const wire = tabsToSession(tabs, 'tab-B', cursors)

    // Simulate disk round-trip
    const json = JSON.stringify(wire)
    const parsed = JSON.parse(json) as unknown

    // Main-process validation
    const normalized = normalizeSession(parsed)
    expect(normalized).not.toBeNull()
    expect(normalized!.tabs).toHaveLength(2)
    expect(normalized!.activeTabId).toBe('tab-B')

    // Renderer-side restore
    const restored = sessionToTabs(normalized as unknown as SessionStateWire)
    expect(restored).not.toBeNull()
    expect(restored!.tabs).toHaveLength(2)
    expect(restored!.activeTabId).toBe('tab-B')

    // File paths preserved
    expect(restored!.tabs[0].filePath).toBe('/home/user/script.m')
    expect(restored!.tabs[1].filePath).toBe('/home/user/analysis.m')

    // Dirty content preserved
    expect(restored!.tabs[1].content).toBe('modified content')
    expect(restored!.tabs[1].savedContent).toBe('original content')

    // Cursors preserved
    expect(restored!.cursors['tab-A']).toEqual({ line: 2, column: 7 })
    expect(restored!.cursors['tab-B']).toEqual({ line: 1, column: 1 })
  })

  it('session with no tabs restores as null (falls back to empty state)', () => {
    const wire: SessionStateWire = {
      version: 1,
      savedAt: Date.now(),
      activeTabId: null,
      tabs: [],
    }
    const json = JSON.stringify(wire)
    const parsed = JSON.parse(json)
    const normalized = normalizeSession(parsed)
    // normalizeSession allows empty tabs array (it's valid)
    // but sessionToTabs returns null for empty tabs → app shows empty state
    const restored = sessionToTabs(normalized as unknown as SessionStateWire)
    expect(restored).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Graceful degradation for old/invalid data
// ---------------------------------------------------------------------------

describe('US-L06: graceful handling of old/invalid session data', () => {
  it('corrupted JSON in session.json → normalizeSession returns null', () => {
    // Simulate what happens when readSession parses garbage
    expect(normalizeSession(undefined)).toBeNull()
    expect(normalizeSession(null)).toBeNull()
    expect(normalizeSession('')).toBeNull()
    expect(normalizeSession(42)).toBeNull()
    expect(normalizeSession([])).toBeNull()
    expect(normalizeSession({ version: 99 })).toBeNull()
  })

  it('pre-rc-dock session (valid tabs, no layout) restores tabs gracefully', () => {
    // Old session.json from before rc-dock migration — tabs are valid,
    // but the layout system was completely different (Allotment)
    const oldSession = {
      version: 1,
      savedAt: 1629345600000,
      activeTabId: 'tab-1',
      tabs: [
        {
          id: 'tab-1',
          filename: 'old_script.m',
          filePath: '/home/user/old_script.m',
          mode: 'script',
          content: 'fprintf("old")',
          savedContent: 'fprintf("old")',
          cursorLine: 1,
          cursorColumn: 15,
        },
      ],
    }

    const json = JSON.stringify(oldSession)
    const parsed = JSON.parse(json)
    const normalized = normalizeSession(parsed)
    expect(normalized).not.toBeNull()

    const restored = sessionToTabs(normalized as unknown as SessionStateWire)
    expect(restored).not.toBeNull()
    expect(restored!.tabs[0].filePath).toBe('/home/user/old_script.m')
    expect(restored!.cursors['tab-1']).toEqual({ line: 1, column: 15 })
  })

  it('session with extra unknown fields is accepted (forward compat)', () => {
    const futureSession = {
      version: 1,
      savedAt: Date.now(),
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          filename: 'a.m',
          filePath: null,
          mode: 'script',
          content: '',
          savedContent: '',
          // Unknown future field
          foldState: [{ start: 1, end: 5 }],
        },
      ],
      // Unknown future top-level field
      themeSnapshot: 'dark',
    }

    const normalized = normalizeSession(futureSession)
    expect(normalized).not.toBeNull()
    expect(normalized!.tabs).toHaveLength(1)
  })

  it('sanitizer returns null for completely invalid dockLayout → app uses default', () => {
    const garbage = {
      dockbox: { mode: 'horizontal', children: [] },
    } as unknown as LayoutBase

    const result = sanitizeSavedDockLayout(garbage, DEFAULT_DOCK_VISIBILITY)
    expect(result).toBeNull()
  })

  it('sanitizer returns null for dockLayout with only unknown tab ids', () => {
    const obsolete = {
      dockbox: {
        mode: 'horizontal',
        children: [
          { tabs: [{ id: 'matslop-obsolete-panel' }] },
          { tabs: [{ id: 'matslop-removed-feature' }] },
        ],
      },
    } as unknown as LayoutBase

    const result = sanitizeSavedDockLayout(obsolete, DEFAULT_DOCK_VISIBILITY)
    expect(result).toBeNull()
  })

  it('sanitizer handles layout from future version with extra tab ids', () => {
    const future = {
      dockbox: {
        mode: 'horizontal',
        children: [
          { tabs: [{ id: DOCK_TAB_IDS.editor }] },
          { tabs: [{ id: DOCK_TAB_IDS.commandWindow }] },
          { tabs: [{ id: 'matslop-ai-chat' }] }, // future feature
        ],
      },
    } as unknown as LayoutBase

    const result = sanitizeSavedDockLayout(future, DEFAULT_DOCK_VISIBILITY)
    expect(result).not.toBeNull()
    const ids = collectTabIds(
      (result as unknown as { dockbox: BoxData }).dockbox,
    )
    expect(ids).toContain(DOCK_TAB_IDS.editor)
    expect(ids).toContain(DOCK_TAB_IDS.commandWindow)
    expect(ids).not.toContain('matslop-ai-chat')
  })
})

// ---------------------------------------------------------------------------
// Combined session + layout restore scenario
// ---------------------------------------------------------------------------

describe('US-L06: combined session + layout restore', () => {
  it('session tabs and dock layout can both be serialized and restored independently', () => {
    // Simulate what happens on app close:
    // 1. Session (tabs/cursors) saved to session.json
    // 2. Layout (dock tree) saved to electron-store

    // Save session
    const tabs: EditorTab[] = [
      makeTab({
        id: 'tab-main',
        filename: 'main.m',
        filePath: '/project/main.m',
        content: 'run_analysis()',
        savedContent: 'run_analysis()',
      }),
    ]
    const sessionWire = tabsToSession(tabs, 'tab-main', {
      'tab-main': { line: 1, column: 16 },
    })

    // Save layout
    const dockLayout = buildDockLayoutFromVisibility({
      ...DEFAULT_DOCK_VISIBILITY,
      commandHistory: true,
    })

    // JSON round-trip both
    const sessionJson = JSON.stringify(sessionWire)
    const layoutJson = JSON.stringify(dockLayout)

    // Restore session
    const restoredSession = sessionToTabs(
      normalizeSession(JSON.parse(sessionJson)) as unknown as SessionStateWire,
    )
    expect(restoredSession).not.toBeNull()
    expect(restoredSession!.tabs[0].filename).toBe('main.m')

    // Restore layout
    const parsedLayout = JSON.parse(layoutJson) as LayoutBase
    const vis: DockVisibility = {
      ...DEFAULT_DOCK_VISIBILITY,
      commandHistory: true,
    }
    const cleanedLayout = sanitizeSavedDockLayout(parsedLayout, vis)
    expect(cleanedLayout).not.toBeNull()
    const layoutIds = collectTabIds(
      (cleanedLayout as unknown as { dockbox: BoxData }).dockbox,
    )
    expect(layoutIds).toContain(DOCK_TAB_IDS.editor)
    expect(layoutIds).toContain(DOCK_TAB_IDS.commandWindow)
    expect(layoutIds).toContain(DOCK_TAB_IDS.commandHistory)
    expect(layoutIds).toContain(DOCK_TAB_IDS.workspace)
  })
})
