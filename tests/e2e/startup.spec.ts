import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForOctaveReady } from './helpers/launch'
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

test('app launches with correct title', async () => {
  const title = await window.title()
  expect(title).toBe('MatSlop')
})

test('main window is visible and has root element', async () => {
  const root = window.locator('#root')
  await expect(root).toBeVisible()
})

test('all default panels are mounted', async () => {
  await expect(window.locator('[data-testid="command-window"]')).toBeVisible()
  await expect(window.locator('[data-testid="workspace-panel"]')).toBeVisible()
  await expect(window.locator('[data-testid="file-browser"]')).toBeVisible()
})

test('engine status indicator is present', async () => {
  await expect(window.locator('[data-testid="engine-status"]')).toBeVisible()
})

test('Octave reaches ready status', async () => {
  await waitForOctaveReady(window)
  const statusText = await window.locator('[data-testid="engine-status"]').textContent()
  expect(statusText).toContain('Ready')
})

test('REGRESSION: no infinite render loop (status stays Ready)', async () => {
  await waitForOctaveReady(window)
  // Wait 3s and verify status is still Ready (not flickering)
  await window.waitForTimeout(3000)
  const statusText = await window.locator('[data-testid="engine-status"]').textContent()
  expect(statusText).toContain('Ready')
})

test('REGRESSION: command input is enabled (not disconnected placeholder)', async () => {
  await waitForOctaveReady(window)
  const input = window.locator('[data-testid="command-input"]')
  const placeholder = await input.getAttribute('placeholder')
  expect(placeholder ?? '').not.toContain('not connected')
  await expect(input).toBeEnabled()
})

test('REGRESSION: exactly one Welcome tab on fresh launch', async () => {
  const welcomeTabs = window.locator('[data-testid="editor-tab"][data-tab-filename="Welcome"]')
  const count = await welcomeTabs.count()
  expect(count).toBe(1)
})
