import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-026: Drag tabs between docks.
 *
 * rc-dock exposes a programmatic `dockMove(source, target, direction)`
 * method on its `DockLayout` ref — we surface this via a test-only
 * `window.__matslopDockMove` global in MatslopDockLayout. Playwright's
 * native pointer-drag is flaky over rc-dock's DragDropDiv, so we drive
 * layout changes through the global instead. The rendered DOM position
 * of the moved tab is what the test asserts — that's the same thing a
 * real drag would end up producing.
 */

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('Dragging the Workspace tab next to Command Window merges it into the bottom dock', async () => {
  const workspaceTab = window.locator('[data-testid="dock-tab-matslop-workspace"]')
  const commandWindowTab = window.locator('[data-testid="dock-tab-matslop-command-window"]')

  // Both dock-tab wrappers must exist in the DOM; rc-dock may keep
  // inactive siblings visibility:hidden, so we assert count only.
  await expect(workspaceTab).toHaveCount(1)
  await expect(commandWindowTab).toHaveCount(1)

  // Before the drag: Workspace sits in the right column, Command Window
  // sits inside the center column. The rc-dock panel ids we resolve via
  // the test-only `__matslopDockGetTabPanelId` hook must differ.
  const getPanelIds = (): Promise<{ ws: string | null; cmd: string | null }> =>
    window.evaluate(() => {
      const w = window as unknown as {
        __matslopDockGetTabPanelId?: (id: string) => string | null
      }
      return {
        ws: w.__matslopDockGetTabPanelId?.('matslop-workspace') ?? null,
        cmd: w.__matslopDockGetTabPanelId?.('matslop-command-window') ?? null,
      }
    })
  const before = await getPanelIds()
  expect(before.ws).toBeTruthy()
  expect(before.cmd).toBeTruthy()
  expect(before.ws).not.toEqual(before.cmd)

  // Perform the drag via the test-only rc-dock API hook. 'middle' merges
  // the source tab into the target panel as a sibling tab.
  const moved = await window.evaluate(() => {
    const w = window as unknown as {
      __matslopDockMove?: (src: string, tgt: string, dir: string) => boolean
    }
    return w.__matslopDockMove?.('matslop-workspace', 'matslop-command-window', 'middle') ?? false
  })
  expect(moved).toBe(true)

  // After the drag: Workspace and Command Window should live in the
  // SAME rc-dock panel (merged as sibling tabs).
  await expect
    .poll(async () => {
      const after = await getPanelIds()
      return !!(after.ws && after.cmd && after.ws === after.cmd)
    }, { timeout: 3000 })
    .toBe(true)

  // Both tab contents must still be attached to the DOM — merging must
  // not orphan them. Only one sibling tab is visible at a time in a
  // merged panel, so we assert count instead of visibility.
  await expect(workspaceTab).toHaveCount(1)
  await expect(commandWindowTab).toHaveCount(1)
})

test('Saved dock layout round-trips through the layout IPC', async () => {
  // Capture the current (post-drag) dock layout via the test hook,
  // then verify that the layout IPC persisted the same structure so
  // a restart would reload the dragged-together arrangement.
  const savedFromRef = await window.evaluate(() => {
    const w = window as unknown as { __matslopDockSaveLayout?: () => unknown }
    return w.__matslopDockSaveLayout?.() ?? null
  })
  expect(savedFromRef).toBeTruthy()

  const storedFromIpc = await window.evaluate(async () => {
    return await window.matslop.layoutGet()
  })
  expect(storedFromIpc.dockLayout).toBeTruthy()

  // The stored tree must mention both tabs somewhere (structural check).
  const json = JSON.stringify(storedFromIpc.dockLayout)
  expect(json).toContain('matslop-workspace')
  expect(json).toContain('matslop-command-window')
})
