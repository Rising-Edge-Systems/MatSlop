import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

/**
 * US-003: Apply MATLAB-default layout preset on first launch.
 *
 * Every Playwright run uses an isolated MATSLOP_USER_DATA_DIR via launchApp,
 * so the app starts with no stored layout and should render the MATLAB-like
 * defaults: File Browser (left) | Editor + Command Window (center) | Workspace (right).
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

test('First launch: MATLAB-default layout puts File Browser | Editor/Command | Workspace in 3 columns', async () => {
  const fileBrowser = window.locator('[data-testid="file-browser"]')
  const editorColumn = window.locator('[data-testid="editor-column"]')
  const editorPanel = window.locator('[data-testid="editor-panel"]')
  const commandWindow = window.locator('[data-testid="command-window"]')
  const workspace = window.locator('[data-testid="workspace-panel"]')

  await expect(fileBrowser).toBeVisible()
  await expect(editorColumn).toBeVisible()
  await expect(editorPanel).toBeVisible()
  await expect(commandWindow).toBeVisible()
  await expect(workspace).toBeVisible()

  const fbBox = await fileBrowser.boundingBox()
  const colBox = await editorColumn.boundingBox()
  const edBox = await editorPanel.boundingBox()
  const cmdBox = await commandWindow.boundingBox()
  const wsBox = await workspace.boundingBox()
  expect(fbBox && colBox && edBox && cmdBox && wsBox).toBeTruthy()
  if (!fbBox || !colBox || !edBox || !cmdBox || !wsBox) return

  const tol = 4

  // File Browser sits to the left of the editor column
  expect(fbBox.x + fbBox.width).toBeLessThanOrEqual(colBox.x + tol)

  // Workspace sits to the right of the editor column
  expect(wsBox.x).toBeGreaterThanOrEqual(colBox.x + colBox.width - tol)

  // Editor sits above the Command Window within the center column
  expect(edBox.y + edBox.height).toBeLessThanOrEqual(cmdBox.y + tol)

  // All three top-level columns are roughly the same height (main work area).
  // Tolerance is larger (60px) because US-025 migrated the layout to rc-dock:
  // file-browser / workspace measurements exclude their tab-header bar, while
  // the editor column is a dock-vbox with no tab header, so a ~30px tab-bar
  // delta is expected.
  expect(Math.abs(fbBox.height - colBox.height)).toBeLessThan(60)
  expect(Math.abs(wsBox.height - colBox.height)).toBeLessThan(60)

  // Sanity: File Browser width roughly matches MATLAB-like default (~220px, allow wide range)
  expect(fbBox.width).toBeGreaterThan(120)
  expect(fbBox.width).toBeLessThan(500)

  // Sanity: Workspace width roughly matches MATLAB-like default (~280px, allow wide range)
  expect(wsBox.width).toBeGreaterThan(120)
  expect(wsBox.width).toBeLessThan(600)
})

test('Reset Layout menu action restores the MATLAB-default layout', async () => {
  // Snapshot initial layout
  const fileBrowser = window.locator('[data-testid="file-browser"]')
  const workspace = window.locator('[data-testid="workspace-panel"]')
  const commandWindow = window.locator('[data-testid="command-window"]')

  const fbBefore = await fileBrowser.boundingBox()
  const wsBefore = await workspace.boundingBox()
  const cmdBefore = await commandWindow.boundingBox()
  expect(fbBefore && wsBefore && cmdBefore).toBeTruthy()
  if (!fbBefore || !wsBefore || !cmdBefore) return

  // Perturb: hide several panels via menu actions (changes layout state)
  await window.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).matslop
    await api._testMenuAction('toggleWorkspace')
    await api._testMenuAction('toggleFileBrowser')
    await api._testMenuAction('toggleCommandWindow')
  })

  // Panels should be hidden now
  await expect(fileBrowser).toBeHidden()
  await expect(workspace).toBeHidden()
  await expect(commandWindow).toBeHidden()

  // Reset Layout menu → restores defaults
  await window.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).matslop._testMenuAction('resetLayout')
  })

  // Panels should be visible again in their default positions
  await expect(fileBrowser).toBeVisible()
  await expect(workspace).toBeVisible()
  await expect(commandWindow).toBeVisible()

  const fbAfter = await fileBrowser.boundingBox()
  const wsAfter = await workspace.boundingBox()
  const cmdAfter = await commandWindow.boundingBox()
  expect(fbAfter && wsAfter && cmdAfter).toBeTruthy()
  if (!fbAfter || !wsAfter || !cmdAfter) return

  // Bounding boxes should match the first-launch snapshot (within tolerance)
  const tol = 8
  expect(Math.abs(fbAfter.x - fbBefore.x)).toBeLessThan(tol)
  expect(Math.abs(fbAfter.width - fbBefore.width)).toBeLessThan(tol)
  expect(Math.abs(wsAfter.x - wsBefore.x)).toBeLessThan(tol)
  expect(Math.abs(wsAfter.width - wsBefore.width)).toBeLessThan(tol)
  expect(Math.abs(cmdAfter.y - cmdBefore.y)).toBeLessThan(tol)
})
