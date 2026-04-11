import { describe, it, expect, vi, beforeEach } from 'vitest'

// US-Q07: Layout schema versioning. Mock electron-store the same way the
// theme test does so this file is importable in pure node.
const storeData: Record<string, unknown> = {}

vi.mock('electron-store', () => {
  return {
    default: class FakeStore {
      get(key: string, fallback: unknown): unknown {
        return key in storeData ? storeData[key] : fallback
      }
      set(key: string, value: unknown): void {
        storeData[key] = value
      }
    },
  }
})

beforeEach(() => {
  for (const k of Object.keys(storeData)) delete storeData[k]
})

describe('US-Q07: layout schema version', () => {
  it('LAYOUT_SCHEMA_VERSION is at least 2', async () => {
    const mod = await import('../../src/main/appConfig')
    expect(mod.LAYOUT_SCHEMA_VERSION).toBeGreaterThanOrEqual(2)
  })

  it('migrateLayoutConfig: stale version drops dockLayout but preserves visibility + sizes', async () => {
    const mod = await import('../../src/main/appConfig')
    const stale = {
      // no `version` field at all → counts as 0
      panelVisibility: {
        fileBrowser: false,
        workspace: true,
        commandWindow: true,
        commandHistory: true, // user explicitly turned on history
      },
      panelSizes: {
        fileBrowserWidth: 333,
        workspaceWidth: 444,
        bottomHeight: 555,
        commandHistoryWidth: 666,
      },
      dockLayout: { dockbox: { id: 'stale-tree', mode: 'horizontal', children: [] } },
    }
    const migrated = mod.migrateLayoutConfig(stale)
    expect(migrated.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
    expect(migrated.dockLayout).toBeUndefined()
    expect(migrated.panelVisibility.fileBrowser).toBe(false)
    expect(migrated.panelVisibility.commandHistory).toBe(true)
    expect(migrated.panelSizes.fileBrowserWidth).toBe(333)
    expect(migrated.panelSizes.commandHistoryWidth).toBe(666)
  })

  it('migrateLayoutConfig: current version passes dockLayout through', async () => {
    const mod = await import('../../src/main/appConfig')
    const tree = { dockbox: { id: 'kept', mode: 'horizontal', children: [] } }
    const current = {
      version: mod.LAYOUT_SCHEMA_VERSION,
      panelVisibility: {
        fileBrowser: true,
        workspace: true,
        commandWindow: true,
        commandHistory: false,
      },
      panelSizes: {
        fileBrowserWidth: 220,
        workspaceWidth: 280,
        bottomHeight: 200,
        commandHistoryWidth: 250,
      },
      dockLayout: tree,
    }
    const migrated = mod.migrateLayoutConfig(current)
    expect(migrated.dockLayout).toEqual(tree)
  })

  it('migrateLayoutConfig: missing or malformed input falls back to defaults', async () => {
    const mod = await import('../../src/main/appConfig')
    const fromNull = mod.migrateLayoutConfig(null)
    expect(fromNull.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
    expect(fromNull.dockLayout).toBeUndefined()
    expect(fromNull.panelVisibility.commandWindow).toBe(true)

    const fromGarbage = mod.migrateLayoutConfig('not-an-object')
    expect(fromGarbage.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
  })

  it('getLayoutConfig: rewrites stale persisted layout to current version on first read', async () => {
    storeData.layout = {
      // no version → stale
      panelVisibility: {
        fileBrowser: true,
        workspace: true,
        commandWindow: true,
        commandHistory: false,
      },
      panelSizes: {
        fileBrowserWidth: 220,
        workspaceWidth: 280,
        bottomHeight: 200,
        commandHistoryWidth: 250,
      },
      dockLayout: { dockbox: { id: 'pre-polish-tree', mode: 'horizontal', children: [] } },
    }
    const mod = await import('../../src/main/appConfig')
    const got = mod.getLayoutConfig()
    expect(got.dockLayout).toBeUndefined()
    expect(got.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
    // The migrated version is now persisted in the (fake) store too.
    const persisted = storeData.layout as { version?: number; dockLayout?: unknown }
    expect(persisted.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
    expect(persisted.dockLayout).toBeUndefined()
  })

  it('setLayoutConfig: always stamps the current schema version', async () => {
    const mod = await import('../../src/main/appConfig')
    mod.setLayoutConfig({
      panelVisibility: {
        fileBrowser: true,
        workspace: true,
        commandWindow: true,
        commandHistory: false,
      },
      panelSizes: {
        fileBrowserWidth: 220,
        workspaceWidth: 280,
        bottomHeight: 200,
        commandHistoryWidth: 250,
      },
      dockLayout: { dockbox: { id: 'fresh', mode: 'horizontal', children: [] } },
    })
    const persisted = storeData.layout as { version?: number }
    expect(persisted.version).toBe(mod.LAYOUT_SCHEMA_VERSION)
  })
})
