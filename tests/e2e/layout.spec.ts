import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('Command Window is horizontally contained within the editor column', async () => {
  const editorColumn = window.locator('[data-testid="editor-column"]')
  const commandWindow = window.locator('[data-testid="command-window"]')
  await expect(editorColumn).toBeVisible()
  await expect(commandWindow).toBeVisible()

  const colBox = await editorColumn.boundingBox()
  const cmdBox = await commandWindow.boundingBox()
  expect(colBox).not.toBeNull()
  expect(cmdBox).not.toBeNull()
  if (!colBox || !cmdBox) return

  // Command Window must be horizontally contained within the editor column
  // (with a small tolerance for sash/border widths)
  const tolerance = 4
  expect(cmdBox.x).toBeGreaterThanOrEqual(colBox.x - tolerance)
  expect(cmdBox.x + cmdBox.width).toBeLessThanOrEqual(colBox.x + colBox.width + tolerance)
})

test('Command Window sits below the Editor in the same column', async () => {
  const editorPanel = window.locator('[data-testid="editor-panel"]')
  const commandWindow = window.locator('[data-testid="command-window"]')
  const editorBox = await editorPanel.boundingBox()
  const cmdBox = await commandWindow.boundingBox()
  expect(editorBox).not.toBeNull()
  expect(cmdBox).not.toBeNull()
  if (!editorBox || !cmdBox) return

  // Command Window top should be at or below editor's bottom
  expect(cmdBox.y).toBeGreaterThanOrEqual(editorBox.y + editorBox.height - 4)
})

test('Command Window does NOT extend under the File Browser', async () => {
  const fileBrowser = window.locator('[data-testid="file-browser"]')
  const commandWindow = window.locator('[data-testid="command-window"]')
  const fbBox = await fileBrowser.boundingBox()
  const cmdBox = await commandWindow.boundingBox()
  expect(fbBox).not.toBeNull()
  expect(cmdBox).not.toBeNull()
  if (!fbBox || !cmdBox) return

  // Command Window left edge must be to the right of the File Browser's right edge
  expect(cmdBox.x).toBeGreaterThanOrEqual(fbBox.x + fbBox.width - 4)
})

test('Command Window does NOT extend under the Workspace', async () => {
  const workspace = window.locator('[data-testid="workspace-panel"]')
  const commandWindow = window.locator('[data-testid="command-window"]')
  const wsBox = await workspace.boundingBox()
  const cmdBox = await commandWindow.boundingBox()
  expect(wsBox).not.toBeNull()
  expect(cmdBox).not.toBeNull()
  if (!wsBox || !cmdBox) return

  // Command Window right edge must be to the left of the Workspace's left edge
  expect(cmdBox.x + cmdBox.width).toBeLessThanOrEqual(wsBox.x + 4)
})
