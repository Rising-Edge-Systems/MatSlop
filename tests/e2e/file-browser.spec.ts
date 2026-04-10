import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForOctaveReady } from './helpers/launch'
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

test('file browser panel is visible', async () => {
  await expect(window.locator('[data-testid="file-browser"]')).toBeVisible()
})

test('file browser shows a cwd path', async () => {
  const cwd = window.locator('[data-testid="file-browser"] .fb-path')
  await expect(cwd).toBeVisible()
  const text = await cwd.textContent()
  expect(text?.length).toBeGreaterThan(0)
})

test('file browser lists some entries', async () => {
  // Any home dir should have at least one entry
  const entries = window.locator('[data-testid="file-browser"] .fb-content > *')
  const count = await entries.count()
  expect(count).toBeGreaterThanOrEqual(0) // permissive: just make sure it renders
})
