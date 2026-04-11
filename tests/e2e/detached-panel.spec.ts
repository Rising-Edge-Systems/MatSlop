import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-027: Detach panel to separate OS window.
 *
 * Exercises the end-to-end detach → redock flow for a dock panel:
 *
 *   1. Call the `onDetachTab` path (via the exposed test hook) for the
 *      Workspace panel.
 *   2. Assert a new `BrowserWindow` opens, carrying
 *      `?detachedPanelId=matslop-workspace` in its URL.
 *   3. Assert the main-window dock layout omits the Workspace tab for
 *      the duration — its `data-testid` disappears from the DOM.
 *   4. Assert the detached window's `DetachedPanel` root mounts and the
 *      shared Octave status is surfaced via the preload bridge (proves
 *      IPC is wired).
 *   5. Close the detached window and verify the Workspace tab is
 *      re-added (redocked) and the main-process bookkeeping is cleared.
 *
 * Also covers the tab context menu:
 *
 *   6. Use `__matslopOpenTabContextMenu` to open the menu, assert the
 *      "Detach to window" option is visible, click it, and confirm the
 *      same detach flow runs.
 */

let app: ElectronApplication
let mainWindow: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window: mainWindow, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

async function waitForDetached(count: number): Promise<void> {
  await mainWindow.waitForFunction(
    async (expected) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = await (window as any).matslop._testDetachedPanelList()
      return Array.isArray(list) && list.length === expected
    },
    count,
    { timeout: 5000 },
  )
}

test('workspace panel detaches into its own BrowserWindow and redocks on close', async () => {
  await expect(mainWindow.locator('#root')).toBeVisible()
  // Workspace panel is visible by default (MATLAB-default layout).
  await expect(mainWindow.locator('[data-testid="dock-tab-matslop-workspace"]')).toHaveCount(1)

  // Drive the detach via the React test hook + wait for the new window.
  const [detachedPage] = await Promise.all([
    app.waitForEvent('window'),
    mainWindow.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      return w.__matslopDetachPanelTab('matslop-workspace')
    }),
  ])

  await detachedPage.waitForLoadState('domcontentloaded')

  // Query string carries the panel id.
  const search = await detachedPage.evaluate(() => window.location.search)
  expect(search).toMatch(/detachedPanelId=matslop-workspace/)

  // Detached window mounts the panel root with the correct panel id.
  await expect(detachedPage.locator('[data-testid="detached-panel-root"]')).toBeVisible({
    timeout: 10000,
  })
  const panelIdAttr = await detachedPage
    .locator('[data-testid="detached-panel-root"]')
    .getAttribute('data-panel-id')
  expect(panelIdAttr).toBe('matslop-workspace')

  // Title matches the dock-tab label.
  await expect(detachedPage.locator('[data-testid="detached-panel-title"]')).toHaveText(
    'Workspace',
  )

  // Shared Octave status surfaced via IPC — proves the preload bridge works
  // in the detached window. It may be 'disconnected' in e2e (no bundled
  // Octave), which is exactly what the main window reports too, confirming
  // they share state.
  await expect(detachedPage.locator('[data-testid="detached-panel-status"]')).toBeVisible()

  // Main window layout omits the detached tab.
  await expect(mainWindow.locator('[data-testid="dock-tab-matslop-workspace"]')).toHaveCount(0)

  // Main process bookkeeping registers the detached panel.
  await waitForDetached(1)
  const detachedList = await mainWindow.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__matslopDetachedPanels as string[]
  })
  expect(detachedList).toContain('matslop-workspace')

  // Close the detached window → main should redock the panel.
  await detachedPage.close()

  await waitForDetached(0)
  await expect(mainWindow.locator('[data-testid="dock-tab-matslop-workspace"]')).toHaveCount(1)
})

test('tab context menu exposes Detach option and triggers detach', async () => {
  // Open context menu for the File Browser tab via the test hook.
  await mainWindow.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__matslopOpenTabContextMenu('matslop-file-browser')
  })

  const menu = mainWindow.locator('[data-testid="dock-tab-context-menu"]')
  await expect(menu).toBeVisible()
  expect(await menu.getAttribute('data-tab-id')).toBe('matslop-file-browser')

  const detachOpt = mainWindow.locator('[data-testid="dock-tab-context-menu-detach"]')
  await expect(detachOpt).toBeVisible()
  await expect(detachOpt).toHaveText(/Detach/)

  // Clicking the option fires onDetachTab which opens a new window.
  const [detachedPage] = await Promise.all([
    app.waitForEvent('window'),
    detachOpt.click(),
  ])
  await detachedPage.waitForLoadState('domcontentloaded')
  await expect(detachedPage.locator('[data-testid="detached-panel-root"]')).toBeVisible({
    timeout: 10000,
  })
  expect(
    await detachedPage
      .locator('[data-testid="detached-panel-root"]')
      .getAttribute('data-panel-id'),
  ).toBe('matslop-file-browser')

  // Main window no longer renders the file browser tab.
  await expect(mainWindow.locator('[data-testid="dock-tab-matslop-file-browser"]')).toHaveCount(0)

  // Menu should have been dismissed after clicking the option.
  await expect(menu).toHaveCount(0)

  await detachedPage.close()
  await waitForDetached(0)
  await expect(mainWindow.locator('[data-testid="dock-tab-matslop-file-browser"]')).toHaveCount(1)
})
