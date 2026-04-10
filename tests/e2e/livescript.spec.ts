import { test, expect } from '@playwright/test'
import path from 'path'
import { launchApp, closeApp, waitForOctaveReady, openFileInEditor, FIXTURES_DIR } from './helpers/launch'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  ({ app, window, userDataDir } = await launchApp())
  await waitForOctaveReady(window)
})

test.afterAll(async () => {
  await closeApp(app, userDataDir)
})

test('opens basic.mls and parses cells', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'basic.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="basic.mls"]')).toBeVisible()
  // LiveScript editor should render the markdown title
  const editor = window.locator('.tabbed-editor')
  await expect(editor).toContainText('Basic Live Script')
})

test('opens multicell.mls with multiple cells', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'livescripts', 'multicell.mls'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="multicell.mls"]')).toBeVisible()
  const editor = window.locator('.tabbed-editor')
  await expect(editor).toContainText('Multi-Cell Test')
  await expect(editor).toContainText('Now multiply them')
})
