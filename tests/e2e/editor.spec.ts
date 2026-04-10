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

test('opens hello.m and tab appears', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'hello.m'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')).toBeVisible()
})

test('opens matrix_ops.m as second tab', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'matrix_ops.m'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="matrix_ops.m"]')).toBeVisible()
  // Previous tab still there
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')).toBeVisible()
})

test('opens function_def.m', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'function_def.m'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="function_def.m"]')).toBeVisible()
})

test('opens error.m', async () => {
  await openFileInEditor(window, path.join(FIXTURES_DIR, 'scripts', 'error.m'))
  await expect(window.locator('[data-testid="editor-tab"][data-tab-filename="error.m"]')).toBeVisible()
})

test('tab close button removes the tab', async () => {
  const errorTab = window.locator('[data-testid="editor-tab"][data-tab-filename="error.m"]')
  await errorTab.locator('.editor-tab-close').click()
  await expect(errorTab).not.toBeVisible()
})

test('switching tabs works', async () => {
  const helloTab = window.locator('[data-testid="editor-tab"][data-tab-filename="hello.m"]')
  await helloTab.click()
  await expect(helloTab).toHaveClass(/active/)
})
